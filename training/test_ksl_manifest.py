"""Ensure evaluation cannot silently omit, relabel, or substitute test clips."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from ksl_clip_manifest import load_manifest, verify_clips


class ManifestTests(unittest.TestCase):
    def test_full_set_and_explicit_typo(self):
        manifest = load_manifest()
        self.assertEqual(sum(c["bytes"] for c in manifest["clips"]), 128719500)
        aliases = {c["file"]: c["expected"] for c in manifest["clips"]
                   if Path(c["file"]).stem != c["expected"]}
        self.assertEqual(aliases, {"꺠끗하다.mp4": "깨끗하다"})

    def test_missing_duplicate_and_traversal_rejected(self):
        original = load_manifest()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            for variant in ("missing", "duplicate", "traversal"):
                data = copy.deepcopy(original)
                if variant == "missing":
                    data["clips"].pop()
                elif variant == "duplicate":
                    data["clips"][1] = data["clips"][0]
                else:
                    data["clips"][0]["file"] = "../outside.mp4"
                path.write_text(json.dumps(data))
                with self.subTest(variant=variant), self.assertRaises(ValueError):
                    load_manifest(path)

    def test_exact_set_content_and_label_required(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clip = root / "typo.mp4"
            clip.write_bytes(b"fixture")
            manifest = {"clips": [{"file": clip.name, "expected": "correct",
                "bytes": 7, "sha256": hashlib.sha256(b"fixture").hexdigest()}]}
            self.assertEqual(verify_clips(root, ["correct"], manifest), {"typo.mp4": "correct"})
            with self.assertRaises(ValueError):
                verify_clips(root, ["wrong"], manifest)
            extra = root / "extra.mp4"
            extra.write_bytes(b"fixture")
            with self.assertRaises(ValueError):
                verify_clips(root, ["correct"], manifest)
            extra.unlink()
            clip.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                verify_clips(root, ["correct"], manifest)
            clip.unlink()
            with self.assertRaises(ValueError):
                verify_clips(root, ["correct"], manifest)


if __name__ == "__main__":
    unittest.main()
