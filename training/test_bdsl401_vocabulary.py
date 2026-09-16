import json
from pathlib import Path
import tempfile
import unittest

from bdsl401_vocabulary import VOCABULARY, labels_for_codes


class VocabularyTests(unittest.TestCase):
    def setUp(self):
        self.codes = [f"W{i:03}" for i in range(1, 402)]

    def test_all_classes_including_previously_dropped_page_starts(self):
        labels = labels_for_codes(self.codes)
        self.assertEqual(len(labels), 401)
        self.assertEqual(len(set(labels)), 398)
        for code, expected in {"W001": "Father", "W070": "Sweet Taste",
                              "W109": "A Religious Leader or Teacher",
                              "W266": "Sofa", "W308": "Lime",
                              "W392": "Contagious", "W401": "X-Ray"}.items():
            self.assertEqual(labels[self.codes.index(code)], expected)

    def test_labels_follow_classifier_order(self):
        codes = list(reversed(self.codes))
        labels = labels_for_codes(codes)
        self.assertEqual(labels[0], "X-Ray")
        self.assertEqual(labels[-1], "Father")
        with self.assertRaises(ValueError):
            labels_for_codes(self.codes[:-1])
        with self.assertRaises(ValueError):
            labels_for_codes(self.codes[:-1] + ["W001"])

    def test_missing_duplicate_or_untrusted_source_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "vocabulary.json"
            for variant in ("missing", "duplicate", "source", "empty"):
                data = json.loads(VOCABULARY.read_text())
                if variant == "missing":
                    data["entries"].pop()
                elif variant == "duplicate":
                    data["entries"][1] = data["entries"][0]
                elif variant == "source":
                    data["sourceSha256"] = "0" * 64
                else:
                    data["entries"][0]["english"] = ""
                path.write_text(json.dumps(data))
                with self.subTest(variant=variant), self.assertRaises(ValueError):
                    labels_for_codes(self.codes, path)


if __name__ == "__main__":
    unittest.main()
