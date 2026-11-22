from __future__ import annotations

import json
import tempfile
import unittest
import wave
from array import array
from pathlib import Path

from app.voice.dataset import prepare_dataset


class WakeWordDatasetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.rows: list[dict[str, object]] = []
        for speaker in ("speaker_a", "speaker_b", "speaker_c"):
            for label, filename, sample in (
                ("positive", f"{speaker}_positive.wav", 1000),
                ("negative", f"{speaker}_negative.wav", -1000),
            ):
                path = self.root / filename
                with wave.open(str(path), "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(16000)
                    wav.writeframes(array("h", [sample]) * 1600)
                self.rows.append({
                    "path": filename,
                    "label": label,
                    "speaker_id": speaker,
                    "source_id": "locally-created",
                    "rights": "Created by the dataset owner with permission.",
                    "consent_confirmed": True,
                })
        self.manifest = self.root / "source.jsonl"
        self.write_manifest()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_manifest(self) -> None:
        self.manifest.write_text(
            "".join(json.dumps(row) + "\n" for row in self.rows),
            encoding="utf-8",
        )

    def test_prepares_speaker_disjoint_splits_with_both_labels(self) -> None:
        output = self.root / "prepared"
        report = prepare_dataset(self.manifest, output)
        self.assertEqual(report["status"], "dataset_prepared_not_model_trained")
        self.assertFalse(report["speaker_leakage_between_splits"])
        seen: dict[str, str] = {}
        for split_name in ("train", "validation", "test"):
            rows = [
                json.loads(line)
                for line in (output / f"{split_name}.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual({row["label"] for row in rows}, {"positive", "negative"})
            for row in rows:
                speaker = Path(row["path"]).name.split("_")[0]
                if speaker in seen:
                    self.assertEqual(seen[speaker], split_name)
                seen[speaker] = split_name
        self.assertEqual(len(seen), 3)
        self.assertTrue((output / "dataset-report.json").is_file())

    def test_rejects_unconfirmed_permission(self) -> None:
        self.rows[0]["consent_confirmed"] = False
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "consent_confirmed=true"):
            prepare_dataset(self.manifest, self.root / "out")

    def test_rejects_path_escape(self) -> None:
        self.rows[0]["path"] = "../outside.wav"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "inside the selected dataset root"):
            prepare_dataset(self.manifest, self.root / "out")

    def test_rejects_missing_provenance(self) -> None:
        del self.rows[0]["rights"]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "rights"):
            prepare_dataset(self.manifest, self.root / "out")

    def test_rejects_fewer_than_three_speaker_groups(self) -> None:
        self.rows = [row for row in self.rows if row["speaker_id"] != "speaker_c"]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "At least three distinct"):
            prepare_dataset(self.manifest, self.root / "out")

    def test_rejects_split_without_both_classes(self) -> None:
        self.rows = [row for row in self.rows if not (row["speaker_id"] == "speaker_a" and row["label"] == "negative")]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "must contain both positive and negative"):
            prepare_dataset(self.manifest, self.root / "out")


if __name__ == "__main__":
    unittest.main()
