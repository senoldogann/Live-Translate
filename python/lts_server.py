"""
LTS — Live Translation Server.

WebSocket service exposing the shared STT + translation core (from ``engine.py``)
to iOS and future clients. The client streams mono 16 kHz PCM (int16 LE binary
frames) and receives JSON segments:

    -> {"type": "config", "apiKey": "...", "sourceLang": "auto",
        "targetLang": "tr", "model": "base"}
    -> <binary int16 LE PCM at 16 kHz mono>
    <- {"type": "segment", "original": "...", "translated": "...",
        "isFinal": true, "confidence": 0.92, "language": "en",
        "provider": "passthrough", "ts": 1724940000.0}
    <- {"type": "error", "message": "..."}

The per-connection pipeline (``LTSSession``) mirrors the macOS
``SubtitleEngine._process_loop`` thresholds: 0.35 s silence finalize, 6 s segment
timeout, 5 s partial window, 0.2 s processing cadence — with mid-sentence
fragment merging. It is pure Python + numpy and fully unit-testable with fakes.

Run:  python python/lts_server.py [--port 8765]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np
import websockets
from websockets.http11 import Headers, Response

from engine import (
    TranscriptionEngine,
    TranslationEngine,
    VoiceActivityDetector,
    _ends_with_sentence_punctuation,
)

SAMPLE_RATE = 16000
SILENCE_THRESHOLD = 0.35
MAX_SEGMENT_DURATION = 6.0
PARTIAL_WINDOW = 5.0
PROCESSING_INTERVAL = 0.2
MIN_AUDIO_DURATION = 0.2


# ═══════════════════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class LTSConfig:
    host: str = os.environ.get("LTS_HOST", "0.0.0.0")
    port: int = int(os.environ.get("LTS_PORT", "8765"))
    # When set, clients must present this key in their config message.
    api_key: str = os.environ.get("LTS_API_KEY", "")
    whisper_model: str = os.environ.get("LTS_WHISPER_MODEL", "base")
    device: str = os.environ.get("LTS_DEVICE", "cpu")
    compute_type: str = os.environ.get("LTS_COMPUTE_TYPE", "int8")
    default_source_lang: str = os.environ.get("LTS_SOURCE_LANG", "auto")
    default_target_lang: str = os.environ.get("LTS_TARGET_LANG", "tr")
    # Preload the offline Argos fallback (slow first run, network access).
    load_offline_translator: bool = os.environ.get("LTS_LOAD_OFFLINE_TRANSLATOR", "0") == "1"
    # Hard cap on concurrent clients (protects the shared Whisper model).
    max_connections: int = int(os.environ.get("LTS_MAX_CONNECTIONS", "32"))
    # STT engine: "local" (faster-whisper, offline/privacy-first) or "deepgram"
    # (Nova-3 streaming cloud STT). Per-client config may override with an
    # "engine" field; "deepgram" needs DEEPGRAM_API_KEY (or per-client sttApiKey).
    engine: str = os.environ.get("LTS_ENGINE", "local").strip().lower()


# ═══════════════════════════════════════════════════════════════════════════════
# Per-connection pipeline
# ═══════════════════════════════════════════════════════════════════════════════


def int16_bytes_to_float32(data: bytes) -> np.ndarray:
    """Decode int16 LE PCM bytes to float32 in [-1, 1]."""
    samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
    return samples


def make_segment(
    original: str,
    translated: str,
    is_final: bool,
    confidence: float,
    language: str,
    provider: str,
) -> dict[str, Any]:
    return {
        "type": "segment",
        "original": original,
        "translated": translated,
        "isFinal": is_final,
        "confidence": round(float(confidence), 4),
        "language": language,
        "provider": provider,
        "ts": time.time(),
    }


class LTSSession:
    """One client's audio pipeline: PCM in, transcript/translation segments out.

    Not thread-safe; drive from a single asyncio task. ``feed_samples`` appends
    audio and updates VAD state; ``tick(now)`` runs one processing pass and
    returns the segments to send.
    """

    def __init__(
        self,
        transcriber: Any,
        translator: Any,
        source_lang: str = "auto",
        target_lang: str = "tr",
        streaming: bool = True,
        silence_threshold: float = SILENCE_THRESHOLD,
        max_segment_duration: float = MAX_SEGMENT_DURATION,
        partial_window: float = PARTIAL_WINDOW,
        processing_interval: float = PROCESSING_INTERVAL,
        min_audio_duration: float = MIN_AUDIO_DURATION,
        vad: Any = None,
    ):
        self.transcriber = transcriber
        self.translator = translator
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.streaming = streaming

        self.silence_threshold = silence_threshold
        self.max_segment_duration = max_segment_duration
        self.partial_window = partial_window
        self.processing_interval = processing_interval
        self.min_audio_duration = min_audio_duration

        # Injectable so tests are deterministic regardless of whether the
        # webrtcvad package is installed (WebRTC VAD rejects synthetic audio).
        self.vad = vad if vad is not None else VoiceActivityDetector(sample_rate=SAMPLE_RATE)
        self._buffer: list[np.ndarray] = []
        self._buffer_samples = 0
        self._last_speech_time: float | None = None
        self._last_transcript_time = 0.0

        # Sentence integrity state (mirrors engine.py).
        self._sentence_buffer: list[str] = []
        self._last_partial_text = ""
        self.last_context = ""

    # -- input -------------------------------------------------------------

    def feed_samples(self, samples: np.ndarray, now: float | None = None) -> None:
        if self.vad.is_speech(samples):
            self._buffer.append(samples)
            self._buffer_samples += int(samples.size)
            self._last_speech_time = time.time() if now is None else now

    def reset(self) -> None:
        self._buffer.clear()
        self._buffer_samples = 0
        self._last_speech_time = None
        self._sentence_buffer.clear()
        self._last_partial_text = ""
        self.last_context = ""

    # -- processing --------------------------------------------------------

    def tick(self, now: float | None = None) -> list[dict[str, Any]]:
        """One processing pass. Returns segments to send to the client."""
        now = time.time() if now is None else now
        if not self._buffer:
            return []

        duration = self._buffer_samples / SAMPLE_RATE
        if duration < self.min_audio_duration:
            return []
        if now - self._last_transcript_time < self.processing_interval:
            return []

        is_silence_final = self._last_speech_time is not None and now - self._last_speech_time >= self.silence_threshold
        is_timeout_final = duration > self.max_segment_duration
        is_final = bool(is_silence_final or is_timeout_final)

        # CPU saving: partial passes only process the last N seconds.
        if not is_final and self.streaming:
            max_partial = int(SAMPLE_RATE * self.partial_window)
            audio = self._current_audio(tail=max_partial)
        else:
            audio = self._current_audio()

        if audio.size < int(SAMPLE_RATE * self.min_audio_duration):
            return []

        if not is_final and not self.streaming:
            return []

        # Honor the client's source language (auto → detect). The shared
        # transcriber is constructed with the server default, so the per-call
        # override is what makes per-client languages actually take effect.
        lang = None if self.source_lang in ("auto", "") else self.source_lang
        text, confidence, detected_lang = self.transcriber.transcribe(
            audio, SAMPLE_RATE, prompt=self.last_context, language=lang
        )
        text = (text or "").strip()
        if not text:
            if is_final:
                self._clear_audio()
            return []

        # Drop Whisper hallucinations (CJK punctuation floods, repeated-phrase
        # loops) before they hit the phone as confusing "translations".
        if self._is_hallucination(text, float(confidence or 0)):
            if is_final:
                self._clear_audio()
            return []

        # Language match: skip when a specific source language is selected but
        # the detected language differs (mirrors engine.py §5.5).
        if detected_lang and self.source_lang not in ("auto", ""):
            if detected_lang != self.source_lang:
                if is_final:
                    self._clear_audio()
                return []

        # Mid-sentence timeout cuts are buffered and merged with the next pass.
        if is_final and is_timeout_final and not _ends_with_sentence_punctuation(text):
            if len(self._sentence_buffer) < 5:
                self._sentence_buffer.append(text)
            else:
                self._sentence_buffer = [text]
            self._last_partial_text = text
            self._last_transcript_time = now
            if is_final:
                self._clear_audio()
            return []

        if is_final and self._sentence_buffer:
            text = " ".join([*self._sentence_buffer, text]).strip()
            self._sentence_buffer.clear()

        if self.streaming and not is_final and text == self._last_partial_text:
            return []

        translated = self.translator.translate(
            text,
            fast_mode=self.streaming and not is_final,
            context=self.last_context if is_final else "",
            prefer_quality=is_final,
        )
        provider = getattr(self.translator, "last_provider", "passthrough")

        if is_final:
            self.last_context = text
            self._last_partial_text = ""
            self._clear_audio()
        else:
            self._last_partial_text = text

        self._last_transcript_time = now
        return [
            make_segment(
                original=text,
                translated=(translated or "").strip(),
                is_final=is_final,
                confidence=confidence,
                language=detected_lang or "",
                provider=provider,
            )
        ]

    # -- hallucination guard -------------------------------------------------

    _LETTER_RE = re.compile(r"[A-Za-zÇĞİÖŞÜçğıöşü0-9]", re.UNICODE)

    def _is_hallucination(self, text: str, confidence: float) -> bool:
        """True when Whisper produced its classic noise/garbage hallucination.

        Faster-whisper's small/base models frequently "transcribe" silence or
        music-heavy broadcast audio as nonsense: CJK punctuation floods (\u300a), or
        a short phrase repeated dozens of times ("I'm not a real man, ..."). These
        have low real-word density, near-garbage punctuation, or pathological
        repetition. We drop them before they reach the phone instead of showing
        confusing subtitles.
        """
        words = text.split()
        if not words:
            return False

        # 1. The model is very unsure of everything.
        if confidence < -1.2:
            return True

        # 2. Most "words" contain no letters or digits -> punctuation/noise flood.
        if len(words) >= 3:
            real = [w for w in words if self._LETTER_RE.search(w)]
            if len(real) / len(words) < 0.4:
                return True

        # 3. Pathological repetition: most words are repeats of a tiny set
        #    ("I'm not a real man" x30 has <5% distinct tokens). Genuine
        #    sentences keep a much higher distinct-word ratio.
        if len(words) >= 8:
            distinct = len({w.lower() for w in words})
            if distinct * 4 < len(words):
                return True

        return False

    # -- internals ---------------------------------------------------------

    def _current_audio(self, tail: int | None = None) -> np.ndarray:
        if not self._buffer:
            return np.array([], dtype=np.float32)
        if tail is None or self._buffer_samples <= tail:
            return np.concatenate(self._buffer)
        keep: list[np.ndarray] = []
        acc = 0
        for chunk in reversed(self._buffer):
            keep.append(chunk)
            acc += int(chunk.size)
            if acc >= tail:
                break
        return np.concatenate(list(reversed(keep)))

    def _clear_audio(self) -> None:
        self._buffer.clear()
        self._buffer_samples = 0
        self._last_speech_time = None


# ═══════════════════════════════════════════════════════════════════════════════
# Cloud (Deepgram) mode
# ═══════════════════════════════════════════════════════════════════════════════


class WebSocketPublisher:
    """Thread-safe bridge from DeepgramWSClient's worker thread into the asyncio loop.

    ``DeepgramWSClient`` runs its translation in a daemon thread and calls
    ``publisher.publish()`` synchronously from there. ``asyncio.Queue`` is not
    thread-safe, so we hop onto the owning event loop with
    ``call_soon_threadsafe`` — the only correct way to enqueue from another thread.
    """

    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self._loop = loop
        self._queue = queue

    def publish(self, payload: dict) -> None:
        self._loop.call_soon_threadsafe(self._queue.put_nowait, payload)


def cloud_payload_to_segment(payload: dict, language: str) -> dict[str, Any]:
    """Normalize a cloud engine's publish payload to the LTS segment shape."""
    return {
        "type": "segment",
        "original": str(payload.get("original") or ""),
        "translated": str(payload.get("translated") or "").strip(),
        "isFinal": bool(payload.get("isFinal", True)),
        "confidence": round(float(payload.get("confidence") or 0.0), 4),
        "language": language,
        "provider": str(payload.get("translationProvider") or payload.get("source") or "cloud"),
        "ts": float(payload.get("timestamp") or time.time()),
    }


