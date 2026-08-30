#!/usr/bin/env python3
"""Fake LTS server for the iOS integration tests.

Runs the REAL `lts_server.LTSServer` (real WebSocket handling, real session
pipeline) with fake transcriber/translator/VAD, so Swift `LTSClient` tests
exercise the actual wire protocol without downloading a Whisper model:

    python3 scripts/lts_fake_server.py --port 8765

The iOS test suite reads LTS_TEST_PORT from the scheme environment and connects
to ws://127.0.0.1:<port>. The /health endpoint works too (Docker/CI probe).
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))

from lts_server import LTSConfig, LTSServer  # noqa: E402


class FakeTranscriber:
    """Deterministic transcriptions; records call count for assertions."""

    def __init__(self) -> None:
        self.calls = 0

    def load(self) -> None:
        pass

    def transcribe(self, audio, sample_rate, prompt="", language=None):
        self.calls += 1
        return "Merhaba dünya.", 0.9, language or "tr"


class FakeTranslator:
    last_provider = "fake"

    def __init__(self) -> None:
        self.translated = "Hello world."

    def load(self) -> None:
        pass

    def translate(self, text, fast_mode=False, context="", prefer_quality=True):
        return self.translated


class EnergyVAD:
    """Energy-based VAD (deterministic; webrtcvad rejects synthetic audio)."""

    def __init__(self, threshold: float = 0.01) -> None:
        self.threshold = threshold

    def is_speech(self, audio_chunk: np.ndarray) -> bool:
        rms = float(np.sqrt(np.mean(np.asarray(audio_chunk, dtype=np.float32) ** 2)))
        return rms > self.threshold


def main() -> None:
    parser = argparse.ArgumentParser(description="Fake LTS server for iOS integration tests")
    parser.add_argument("--port", type=int, default=int(os.environ.get("LTS_PORT", "8765")))
    args = parser.parse_args()

    config = LTSConfig(port=args.port, load_offline_translator=False)
    server = LTSServer(
        config,
        transcriber_factory=FakeTranscriber,
        translator_factory=lambda src, tgt: FakeTranslator(),
        vad_factory=EnergyVAD,
    )
    print(f"[fake-lts] listening on ws://127.0.0.1:{args.port}", flush=True)
    asyncio.run(server.serve_forever())


if __name__ == "__main__":
    main()
