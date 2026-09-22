"""Regression checks for the legacy release reader; no accuracy claims."""
import pickle
import tempfile
import unittest
from pathlib import Path

import numpy as np
from mediapipe.framework.formats.landmark_pb2 import NormalizedLandmarkList

from train_swl_lse_onnx import LandmarkDataset, read_split, resample, sequence_from_release, validate_splits


class ReleaseReaderTests(unittest.TestCase):
    def test_legacy_protobuf_pickle_roundtrip_and_normalisation(self):
        pose = NormalizedLandmarkList()
        for _ in range(33):
            pose.landmark.add(x=0.5, y=0.5, z=0)
        pose.landmark[11].x = 0.25
        pose.landmark[12].x = 0.75
        record = [{"holistic_legacy": {"pose_landmarks": pose}}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.pkl"
            path.write_bytes(pickle.dumps(record))
            values, label = LandmarkDataset([(path, 7)])[0]
        self.assertEqual(tuple(values.shape), (64, 183))
        self.assertEqual(label.item(), 7)
        self.assertAlmostEqual(values[0, 15].item(), -0.5)
        self.assertAlmostEqual(values[0, 18].item(), 0.5)
        self.assertTrue(np.all(values.numpy()[:, 57:] == 0))

    def test_rejects_unknown_release_shapes(self):
        for value in (None, {}, [], [{}]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                sequence_from_release(value)

    def test_rejects_all_missing_landmarks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty.pkl"
            path.write_bytes(pickle.dumps([{"holistic_legacy": {}}]))
            with self.assertRaisesRegex(ValueError, "Empty or non-finite"):
                LandmarkDataset([(path, 0)])

    def test_rounding_matches_browser_half_up(self):
        np.testing.assert_array_equal(resample(np.array([10, 20]), 3), [10, 20, 20])

    def test_split_parser_does_not_silently_drop_missing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "known.pkl").touch()
            split = root / "train.csv"
            split.write_text("FILENAME,CLASS_ID\nknown.mp4,2\n")
            self.assertEqual(read_split(split, root), [(root / "known.pkl", 2)])
            split.write_text("missing,2\n")
            with self.assertRaisesRegex(ValueError, "Missing sample"):
                read_split(split, root)

    def test_split_overlap_and_class_coverage(self):
        train = [(Path(f"train-{index}.pkl"), index) for index in range(300)]
        valid, test = [(Path("valid.pkl"), 0)], [(Path("test.pkl"), 0)]
        validate_splits(train, valid, test)
        with self.assertRaisesRegex(ValueError, "overlap"):
            validate_splits(train, [train[0]], test)
        with self.assertRaisesRegex(ValueError, "all 300"):
            validate_splits(train[:-1], valid, test)


if __name__ == "__main__":
    unittest.main()
