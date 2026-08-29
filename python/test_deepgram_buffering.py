import os
import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from deepgram_engine import DeepgramWSClient


class FakePublisher:
    def __init__(self):
        self.messages = []

    def publish(self, payload):
        self.messages.append(payload)


class FakeTranslator:
    def __init__(self):
        self.calls = []

    def translate(self, text, context="", prefer_quality=True):
        self.calls.append(
            {
                "text": text,
                "context": context,
                "prefer_quality": prefer_quality,
            }
        )
        prefix = "FINAL" if prefer_quality else "PREVIEW"
        return f"{prefix}:{text}"


class FakeAlternative:
    def __init__(self, transcript, confidence=0.91, words=None):
        self.transcript = transcript
        self.confidence = confidence
        self.words = words or []


class FakeChannel:
    def __init__(self, transcript, confidence=0.91, words=None):
        self.alternatives = [FakeAlternative(transcript, confidence, words)]


class FakeWord:
    def __init__(self, start, end):
        self.start = start
        self.end = end


class FakeResultsMessage:
    def __init__(
        self,
        transcript,
        is_final,
        speech_final=False,
        confidence=0.91,
        words=None,
    ):
        self.type = "Results"
        self.channel = FakeChannel(transcript, confidence, words)
        self.is_final = is_final
        self.speech_final = speech_final


class FakeUtteranceEndMessage:
    def __init__(self, last_word_end=1.25):
        self.type = "UtteranceEnd"
        self.last_word_end = last_word_end


