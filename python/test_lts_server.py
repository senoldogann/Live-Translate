"""Tests for the LTS WebSocket translation server (python/lts_server.py)."""

import asyncio
import json
import unittest

import numpy as np
import websockets

from lts_server import (
    LTSConfig,
    LTSServer,
    LTSSession,
    int16_bytes_to_float32,
    make_segment,
)

# ═══════════════════════════════════════════════════════════════════════════════
# Fakes
# ═══════════════════════════════════════════════════════════════════════════════


class FakeTranscriber:
    def __init__(self, text="Merhaba dünya.", lang="tr", confidence=0.9):
        self.text = text
        self.lang = lang
        self.confidence = confidence
        self.calls = []

    def load(self):
        pass

    def transcribe(self, audio, sample_rate, prompt=""):
        self.calls.append({"samples": int(audio.size), "prompt": prompt})
        return self.text, self.confidence, self.lang


class FakeTranslator:
    last_provider = "fake"

    def __init__(self, translated="Hello world."):
        self.translated = translated

    def load(self):
        pass

    def translate(self, text, fast_mode=False, context="", prefer_quality=True):
        return self.translated


def loud_chunk(seconds=0.5, sample_rate=16000, amplitude=0.5):
    n = int(sample_rate * seconds)
    return np.full(n, amplitude, dtype=np.float32)


def silence_chunk(seconds=0.5, sample_rate=16000):
    n = int(sample_rate * seconds)
    return np.zeros(n, dtype=np.float32)


class EnergyVAD:
    """Deterministic energy-based VAD for tests.

    The real VAD prefers webrtcvad when installed (CI installs it), and WebRTC
    VAD rejects constant-amplitude synthetic audio — so tests inject this
    fallback instead of depending on the environment.
    """

    def __init__(self, threshold: float = 0.01):
        self.threshold = threshold

    def is_speech(self, audio_chunk: np.ndarray) -> bool:
        rms = float(np.sqrt(np.mean(np.asarray(audio_chunk, dtype=np.float32) ** 2)))
        return rms > self.threshold


# ═══════════════════════════════════════════════════════════════════════════════
# Unit tests — LTSSession
# ═══════════════════════════════════════════════════════════════════════════════


class LTSSessionTests(unittest.TestCase):
    def make_session(self, **kwargs):
        return LTSSession(
            transcriber=FakeTranscriber(),
            translator=FakeTranslator(),
            source_lang="tr",
            target_lang="en",
            vad=EnergyVAD(),
            **kwargs,
        )

    def test_int16_bytes_to_float32(self):
        pcm = np.array([0, 32767, -32768, 16384], dtype=np.int16)
        samples = int16_bytes_to_float32(pcm.tobytes())
        self.assertAlmostEqual(samples[0], 0.0, places=4)
        self.assertAlmostEqual(samples[1], 0.9999, places=3)
        self.assertAlmostEqual(samples[2], -1.0, places=3)
        self.assertAlmostEqual(samples[3], 0.5, places=3)

    def test_make_segment_shape(self):
        seg = make_segment("a", "b", True, 0.9, "tr", "fake")
        self.assertEqual(seg["type"], "segment")
        self.assertEqual(seg["original"], "a")
        self.assertEqual(seg["translated"], "b")
        self.assertTrue(seg["isFinal"])
        self.assertEqual(seg["provider"], "fake")

    def test_silence_produces_no_segments(self):
        session = self.make_session()
        session.feed_samples(silence_chunk(), now=100.0)
        segments = session.tick(now=101.0)
        self.assertEqual(segments, [])

    def test_short_buffer_skipped(self):
        session = self.make_session()
        session.feed_samples(loud_chunk(0.1), now=100.0)  # below 0.2 s minimum
        self.assertEqual(session.tick(now=100.05), [])

    def test_partial_published_while_speaking(self):
        session = self.make_session()
        session.feed_samples(loud_chunk(0.5), now=100.0)
        segments = session.tick(now=100.25)  # silence not elapsed, speaking
        self.assertEqual(len(segments), 1)
        self.assertFalse(segments[0]["isFinal"])
        self.assertEqual(segments[0]["original"], "Merhaba dünya.")

    def test_silence_finalizes(self):
        session = self.make_session()
        session.feed_samples(loud_chunk(0.5), now=100.0)
        # Speech continues → partial.
        self.assertEqual(session.tick(now=100.2)[0]["isFinal"], False)
        # 0.5 s later: silence threshold (0.35) elapsed → final.
        final_segments = session.tick(now=100.8)
        self.assertEqual(len(final_segments), 1)
        self.assertTrue(final_segments[0]["isFinal"])
        # Buffer cleared after final.
        self.assertEqual(session.tick(now=100.9), [])

    def test_timeout_finalizes_mid_speech(self):
        session = self.make_session(max_segment_duration=0.8)
        # Keep feeding speech so silence never elapses; buffer exceeds 0.8 s.
        for t in (100.0, 100.2, 100.4, 100.6, 100.8):
            session.feed_samples(loud_chunk(0.5), now=t)
        segments = session.tick(now=100.9)
        self.assertEqual(len(segments), 1)
        self.assertTrue(segments[0]["isFinal"])

    def test_timeout_cut_without_punctuation_buffers_and_merges(self):
        transcriber = FakeTranscriber(text="Merhaba dünya", lang="tr")  # no punctuation
        session = LTSSession(
            transcriber=transcriber,
            translator=FakeTranslator(),
            source_lang="tr",
            target_lang="en",
            max_segment_duration=0.8,
            vad=EnergyVAD(),
        )
        for t in (100.0, 100.2, 100.4, 100.6, 100.8):
            session.feed_samples(loud_chunk(0.5), now=t)
        # Timeout cut lands mid-sentence → buffered, nothing published.
        self.assertEqual(session.tick(now=100.9), [])
        self.assertEqual(session._sentence_buffer, ["Merhaba dünya"])

        # Next pass completes the sentence (with punctuation) → merged.
        transcriber.text = "nasılsın?"
        session.feed_samples(loud_chunk(0.5), now=101.2)
        segments = session.tick(now=101.6)
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["original"], "Merhaba dünya nasılsın?")
        self.assertTrue(segments[0]["isFinal"])

    def test_duplicate_partial_dedup(self):
        session = self.make_session()
        session.feed_samples(loud_chunk(0.5), now=100.0)
        first = session.tick(now=100.2)  # partial, silence not elapsed
        # Keep feeding speech so the same partial text comes back (no new words).
        session.feed_samples(loud_chunk(0.2), now=100.2)
        second = session.tick(now=100.4)
        self.assertEqual(len(first), 1)
        self.assertFalse(first[0]["isFinal"])
        self.assertEqual(second, [], "duplicate partial must be skipped")

    def test_language_mismatch_skipped(self):
        transcriber = FakeTranscriber(lang="en")  # detected en, selected tr
        session = LTSSession(
            transcriber=transcriber,
            translator=FakeTranslator(),
            source_lang="tr",
            target_lang="en",
            vad=EnergyVAD(),
        )
        session.feed_samples(loud_chunk(0.5), now=100.0)
        self.assertEqual(session.tick(now=100.2), [])
        # Auto-detect accepts any language.
        session.source_lang = "auto"
        session.feed_samples(loud_chunk(0.5), now=100.4)
        self.assertEqual(len(session.tick(now=100.6)), 1)

    def test_context_used_as_prompt(self):
        transcriber = FakeTranscriber()
        session = LTSSession(
            transcriber=transcriber,
            translator=FakeTranslator(),
            source_lang="tr",
            target_lang="en",
            vad=EnergyVAD(),
        )
        session.feed_samples(loud_chunk(0.5), now=100.0)
        session.tick(now=100.8)  # final → last_context set
        self.assertEqual(session.last_context, "Merhaba dünya.")
        session.feed_samples(loud_chunk(0.5), now=101.0)
        session.tick(now=101.2)
        self.assertEqual(transcriber.calls[-1]["prompt"], "Merhaba dünya.")

    def test_reset_clears_state(self):
        session = self.make_session()
        session.feed_samples(loud_chunk(0.5), now=100.0)
        session.tick(now=100.8)
        session.reset()
        self.assertEqual(session._buffer_samples, 0)
        self.assertEqual(session.last_context, "")
        self.assertEqual(session._sentence_buffer, [])


