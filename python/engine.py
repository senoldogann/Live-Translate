#!/usr/bin/env python3
"""
Stealth Subtitle Translator - AI Engine

Bu script Electron uygulamasının sidecar process'i olarak çalışır.
- BlackHole 2ch'den sistem sesini yakalar
- Faster-Whisper ile transkripsiyon yapar
- ArgosTranslate ile İngilizce -> Türkçe çeviri yapar
- ZeroMQ PUB socket ile Electron'a sonuçları gönderir

Optimizasyonlar:
- VAD (Voice Activity Detection) ile sessizlik tespiti
- int8 quantization ile düşük bellek kullanımı
- Streaming mode ile düşük latency

Gereksinimler:
- BlackHole 2ch virtual audio driver kurulu olmalı
- Apple Silicon için optimize edilmiş (M1/M2/M3)
"""

import json
import os
import re
import signal
import sys
import threading
import time
import warnings
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

import requests

# Load environment variables
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

import numpy as np
import zmq

# Lazy imports for faster startup
_whisper_model = None
_translator = None

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class EngineConfig:
    """Engine configuration parameters"""

    # Audio settings
    sample_rate: int = 16000
    channels: int = 1
    chunk_duration: float = 0.25  # seconds per chunk
    buffer_duration: float = 3.0  # seconds to accumulate before transcription

    # Whisper settings
    whisper_model: str = "small"  # tiny, base, small, medium, large-v3
    whisper_device: str = "cpu"  # cpu veya mps (experimental)
    whisper_compute_type: str = "int8"  # int8, float16, float32
    whisper_language: str = "auto"  # Auto-detect mode (None for Whisper)

    # VAD settings
    vad_mode: int = 3  # 0-3, higher = more aggressive
    vad_frame_duration: int = 30  # ms (10, 20, or 30)

    # Translation settings
    source_lang: str = "en"
    target_lang: str = "tr"

    # ZMQ settings
    zmq_address: str = "tcp://127.0.0.1:5555"

    # Audio device
    audio_device: str | None = "BlackHole 2ch"  # None for default

    # Streaming setting
    streaming_mode: bool = False

    # Engine Settings
    engine_type: str = "local"  # "local" or "cloud"
    is_listening: bool = True


CONFIG = EngineConfig()


def _parse_bool_env(value: str | None) -> bool | None:
    if value is None:
        return None

    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return None


def apply_runtime_env_overrides(config: EngineConfig) -> None:
    source_lang = os.getenv("ENGINE_SOURCE_LANG", "").strip().lower()
    if source_lang in {"en", "fi", "tr"}:
        config.source_lang = source_lang

    engine_type = os.getenv("ENGINE_TYPE", "").strip().lower()
    if engine_type in {"local", "cloud"}:
        config.engine_type = engine_type

    streaming_mode = _parse_bool_env(os.getenv("ENGINE_STREAMING_MODE"))
    if streaming_mode is not None:
        config.streaming_mode = streaming_mode

    is_listening = _parse_bool_env(os.getenv("ENGINE_IS_LISTENING"))
    if is_listening is not None:
        config.is_listening = is_listening


apply_runtime_env_overrides(CONFIG)


# ═══════════════════════════════════════════════════════════════════════════════
# DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class TranscriptResult:
    """Transcription result to send to Electron"""

    original: str
    translated: str
    timestamp: float
    isFinal: bool
    confidence: float = 0.0
    source: str = "local"
    translationProvider: str = "passthrough"


# ═══════════════════════════════════════════════════════════════════════════════
# VOICE ACTIVITY DETECTION
# ═══════════════════════════════════════════════════════════════════════════════


class VoiceActivityDetector:
    """
    WebRTC VAD wrapper for detecting speech in audio.
    Falls back to energy-based detection if webrtcvad is unavailable.
    """

    def __init__(self, mode: int = 3, sample_rate: int = 16000, frame_duration: int = 30):
        self.mode = mode
        self.sample_rate = sample_rate
        self.frame_duration = frame_duration
        self.frame_size = int(sample_rate * frame_duration / 1000)
        self.vad = None
        self._use_energy_fallback = False

        try:
            with warnings.catch_warnings():
                warnings.filterwarnings(
                    "ignore",
                    message="pkg_resources is deprecated as an API.*",
                    category=UserWarning,
                )
                import webrtcvad as webrtcvad_module

            self.vad = webrtcvad_module.Vad(mode)
            print(f"[VAD] WebRTC VAD initialized (mode={mode})")
        except ImportError:
            print("[VAD] webrtcvad not available, using energy-based detection")
            self._use_energy_fallback = True

    def is_speech(self, audio_chunk: np.ndarray) -> bool:
        """Check if audio chunk contains speech"""
        if self._use_energy_fallback:
            return self._energy_based_detection(audio_chunk)

        try:
            # Convert to int16 for webrtcvad
            audio_int16 = (audio_chunk * 32767).astype(np.int16)

            # Process in frames
            speech_frames = 0
            total_frames = 0

            for i in range(0, len(audio_int16) - self.frame_size, self.frame_size):
                frame = audio_int16[i : i + self.frame_size].tobytes()
                if len(frame) == self.frame_size * 2:  # 2 bytes per sample
                    if self.vad.is_speech(frame, self.sample_rate):
                        speech_frames += 1
                    total_frames += 1

            # Return True if more than 30% of frames contain speech
            return total_frames > 0 and (speech_frames / total_frames) > 0.3

        except Exception as e:
            print(f"[VAD] Error: {e}, falling back to energy detection")
            return self._energy_based_detection(audio_chunk)

    def _energy_based_detection(self, audio_chunk: np.ndarray, threshold: float = 0.01) -> bool:
        """Simple energy-based voice detection fallback"""
        rms = np.sqrt(np.mean(audio_chunk**2))
        return rms > threshold


