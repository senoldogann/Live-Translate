"""
Deepgram SDK v6 Streaming Client (Listen v1).

Cloud STT is fast enough already. The real bottleneck is turning those fast
segments into stable Turkish output. This client now:

1. Buffers finalized Deepgram segments instead of treating every frame as a
   full sentence.
2. Commits stable clauses early while still flushing the remaining tail on
   speech-final or UtteranceEnd events.
3. Moves translation work off the websocket callback thread.
4. Drops stale preview translations when fresher segments arrive.
"""

import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from queue import Empty, Queue

from deepgram import DeepgramClient
from deepgram.core.events import EventType


@dataclass
class TranslationJob:
    job_id: int
    text: str
    confidence: float
    is_final: bool
    context: str


class DeepgramWSClient:
    """
    Deepgram Nova-3 real-time streaming client built on SDK v6.

    publisher  : ZmqPublisher  — forwards results to Electron
    translator : TranslationEngine — translates transcript to target language
    """

    def __init__(self, publisher, translator=None):
        self.api_key: str = os.getenv("DEEPGRAM_API_KEY", "")
        self.publisher = publisher
        self.translator = translator
        self.source_lang: str = "en"
        self.streaming_mode: bool = False

        self._running: bool = False
        self._client: DeepgramClient | None = None
        # Protected by _conn_lock; written from daemon thread, read from audio thread
        self._connection = None
        self._conn_lock = threading.Lock()
        self._listen_thread: threading.Thread | None = None
        self._keepalive_thread: threading.Thread | None = None
        self._translation_thread: threading.Thread | None = None
        self._keepalive_interval_s: float = 3.0
        self._last_audio_sent_at: float = 0.0

        # Translation stabilization state
        self._segment_lock = threading.Lock()
        self._current_segments: list[str] = []
        self._recent_context: deque[str] = deque(maxlen=3)
        self._last_preview_source: str = ""
        self._last_final_source: str = ""

        # Async translation queue (prevents websocket callback stalls)
        self._translation_queue: Queue[TranslationJob | None] = Queue()
        self._job_counter = 0
        self._latest_preview_job_id = -1
        self._latest_final_job_id = -1

        # Readability tuning: shorter committed chunks so the user can follow
        # along while the speaker keeps talking.
        self._soft_commit_min_words = 6
        self._soft_commit_min_chars = 42
        self._rolling_commit_min_words = 12
        self._rolling_commit_holdback_words = 4
        self._minimum_trailing_words = 3
        self._word_gap_commit_threshold_s = 0.32
        self._terminal_punctuation = (".", "!", "?", "…", ":", ";")
        self._clause_punctuation = (",", "—")
        self._default_keyterms = (
            "Amazon Web Services",
            "AWS",
            "EC2",
            "S3",
            "Lambda",
            "CloudFormation",
            "DynamoDB",
            "Kubernetes",
            "Docker",
            "Terraform",
            "OpenAI",
            "Deepgram",
            "DeepL",
            "API",
            "SDK",
            "CLI",
            "GPU",
            "CPU",
        )

    # ── Public API ──────────────────────────────────────────────────────────

    def start(self, language: str = "en") -> None:
        """Open a new WebSocket connection to Deepgram."""
        if self._running:
            if self.source_lang != language:
                print(f"[Deepgram] Language changed ({self.source_lang} -> {language}), restarting...")
                self.stop()
            else:
                return  # Already running with the same language

        if not self.api_key:
            print("[Deepgram] WARNING: DEEPGRAM_API_KEY is not set — cloud engine disabled.")
            return

        self.source_lang = language
        self._running = True
        self._last_audio_sent_at = time.monotonic()
        self._client = DeepgramClient(api_key=self.api_key)
        self._translation_queue = Queue()
        self._job_counter = 0
        self._latest_preview_job_id = -1
        self._latest_final_job_id = -1
        self._reset_utterance_state(clear_context=False)

        print(f"[Deepgram] Starting SDK v6 (model=nova-3, language={self.source_lang})...")

        self._translation_thread = threading.Thread(
            target=self._translation_loop,
            daemon=True,
            name="deepgram-translate",
        )
        self._translation_thread.start()

        # _connection_loop blocks on start_listening(); run in a daemon thread
        self._listen_thread = threading.Thread(
            target=self._connection_loop,
            daemon=True,
            name="deepgram-listen",
        )
        self._listen_thread.start()

        # Deepgram closes idle websocket streams after ~10s without audio.
        # KeepAlive frames keep the stream reusable through normal pauses.
        self._keepalive_thread = threading.Thread(
            target=self._keepalive_loop,
            daemon=True,
            name="deepgram-keepalive",
        )
        self._keepalive_thread.start()

    def has_credentials(self) -> bool:
        return bool(self.api_key.strip())

    def send_audio(self, audio_bytes: bytes) -> None:
        """Send raw PCM-16 LE bytes to the open WebSocket connection."""
        with self._conn_lock:
            conn = self._connection
        if conn is not None and self._running:
            try:
                conn.send_media(audio_bytes)
                self._last_audio_sent_at = time.monotonic()
            except Exception as e:
                print(f"[Deepgram] Audio send error: {e}")

    def stop(self) -> None:
        """Close the WebSocket connection and stop the listener thread."""
        self._running = False

        with self._conn_lock:
            conn = self._connection
        if conn is not None:
            try:
                conn.send_finalize()
            except Exception:
                pass

            try:
                conn.send_close_stream()
            except Exception:
                pass

            try:
                # Fallback for immediate teardown if the server has not yet
                # closed the socket after CloseStream.
                conn._websocket.close()
            except Exception:
                pass  # Connection may already be closed

        if self._translation_thread is not None:
            try:
                self._translation_queue.put_nowait(None)
            except Exception:
                pass
            self._translation_thread.join(timeout=3.0)
            self._translation_thread = None

        if self._listen_thread is not None:
            self._listen_thread.join(timeout=3.0)
            self._listen_thread = None

        if self._keepalive_thread is not None:
            self._keepalive_thread.join(timeout=3.0)
            self._keepalive_thread = None

        with self._conn_lock:
            self._connection = None

        self._client = None
        self._reset_utterance_state(clear_context=True)
        print("[Deepgram] Stopped.")

    def update_api_key(self, new_key: str) -> None:
        """Swap in a new Deepgram API key; restart if currently streaming."""
        normalized = new_key.strip()
        if normalized == self.api_key:
            return
        print("[Deepgram] Updating API key...")
        self.api_key = normalized
        if self._running:
            self.stop()
            if self.has_credentials():
                self.start(self.source_lang)

    # ── Internal ────────────────────────────────────────────────────────────

    def _reset_utterance_state(self, clear_context: bool) -> None:
        with self._segment_lock:
            self._current_segments.clear()
            self._last_preview_source = ""
            self._last_final_source = ""
            if clear_context:
                self._recent_context.clear()

    def _get_keyterms(self) -> list[str] | None:
        env_value = os.getenv("DEEPGRAM_KEYTERMS", "").strip()
        if env_value:
            terms = [term.strip() for term in env_value.split(",") if term.strip()]
            return terms or None

        if self.source_lang.lower() not in {"en", "fi"}:
            return None

        return list(self._default_keyterms)

    def _connection_loop(self) -> None:
        """
        Runs inside the daemon thread.

        Opens a Listen v1 WebSocket, registers event handlers, then blocks on
        start_listening() until the stream is closed locally or by the server.
        """
        if self._client is None:
            return

        try:
            keyterms = self._get_keyterms()
            with self._client.listen.v1.connect(
                model="nova-3",
                language=self.source_lang,
                smart_format="true",
                punctuate="true",
                encoding="linear16",
                channels="1",
                sample_rate="16000",
                interim_results="true",
                utterance_end_ms="1000",
                vad_events="true",
                endpointing="500",
                keyterm=keyterms,
            ) as connection:
                with self._conn_lock:
                    self._connection = connection

                connection.on(EventType.OPEN, self._on_open)
                connection.on(EventType.MESSAGE, self._on_message)
                connection.on(EventType.ERROR, self._on_error)
                connection.on(EventType.CLOSE, self._on_close)

                # Blocks until the server closes the socket or stop() closes it
                connection.start_listening()

        except Exception as e:
            print(f"[Deepgram] Connection error: {e}")
        finally:
            with self._conn_lock:
                self._connection = None
            self._running = False

    def _keepalive_loop(self) -> None:
        """Send KeepAlive during silent periods so the server does not time out."""
        while self._running:
            time.sleep(self._keepalive_interval_s)

            if not self._running:
                return

            if time.monotonic() - self._last_audio_sent_at < self._keepalive_interval_s:
                continue

            with self._conn_lock:
                conn = self._connection

            if conn is None:
                continue

            try:
                conn.send_keep_alive()
            except Exception as exc:
                print(f"[Deepgram] KeepAlive error: {exc}")

    def _translation_loop(self) -> None:
        """Process translation jobs away from the websocket callback thread."""
        while self._running:
            try:
                job = self._translation_queue.get(timeout=0.25)
            except Empty:
                continue

            if job is None:
                return

            if not job.is_final and job.job_id != self._latest_preview_job_id:
                continue

            if job.is_final and job.job_id != self._latest_final_job_id:
                continue

            translated = job.text

            if self.translator is not None:
                try:
                    result = self.translator.translate(
                        job.text,
                        context=job.context,
                        prefer_quality=job.is_final,
                    )
                    if result:
                        translated = result
                except Exception as exc:
                    print(f"[Deepgram] Translation error: {exc}")

            if not self._running:
                continue

            if not job.is_final and job.job_id != self._latest_preview_job_id:
                continue

            if job.is_final and job.job_id != self._latest_final_job_id:
                continue

            if self.publisher is not None:
                print(
                    f"[Transcript] cloud {'FINAL' if job.is_final else 'PREVIEW'} "
                    f"({getattr(self.translator, 'last_provider', 'passthrough')}): "
                    f"'{job.text[:80]}'"
                )
                self.publisher.publish(
                    {
                        "original": job.text,
                        "translated": translated.strip(),
                        "isFinal": job.is_final,
                        "confidence": job.confidence,
                        "source": "cloud",
                        "translationProvider": getattr(self.translator, "last_provider", "passthrough"),
                        "timestamp": time.time(),
                    }
                )

            if job.is_final:
                with self._segment_lock:
                    self._recent_context.append(job.text)
                    self._last_preview_source = ""

    def _build_context(self) -> str:
        with self._segment_lock:
            if not self._recent_context:
                return ""
            return " ".join(self._recent_context)

    def _coalesce_segments(self) -> str:
        return " ".join(segment.strip() for segment in self._current_segments if segment.strip()).strip()

    def _enqueue_translation(
        self,
        text: str,
        confidence: float,
        is_final: bool,
        context: str,
    ) -> None:
        if not text.strip():
            return

        self._job_counter += 1
        job = TranslationJob(
            job_id=self._job_counter,
            text=text.strip(),
            confidence=confidence,
            is_final=is_final,
            context=context,
        )

        if is_final:
            self._latest_final_job_id = job.job_id
            self._latest_preview_job_id = -1
        else:
            self._latest_preview_job_id = job.job_id

        self._translation_queue.put(job)

    def _replace_buffered_segments(self, text: str) -> None:
        normalized = text.strip()
        self._current_segments = [normalized] if normalized else []

    def _split_on_boundary(self, text: str) -> tuple[str, str]:
        normalized = text.strip()
        if not normalized:
            return "", ""

        boundaries = set(self._terminal_punctuation + self._clause_punctuation)

        for index in range(len(normalized) - 1, -1, -1):
            if normalized[index] not in boundaries:
                continue

            prefix = normalized[: index + 1].strip()
            suffix = normalized[index + 1 :].strip()

            if not prefix or not suffix:
                continue

            if len(prefix.split()) < self._soft_commit_min_words:
                continue

            if len(suffix.split()) < self._minimum_trailing_words:
                continue

            return prefix, suffix

        return "", normalized

    def _split_rolling_prefix(self, text: str) -> tuple[str, str]:
        normalized = text.strip()
        if not normalized:
            return "", ""

        words = normalized.split()
        if len(words) < self._rolling_commit_min_words:
            return "", normalized

        prefix_words = words[: -self._rolling_commit_holdback_words]
        suffix_words = words[-self._rolling_commit_holdback_words :]

        if len(prefix_words) < self._soft_commit_min_words:
            return "", normalized

        return " ".join(prefix_words).strip(), " ".join(suffix_words).strip()

    def _split_on_word_gap(self, text: str, words: list[object]) -> tuple[str, str]:
        normalized = text.strip()
        if not normalized or len(words) < 2:
            return "", normalized

        best_prefix_count = -1
        best_gap = 0.0

        for index in range(len(words) - 1):
            current_end = getattr(words[index], "end", None)
            next_start = getattr(words[index + 1], "start", None)

            if not isinstance(current_end, (int, float)):
                continue
            if not isinstance(next_start, (int, float)):
                continue

            gap = float(next_start) - float(current_end)
            if gap >= self._word_gap_commit_threshold_s and gap > best_gap:
                best_gap = gap
                best_prefix_count = index + 1

        if best_prefix_count <= 0:
            return "", normalized

        tokens = normalized.split()
        if len(tokens) <= best_prefix_count:
            return "", normalized

        prefix_tokens = tokens[:best_prefix_count]
        suffix_tokens = tokens[best_prefix_count:]

        if len(prefix_tokens) < self._soft_commit_min_words:
            return "", normalized

        if len(suffix_tokens) < self._minimum_trailing_words:
            return "", normalized

        return " ".join(prefix_tokens).strip(), " ".join(suffix_tokens).strip()

    def _extract_soft_commit(
        self,
        text: str,
        words: list[object] | None = None,
    ) -> tuple[str, str]:
        normalized = text.strip()
        if not normalized:
            return "", ""

        if normalized.endswith(self._terminal_punctuation):
            return normalized, ""

        prefix, suffix = self._split_on_boundary(normalized)
        if prefix:
            return prefix, suffix

        if words:
            prefix, suffix = self._split_on_word_gap(normalized, words)
            if prefix:
                return prefix, suffix

        return self._split_rolling_prefix(normalized)

    def _emit_preview_or_finalize(
        self,
        transcript: str,
        confidence: float,
        speech_final: bool,
        words: list[object] | None = None,
    ) -> None:
        normalized = transcript.strip()
        if not normalized:
            return

        final_text = ""
        preview_text = ""
        final_context = ""
        preview_context = ""

        with self._segment_lock:
            if not self._current_segments or self._current_segments[-1] != normalized:
                self._current_segments.append(normalized)

            combined = self._coalesce_segments()
            if not combined:
                return

            if speech_final:
                if combined == self._last_final_source:
                    self._current_segments.clear()
                    self._last_preview_source = ""
                    return

                final_text = combined
                self._last_final_source = combined
                self._current_segments.clear()
                self._last_preview_source = ""
            else:
                clause_text, remainder = self._extract_soft_commit(
                    combined,
                    words=words,
                )
                if clause_text:
                    if clause_text != self._last_final_source:
                        final_text = clause_text
                        self._last_final_source = clause_text

                    self._replace_buffered_segments(remainder)
                    self._last_preview_source = ""

                    if self.streaming_mode and remainder:
                        preview_text = remainder
                        self._last_preview_source = remainder
                elif self.streaming_mode and combined != self._last_preview_source:
                    preview_text = combined
                    self._last_preview_source = combined
                else:
                    return

        if final_text:
            final_context = self._build_context()
            self._enqueue_translation(
                final_text,
                confidence=confidence,
                is_final=True,
                context=final_context,
            )

        if preview_text:
            preview_context = final_context
            if final_text:
                preview_context = " ".join(part for part in (final_context, final_text) if part)
            self._enqueue_translation(
                preview_text,
                confidence=confidence,
                is_final=False,
                context=preview_context,
            )

    def _flush_buffered_utterance(self) -> None:
        with self._segment_lock:
            combined = self._coalesce_segments()
            if not combined:
                return

            if combined == self._last_final_source:
                self._current_segments.clear()
                self._last_preview_source = ""
                return

            self._last_final_source = combined
            self._current_segments.clear()
            self._last_preview_source = ""

        self._enqueue_translation(
            combined,
            confidence=0.0,
            is_final=True,
            context=self._build_context(),
        )

    # ── Event handlers ──────────────────────────────────────────────────────

    def _on_open(self, *args, **kwargs) -> None:
        print("[Deepgram] WebSocket connected — SDK v6 active.")

    def _on_message(self, *args, **kwargs) -> None:
        """
        Called for every server message. We intentionally ignore unstable interim
        frames and only emit previews from finalized segments.
        """
        try:
            message = args[0] if args else kwargs.get("message")
            if message is None:
                return

            message_type = getattr(message, "type", None)

            if message_type == "UtteranceEnd":
                last_word_end = getattr(message, "last_word_end", 0)
                if isinstance(last_word_end, (int, float)) and last_word_end < 0:
                    return
                self._flush_buffered_utterance()
                return

            if message_type != "Results":
                return

            alternatives = getattr(getattr(message, "channel", None), "alternatives", [])
            if not alternatives:
                return

            first_alternative = alternatives[0]
            transcript = getattr(first_alternative, "transcript", "").strip()
            if not transcript:
                return

            if not getattr(message, "is_final", False):
                # Interims are intentionally ignored; they are too unstable for
                # meaningful Turkish subtitles and create churn.
                return

            confidence = getattr(first_alternative, "confidence", 0.0)
            speech_final = bool(getattr(message, "speech_final", False))
            words = list(getattr(first_alternative, "words", []) or [])

            self._emit_preview_or_finalize(
                transcript=transcript,
                confidence=confidence,
                speech_final=speech_final,
                words=words,
            )

        except Exception as e:
            print(f"[Deepgram] Message handling error: {e}")

    def _on_error(self, *args, **kwargs) -> None:
        error = args[0] if args else kwargs.get("error", "unknown error")
        print(f"[Deepgram] WebSocket error: {error}")

    def _on_close(self, *args, **kwargs) -> None:
        if self._running:
            # Server closed the connection unexpectedly; surface it for debugging
            print("[Deepgram] Connection closed by server.")