class DeepgramBufferingTests(unittest.TestCase):
    def start_client(self, streaming_mode):
        publisher = FakePublisher()
        translator = FakeTranslator()
        client = DeepgramWSClient(publisher, translator)
        client.streaming_mode = streaming_mode
        client._running = True
        client._translation_thread = threading.Thread(
            target=client._translation_loop,
            daemon=True,
            name="deepgram-translate-test",
        )
        client._translation_thread.start()
        return client, publisher, translator

    def stop_client(self, client):
        client._running = False
        client._translation_queue.put(None)
        client._translation_thread.join(timeout=1.0)

    def wait_for_messages(self, publisher, expected_count):
        deadline = time.time() + 1.0
        while time.time() < deadline:
            if len(publisher.messages) >= expected_count:
                return
            time.sleep(0.01)
        self.fail(f"Timed out waiting for {expected_count} messages, got {len(publisher.messages)}")

    def test_streaming_mode_ignores_interims_and_previews_finalized_segments(self):
        client, publisher, translator = self.start_client(streaming_mode=True)
        try:
            client._on_message(FakeResultsMessage("Hello", is_final=False))
            time.sleep(0.05)
            self.assertEqual(publisher.messages, [])

            client._on_message(FakeResultsMessage("Hello everyone", is_final=True, speech_final=False))
            self.wait_for_messages(publisher, 1)

            self.assertFalse(publisher.messages[0]["isFinal"])
            self.assertEqual(publisher.messages[0]["original"], "Hello everyone")
            self.assertEqual(publisher.messages[0]["translated"], "PREVIEW:Hello everyone")
            self.assertFalse(translator.calls[0]["prefer_quality"])

            client._on_message(FakeResultsMessage("Welcome back", is_final=True, speech_final=True))
            self.wait_for_messages(publisher, 2)

            self.assertTrue(publisher.messages[1]["isFinal"])
            self.assertEqual(publisher.messages[1]["original"], "Hello everyone Welcome back")
            self.assertEqual(
                publisher.messages[1]["translated"],
                "FINAL:Hello everyone Welcome back",
            )
            self.assertTrue(translator.calls[1]["prefer_quality"])
        finally:
            self.stop_client(client)

    def test_stable_mode_waits_for_utterance_end_and_uses_context(self):
        client, publisher, translator = self.start_client(streaming_mode=False)
        try:
            client._on_message(FakeResultsMessage("First sentence", is_final=True, speech_final=False))
            time.sleep(0.05)
            self.assertEqual(publisher.messages, [])

            client._on_message(FakeUtteranceEndMessage())
            self.wait_for_messages(publisher, 1)
            self.assertTrue(publisher.messages[0]["isFinal"])
            self.assertEqual(publisher.messages[0]["original"], "First sentence")
            self.assertEqual(translator.calls[0]["context"], "")

            client._on_message(FakeResultsMessage("Second sentence", is_final=True, speech_final=False))
            client._on_message(FakeUtteranceEndMessage())
            self.wait_for_messages(publisher, 2)

            self.assertEqual(publisher.messages[1]["original"], "Second sentence")
            self.assertEqual(translator.calls[1]["context"], "First sentence")
        finally:
            self.stop_client(client)

    def test_clause_boundary_commits_final_prefix_and_keeps_live_tail(self):
        client, publisher, translator = self.start_client(streaming_mode=True)
        try:
            client._on_message(
                FakeResultsMessage(
                    "We have a lot of material to cover, and we are just getting started",
                    is_final=True,
                    speech_final=False,
                )
            )
            self.wait_for_messages(publisher, 2)

            self.assertTrue(publisher.messages[0]["isFinal"])
            self.assertEqual(
                publisher.messages[0]["original"],
                "We have a lot of material to cover,",
            )
            self.assertFalse(publisher.messages[1]["isFinal"])
            self.assertEqual(
                publisher.messages[1]["original"],
                "and we are just getting started",
            )
            self.assertEqual(
                translator.calls[1]["context"],
                "We have a lot of material to cover,",
            )
        finally:
            self.stop_client(client)

    def test_word_gap_commits_at_natural_pause_before_rolling_split(self):
        client, publisher, translator = self.start_client(streaming_mode=True)
        try:
            words = [
                FakeWord(0.0, 0.1),
                FakeWord(0.1, 0.2),
                FakeWord(0.2, 0.3),
                FakeWord(0.3, 0.4),
                FakeWord(0.4, 0.5),
                FakeWord(0.5, 0.6),
                FakeWord(1.05, 1.15),
                FakeWord(1.15, 1.25),
                FakeWord(1.25, 1.35),
            ]

            client._on_message(
                FakeResultsMessage(
                    "This should commit on the word gap before the tail",
                    is_final=True,
                    speech_final=False,
                    words=words,
                )
            )
            self.wait_for_messages(publisher, 2)

            self.assertEqual(
                publisher.messages[0]["original"],
                "This should commit on the word",
            )
            self.assertEqual(
                publisher.messages[1]["original"],
                "gap before the tail",
            )
            self.assertEqual(
                translator.calls[1]["context"],
                "This should commit on the word",
            )
        finally:
            self.stop_client(client)

    def test_long_finalized_segment_holds_back_tail_until_pause(self):
        client, publisher, translator = self.start_client(streaming_mode=False)
        try:
            client._on_message(
                FakeResultsMessage(
                    "We are testing a long running clause that should keep some tail words",
                    is_final=True,
                    speech_final=False,
                )
            )
            self.wait_for_messages(publisher, 1)

            self.assertTrue(publisher.messages[0]["isFinal"])
            self.assertEqual(
                publisher.messages[0]["original"],
                "We are testing a long running clause that should",
            )
            self.assertTrue(translator.calls[0]["prefer_quality"])

            client._on_message(FakeUtteranceEndMessage())
            self.wait_for_messages(publisher, 2)

            self.assertEqual(publisher.messages[1]["original"], "keep some tail words")
            self.assertEqual(
                translator.calls[1]["context"],
                "We are testing a long running clause that should",
            )
        finally:
            self.stop_client(client)

    def test_keyterms_default_and_env_override(self):
        client, _, _ = self.start_client(streaming_mode=False)
        try:
            client.source_lang = "en"
            default_terms = client._get_keyterms()
            self.assertIsNotNone(default_terms)
            self.assertIn("AWS", default_terms)

            previous = os.environ.get("DEEPGRAM_KEYTERMS")
            os.environ["DEEPGRAM_KEYTERMS"] = "Redis, Postgres ,  Kafka "
            try:
                env_terms = client._get_keyterms()
                self.assertEqual(env_terms, ["Redis", "Postgres", "Kafka"])
            finally:
                if previous is None:
                    os.environ.pop("DEEPGRAM_KEYTERMS", None)
                else:
                    os.environ["DEEPGRAM_KEYTERMS"] = previous
        finally:
            self.stop_client(client)


if __name__ == "__main__":
    unittest.main()
