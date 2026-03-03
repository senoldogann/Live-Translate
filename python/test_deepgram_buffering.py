import threading
import time
import unittest

from python.deepgram_engine import DeepgramWSClient


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
    def __init__(self, transcript, confidence=0.91):
        self.transcript = transcript
        self.confidence = confidence


class FakeChannel:
    def __init__(self, transcript, confidence=0.91):
        self.alternatives = [FakeAlternative(transcript, confidence)]


class FakeResultsMessage:
    def __init__(self, transcript, is_final, speech_final=False, confidence=0.91):
        self.type = "Results"
        self.channel = FakeChannel(transcript, confidence)
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
        self.fail(
            f"Timed out waiting for {expected_count} messages, got {len(publisher.messages)}"
        )

    def test_streaming_mode_ignores_interims_and_previews_finalized_segments(self):
        client, publisher, translator = self.start_client(streaming_mode=True)
        try:
            client._on_message(FakeResultsMessage("Hello", is_final=False))
            time.sleep(0.05)
            self.assertEqual(publisher.messages, [])

            client._on_message(
                FakeResultsMessage(
                    "Hello everyone", is_final=True, speech_final=False
                )
            )
            self.wait_for_messages(publisher, 1)

            self.assertFalse(publisher.messages[0]["isFinal"])
            self.assertEqual(publisher.messages[0]["original"], "Hello everyone")
            self.assertEqual(
                publisher.messages[0]["translated"], "PREVIEW:Hello everyone"
            )
            self.assertFalse(translator.calls[0]["prefer_quality"])

            client._on_message(
                FakeResultsMessage("Welcome back", is_final=True, speech_final=True)
            )
            self.wait_for_messages(publisher, 2)

            self.assertTrue(publisher.messages[1]["isFinal"])
            self.assertEqual(
                publisher.messages[1]["original"], "Hello everyone Welcome back"
            )
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
            client._on_message(
                FakeResultsMessage("First sentence", is_final=True, speech_final=False)
            )
            time.sleep(0.05)
            self.assertEqual(publisher.messages, [])

            client._on_message(FakeUtteranceEndMessage())
            self.wait_for_messages(publisher, 1)
            self.assertTrue(publisher.messages[0]["isFinal"])
            self.assertEqual(publisher.messages[0]["original"], "First sentence")
            self.assertEqual(translator.calls[0]["context"], "")

            client._on_message(
                FakeResultsMessage(
                    "Second sentence", is_final=True, speech_final=False
                )
            )
            client._on_message(FakeUtteranceEndMessage())
            self.wait_for_messages(publisher, 2)

            self.assertEqual(publisher.messages[1]["original"], "Second sentence")
            self.assertEqual(translator.calls[1]["context"], "First sentence")
        finally:
            self.stop_client(client)

    def test_long_finalized_segment_soft_commits_without_waiting_for_pause(self):
        client, publisher, translator = self.start_client(streaming_mode=False)
        try:
            client._on_message(
                FakeResultsMessage(
                    "This segment is long enough to commit early",
                    is_final=True,
                    speech_final=False,
                )
            )
            self.wait_for_messages(publisher, 1)

            self.assertTrue(publisher.messages[0]["isFinal"])
            self.assertEqual(
                publisher.messages[0]["original"],
                "This segment is long enough to commit early",
            )
            self.assertTrue(translator.calls[0]["prefer_quality"])
        finally:
            self.stop_client(client)


if __name__ == "__main__":
    unittest.main()