# ═══════════════════════════════════════════════════════════════════════════════
# End-to-end WebSocket tests
# ═══════════════════════════════════════════════════════════════════════════════


class LTSWebSocketTests(unittest.TestCase):
    def run_server_test(self, config: LTSConfig, test_coro):
        async def main():
            server = LTSServer(
                config,
                transcriber_factory=FakeTranscriber,
                translator_factory=lambda src, tgt: FakeTranslator(),
                vad_factory=EnergyVAD,
            )
            async with websockets.serve(server.handle, "127.0.0.1", 0) as ws_server:
                port = ws_server.sockets[0].getsockname()[1]
                await test_coro(port)

        asyncio.run(main())

    def test_auth_rejects_wrong_key(self):
        config = LTSConfig(api_key="secret", load_offline_translator=False)

        async def scenario(port):
            async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send(json.dumps({"type": "config", "apiKey": "wrong"}))
                reply = json.loads(await ws.recv())
                self.assertEqual(reply["type"], "error")
                self.assertIn("unauthorized", reply["message"])

        self.run_server_test(config, scenario)

    def test_full_stream_roundtrip(self):
        config = LTSConfig(api_key="secret", load_offline_translator=False)

        async def scenario(port):
            async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send(
                    json.dumps(
                        {
                            "type": "config",
                            "apiKey": "secret",
                            "sourceLang": "tr",
                            "targetLang": "en",
                        }
                    )
                )
                ready = json.loads(await ws.recv())
                self.assertEqual(ready["type"], "ready")

                # Stream 1.2 s of loud PCM (exceeds silence threshold).
                pcm = (loud_chunk(1.2) * 32767).astype(np.int16).tobytes()
                await ws.send(pcm)

                # Collect segments until a final arrives (timeout 5 s).
                segments = []
                deadline = asyncio.get_event_loop().time() + 5
                while asyncio.get_event_loop().time() < deadline:
                    try:
                        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=1))
                    except TimeoutError:
                        break
                    if msg.get("type") == "segment":
                        segments.append(msg)
                        if msg["isFinal"]:
                            break
                self.assertTrue(any(s["isFinal"] for s in segments), f"no final segment: {segments}")
                final = next(s for s in segments if s["isFinal"])
                self.assertEqual(final["original"], "Merhaba dünya.")
                self.assertEqual(final["translated"], "Hello world.")
                self.assertEqual(final["provider"], "fake")

        self.run_server_test(config, scenario)


if __name__ == "__main__":
    unittest.main()