# ═══════════════════════════════════════════════════════════════════════════════
# AUDIO CAPTURE
# ═══════════════════════════════════════════════════════════════════════════════


class AudioCapture:
    """
    Captures audio from BlackHole or system audio device.
    Uses sounddevice for modern, async-native audio capture.
    """

    def __init__(
        self,
        device_name: str | None = None,
        sample_rate: int = 16000,
        channels: int = 1,
        chunk_duration: float = 0.5,
        callback: Callable[[np.ndarray], None] | None = None,
    ):
        self.device_name = device_name
        self.sample_rate = sample_rate
        self.channels = channels
        self.chunk_size = int(sample_rate * chunk_duration)
        self.callback = callback
        self.stream = None
        self._running = False

        # Import sounddevice
        try:
            import sounddevice as sd

            self.sd = sd
        except ImportError:
            raise RuntimeError("sounddevice is required. Install with: pip install sounddevice")

        # Find device
        self.device_id = self._find_device()

    def _find_device(self) -> int | None:
        """Find the audio device by name"""
        if self.device_name is None:
            return None  # Use default

        devices = self.sd.query_devices()
        for i, device in enumerate(devices):
            if self.device_name.lower() in device["name"].lower():
                if device["max_input_channels"] > 0:
                    print(f"[Audio] Found device: {device['name']} (id={i})")
                    return i

        print(f"[Audio] Device '{self.device_name}' not found, available devices:")
        for i, device in enumerate(devices):
            if device["max_input_channels"] > 0:
                print(f"  [{i}] {device['name']}")

        return None

    def _audio_callback(self, indata: np.ndarray, frames: int, time_info, status):
        """Called for each audio chunk"""
        if status:
            print(f"[Audio] Status: {status}")

        if self.callback and self._running:
            # Convert to mono float32
            audio = indata[:, 0] if indata.ndim > 1 else indata.flatten()
            self.callback(audio.astype(np.float32))

    def start(self):
        """Start audio capture"""
        if self._running:
            return

        self._running = True

        try:
            self.stream = self.sd.InputStream(
                device=self.device_id,
                samplerate=self.sample_rate,
                channels=self.channels,
                blocksize=self.chunk_size,
                callback=self._audio_callback,
                dtype=np.float32,
            )
            self.stream.start()
            print(f"[Audio] Capture started (device={self.device_id}, rate={self.sample_rate})")
        except Exception as e:
            print(f"[Audio] Failed to start capture: {e}")
            self._running = False
            raise

    def stop(self):
        """Stop audio capture"""
        self._running = False
        if self.stream:
            self.stream.stop()
            self.stream.close()
            self.stream = None
            print("[Audio] Capture stopped")


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSCRIPTION ENGINE
# ═══════════════════════════════════════════════════════════════════════════════


class TranscriptionEngine:
    """
    Faster-Whisper based transcription engine.
    Optimized for Apple Silicon with int8 quantization.
    """

    def __init__(
        self,
        model_name: str = "small",
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "en",
    ):
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self.model = None

    def load(self, model_name: str = None):
        """Load the Whisper model (lazy loading)"""
        if model_name:
            if self.model_name != model_name:
                self.model = None  # Force reload
            self.model_name = model_name

        if self.model is not None:
            return

        print(f"[Whisper] Loading model '{self.model_name}' (device={self.device}, compute={self.compute_type})...")
        start_time = time.time()

        try:
            from faster_whisper import WhisperModel

            self.model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type,
                download_root=str(Path.home() / ".cache" / "whisper"),
            )

            elapsed = time.time() - start_time
            print(f"[Whisper] Model loaded in {elapsed:.2f}s")

        except ImportError:
            raise RuntimeError("faster-whisper is required. Install with: pip install faster-whisper")
        except Exception as e:
            print(f"[Whisper] Failed to load model: {e}")
            raise

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000, prompt: str = "") -> tuple[str, float, str]:
        """
        Transcribe audio to text with language detection.
        Returns (text, confidence, detected_language)
        """
        if self.model is None:
            self.load()

        try:
            # Use None for auto-detection, or specific language if set
            lang_param = None if self.language == "auto" else self.language

            segments, info = self.model.transcribe(
                audio,
                language=lang_param,  # None = auto-detect
                beam_size=1,
                best_of=1,
                temperature=0.0,
                condition_on_previous_text=False,
                initial_prompt=prompt,  # <--- Context Awareness
                # We already segment with WebRTC VAD. Re-running internal VAD adds
                # latency and can clip words at segment boundaries.
                vad_filter=False,
            )

            # Get detected language from info
            detected_lang = info.language if info.language else "unknown"

            # Collect all segments
            text_parts = []
            total_confidence = 0.0
            segment_count = 0

            for segment in segments:
                text_parts.append(segment.text.strip())
                total_confidence += segment.avg_logprob
                segment_count += 1

            text = " ".join(text_parts)

            # Anti-Loop Filter: Remove repeated phrases (e.g. "on and on and on")
            if len(text) > 10:
                words = text.split()
                if len(words) > 8:
                    # Check for 3-gram repetition
                    last_3 = words[-3:]
                    prev_3 = words[-6:-3]
                    if last_3 == prev_3:
                        # Repetition detected!
                        text = " ".join(words[:-3])

            avg_confidence = (total_confidence / segment_count) if segment_count > 0 else 0.0

            return text, avg_confidence, detected_lang

        except Exception as e:
            print(f"[Whisper] Transcription error: {e}")
            return "", 0.0, "unknown"


