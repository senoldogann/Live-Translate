import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent))

from engine import TranslationEngine


class TranslationTermProtectionTests(unittest.TestCase):
    def test_translate_restores_protected_terms_after_provider_response(self):
        engine = TranslationEngine(source_lang="en", target_lang="tr")
        captured = {}

        def fake_deepl_translate(text, context="", model_type=None):
            captured["text"] = text
            captured["context"] = context
            captured["model_type"] = model_type
            return f"CEVIRI {text}"

        engine.deepl_translator.translate = fake_deepl_translate
        engine.google_translator.translate = lambda text: f"GOOGLE {text}"

        result = engine.translate(
            "AWS Lambda works with the OpenAI API",
            context="Amazon Web Services uses AWS Lambda",
            prefer_quality=True,
        )

        self.assertEqual(engine.last_provider, "deepl")
        self.assertIn("__TERM_", captured["text"])
        self.assertIn("__TERM_", captured["context"])
        self.assertIn("AWS", result)
        self.assertIn("Lambda", result)
        self.assertIn("OpenAI", result)
        self.assertIn("API", result)
        self.assertNotIn("__TERM_", result)


if __name__ == "__main__":
    unittest.main()
