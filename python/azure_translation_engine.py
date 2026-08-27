"""
Azure Speech Translation streaming client.

This path is purpose-built for the product's actual goal: translated subtitles
that arrive while the speaker is still talking. Unlike the Deepgram + text MT
chain, Azure emits intermediate and final translated text from the same SDK.
"""

from __future__ import annotations

import os
import threading
import time

AZURE_STABLE_PARTIAL_THRESHOLD = "2"
DEFAULT_AZURE_PHRASES = (
    "AWS",
    "Amazon Web Services",
    "EC2",
    "S3",
    "Lambda",
    "CloudFront",
    "Kubernetes",
    "Docker",
    "Terraform",
    "OpenAI",
    "Deepgram",
    "Azure",
    "API",
)


class AzureSpeechTranslationClient:
    """Stream audio to Azure Speech Translation and publish translated text."""

    def __init__(self, publisher):
        self.api_key: str = os.getenv("AZURE_SPEECH_KEY", "")
        self.region: str = os.getenv("AZURE_SPEECH_REGION", "")
        self.publisher = publisher
        self.source_lang: str = "en"
        self.streaming_mode: bool = False

        self._running = False
        self._speechsdk = None
        self._recognizer = None
        self._push_stream = None
        self._session_lock = threading.Lock()
        self._last_preview_pair: tuple[str, str] = ("", "")
        self._last_final_pair: tuple[str, str] = ("", "")

    def has_credentials(self) -> bool:
        return bool(self.api_key.strip() and self.region.strip())

    def start(self, language: str = "en") -> None:
        """Open a new Azure recognition session."""
        if self._running:
            if self.source_lang != language:
                print(f"[AzureSpeech] Language changed ({self.source_lang} -> {language}), restarting...")
                self.stop()
            else:
                return

        if not self.has_credentials():
            print("[AzureSpeech] WARNING: AZURE_SPEECH_KEY/AZURE_SPEECH_REGION missing — Azure cloud engine disabled.")
            return

        try:
            import azure.cognitiveservices.speech as speechsdk  # type: ignore
        except ImportError:
            print("[AzureSpeech] WARNING: azure-cognitiveservices-speech not installed — Azure cloud engine disabled.")
            return

        self.source_lang = language
        self._speechsdk = speechsdk
        self._last_preview_pair = ("", "")
        self._last_final_pair = ("", "")

        translation_config = speechsdk.translation.SpeechTranslationConfig(
            subscription=self.api_key.strip(),
            region=self.region.strip(),
        )
        translation_config.speech_recognition_language = self._resolve_locale(language)
        translation_config.add_target_language("tr")

        # Lower segmentation delay without aggressively chopping words.
        segmentation_prop = getattr(speechsdk.PropertyId, "Speech_SegmentationSilenceTimeoutMs", None)
        if segmentation_prop is not None:
            translation_config.set_property(segmentation_prop, "350")

        stable_partial_prop = getattr(
            speechsdk.PropertyId,
            "SpeechServiceResponse_StablePartialResultThreshold",
            None,
        )
        if stable_partial_prop is not None:
            translation_config.set_property(stable_partial_prop, AZURE_STABLE_PARTIAL_THRESHOLD)

        stream_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=16000,
            bits_per_sample=16,
            channels=1,
        )
        self._push_stream = speechsdk.audio.PushAudioInputStream(stream_format)
        audio_config = speechsdk.audio.AudioConfig(stream=self._push_stream)

        recognizer = speechsdk.translation.TranslationRecognizer(
            translation_config=translation_config,
            audio_config=audio_config,
        )
        self._configure_phrase_hints(recognizer)
        recognizer.recognizing.connect(self._on_recognizing)
        recognizer.recognized.connect(self._on_recognized)
        recognizer.canceled.connect(self._on_canceled)
        recognizer.session_stopped.connect(self._on_session_stopped)

        with self._session_lock:
            self._recognizer = recognizer
            self._running = True

        print(
            f"[AzureSpeech] Starting translation (language={translation_config.speech_recognition_language}, region={self.region.strip()})..."
        )

        start_async = getattr(recognizer, "start_continuous_recognition_async", None)
        if callable(start_async):
            start_async().get()
        else:
            recognizer.start_continuous_recognition()

        print("[AzureSpeech] Streaming translation active.")

    def send_audio(self, audio_bytes: bytes) -> None:
        with self._session_lock:
            stream = self._push_stream
            running = self._running

        if not running or stream is None:
            return

        try:
            stream.write(audio_bytes)
        except Exception as exc:
            print(f"[AzureSpeech] Audio send error: {exc}")

    def stop(self) -> None:
        with self._session_lock:
            recognizer = self._recognizer
            stream = self._push_stream
            self._running = False
            self._recognizer = None
            self._push_stream = None

        if recognizer is not None:
            try:
                stop_async = getattr(recognizer, "stop_continuous_recognition_async", None)
                if callable(stop_async):
                    stop_async().get()
                else:
                    recognizer.stop_continuous_recognition()
            except Exception:
                pass

        if stream is not None:
            try:
                stream.close()
            except Exception:
                pass

        self._speechsdk = None
        self._last_preview_pair = ("", "")
        self._last_final_pair = ("", "")
        print("[AzureSpeech] Stopped.")

    def update_credentials(self, new_key: str | None = None, new_region: str | None = None) -> None:
        next_key = self.api_key if new_key is None else new_key.strip()
        next_region = self.region if new_region is None else new_region.strip().lower()

        if next_key == self.api_key and next_region == self.region:
            return

        print("[AzureSpeech] Updating credentials...")
        self.api_key = next_key
        self.region = next_region

        if self._running:
            self.stop()
            if self.has_credentials():
                self.start(self.source_lang)

    def _resolve_locale(self, language: str) -> str:
        normalized = language.strip().lower()
        if normalized == "fi":
            return "fi-FI"
        if normalized == "tr":
            return "tr-TR"
        return "en-US"

    def _get_phrase_hints(self) -> tuple[str, ...]:
        raw_phrases = os.getenv("AZURE_SPEECH_PHRASES", "")
        if raw_phrases.strip():
            phrases = tuple(phrase.strip() for phrase in raw_phrases.split(",") if phrase.strip())
            if phrases:
                return phrases

        return DEFAULT_AZURE_PHRASES

    def _configure_phrase_hints(self, recognizer) -> None:
        if self._speechsdk is None:
            return

        grammar_type = getattr(self._speechsdk, "PhraseListGrammar", None)
        if grammar_type is None:
            return

        from_recognizer = getattr(grammar_type, "from_recognizer", None)
        if not callable(from_recognizer):
            return

        try:
            grammar = from_recognizer(recognizer)
            set_weight = getattr(grammar, "setWeight", None)
            if callable(set_weight):
                set_weight(1.3)

            for phrase in self._get_phrase_hints():
                grammar.addPhrase(phrase)
        except Exception as exc:
            print(f"[AzureSpeech] Phrase hint setup skipped: {exc}")

    def _extract_translations(self, result) -> tuple[str, str]:
        original = (getattr(result, "text", "") or "").strip()
        if not original:
            return "", ""

        translations = getattr(result, "translations", None)
        translated = ""

        if translations is None:
            return original, ""

        if hasattr(translations, "get"):
            translated = translations.get("tr", "") or ""
        else:
            try:
                translated = translations["tr"] or ""
            except Exception:
                translated = ""

        return original, translated.strip()

    def _publish(self, original: str, translated: str, is_final: bool) -> None:
        if not self.publisher or not original or not translated:
            return

        print(f"[Transcript] cloud {'FINAL' if is_final else 'PREVIEW'} (azure-speech): '{original[:80]}'")
        self.publisher.publish(
            {
                "original": original,
                "translated": translated,
                "isFinal": is_final,
                "confidence": 1.0,
                "source": "cloud",
                "translationProvider": "azure-speech",
                "timestamp": time.time(),
            }
        )

    def _on_recognizing(self, evt) -> None:
        if not self._running or not self.streaming_mode:
            return

        original, translated = self._extract_translations(getattr(evt, "result", None))
        if not original or not translated:
            return

        pair = (original, translated)
        if pair == self._last_preview_pair or pair == self._last_final_pair:
            return

        self._last_preview_pair = pair
        self._publish(original, translated, is_final=False)

    def _on_recognized(self, evt) -> None:
        if not self._running:
            return

        original, translated = self._extract_translations(getattr(evt, "result", None))
        if not original or not translated:
            return

        pair = (original, translated)
        if pair == self._last_final_pair:
            return

        self._last_final_pair = pair
        self._last_preview_pair = ("", "")
        self._publish(original, translated, is_final=True)

    def _on_canceled(self, evt) -> None:
        details = getattr(evt, "result", None)
        if details is not None:
            reason = getattr(details, "reason", "unknown")
            print(f"[AzureSpeech] Recognition canceled: {reason}")
        else:
            print("[AzureSpeech] Recognition canceled.")

    def _on_session_stopped(self, _evt) -> None:
        if self._running:
            print("[AzureSpeech] Session stopped by service.")