# ═══════════════════════════════════════════════════════════════════════════════
# DEEPL TRANSLATOR
# ═══════════════════════════════════════════════════════════════════════════════


class DeepLTranslator:
    """
    DeepL API Client for high-quality translation.
    Uses Free API endpoint (api-free.deepl.com) when key ends with :fx
    """

    def __init__(self, source_lang: str = "en", target_lang: str = "tr"):
        self.api_key = os.getenv("DEEPL_API_KEY", "")
        self._session = requests.Session()
        # Detect Free vs Pro based on key suffix
        self.base_url = "https://api-free.deepl.com" if self.api_key.endswith(":fx") else "https://api.deepl.com"
        # DeepL uses uppercase language codes
        self.source_lang = source_lang.upper()
        self.target_lang = target_lang.upper()
        self._available = bool(self.api_key)

        if self._available:
            print(f"[DeepL] Initialized ({self.base_url.split('//')[1]})")
        else:
            print("[DeepL] No API key found, disabled")

    def translate(
        self,
        text: str,
        context: str = "",
        model_type: str | None = None,
    ) -> str | None:
        """Translate text using DeepL API. Returns None on failure."""
        if not self._available or not text.strip():
            return None

        payload = {
            "text": [text],
            "source_lang": self.source_lang,
            "target_lang": self.target_lang,
        }

        if context.strip():
            payload["context"] = context.strip()

        if model_type:
            payload["model_type"] = model_type

        try:
            response = self._session.post(
                f"{self.base_url}/v2/translate",
                headers={
                    "Authorization": f"DeepL-Auth-Key {self.api_key}",
                    "Content-Type": "application/json",
                    "User-Agent": "StealthSubtitleTranslator/1.0.0",
                },
                json=payload,
                timeout=5,
            )
            response.raise_for_status()
            result = response.json()["translations"][0]["text"]
            print(f"[DeepL] Translated: '{text[:30]}...' -> '{result[:30]}...'")
            return result
        except Exception as e:
            if model_type:
                try:
                    fallback_payload = dict(payload)
                    fallback_payload.pop("model_type", None)
                    response = self._session.post(
                        f"{self.base_url}/v2/translate",
                        headers={
                            "Authorization": f"DeepL-Auth-Key {self.api_key}",
                            "Content-Type": "application/json",
                            "User-Agent": "StealthSubtitleTranslator/1.0.0",
                        },
                        json=fallback_payload,
                        timeout=5,
                    )
                    response.raise_for_status()
                    result = response.json()["translations"][0]["text"]
                    print(f"[DeepL] Fallback translated: '{text[:30]}...' -> '{result[:30]}...'")
                    return result
                except Exception:
                    pass
            print(f"[DeepL] Error: {e}")
            return None

    def update_api_key(self, new_key: str):
        """API anahtarını güncelle."""
        if not new_key or new_key == self.api_key:
            return

        print("[DeepL] API anahtarı güncelleniyor...")
        self.api_key = new_key
        self.base_url = "https://api-free.deepl.com" if self.api_key.endswith(":fx") else "https://api.deepl.com"
        self._available = True


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSLATION ENGINE (DeepL → Argos)
# ═══════════════════════════════════════════════════════════════════════════════


