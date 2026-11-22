# BOZZ wake-word dataset preparation

Gate 9 adds a local dataset validator and speaker-disjoint split generator. It does **not** train a model or bundle voice recordings.

## Privacy and rights requirements

- Use recordings you created yourself or have clear permission and legal rights to use.
- Do not record another person without their informed permission.
- Use anonymous speaker IDs such as `speaker_001`; do not put names, contact details, or other personal identifiers in manifests.
- Keep the dataset, source manifest, generated split manifests, and audit report on your PC. Do not commit audio or manifests containing identifying details.
- Keep training, validation, and test speakers separate. Do not tune thresholds against the final test split.
- The tool does not open a microphone, contact a network, upload audio, or transform audio.

## Dataset layout

Create a folder such as `C:\\BOZZ-data\\wake-word\\` with a local source manifest and WAV files. The manifest is JSON Lines, one clip per line:

```jsonl
{"path":"audio/speaker_001_bozz_01.wav","label":"positive","speaker_id":"speaker_001","source_id":"owner_recording_001","rights":"Recorded by dataset owner; permitted for this project.","consent_confirmed":true}
{"path":"audio/speaker_001_negative_01.wav","label":"negative","speaker_id":"speaker_001","source_id":"owner_recording_001","rights":"Recorded by dataset owner; permitted for this project.","consent_confirmed":true}
{"path":"audio/speaker_002_bozz_01.wav","label":"positive","speaker_id":"speaker_002","source_id":"owner_recording_002","rights":"Recorded by dataset owner; permitted for this project.","consent_confirmed":true}
{"path":"audio/speaker_002_negative_01.wav","label":"negative","speaker_id":"speaker_002","source_id":"owner_recording_002","rights":"Recorded by dataset owner; permitted for this project.","consent_confirmed":true}
{"path":"audio/speaker_003_bozz_01.wav","label":"positive","speaker_id":"speaker_003","source_id":"owner_recording_003","rights":"Recorded by dataset owner; permitted for this project.","consent_confirmed":true}
{"path":"audio/speaker_003_negative_01.wav","label":"negative","speaker_id":"speaker_003","source_id":"owner_recording_003","rights":"Recorded by dataset owner; permitted for this project.","consent_confirmed":true}
```

This is a schema example only; BOZZ does not provide or generate these recordings. Every clip must be uncompressed mono 16-bit PCM WAV at 16 kHz, between 80 ms and 10 seconds. Paths must resolve inside the dataset folder. At least three distinct anonymous speaker groups are required. Every generated split must contain both positive and negative clips.

## Prepare the dataset

From the `backend` folder:

```powershell
python scripts/prepare_wake_word_dataset.py --manifest "C:\\BOZZ-data\\wake-word\\source.jsonl" --output-dir "C:\\BOZZ-data\\wake-word\\prepared"
```

The tool creates:

- `train.jsonl`
- `validation.jsonl`
- `test.jsonl`
- `dataset-report.json`

All clips from one speaker are assigned to exactly one split, preventing speaker leakage between training, validation, and test sets. Assignment is deterministic for the same seed. You can supply `--seed`, `--train-ratio`, and `--validation-ratio`.

The split manifests contain only relative WAV paths and labels. The audit report contains aggregate clip/speaker counts and rights statements; keep it local because source metadata can still reveal project details.

## What this gate does not do

- It does not record audio or create synthetic speech.
- It does not train or export an ONNX classifier.
- It does not download models or data.
- It does not certify that any source recording is lawful; the user remains responsible for permission and rights.
- It does not prove the model recognizes “BOZZ” or works reliably in live conditions.

The next model-training gate must use a documented, compatible training method and preserve the held-out test split. Model artifacts must be evaluated before they can be selected in BOZZ Settings.
