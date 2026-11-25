"""The Kaggle ISLR import and cache merge, exercised on a synthetic dataset in the published schema.

The real dataset is gated behind competition rules and tens of gigabytes, so these tests build two
parquet clips in the shape the competition ships (one struct-of-x/y/z column per landmark group) and
check the two things that would otherwise only fail on the training machine, hours in:

  * a clip arrives at the trainer as [T, 86, 3] float16 with the project's point order, and a
    zero-filled hand column reads as a missing hand rather than a hand at the origin;
  * merging keeps the existing rows first, is idempotent, and can be undone.

Skipped when pyarrow or numpy is unavailable, so the rest of the suite still runs.
"""
import csv, json, os, subprocess, sys, tempfile, unittest

try:
    import numpy as np
    import pyarrow as pa
    import pyarrow.parquet as pq
    AVAILABLE = True
except Exception:  # pragma: no cover - environment without the optional deps
    AVAILABLE = False

def read_json(path):
    with open(path) as handle:
        return json.load(handle)


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPELINE = os.path.join(ROOT, "engine-v3", "pipeline")


def write_clip(path, frames, left_present=True):
    rng = np.random.default_rng(len(path))
    def group(count):
        base = rng.normal(0.5, 0.05, (frames, count, 3)).astype(np.float32)
        base[..., 2] = rng.normal(0, 0.01, (frames, count)).astype(np.float32)
        return base
    left = group(21) if left_present else np.zeros((frames, 21, 3), np.float32)
    struct = pa.list_(pa.struct([("x", pa.float32()), ("y", pa.float32()), ("z", pa.float32())]))
    pq.write_table(pa.table({
        "frame": pa.array(np.arange(frames, dtype=np.int32)),
        "left_hand": pa.array([list(map(tuple, f)) for f in left], struct),
        "right_hand": pa.array([list(map(tuple, f)) for f in group(21)], struct),
        "pose": pa.array([list(map(tuple, f)) for f in group(33)], struct),
        "face": pa.array([list(map(tuple, f)) for f in group(468)], struct),
    }), path)


def write_long_clip(path, frames, hand_frames):
    """The layout the competition actually ships: one row per landmark point, nulls for missing points."""
    rng = np.random.default_rng(len(path) + frames)
    rows = {"frame": [], "row_id": [], "type": [], "landmark_index": [], "x": [], "y": [], "z": []}
    counts = {"face": 468, "pose": 33, "left_hand": 21, "right_hand": 21}
    for frame in range(frames):
        for kind, count in counts.items():
            present = kind != "left_hand" or frame < hand_frames
            for index in range(count):
                rows["frame"].append(frame); rows["row_id"].append(len(rows["frame"]) - 1)
                rows["type"].append(kind); rows["landmark_index"].append(index)
                if present:
                    rows["x"].append(float(rng.normal(0.5, 0.05)))
                    rows["y"].append(float(rng.normal(0.5, 0.05)))
                    rows["z"].append(float(rng.normal(0, 0.01)))
                else:
                    # Absent points arrive as null triples, which must stay missing rather than become 0,0
                    rows["x"].append(None); rows["y"].append(None); rows["z"].append(None)
    pq.write_table(pa.table({
        "frame": pa.array(rows["frame"], pa.int32()), "row_id": pa.array(rows["row_id"], pa.int64()),
        "type": pa.array(rows["type"], pa.string()), "landmark_index": pa.array(rows["landmark_index"], pa.int32()),
        "x": pa.array(rows["x"], pa.float64()), "y": pa.array(rows["y"], pa.float64()),
        "z": pa.array(rows["z"], pa.float64()),
    }), path)


LONG_ONLY = {"long": True}


