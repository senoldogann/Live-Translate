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
    cloud_payload_to_segment,
    int16_bytes_to_float32,
    make_segment,
    resolve_deepgram_language,
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

    def transcribe(self, audio, sample_rate, prompt="", language=None):
        self.calls.append({"samples": int(audio.size), "prompt": prompt, "language": language})
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

    def test_source_lang_passed_to_transcriber(self):
        transcriber = FakeTranscriber()
        session = LTSSession(
            transcriber=transcriber,
            translator=FakeTranslator(),
            source_lang="en",
            target_lang="tr",
            vad=EnergyVAD(),
        )
        session.feed_samples(loud_chunk(0.5), now=100.0)
        session.tick(now=100.2)
        self.assertEqual(transcriber.calls[-1]["language"], "en")

    def test_auto_lang_passes_none(self):
        transcriber = FakeTranscriber()
        session = LTSSession(
            transcriber=transcriber,
            translator=FakeTranslator(),
            source_lang="auto",
            target_lang="tr",
            vad=EnergyVAD(),
        )
        session.feed_samples(loud_chunk(0.5), now=100.0)
        session.tick(now=100.2)
        self.assertIsNone(transcriber.calls[-1]["language"])

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
# Health endpoint + connection limits
# ═══════════════════════════════════════════════════════════════════════════════


class LTSHealthAndLimitsTests(unittest.TestCase):
    def make_server(self, **config_kwargs):
        config = LTSConfig(load_offline_translator=False, **config_kwargs)
        return LTSServer(
            config,
            transcriber_factory=FakeTranscriber,
            translator_factory=lambda src, tgt: FakeTranslator(),
            vad_factory=EnergyVAD,
        )

    def test_health_path_returns_ok(self):
        from types import SimpleNamespace

        server = self.make_server()
        resp = asyncio.run(server._process_request(None, SimpleNamespace(path="/health")))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.body, b"ok")

    def test_other_paths_pass_through(self):
        from types import SimpleNamespace

        server = self.make_server()
        resp = asyncio.run(server._process_request(None, SimpleNamespace(path="/")))
        self.assertIsNone(resp)

    def test_health_endpoint_over_http(self):
        """A real server answers GET /health with 200 "ok" (Docker HEALTHCHECK)."""
        import urllib.request

        def fetch(port: int) -> tuple[int, bytes]:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5) as resp:
                return resp.status, resp.read()

        async def main():
            server = self.make_server()
            async with server._serve() as ws_server:
                port = ws_server.sockets[0].getsockname()[1]
                # Blocking HTTP call must run off the event loop.
                status, body = await asyncio.to_thread(fetch, port)
                self.assertEqual(status, 200)
                self.assertEqual(body, b"ok")

        asyncio.run(main())

    def test_max_connections_rejects_overflow(self):
        """Beyond the cap, new clients are closed with 1013 (try again later)."""

        async def main():
            server = self.make_server(max_connections=1)
            async with server._serve() as ws_server:
                port = ws_server.sockets[0].getsockname()[1]
                first = await websockets.connect(f"ws://127.0.0.1:{port}")
                # Let the first handler acquire the slot.
                await asyncio.sleep(0.05)
                second = await websockets.connect(f"ws://127.0.0.1:{port}")
                try:
                    await second.recv()
                    self.fail("expected the second connection to be closed")
                except websockets.ConnectionClosed as exc:
                    self.assertEqual(exc.code, 1013)
                await first.close()

        asyncio.run(main())


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


# ═══════════════════════════════════════════════════════════════════════════════
# Hallucination guard
# ═══════════════════════════════════════════════════════════════════════════════