def resolve_deepgram_language(source_lang: str) -> str:
    """Deepgram needs a concrete language code; "auto" is not valid on the wire."""
    lang = (source_lang or "").strip().lower()
    if lang in ("", "auto"):
        return "en"
    return lang


# ═══════════════════════════════════════════════════════════════════════════════
# WebSocket server
# ═══════════════════════════════════════════════════════════════════════════════


class LTSServer:
    def __init__(
        self,
        config: LTSConfig,
        transcriber_factory: Callable[[], Any] | None = None,
        translator_factory: Callable[[str, str], Any] | None = None,
        vad_factory: Callable[[], Any] | None = None,
        deepgram_client_factory: Callable[[Any, Any], Any] | None = None,
    ):
        self.config = config
        self._transcriber_factory = transcriber_factory or (
            lambda: TranscriptionEngine(
                model_name=config.whisper_model,
                device=config.device,
                compute_type=config.compute_type,
                language=config.default_source_lang,
            )
        )
        self._translator_factory = translator_factory or (
            lambda src, tgt: TranslationEngine(source_lang=src, target_lang=tgt)
        )
        self._vad_factory = vad_factory
        self._deepgram_client_factory = deepgram_client_factory or self._default_deepgram_client
        self._transcriber: Any = None
        self._translator: Any = None
        # Client slot limiter; ``handle`` rejects connections beyond the cap.
        self._slots = asyncio.Semaphore(max(1, config.max_connections))

    @staticmethod
    def _default_deepgram_client(publisher: Any, translator: Any) -> Any:
        """Construct the real Deepgram client. Import is lazy so local-only
        deployments (Docker's lean image) never pull the SDK."""
        from deepgram_engine import DeepgramWSClient

        return DeepgramWSClient(publisher=publisher, translator=translator)

    # -- HTTP endpoints ------------------------------------------------------

    async def _process_request(self, connection, request) -> Response | None:
        """Health check for load balancers / Docker HEALTHCHECK.

        ``websockets`` calls this for every HTTP request; returning a response
        short-circuits the WebSocket upgrade, so ``GET /health`` gets a plain
        HTTP 200 without opening a socket.
        """
        if getattr(request, "path", "") == "/health":
            return Response(200, "OK", Headers({"Content-Type": "text/plain"}), b"ok")
        return None

    async def _ensure_models(self) -> None:
        if self._transcriber is None:
            self._transcriber = self._transcriber_factory()
            self._transcriber.load()
        if self._translator is None:
            self._translator = self._translator_factory(
                self.config.default_source_lang, self.config.default_target_lang
            )
            if self.config.load_offline_translator:
                await asyncio.to_thread(self._translator.load)

    async def handle(self, websocket: websockets.ServerConnection) -> None:
        # Reject clients beyond the connection cap with a 1013 (try again later)
        # instead of queueing them behind the shared Whisper model. The locked()
        # pre-check avoids a race where acquire() would block.
        if self._slots.locked():
            await websocket.close(code=1013, reason="server busy")
            return
        await self._slots.acquire()
        try:
            await self._handle(websocket)
        finally:
            self._slots.release()

    async def _handle(self, websocket: websockets.ServerConnection) -> None:
        try:
            # The first message must be a JSON config (auth + languages).
            config_msg = await asyncio.wait_for(websocket.recv(), timeout=30)
            cfg = json.loads(config_msg)
            if cfg.get("type") != "config":
                await websocket.send(json.dumps({"type": "error", "message": "expected config message"}))
                return
            if self.config.api_key and not secrets.compare_digest(cfg.get("apiKey", ""), self.config.api_key):
                await websocket.send(json.dumps({"type": "error", "message": "unauthorized"}))
                return

            source_lang = cfg.get("sourceLang") or self.config.default_source_lang
            target_lang = cfg.get("targetLang") or self.config.default_target_lang

            # Engine selection: per-client config wins, server env is the default.
            engine = str(cfg.get("engine") or self.config.engine).strip().lower()
            if engine == "deepgram":
                await self._handle_deepgram(websocket, cfg, source_lang, target_lang)
                return
            if engine != "local":
                await websocket.send(json.dumps({"type": "error", "message": f"unknown engine: {engine}"}))
                return

            await self._ensure_models()
            session = LTSSession(
                transcriber=self._transcriber,
                translator=self._translator,
                source_lang=source_lang,
                target_lang=target_lang,
                vad=self._vad_factory() if self._vad_factory else None,
            )
            await websocket.send(json.dumps({"type": "ready", "model": self.config.whisper_model}))

            # ``stop`` lets both loops exit when the client disconnects; the
            # serve() context manager waits for the handler to return, so an
            # infinite process loop would otherwise hang shutdown.
            stop = asyncio.Event()

            async def receive_loop() -> None:
                try:
                    async for message in websocket:
                        if isinstance(message, (bytes, bytearray)):
                            session.feed_samples(int16_bytes_to_float32(bytes(message)))
                        elif isinstance(message, str):
                            try:
                                data = json.loads(message)
                                if data.get("type") == "reset":
                                    session.reset()
                            except json.JSONDecodeError:
                                pass
                except websockets.ConnectionClosed:
                    pass
                finally:
                    stop.set()

            async def process_loop() -> None:
                while not stop.is_set():
                    await asyncio.sleep(PROCESSING_INTERVAL)
                    try:
                        for segment in session.tick():
                            await websocket.send(json.dumps(segment))
                    except websockets.ConnectionClosed:
                        stop.set()

            await asyncio.gather(receive_loop(), process_loop())
        except websockets.ConnectionClosed:
            pass
        except Exception as exc:
            # Log the real cause server-side; never leak internals to clients.
            print(f"[LTS] handler error: {exc!r}", flush=True)
            try:
                await websocket.send(json.dumps({"type": "error", "message": "internal error"}))
            except websockets.ConnectionClosed:
                pass

    async def _handle_deepgram(
        self,
        websocket: websockets.ServerConnection,
        cfg: dict[str, Any],
        source_lang: str,
        target_lang: str,
    ) -> None:
        """Cloud mode: Deepgram Nova-3 streaming STT + translation.

        Raw int16 LE PCM frames are forwarded straight to Deepgram (its own VAD
        and endpointing replace the local energy detector). The Deepgram client
        translates off its callback thread and publishes through
        ``WebSocketPublisher``; ``process_loop`` drains that queue and forwards
        normalized segments to the client. No Whisper model is loaded here.
        """
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict] = asyncio.Queue()
        lang = resolve_deepgram_language(source_lang)
        translator = self._translator_factory(lang, target_lang)

        try:
            client = self._deepgram_client_factory(WebSocketPublisher(loop, queue), translator)
        except ImportError:
            await websocket.send(
                json.dumps(
                    {"type": "error", "message": "deepgram-sdk not installed on the server (pip install deepgram-sdk)"}
                )
            )
            return

        key = str(cfg.get("sttApiKey") or "").strip()
        if key:
            client.api_key = key
        if not client.has_credentials():
            await websocket.send(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Deepgram API key missing — set DEEPGRAM_API_KEY on the server or send sttApiKey in the config",
                    }
                )
            )
            return

        # LTS is a live-subtitle client: emit committed previews, not only
        # utterance-end finals.
        client.streaming_mode = True
        await websocket.send(json.dumps({"type": "ready", "model": "deepgram-nova-3", "engine": "deepgram"}))
        client.start(lang)

        stop = asyncio.Event()

        async def receive_loop() -> None:
            try:
                async for message in websocket:
                    if isinstance(message, (bytes, bytearray)):
                        client.send_audio(bytes(message))
            except websockets.ConnectionClosed:
                pass
            finally:
                stop.set()

        async def process_loop() -> None:
            while not stop.is_set():
                await asyncio.sleep(0.05)
                try:
                    while True:
                        try:
                            payload = queue.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                        await websocket.send(json.dumps(cloud_payload_to_segment(payload, lang)))
                except websockets.ConnectionClosed:
                    stop.set()

        try:
            await asyncio.gather(receive_loop(), process_loop())
        finally:
            client.stop()

    def _serve(self):
        """Return the socket server async context manager (extracted for testability)."""
        return websockets.serve(
            self.handle,
            self.config.host,
            self.config.port,
            max_size=2**20,
            # Disable server-side pings: the websockets library pings every
            # ping_interval (default 20s) and drops the connection when the
            # peer's pong is delayed. iOS URLSessionWebSocketTask replies to
            # pings, but under ReplayKit capture the extension can lag past the
            # 20s ping_timeout, killing the session mid-broadcast ("socket is
            # not connected" on the client). Sessions are short-lived on LAN,
            # so keepalive pings buy nothing here.
            ping_interval=None,
            process_request=self._process_request,
        )

    async def serve_forever(self) -> None:
        async with self._serve():
            print(f"[LTS] listening on ws://{self.config.host}:{self.config.port}")
            print(f"[LTS] model={self.config.whisper_model} auth={'on' if self.config.api_key else 'off'}")
            print(f"[LTS] max_connections={self.config.max_connections}")
            await asyncio.Future()  # run forever


def main() -> None:
    parser = argparse.ArgumentParser(description="LTS — Live Translation Server")
    parser.add_argument("--port", type=int, default=None, help="Override LTS_PORT")
    args = parser.parse_args()

    config = LTSConfig()
    if args.port:
        config.port = args.port

    asyncio.run(LTSServer(config).serve_forever())


if __name__ == "__main__":
    main()
