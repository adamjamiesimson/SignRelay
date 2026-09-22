import unittest

import numpy as np

from export_bdsl401_onnx import ordered_codes, prepare_frames, temporal_indices


class BdslContractTests(unittest.TestCase):
    def test_numeric_class_order_and_inverse(self):
        codes = [f"W{i:03d}" for i in range(1, 402)]
        config = {"id2label": {str(i): label for i, label in reversed(list(enumerate(codes)))},
                  "label2id": {label: i for i, label in enumerate(codes)}}
        self.assertEqual(ordered_codes(config), codes)
        config["label2id"]["W001"] = 1
        with self.assertRaises(ValueError):
            ordered_codes(config)

    def test_temporal_selection_truncates_and_repeats(self):
        # Twenty source observations: second sample is index 1, not rounded 1;
        # the third is 2 rather than rounded 3. Keep both endpoints.
        self.assertEqual(temporal_indices(20).tolist()[:4], [0, 1, 2, 3])
        self.assertEqual(temporal_indices(20).tolist()[-1], 19)
        self.assertEqual(temporal_indices(1).tolist(), [0] * 16)
        with self.assertRaises(ValueError):
            temporal_indices(0)

    def test_rgb_normalization_preserves_full_frame_edges(self):
        # The rectangle's red left edge would disappear with a square center crop.
        frames = np.zeros((1, 8, 24, 3), dtype=np.uint8)
        frames[:, :, :4, 0] = 255
        result = prepare_frames(frames)
        self.assertEqual(result.shape, (1, 16, 3, 224, 224))
        self.assertEqual(result.dtype, np.float32)
        self.assertAlmostEqual(float(result[0, 0, 0, 100, 0]), (1 - .485) / .229, places=5)
        self.assertAlmostEqual(float(result[0, 0, 0, 100, -1]), -.485 / .229, places=5)
        self.assertAlmostEqual(float(result[0, 0, 2, 100, 0]), -.406 / .225, places=5)
        np.testing.assert_array_equal(result[:, 0], result[:, -1])
        for invalid in [frames.astype(np.float32), np.zeros((0, 8, 24, 3), dtype=np.uint8), frames[..., :2]]:
            with self.assertRaises(ValueError):
                prepare_frames(invalid)


if __name__ == "__main__":
    unittest.main()