class LTSHallucinationGuardTests(unittest.TestCase):
    def make_session(self):
        return LTSSession(
            transcriber=FakeTranscriber(),
            translator=FakeTranslator(),
            source_lang="tr",
            target_lang="en",
            vad=EnergyVAD(),
        )

    def test_cjk_punctuation_flood_rejected(self):
        s = self.make_session()
        flood = "《 《 《 《 《 《《《《《《《《《《"
        self.assertTrue(s._is_hallucination(flood, confidence=0.5))

    def test_repeated_phrase_loop_rejected(self):
        s = self.make_session()
        loop = ", ".join(["I'm not a real man"] * 30)
        self.assertTrue(s._is_hallucination(loop, confidence=0.2))

    def test_very_low_confidence_rejected(self):
        s = self.make_session()
        self.assertTrue(s._is_hallucination("some plausible words here despite noise", confidence=-1.5))

    def test_normal_speech_accepted(self):
        s = self.make_session()
        text = "Bugün hava çok güzel ve ben yürüyüşe çıktım."
        self.assertFalse(s._is_hallucination(text, confidence=0.9))

    def test_short_speech_accepted(self):
        s = self.make_session()
        # Fewer than 8 words → repetition/debris heuristics do not apply.
        self.assertFalse(s._is_hallucination("Merhaba dünya", confidence=0.8))


# ═══════════════════════════════════════════════════════════════════════════════
# Cloud (Deepgram) mode
# ═══════════════════════════════════════════════════════════════════════════════


class FakeDeepgramClient:
    """Mirrors the DeepgramWSClient surface the LTS server uses — no network."""

    def __init__(self, publisher, translator, *, missing_credentials=False, publish_on_start=None):
        self.publisher = publisher
        self.translator = translator
        self.api_key = ""
        self.streaming_mode = False
        self.source_lang = ""
        self.missing_credentials = missing_credentials
        self.publish_on_start = publish_on_start
        self.started_lang = None
        self.audio_chunks = []
        self.stopped = False

    def has_credentials(self):
        return not self.missing_credentials and bool(self.api_key.strip())

    def start(self, language):
        self.started_lang = language
        if self.publish_on_start is not None:
            self.publisher.publish(self.publish_on_start)

    def send_audio(self, audio_bytes):
        self.audio_chunks.append(audio_bytes)

    def stop(self):
        self.stopped = True


