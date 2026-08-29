"""Unit tests for pure functions and security-critical paths in engine.py.

These tests avoid hardware dependencies (no audio device, no Whisper model,
no ZMQ socket) by exercising only pure helpers and object-level mocks.
"""

import json
import os
import sys
import time
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from engine import (
    EngineConfig,
    SubtitleEngine,
    VoiceActivityDetector,
    ZmqPublisher,
    _ends_with_sentence_punctuation,
    _parse_bool_env,
    apply_runtime_env_overrides,
)


class ParseBoolEnvTests(unittest.TestCase):
    def test_truthy_values(self):
        for raw in ("1", "true", "True", "TRUE", "yes", "on", " 1 ", "yes "):
            self.assertIs(_parse_bool_env(raw), True, f"expected True for {raw!r}")

    def test_falsy_values(self):
        for raw in ("0", "false", "False", "no", "off", " 0 "):
            self.assertIs(_parse_bool_env(raw), False, f"expected False for {raw!r}")

    def test_invalid_values_return_none(self):
        for raw in (None, "", "maybe", "2", "enabled"):
            self.assertIsNone(_parse_bool_env(raw), f"expected None for {raw!r}")


class SentencePunctuationTests(unittest.TestCase):
    def test_detects_sentence_final_punctuation(self):
        for text in ("Hello.", "How are you?", "Wow!", "Evet…", "."):
            self.assertTrue(_ends_with_sentence_punctuation(text), f"expected final for {text!r}")

    def test_rejects_non_final_punctuation(self):
        for text in ("Hello", "Hello,", "What", "Merhaba", ""):
            self.assertFalse(_ends_with_sentence_punctuation(text), f"expected non-final for {text!r}")


