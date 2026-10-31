import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from validate_landmark_artifacts import validate


class LandmarkArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def shard(self, split, *, empty=False, bad_span=False, license="CC BY 4.0"):
        path = self.root / f"{split}-00.npz"
        frames = 0 if empty else 2
        index = [] if empty else [{"offset": 1 if bad_span else 0, "frames": 2, "sign": "hello", "signer": "A",
                                   "license": license, "recording_sha256": "a"*64}]
        np.savez_compressed(path, pose=np.zeros((frames, 33, 3)), hands=np.zeros((frames, 2, 21, 2)), index=json.dumps(index))
        path.with_suffix(".sha256").write_text(hashlib.sha256(path.read_bytes()).hexdigest())
        return path

    def test_complete_artifacts(self):
        self.shard("train")
        self.shard("test")
        self.assertEqual(validate(self.root, 1, 1), {"shards": 2, "clips": 2})

    def test_missing_directory_or_shards_block_training(self):
        with self.assertRaisesRegex(ValueError, "missing=.*test-00.npz"):
            validate(self.root / "missing", 1, 1)
        self.shard("train")
        with self.assertRaisesRegex(ValueError, "incomplete"):
            validate(self.root, 1, 1)

    def test_corrupt_artifact_or_missing_digest_block_training(self):
        self.shard("train")
        path = self.shard("test")
        path.write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            validate(self.root, 1, 1)
        self.shard("test").with_suffix(".sha256").unlink()
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            validate(self.root, 1, 1)

    def test_empty_shard_bad_index_and_missing_license_block_training(self):
        self.shard("train")
        for kwargs in ({"empty": True}, {"bad_span": True}, {"license": "unknown"}):
            self.shard("test", **kwargs)
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                validate(self.root, 1, 1)

    def test_unexpected_shard_blocks_training(self):
        self.shard("train")
        self.shard("test")
        self.shard("val")
        with self.assertRaisesRegex(ValueError, "unexpected=.*val-00.npz"):
            validate(self.root, 1, 1)


if __name__ == "__main__":
    unittest.main()