class TranslationEngine:
    """
    Hybrid Translation Engine with priority:
    1. DeepL API (Highest quality, Finnish supported)
    2. Argos Offline (Last resort, lower quality)
    """

    def __init__(self, source_lang: str = "en", target_lang: str = "tr"):
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.translator = None  # Argos translator
        self._installed = False
        self._load_lock = threading.Lock()
        self.last_provider = "passthrough"
        self._protected_terms = self._build_protected_terms(source_lang)

        # Initialize translators
        self.deepl_translator = DeepLTranslator(source_lang=source_lang, target_lang=target_lang)

    def load(self):
        """Load translation models"""
        if self._installed:
            return

        with self._load_lock:
            if self._installed:
                return

            print(f"[Translate] Initializing Hybrid Engine {self.source_lang} -> {self.target_lang}...")

            # Load Offline Model (Argos) as Last Resort Backup
            try:
                import argostranslate.package
                import argostranslate.translate

                argostranslate.package.update_package_index()
                available_packages = argostranslate.package.get_available_packages()
                package_to_install = next(
                    filter(
                        lambda x: x.from_code == self.source_lang and x.to_code == self.target_lang,
                        available_packages,
                    ),
                    None,
                )

                if package_to_install:
                    if package_to_install not in argostranslate.package.get_installed_packages():
                        print(f"[Translate] Installing offline package: {package_to_install}")
                        argostranslate.package.install_from_path(package_to_install.download())

                    installed_languages = argostranslate.translate.get_installed_languages()
                    source = next(
                        (l for l in installed_languages if l.code == self.source_lang),
                        None,
                    )
                    target = next(
                        (l for l in installed_languages if l.code == self.target_lang),
                        None,
                    )

                    if source and target:
                        self.translator = source.get_translation(target)
                        print(f"[Translate] Argos Offline Loaded: {source.name} -> {target.name}")
                else:
                    print("[Translate] Argos package not available for this language pair.")

            except Exception as e:
                print(f"[Translate] Argos setup failed: {e}")

            self._installed = True

    def preload_async(self):
        """Warm Argos in the background without blocking engine startup."""
        if self._installed:
            return

        threading.Thread(
            target=self.load,
            daemon=True,
            name="argos-preload",
        ).start()

    def _build_protected_terms(self, source_lang: str) -> list[str]:
        shared_terms = [
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
            "BlackHole",
            "API",
            "SDK",
            "CLI",
            "GPU",
            "CPU",
        ]

        if source_lang.lower() == "fi":
            shared_terms.extend(
                [
                    "Azure",
                    "GitHub",
                ]
            )

        seen = set()
        ordered_terms = []
        for term in shared_terms:
            if term.lower() in seen:
                continue
            seen.add(term.lower())
            ordered_terms.append(term)

        return sorted(ordered_terms, key=len, reverse=True)

    def _build_term_pattern(self, term: str):
        escaped = re.escape(term)
        if term.replace(" ", "").isalnum():
            return re.compile(rf"(?<!\w){escaped}(?!\w)", re.IGNORECASE)
        return re.compile(escaped, re.IGNORECASE)

    def _protect_terms(
        self,
        text: str,
        replacements: dict[str, str] | None = None,
        next_index: int = 0,
    ) -> tuple[str, dict[str, str], int]:
        if not text.strip():
            return text, replacements or {}, next_index

        protected = text
        replacement_map = replacements or {}

        for term in self._protected_terms:
            pattern = self._build_term_pattern(term)

            def replace_match(match):
                nonlocal next_index
                placeholder = f"__TERM_{next_index}__"
                replacement_map[placeholder] = match.group(0)
                next_index += 1
                return placeholder

            protected = pattern.sub(replace_match, protected)

        return protected, replacement_map, next_index

    def _protect_payload(
        self,
        text: str,
        context: str,
    ) -> tuple[str, str, dict[str, str]]:
        protected_text, replacements, next_index = self._protect_terms(text)
        protected_context, replacements, _ = self._protect_terms(
            context,
            replacements=replacements,
            next_index=next_index,
        )
        return protected_text, protected_context, replacements

    def _restore_terms(self, text: str | None, replacements: dict[str, str]) -> str | None:
        if text is None:
            return None

        restored = text
        for placeholder, original in replacements.items():
            restored = restored.replace(placeholder, original)
        return restored

    def translate(
        self,
        text: str,
        fast_mode: bool = False,
        context: str = "",
        prefer_quality: bool = True,
    ) -> str:
        """Translate text with fallback chain: DeepL -> Argos"""
        if not text or not text.strip():
            self.last_provider = "passthrough"
            return ""

        text_stripped = text.strip()
        protected_text, protected_context, replacements = self._protect_payload(
            text,
            context,
        )

        if fast_mode:
            if self.translator:
                try:
                    result = self.translator.translate(protected_text)
                    result = self._restore_terms(result, replacements)
                    self.last_provider = "fast-argos"
                    return result
                except Exception as e:
                    print(f"[Translate] Fast Argos failed: {e}")
            self.last_provider = "passthrough"
            return text

        # 1. Try DeepL (Highest Quality) - Skip Finnish source to avoid unstable provider results
        if self.source_lang.lower() != "fi":
            result = self.deepl_translator.translate(
                protected_text,
                context=protected_context,
                model_type=("prefer_quality_optimized" if prefer_quality else "latency_optimized"),
            )
            if result:
                result = self._restore_terms(result, replacements)
                result_stripped = result.strip()
                # Check if DeepL actually translated (not just returned same text)
                if result_stripped.lower() != text_stripped.lower():
                    self.last_provider = "deepl"
                    return result
                else:
                    print("[DeepL] Same text returned, falling back to offline translation...")
        else:
            print("[DeepL] Skipping for Finnish (source='fi')")

        # 2. Fallback to Argos (Offline)
        if not self._installed:
            self.load()

        if self.translator:
            try:
                result = self.translator.translate(protected_text)
                result = self._restore_terms(result, replacements)
                self.last_provider = "argos"
                return result
            except Exception as e:
                print(f"[Translate] Argos failed: {e}")
                self.last_provider = "passthrough"
                return text

        self.last_provider = "passthrough"
        return text

    def update_source_lang(self, new_source_lang: str):
        """Update source language and reinitialize translators"""
        if new_source_lang == self.source_lang:
            return

        print(f"[Translate] Updating source language: {self.source_lang} -> {new_source_lang}")
        self.source_lang = new_source_lang

        # Reinitialize translators with new source language
        self.deepl_translator = DeepLTranslator(source_lang=new_source_lang, target_lang=self.target_lang)
        self._protected_terms = self._build_protected_terms(new_source_lang)
        self.translator = None
        self._installed = False