class RuntimeEnvOverrideTests(unittest.TestCase):
    def setUp(self):
        self._saved = {
            k: os.environ.get(k)
            for k in (
                "TRANSCRIPT_ZMQ_ADDRESS",
                "COMMAND_ZMQ_ADDRESS",
                "ZMQ_AUTH_TOKEN",
                "ENGINE_SOURCE_LANG",
                "ENGINE_WHISPER_MODEL",
                "ENGINE_TYPE",
                "ENGINE_STREAMING_MODE",
                "ENGINE_IS_LISTENING",
            )
        }

    def tearDown(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_valid_overrides_are_applied(self):
        config = EngineConfig()
        os.environ["ENGINE_SOURCE_LANG"] = "fi"
        os.environ["ENGINE_WHISPER_MODEL"] = "medium"
        os.environ["ENGINE_TYPE"] = "cloud"
        os.environ["ENGINE_STREAMING_MODE"] = "0"
        os.environ["ENGINE_IS_LISTENING"] = "false"
        os.environ["ZMQ_AUTH_TOKEN"] = "tok"
        os.environ["TRANSCRIPT_ZMQ_ADDRESS"] = "tcp://127.0.0.1:9999"

        apply_runtime_env_overrides(config)

        self.assertEqual(config.source_lang, "fi")
        self.assertEqual(config.whisper_model, "medium")
        self.assertEqual(config.engine_type, "cloud")
        self.assertFalse(config.streaming_mode)
        self.assertFalse(config.is_listening)
        self.assertEqual(config.zmq_auth_token, "tok")
        self.assertEqual(config.zmq_address, "tcp://127.0.0.1:9999")

    def test_invalid_values_are_ignored(self):
        config = EngineConfig()
        os.environ["ENGINE_SOURCE_LANG"] = "xx"
        os.environ["ENGINE_TYPE"] = "quantum"
        os.environ["ENGINE_STREAMING_MODE"] = "maybe"

        apply_runtime_env_overrides(config)

        self.assertEqual(config.source_lang, "en")
        self.assertEqual(config.engine_type, "local")
        self.assertTrue(config.streaming_mode)


class EnergyVadTests(unittest.TestCase):
    def setUp(self):
        # Force energy fallback regardless of webrtcvad availability
        self.vad = VoiceActivityDetector.__new__(VoiceActivityDetector)
        self.vad._use_energy_fallback = True

    def test_silence_is_not_speech(self):
        silence = np.zeros(4800, dtype=np.float32)
        self.assertFalse(self.vad._energy_based_detection(silence))

    def test_loud_audio_is_speech(self):
        loud = np.ones(4800, dtype=np.float32) * 0.5
        self.assertTrue(self.vad._energy_based_detection(loud))

    def test_low_amplitude_is_not_speech(self):
        quiet = np.full(4800, 0.0005, dtype=np.float32)
        self.assertFalse(self.vad._energy_based_detection(quiet))

    def test_custom_threshold(self):
        audio = np.full(4800, 0.05, dtype=np.float32)
        self.assertFalse(self.vad._energy_based_detection(audio, threshold=0.1))
        self.assertTrue(self.vad._energy_based_detection(audio, threshold=0.01))


class ZmqEnvelopeTests(unittest.TestCase):
    """Round-trip: publisher signs, engine verifies — including replay & window rules."""

    def _make_publisher(self, token="secret-token"):
        pub = ZmqPublisher.__new__(ZmqPublisher)
        pub.auth_token = token
        return pub

    def _make_engine(self, token="secret-token"):
        engine = object.__new__(SubtitleEngine)
        engine._zmq_auth_token = token
        engine._last_signed_command_time_ms = None
        return engine

    def test_round_trip_with_matching_token(self):
        pub = self._make_publisher()
        engine = self._make_engine()
        result = {"original": "Hello", "translated": "Merhaba", "isFinal": True, "type": "transcript"}

        envelope = json.loads(pub._encode_message(result))
        verified = engine._verify_signed_message(json.dumps(envelope))

        self.assertEqual(verified["original"], "Hello")
        self.assertEqual(verified["translated"], "Merhaba")
        self.assertTrue(verified["isFinal"])

    def test_mismatched_token_is_rejected(self):
        pub = self._make_publisher(token="sender-token")
        engine = self._make_engine(token="receiver-token")

        envelope = pub._encode_message({"original": "x", "translated": "y", "isFinal": False})
        self.assertIsNone(engine._verify_signed_message(envelope))

    def test_tampered_payload_is_rejected(self):
        pub = self._make_publisher()
        engine = self._make_engine()

        envelope = json.loads(pub._encode_message({"original": "x", "translated": "y", "isFinal": True}))
        envelope["payload"] = envelope["payload"].replace("x", "z")
        self.assertIsNone(engine._verify_signed_message(json.dumps(envelope)))

    def test_non_json_message_is_rejected(self):
        engine = self._make_engine()
        self.assertIsNone(engine._verify_signed_message("not-json-at-all"))

    def test_wrong_version_is_rejected(self):
        pub = self._make_publisher()
        engine = self._make_engine()
        envelope = json.loads(pub._encode_message({"original": "x", "translated": "y", "isFinal": True}))
        envelope["v"] = 2
        self.assertIsNone(engine._verify_signed_message(json.dumps(envelope)))

    def test_replayed_command_is_rejected(self):
        pub = self._make_publisher()
        engine = self._make_engine()

        message = pub._encode_message({"type": "config", "key": "engine_type", "value": "cloud"})
        self.assertIsNotNone(engine._verify_signed_message(message))
        # Same envelope again — replay must be rejected
        self.assertIsNone(engine._verify_signed_message(message))

    def test_old_timestamp_outside_window_is_rejected(self):
        pub = self._make_publisher()
        engine = self._make_engine()

        envelope = json.loads(pub._encode_message({"type": "config", "key": "is_listening", "value": True}))
        envelope["ts"] = int(time.time() * 1000) - 60_000  # 60s old
        self.assertIsNone(engine._verify_signed_message(json.dumps(envelope)))

    def test_encode_requires_auth_token(self):
        pub = self._make_publisher(token=None)
        with self.assertRaises(ValueError):
            pub._encode_message({"original": "x", "translated": "y", "isFinal": False})

    def test_encode_returns_empty_for_unknown_type(self):
        pub = self._make_publisher()
        self.assertEqual(pub._encode_message("just-a-string"), "")


class EngineInitTokenTests(unittest.TestCase):
    def test_macos_requires_auth_token(self):
        if sys.platform != "darwin":
            self.skipTest("darwin-only guard")
        config = EngineConfig()
        config.zmq_auth_token = None
        os.environ.pop("ZMQ_AUTH_TOKEN", None)
        with self.assertRaises(RuntimeError):
            SubtitleEngine(config)


if __name__ == "__main__":
    unittest.main()
