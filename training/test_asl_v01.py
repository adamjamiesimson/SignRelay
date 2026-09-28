import unittest
import numpy as np

from prepare_asl_v01 import resample
from train_asl_v01 import split_groups, fit_normalization, normalize


class AslExperimentTests(unittest.TestCase):
    def test_duplicates_never_cross_splits_and_all_classes_are_present(self):
        y = np.array([0] * 11 + [1] * 10)
        hashes = np.array(["duplicate"] * 2 + [f"a{i}" for i in range(9)] + [f"b{i}" for i in range(10)])
        splits = split_groups(y, hashes)
        sets = {key: set(hashes[value]) for key, value in splits.items()}
        self.assertFalse(sets["train"] & sets["validation"])
        self.assertFalse(sets["train"] & sets["test"])
        self.assertFalse(sets["test"] & sets["validation"])
        self.assertEqual(sum(len(value) for value in splits.values()), len(y))
        for indices in splits.values():
            self.assertEqual(set(y[indices]), {0, 1})

    def test_conflicting_duplicate_labels_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "conflicting"):
            split_groups(np.array([0, 1]), np.array(["same", "same"]))

    def test_missing_points_do_not_bias_normalization_or_become_fake_points(self):
        samples = np.zeros((2, 96, 76, 3), dtype=np.float32)
        samples[0, :, 0] = [1, 2, 3]
        mean, scale = fit_normalization(samples)
        np.testing.assert_allclose(mean[0], [1, 2, 3])
        result = normalize(samples, mean, scale)
        self.assertTrue(np.isfinite(result).all())
        self.assertTrue(np.all(result[1] == 0))

    def test_invalid_landmarks_fail_before_creating_a_training_array(self):
        for sample in [np.zeros((0, 76, 3)), np.ones((3, 75, 3)),
                       np.full((3, 76, 3), np.nan), np.zeros((3, 76, 3))]:
            with self.assertRaises(ValueError):
                resample(sample)

    def test_sampling_retains_first_last_frames_and_missing_point_sentinels(self):
        raw = np.ones((10, 76, 3), dtype=np.float32)
        raw[0, 0] = 0
        raw[-1, 1] = 2
        result = resample(raw)
        self.assertEqual(result.shape, (96, 76, 3))
        np.testing.assert_array_equal(result[0], raw[0])
        np.testing.assert_array_equal(result[-1], raw[-1])


if __name__ == "__main__":
    unittest.main()