# ═══════════════════════════════════════════════════════════════════════════════
# ZMQ PUBLISHER
# ═══════════════════════════════════════════════════════════════════════════════


class ZmqPublisher:
    """
    ZeroMQ PUB socket for sending transcripts to Electron.
    Low latency pub/sub pattern.
    """

    def __init__(self, address: str = "tcp://127.0.0.1:5555"):
        self.address = address
        self.socket = None
        self.context = None

    def start(self):
        """Start ZMQ publisher"""
        try:
            import zmq

            self.context = zmq.Context()
            self.socket = self.context.socket(zmq.PUB)
            self.socket.bind(self.address)

            # High water mark for message buffering
            self.socket.setsockopt(zmq.SNDHWM, 10)

            print(f"[ZMQ] Publisher bound to {self.address}")

        except ImportError:
            print("[ZMQ] pyzmq not available, using stdout fallback")
            self.socket = None
        except Exception as e:
            print(f"[ZMQ] Critical Error - Failed to start: {e}")
            print("[ZMQ] Please check if another instance of the app is running.")
            sys.exit(1)  # Fail fast to prevent zombie process
            self.socket = None

    def publish(self, result):
        """Publish transcript result or generic dict"""
        if hasattr(result, "__dataclass_fields__"):
            data = json.dumps(asdict(result))
        elif isinstance(result, dict):
            data = json.dumps(result)
        else:
            return  # Ignore unknown types

        if self.socket:
            try:
                self.socket.send_string(data)
            except Exception as e:
                print(f"[ZMQ] Send error: {e}")
        # else:
        # Fallback for stdout debugging (optional, too noisy for audio levels)
        # if not isinstance(result, dict) or result.get('type') != 'audio_level':
        #    print(f"[TRANSCRIPT] {data}", flush=True)

    def publish_audio_level(self, level: float):
        """Publish audio RMS level for visualizer"""
        msg = {"type": "audio_level", "level": float(level)}
        self.publish(msg)

    def stop(self):
        """Stop ZMQ publisher"""
        if self.socket:
            self.socket.close()
            self.socket = None
        if self.context:
            self.context.term()
            self.context = None
        print("[ZMQ] Publisher stopped")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

from azure_translation_engine import AzureSpeechTranslationClient
from deepgram_engine import DeepgramWSClient