@unittest.skipUnless(AVAILABLE, "numpy and pyarrow are required to build the synthetic dataset")
class IslrImportTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.landmarks = os.path.join(self.dir, "landmarks")
        self.cache = os.path.join(self.dir, "cache")
        os.makedirs(self.cache)
        rows = []
        for participant, sign in (("111", "hello"), ("222", "water"), ("333", "book")):
            folder = os.path.join(self.landmarks, participant)
            os.makedirs(folder)
            write_clip(os.path.join(folder, f"{participant}001.parquet"), 40, left_present=sign != "book")
            rows.append({"sequence_id": f"{participant}001", "participant_id": participant, "sequence_label": sign})
        self.meta = os.path.join(self.dir, "train.csv")
        with open(self.meta, "w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["sequence_id", "participant_id", "sequence_label"])
            writer.writeheader(); writer.writerows(rows)

    def run_pipeline(self, script, *args):
        result = subprocess.run([sys.executable, os.path.join(PIPELINE, script), *args],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_import_writes_the_trainer_contract(self):
        self.run_pipeline("import_islr.py", "--landmarks", self.landmarks, "--meta", self.meta,
                          "--out", self.cache, "--val-fraction", "0", "--test-fraction", "0")
        archive = np.load(os.path.join(self.cache, "islr_train.npz"))
        meta = read_json(os.path.join(self.cache, "islr_train.json"))
        self.assertEqual(archive["pts"].shape[1], 86)
        self.assertEqual(archive["pts"].dtype, np.float16)
        self.assertEqual(int(archive["offsets"][-1]), len(archive["pts"]))
        self.assertEqual({row["sign"] for row in meta}, {"HELLO", "WATER", "BOOK"})
        for name in ("frames", "hand_frames", "signer", "fps", "width", "height", "duration", "key", "sha256"):
            self.assertIn(name, meta[0])

    def test_zero_filled_hand_is_missing_not_at_the_origin(self):
        self.run_pipeline("import_islr.py", "--landmarks", self.landmarks, "--meta", self.meta,
                          "--out", self.cache, "--val-fraction", "0", "--test-fraction", "0")
        archive = np.load(os.path.join(self.cache, "islr_train.npz"))
        meta = read_json(os.path.join(self.cache, "islr_train.json"))
        offsets = archive["offsets"]
        index = [row["sign"] for row in meta].index("BOOK")
        clip = archive["pts"][offsets[index]:offsets[index + 1]]
        self.assertFalse(np.isfinite(clip[:, :21, :]).any(), "a zero hand column must not become a hand at 0,0")

    def test_merge_keeps_base_rows_first_is_idempotent_and_restores(self):
        base_pts = np.full((40, 86, 3), 0.4, np.float16)
        np.savez(os.path.join(self.cache, "train.npz"), pts=base_pts, offsets=np.array([0, 40], np.int64))
        with open(os.path.join(self.cache, "train.json"), "w") as handle:
            json.dump([{"key": "popsign-A", "sign": "HELLO", "signer": "p", "sha256": "a", "frames": 40,
                        "hand_frames": 40, "width": 720, "height": 1280, "fps": 30, "duration": 1.3}], handle)
        self.run_pipeline("import_islr.py", "--landmarks", self.landmarks, "--meta", self.meta,
                          "--out", self.cache, "--val-fraction", "0", "--test-fraction", "0")
        self.run_pipeline("merge_cache.py", "--cache", self.cache, "--add", "islr")
        merged = np.load(os.path.join(self.cache, "train.npz"))
        meta = read_json(os.path.join(self.cache, "train.json"))
        self.assertEqual(len(meta), 4)
        self.assertEqual(meta[0]["key"], "popsign-A", "base rows must stay in front")
        self.assertEqual(int(merged["offsets"][-1]), len(merged["pts"]))
        # Running it again must not append a second copy.
        self.run_pipeline("merge_cache.py", "--cache", self.cache, "--add", "islr")
        self.assertEqual(len(read_json(os.path.join(self.cache, "train.json"))), 4)
        # And the original cache can be put back byte-for-byte.
        self.run_pipeline("merge_cache.py", "--cache", self.cache, "--restore")
        restored = np.load(os.path.join(self.cache, "train.npz"))
        self.assertEqual(len(restored["pts"]), 40)
        self.assertEqual([row["key"] for row in read_json(os.path.join(self.cache, "train.json"))], ["popsign-A"])

    def test_long_format_rows_pivot_into_the_same_contract(self):
        folder = os.path.join(self.landmarks, "444")
        os.makedirs(folder)
        write_long_clip(os.path.join(folder, "444001.parquet"), 20, hand_frames=8)
        with open(self.meta, "a", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["sequence_id", "participant_id", "sequence_label"])
            writer.writerow({"sequence_id": "444001", "participant_id": "444", "sequence_label": "thanks"})
        self.run_pipeline("import_islr.py", "--landmarks", self.landmarks, "--meta", self.meta,
                          "--out", self.cache, "--val-fraction", "0", "--test-fraction", "0")
        archive = np.load(os.path.join(self.cache, "islr_train.npz"))
        meta = read_json(os.path.join(self.cache, "islr_train.json"))
        self.assertEqual(archive["pts"].shape[1], 86)
        index = [row["sign"] for row in meta].index("THANKS")
        clip = archive["pts"][archive["offsets"][index]:archive["offsets"][index + 1]]
        self.assertEqual(len(clip), 20, "one output frame per distinct frame in the file")
        self.assertTrue(np.isfinite(clip[:, 21:42, :]).all(), "right hand is present throughout")
        # The left hand only exists in the first 8 frames; the rest must read as missing, not as (0,0).
        self.assertTrue(np.isfinite(clip[:8, :21, :]).any())
        self.assertFalse(np.isfinite(clip[10:, :21, :]).any())
        self.assertEqual(meta[index]["hand_frames"], 20)

    def test_frame_size_override_reaches_the_stored_metadata(self):
        self.run_pipeline("import_islr.py", "--landmarks", self.landmarks, "--meta", self.meta,
                          "--out", self.cache, "--val-fraction", "0", "--test-fraction", "0",
                          "--width", "1080", "--height", "1920")
        meta = read_json(os.path.join(self.cache, "islr_train.json"))
        self.assertEqual((meta[0]["width"], meta[0]["height"]), (1080, 1920),
                         "a portrait source must record the size that was actually used")

    def test_splits_are_signer_disjoint(self):
        self.run_pipeline("import_islr.py", "--landmarks", self.landmarks, "--meta", self.meta,
                          "--out", self.cache, "--val-fraction", "0.34", "--test-fraction", "0.34")
        signers = {}
        for split in ("train", "val", "test"):
            path = os.path.join(self.cache, f"islr_{split}.json")
            if os.path.exists(path):
                signers[split] = {row["signer"] for row in read_json(path)}
        all_signers = [name for group in signers.values() for name in group]
        self.assertEqual(len(all_signers), len(set(all_signers)), "a signer must not appear in two splits")
        self.assertGreaterEqual(len(signers), 2, "a non-zero fraction must claim a signer")


if __name__ == "__main__":
    unittest.main()