class LTSDeepgramTests(unittest.TestCase):
    def run_deepgram_test(self, config, fake_factory, scenario):
        async def main():
            server = LTSServer(
                config,
                transcriber_factory=FakeTranscriber,
                translator_factory=lambda src, tgt: FakeTranslator(),
                vad_factory=EnergyVAD,
                deepgram_client_factory=fake_factory,
            )
            async with websockets.serve(server.handle, "127.0.0.1", 0) as ws_server:
                port = ws_server.sockets[0].getsockname()[1]
                await scenario(port)

        asyncio.run(main())

    def test_cloud_payload_to_segment_normalizes(self):
        payload = {
            "original": "Hello world.",
            "translated": "Merhaba dünya.",
            "isFinal": False,
            "confidence": 0.88,
            "source": "cloud",
            "translationProvider": "deepl",
            "timestamp": 1234.5,
        }
        seg = cloud_payload_to_segment(payload, "en")
        self.assertEqual(seg["type"], "segment")
        self.assertEqual(seg["original"], "Hello world.")
        self.assertEqual(seg["translated"], "Merhaba dünya.")
        self.assertFalse(seg["isFinal"])
        self.assertEqual(seg["provider"], "deepl")
        self.assertEqual(seg["language"], "en")
        self.assertEqual(seg["ts"], 1234.5)

    def test_cloud_payload_defaults(self):
        seg = cloud_payload_to_segment({"original": "x", "translated": "y"}, "tr")
        self.assertTrue(seg["isFinal"])
        self.assertEqual(seg["provider"], "cloud")
        self.assertEqual(seg["confidence"], 0.0)

    def test_resolve_deepgram_language_auto_defaults_to_en(self):
        self.assertEqual(resolve_deepgram_language("auto"), "en")
        self.assertEqual(resolve_deepgram_language(""), "en")
        self.assertEqual(resolve_deepgram_language("EN"), "en")
        self.assertEqual(resolve_deepgram_language("tr"), "tr")

    def test_unknown_engine_rejected(self):
        config = LTSConfig(load_offline_translator=False)

        async def scenario(port):
            async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send(json.dumps({"type": "config", "engine": "bogus"}))
                reply = json.loads(await ws.recv())
                self.assertEqual(reply["type"], "error")
                self.assertIn("unknown engine", reply["message"])

        self.run_deepgram_test(config, lambda pub, tr: FakeDeepgramClient(pub, tr), scenario)

    def test_deepgram_missing_key_sends_error(self):
        config = LTSConfig(load_offline_translator=False)

        async def scenario(port):
            async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send(json.dumps({"type": "config", "engine": "deepgram"}))
                reply = json.loads(await ws.recv())
                self.assertEqual(reply["type"], "error")
                self.assertIn("Deepgram API key missing", reply["message"])

        factory = lambda pub, tr: FakeDeepgramClient(pub, tr, missing_credentials=True)
        self.run_deepgram_test(config, factory, scenario)

    def test_deepgram_roundtrip_publishes_segments(self):
        config = LTSConfig(load_offline_translator=False)
        sample_payload = {
            "original": "Hello world.",
            "translated": "Merhaba dünya.",
            "isFinal": True,
            "confidence": 0.95,
            "source": "cloud",
            "translationProvider": "deepl",
            "timestamp": 99.0,
        }
        factory = lambda pub, tr: FakeDeepgramClient(pub, tr, publish_on_start=sample_payload)

        async def scenario(port):
            async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send(
                    json.dumps({"type": "config", "engine": "deepgram", "sourceLang": "auto", "sttApiKey": "dg-key"})
                )
                ready = json.loads(await ws.recv())
                self.assertEqual(ready["type"], "ready")
                self.assertEqual(ready["engine"], "deepgram")

                seg = json.loads(await asyncio.wait_for(ws.recv(), timeout=3))
                self.assertEqual(seg["type"], "segment")
                self.assertEqual(seg["original"], "Hello world.")
                self.assertEqual(seg["translated"], "Merhaba dünya.")
                self.assertTrue(seg["isFinal"])
                self.assertEqual(seg["provider"], "deepl")
                # "auto" must resolve to a concrete Deepgram language.
                self.assertEqual(seg["language"], "en")

        self.run_deepgram_test(config, factory, scenario)

    def test_deepgram_forwards_raw_pcm_and_streaming_mode(self):
        config = LTSConfig(load_offline_translator=False)
        holder = {}

        def factory(pub, tr):
            client = FakeDeepgramClient(pub, tr)
            holder["client"] = client
            return client

        async def scenario(port):
            async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send(json.dumps({"type": "config", "engine": "deepgram", "sttApiKey": "dg-key"}))
                await ws.recv()  # ready
                raw = b"\x00\x01\xff\xfe"
                await ws.send(raw)
                await asyncio.sleep(0.2)
                client = holder["client"]
                self.assertEqual(client.audio_chunks, [raw], "raw PCM bytes must be forwarded untouched")
                self.assertTrue(client.streaming_mode, "LTS must request streaming previews")
                self.assertEqual(client.started_lang, "en")

        self.run_deepgram_test(config, factory, scenario)

    def test_deepgram_client_stopped_on_disconnect(self):
        config = LTSConfig(load_offline_translator=False)
        holder = {}

        def factory(pub, tr):
            client = FakeDeepgramClient(pub, tr)
            holder["client"] = client
            return client

        async def scenario(port):
            ws = await websockets.connect(f"ws://127.0.0.1:{port}")
            await ws.send(json.dumps({"type": "config", "engine": "deepgram", "sttApiKey": "dg-key"}))
            await ws.recv()  # ready
            await ws.close()
            await asyncio.sleep(0.3)
            self.assertTrue(holder["client"].stopped, "client must be stopped when the connection ends")

        self.run_deepgram_test(config, factory, scenario)


if __name__ == "__main__":
    unittest.main()
