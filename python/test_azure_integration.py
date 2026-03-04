import sys
import unittest
import os
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent))

from azure_translation_engine import AzureSpeechTranslationClient
from engine import SubtitleEngine, EngineConfig, apply_runtime_env_overrides


class DummyCloudClient:
    def __init__(self, available):
        self.available = available

    def has_credentials(self):
        return self.available


class AzureSpeechClientTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("AZURE_SPEECH_PHRASES", None)
        os.environ.pop("ENGINE_TYPE", None)
        os.environ.pop("ENGINE_SOURCE_LANG", None)

    def test_has_credentials_and_locale_mapping(self):
        client = AzureSpeechTranslationClient(None)
        client.api_key = "test-key"
        client.region = "westeurope"

        self.assertTrue(client.has_credentials())
        self.assertEqual(client._resolve_locale("en"), "en-US")
        self.assertEqual(client._resolve_locale("fi"), "fi-FI")
        self.assertEqual(client._resolve_locale("tr"), "tr-TR")

    def test_update_credentials_restarts_active_session(self):
        client = AzureSpeechTranslationClient(None)
        client.api_key = "old-key"
        client.region = "eastus"
        client.source_lang = "fi"
        client._running = True
        events = []

        client.stop = lambda: events.append("stop")
        client.start = lambda language="en": events.append(f"start:{language}")

        client.update_credentials("new-key", "westeurope")

        self.assertEqual(client.api_key, "new-key")
        self.assertEqual(client.region, "westeurope")
        self.assertEqual(events, ["stop", "start:fi"])

    def test_uses_default_and_override_phrase_hints(self):
        client = AzureSpeechTranslationClient(None)

        default_phrases = client._get_phrase_hints()
        self.assertIn("AWS", default_phrases)

        os.environ["AZURE_SPEECH_PHRASES"] = "Qdrant, LangGraph ,  Redis"
        self.assertEqual(client._get_phrase_hints(), ("Qdrant", "LangGraph", "Redis"))

    def test_runtime_env_overrides_respect_saved_startup_mode(self):
        config = EngineConfig()
        config.engine_type = "local"
        config.source_lang = "en"

        os.environ["ENGINE_TYPE"] = "cloud"
        os.environ["ENGINE_SOURCE_LANG"] = "fi"

        apply_runtime_env_overrides(config)

        self.assertEqual(config.engine_type, "cloud")
        self.assertEqual(config.source_lang, "fi")


class CloudBackendSelectionTests(unittest.TestCase):
    def test_prefers_azure_when_both_cloud_backends_are_available(self):
        engine = object.__new__(SubtitleEngine)
        engine._azure_speech = DummyCloudClient(True)
        engine._deepgram = DummyCloudClient(True)

        self.assertEqual(engine._select_cloud_backend_name(), "azure")

    def test_falls_back_to_deepgram_when_azure_is_missing(self):
        engine = object.__new__(SubtitleEngine)
        engine._azure_speech = DummyCloudClient(False)
        engine._deepgram = DummyCloudClient(True)

        self.assertEqual(engine._select_cloud_backend_name(), "deepgram")


if __name__ == "__main__":
    unittest.main()
