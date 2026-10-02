import csv
import tempfile
import unittest
from pathlib import Path

from training.pipeline import (
    REQUIRED_COLUMNS,
    Sample,
    audit,
    read_manifest,
    signer_split,
    split_integrity_report,
    write_manifest,
)


class PipelineIntegrityTests(unittest.TestCase):
    def make_dataset(self, root: Path) -> list[Sample]:
        samples = []
        for signer in ("s1", "s2", "s3"):
            for gloss in ("HELLO", "NO"):
                filename = f"{signer}-{gloss.lower()}.mp4"
                (root / filename).write_bytes(f"{signer}:{gloss}".encode())
                samples.append(Sample(
                    sample_id=f"{signer}-{gloss}",
                    video_path=filename,
                    gloss=gloss,
                    signer_id=signer,
                    language="asl",
                    source="fixture",
                    license_id="TEST-LICENSE",
                ))
        return samples

    def test_three_signers_always_produce_nonempty_signer_independent_splits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            samples = self.make_dataset(root)
            audit(samples, root, {"TEST-LICENSE"})
            split = signer_split(samples, seed=42)
            report = split_integrity_report(split)

            self.assertEqual(report["signer_leakage"], {})
            self.assertEqual(report["split_signers"], {
                "train": 1,
                "validation": 1,
                "test": 1,
            })
            self.assertTrue(all(count > 0 for count in report["split_counts"].values()))
            self.assertTrue(all(not missing for missing in report["classes_missing_by_split"].values()))

    def test_duplicate_video_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            samples = self.make_dataset(root)
            samples[1] = Sample(**{
                **samples[1].__dict__,
                "video_path": samples[0].video_path,
            })
            with self.assertRaises(ValueError) as error:
                audit(samples, root, {"TEST-LICENSE"})
            self.assertIn("duplicate_video_paths", str(error.exception))

    def test_missing_required_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            samples = self.make_dataset(root)
            samples[0] = Sample(**{
                **samples[0].__dict__,
                "source": "",
            })
            with self.assertRaises(ValueError) as error:
                audit(samples, root, {"TEST-LICENSE"})
            self.assertIn("missing_metadata", str(error.exception))

    def test_written_manifest_has_stable_column_order_and_round_trips(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            samples = signer_split(self.make_dataset(root), seed=7)
            path = root / "split.csv"
            write_manifest(samples, path)

            with path.open(newline="", encoding="utf-8") as handle:
                reader = csv.reader(handle)
                self.assertEqual(next(reader), list(REQUIRED_COLUMNS))

            self.assertEqual(read_manifest(path), samples)


if __name__ == "__main__":
    unittest.main()