class SubtitleEngine:
    """
    Main engine orchestrating audio capture, transcription, translation, and publishing.
    """

    def __init__(self, config: EngineConfig):
        self.config = config
        self._running = False
        self._last_speech_time = 0.0
        self._last_transcript_time = 0.0
        self._min_transcript_interval = 0.35
        self._deepgram = DeepgramWSClient(None)  # we set publisher below
        self._azure_speech = AzureSpeechTranslationClient(None)
        self._listening_epoch = 0

        # Cümle biriktirme sistemi
        self._sentence_buffer: list = []  # Biriken cümleler
        self._silence_threshold = 0.35  # Faster finalize for real-time subtitles
        self._current_speech_audio: list = []  # Şu anki konuşma sesi
        self._audio_lock = threading.Lock()  # Thread safety lock

        # Components
        self.vad = VoiceActivityDetector(
            mode=config.vad_mode,
            sample_rate=config.sample_rate,
            frame_duration=config.vad_frame_duration,
        )

        self.audio_capture = AudioCapture(
            device_name=config.audio_device,
            sample_rate=config.sample_rate,
            channels=config.channels,
            chunk_duration=config.chunk_duration,
            callback=self._on_audio_chunk,
        )

        self.transcriber = TranscriptionEngine(
            model_name=config.whisper_model,
            device=config.whisper_device,
            compute_type=config.whisper_compute_type,
            language=config.whisper_language,
        )

        self.translator = TranslationEngine(source_lang=config.source_lang, target_lang=config.target_lang)

        self.publisher = ZmqPublisher(address=config.zmq_address)
        self._deepgram.publisher = self.publisher
        self._deepgram.translator = self.translator
        self._deepgram.streaming_mode = config.streaming_mode
        self._azure_speech.publisher = self.publisher
        self._azure_speech.streaming_mode = config.streaming_mode

        # Processing thread
        self._process_thread: threading.Thread | None = None
        self._process_event = threading.Event()

        # Command Listener (Config updates)
        self._command_thread: threading.Thread | None = None
        self._command_context = zmq.Context()
        self._command_socket = self._command_context.socket(zmq.SUB)
        # Note: Electron Binds to 5556, we Connect to it.
        self._command_socket.connect("tcp://127.0.0.1:5556")
        self._command_socket.setsockopt_string(zmq.SUBSCRIBE, "")

        # Audio Level Broadcasting State
        self._last_audio_level_time = 0.0
        self._audio_level_interval = 1.0 / 30.0  # 30 FPS visualizer

    def _select_cloud_backend_name(self) -> str | None:
        if self._azure_speech.has_credentials():
            return "azure"
        if self._deepgram.has_credentials():
            return "deepgram"
        return None

    def _get_active_cloud_client(self):
        if getattr(self._azure_speech, "_running", False):
            return self._azure_speech
        if getattr(self._deepgram, "_running", False):
            return self._deepgram

        backend = self._select_cloud_backend_name()
        if backend == "azure":
            return self._azure_speech
        if backend == "deepgram":
            return self._deepgram
        return None

    def _start_cloud_engine(self):
        backend = self._select_cloud_backend_name()

        if backend == "azure":
            self._deepgram.stop()
            self._azure_speech.start(self.config.source_lang)
            if not getattr(self._azure_speech, "_running", False) and self._deepgram.has_credentials():
                print("[Cloud] Azure unavailable, falling back to Deepgram for this session.")
                self._deepgram.start(self.config.source_lang)
            return

        if backend == "deepgram":
            self._azure_speech.stop()
            self._deepgram.start(self.config.source_lang)
            return

        print("[Cloud] WARNING: No Azure Speech or Deepgram credentials configured — cloud engine disabled.")

    def _stop_cloud_engine(self):
        self._azure_speech.stop()
        self._deepgram.stop()

    def _on_audio_chunk(self, audio: np.ndarray):
        """Callback for audio chunks"""
        if not self._running:
            return

        now = time.time()

        if not self.config.is_listening:
            if now - self._last_audio_level_time >= self._audio_level_interval:
                self.publisher.publish_audio_level(0.0)
                self._last_audio_level_time = now
            return

        if self.config.engine_type == "cloud":
            # Send directly to Deepgram WebSocket Engine (bypassing local VAD & Whisper)
            # Audio is float32 normalized; both cloud engines accept linear16 PCM.
            audio_int16 = (audio * 32768.0).astype(np.int16).tobytes()
            cloud_client = self._get_active_cloud_client()
            if cloud_client is not None:
                cloud_client.send_audio(audio_int16)

            # Still broadcast volume for UI
            rms = np.sqrt(np.mean(audio**2))
            if now - self._last_audio_level_time >= self._audio_level_interval:
                visual_level = min(1.0, rms * 20.0)
                self.publisher.publish_audio_level(visual_level)
                self._last_audio_level_time = now
            return

        # ----- LOCAL MODE (Faster Whisper) -----

        # 0. RMS (Enerji) Kontrolü - Dip gürültüyü filtrele ve Visualizer'a gönder
        rms = np.sqrt(np.mean(audio**2))

        # Broadcast Audio Level for Visualizer
        if now - self._last_audio_level_time >= self._audio_level_interval:
            # Normalize RMS roughly to 0.0 - 1.0 range based on typical speech volume
            # Typical speech RMS might be 0.01 to 0.1.
            # Let's boost it visually.
            visual_level = min(1.0, rms * 20.0)  # Boosted sensitivity
            # Debug: Print visual level to see if it's > 0
            if visual_level > 0.05:
                print(f"[Audio] Level: {visual_level:.4f} (RMS: {rms:.6f})")

            self.publisher.publish_audio_level(visual_level)
            self._last_audio_level_time = now

        MIN_RMS = 0.002  # Gürültü eşiği (deneme yanılma ile gerekirse ayarlanır)

        # VAD check
        is_speech = self.vad.is_speech(audio) and (rms > MIN_RMS)

        if is_speech:
            # Ses var - mevcut konuşma bufferına ekle
            with self._audio_lock:
                self._current_speech_audio.append(audio)

            self._last_speech_time = now
            # Hemen işlemesi için event set et (Streaming)
            self._process_event.set()
        else:
            # Sessizlik
            has_audio = False
            with self._audio_lock:
                has_audio = len(self._current_speech_audio) > 0

            if has_audio:
                # Hala bufferda ses var
                # Eğer sessizlik süresi dolduysa Finalize et
                if now - self._last_speech_time >= self._silence_threshold:
                    self._process_event.set()

    def _command_loop(self):
        """Listen for commands/config updates from Electron"""
        print("[Command] Listener started")
        while self._running:
            try:
                # Non-blocking check or poller could be better, but blocking with timeout is fine
                if self._command_socket.poll(timeout=500):
                    msg = self._command_socket.recv_string()
                    try:
                        data = json.loads(msg)
                        if data.get("type") == "config":
                            key = data.get("key")
                            value = data.get("value")
                            print(f"[Command] Config update: {key} = {value}")

                            if key == "streaming_mode":
                                self.config.streaming_mode = bool(value)
                                self._deepgram.streaming_mode = self.config.streaming_mode
                                self._azure_speech.streaming_mode = self.config.streaming_mode
                            elif key == "is_listening":
                                enabled = (
                                    value
                                    if isinstance(value, bool)
                                    else str(value).strip().lower() in {"1", "true", "yes", "on"}
                                )
                                if self.config.is_listening != enabled:
                                    self.config.is_listening = enabled
                                    self._listening_epoch += 1
                                    state = "resumed" if enabled else "paused"
                                    print(f"[Command] Listening {state}")

                                    if not enabled:
                                        with self._audio_lock:
                                            self._current_speech_audio.clear()
                                        self.publisher.publish_audio_level(0.0)
                                        self._process_event.set()
                            elif key == "source_lang":
                                self.config.source_lang = str(value)
                                # Also update translation engine
                                if hasattr(self, "translator") and self.translator:
                                    self.translator.update_source_lang(str(value))
                                # Restart Deepgram with new language if cloud engine is active
                                if self.config.engine_type == "cloud" and self._get_active_cloud_client() is not None:
                                    self._start_cloud_engine()
                            elif key == "engine_type":
                                next_engine_type = str(value)
                                if next_engine_type != self.config.engine_type:
                                    self._listening_epoch += 1
                                    with self._audio_lock:
                                        self._current_speech_audio.clear()
                                    self._process_event.set()

                                self.config.engine_type = next_engine_type
                                print(f"[Command] Engine Type set to: {value}")
                                if next_engine_type == "cloud":
                                    self._start_cloud_engine()
                                else:
                                    self._stop_cloud_engine()
                        elif data.get("type") == "update_keys":
                            # Fired by Electron save-config; must be a top-level branch
                            dg_key = data.get("deepgram")
                            dl_key = data.get("deepl")
                            azure_key = data.get("azureSpeech")
                            azure_region = data.get("azureSpeechRegion")
                            print("[Command] Updating API keys...")
                            if dg_key is not None:
                                self._deepgram.update_api_key(str(dg_key))
                            if azure_key is not None or azure_region is not None:
                                self._azure_speech.update_credentials(
                                    None if azure_key is None else str(azure_key),
                                    None if azure_region is None else str(azure_region),
                                )
                            if dl_key:
                                if hasattr(self.translator, "deepl_translator"):
                                    self.translator.deepl_translator.update_api_key(dl_key)
                            if self.config.engine_type == "cloud":
                                self._start_cloud_engine()
                        elif data.get("type") == "shutdown":
                            print("[Command] Shutdown requested by Electron")
                            self.stop()
                            break
                    except json.JSONDecodeError:
                        pass

            except Exception as e:
                print(f"[Command] Error: {e}")
                time.sleep(1)

    def _process_loop(self):
        """Background processing loop - Real-time Streaming"""

        last_partial_text = ""
        last_context = ""  # Hafıza (Önceki cümle)

        # Maksimum segment süresi (saniye) - Çok uzarsa kesip yeni satıra geçsin
        # Maksimum segment süresi (saniye) - Çok uzarsa kesip yeni satıra geçsin
        MAX_SEGMENT_DURATION = 3.0

        while self._running:
            # Wait for event
            self._process_event.wait(timeout=0.2)
            self._process_event.clear()

            if not self._running:
                break

            if not self.config.is_listening:
                last_partial_text = ""
                continue

            now = time.time()
            processing_epoch = self._listening_epoch

            with self._audio_lock:
                if not self._current_speech_audio:
                    continue
                # Copy buffer for processing to avoid holding lock during heavy ops
                # Fix: Track count to only remove processed chunks later
                processed_count = len(self._current_speech_audio)
                current_audio_copy = list(self._current_speech_audio)

            # Determine Interval based on Streaming Mode
            # Streaming mode still needs throttling or the CPU cost jumps sharply.
            interval = 0.2 if self.config.streaming_mode else self._min_transcript_interval

            # Rate limiting
            if now - self._last_transcript_time < interval:
                continue

            # 3. Determine if Final or Partial
            is_silence_final = now - self._last_speech_time >= self._silence_threshold

            # Ses buffer süresini hesapla
            total_samples = sum(len(c) for c in current_audio_copy)
            duration_sec = total_samples / self.config.sample_rate

            is_timeout_final = duration_sec > MAX_SEGMENT_DURATION

            is_final = is_silence_final or is_timeout_final

            # 4. Prepare Audio
            try:
                audio = np.concatenate(current_audio_copy)
            except ValueError:
                continue

            if len(audio) < self.config.sample_rate * 0.2:
                if is_final:
                    with self._audio_lock:
                        self._current_speech_audio.clear()
                continue

            if not is_final and not self.config.streaming_mode:
                continue

            # 5. Transcribe (Only at the end) with CONTEXT
            # last_partial_text'i prompt olarak kullan (veya bir önceki cümleyi)
            # Burada 'last_partial_text' streaming için kullanılıyordu, context için
            # bir üst scope'ta 'previous_sentence' tutmak daha iyi.

            text, confidence, detected_lang = self.transcriber.transcribe(
                audio,
                self.config.sample_rate,
                prompt=last_context,  # <--- Use previous sentence as context
            )
            text = text.strip()

            if not text:
                if is_final:
                    with self._audio_lock:
                        self._current_speech_audio.clear()
                continue

            # 5.5. Language Match Check
            # Only translate if detected language matches selected source language
            if detected_lang != self.config.source_lang:
                if is_final:
                    print(
                        f"[Engine] Detected '{detected_lang}' but selected '{self.config.source_lang}', skipping...",
                        flush=True,
                    )
                    with self._audio_lock:
                        self._current_speech_audio.clear()
                continue

            # 6. Translate (language matched)
            translated = self.translator.translate(
                text,
                fast_mode=self.config.streaming_mode and not is_final,
                context=last_context if is_final else "",
                prefer_quality=is_final,
            )

            if not self.config.is_listening or processing_epoch != self._listening_epoch:
                last_partial_text = ""
                continue

            if self.config.streaming_mode and not is_final and text == last_partial_text:
                self._last_transcript_time = now
                continue

            # 7. Publish
            result = TranscriptResult(
                original=text,
                translated=translated.strip(),
                timestamp=now,
                isFinal=is_final,
                confidence=confidence,
                source="local",
                translationProvider=self.translator.last_provider,
            )

            # Stable Mode Logic: Only publish if final (sentence complete)
            # Fast Mode Logic: Publish everything immediately
            should_publish = is_final or self.config.streaming_mode

            if should_publish:
                self.publisher.publish(result)
                print(
                    f"[Transcript] local {'FINAL' if is_final else 'PARTIAL'} "
                    f"({self.translator.last_provider}): '{text[:80]}'",
                    flush=True,
                )
                self._last_transcript_time = now

            if is_final:
                # Update context for next sentence
                last_context = text  # "Hafıza" güncelle
                last_partial_text = ""

                with self._audio_lock:
                    # Fix: Only remove the chunks we actually processed
                    # New chunks might have arrived during transcription!
                    if processing_epoch == self._listening_epoch:
                        del self._current_speech_audio[:processed_count]
                    else:
                        self._current_speech_audio.clear()
                # Eğer timeout ise ve hala konuşuyorsa (VAD true ise), son konuşma zamanını resetleme ki hemen yeni cümle başlasın?
                # Şimdilik direkt temizliyoruz, ses gelmeye devam ederse _on_audio_chunk yeni buffer dolduracak.
            else:
                last_partial_text = text

    def start(self, model_size: str | None = None):
        """Start the audio capture and processing loop"""
        if self._running:
            return

        print("[Engine] Starting...")
        self._running = True

        # Load AI Models
        print("[Engine] Loading AI models (this may take a moment)...")

        if self.config.engine_type == "local":
            selected_model = model_size or self.config.whisper_model
            print(
                f"[Whisper] Loading model '{selected_model}' (device={self.transcriber.device}, compute={self.transcriber.compute_type})..."
            )
            self.transcriber.load(selected_model)
        else:
            print("[Engine] Cloud mode selected, skipping local Whisper warm-up")

        # Translator preload is safe in both modes. In cloud mode this warms the
        # offline fallback and keeps translation latency lower without blocking
        # startup.
        self.translator.preload_async()

        # Start components
        self.publisher.start()

        # Start deepgram initially if configured
        if self.config.engine_type == "cloud":
            self._start_cloud_engine()

        # Start processing thread
        self._process_thread = threading.Thread(target=self._process_loop, daemon=True)
        self._process_thread.start()

        # Start command thread
        self._command_thread = threading.Thread(target=self._command_loop, daemon=True)
        self._command_thread.start()

        # Start audio capture (this blocks in callback mode)
        self.audio_capture.start()

        print("[Engine] Started successfully. Listening for audio...")

    def stop(self):
        """Stop the engine"""
        if not self._running:
            return

        print("[Engine] Stopping...")
        self._running = False
        self._process_event.set()  # Wake up processing thread

        # Stop components
        self.audio_capture.stop()
        self.publisher.stop()
        self._stop_cloud_engine()

        current_thread = threading.current_thread()

        # Wait for processing thread
        if self._process_thread and self._process_thread is not current_thread:
            self._process_thread.join(timeout=2.0)

        if self._command_thread and self._command_thread is not current_thread:
            # Often ZMQ receive is blocking, so maybe it won't join easily without a message
            # But we used poll(timeout=500), so it should exit within 0.5s
            self._command_thread.join(timeout=2.0)

        if self._command_socket:
            self._command_socket.close(0)
            self._command_socket = None

        if self._command_context:
            self._command_context.term()
            self._command_context = None

        print("[Engine] Stopped")

    def run(self):
        """Run the engine (blocking)"""

        # Signal handlers
        def signal_handler(sig, frame):
            print("\n[Engine] Received shutdown signal")
            self.stop()
            sys.exit(0)

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        try:
            self.start()

            # Keep running
            while self._running:
                time.sleep(1)

        except KeyboardInterrupt:
            pass
        finally:
            self.stop()


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════


def main():
    """Main entry point"""
    print("=" * 60)
    print("  Stealth Subtitle Translator - AI Engine")
    print("  Faster-Whisper + ArgosTranslate + ZeroMQ")
    print("=" * 60)
    print()

    # Create and run engine
    engine = SubtitleEngine(CONFIG)
    engine.run()


if __name__ == "__main__":
    main()
