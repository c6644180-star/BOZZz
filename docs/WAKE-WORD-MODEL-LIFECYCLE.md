# BOZZ wake-word model lifecycle

Gate 11 adds an isolated runtime load-check and an explicit local activation/rollback workflow.

## Runtime compatibility check

The validator launches a separate Python process using the current interpreter in isolated mode. It attempts to initialize openWakeWord with the staged BOZZ classifier and the locally configured melspectrogram and embedding ONNX models, using CPU inference limited to one thread.

Set these environment variables to existing local files before activation:

```powershell
$env:BOZZ_WAKE_WORD_MELSPEC_MODEL = "C:\BOZZ-models\melspectrogram.onnx"
$env:BOZZ_WAKE_WORD_EMBEDDING_MODEL = "C:\BOZZ-models\embedding.onnx"
```

The check opens no microphone, records no audio, and does not download models. It has a 30-second timeout. It proves only that the installed openWakeWord runtime can initialize the candidate with those feature assets; it does not prove phrase accuracy.

## Explicit activation

Review the candidate manifest and independent evaluation report first. Then run from the backend directory:

```powershell
python scripts/manage_wake_word_model.py --registry "C:\BOZZ-models\registry" --activate 1.0.0 --approve
```

The approval flag is mandatory. Activation is blocked if bundle metadata/checksum validation or isolated runtime loading fails. BOZZ writes an atomic active.json pointer and preserves the prior active pointer as rollback.json. It does not overwrite model files.

## Rollback

```powershell
python scripts/manage_wake_word_model.py --registry "C:\BOZZ-models\registry" --rollback --approve
```

Rollback checks that the previous candidate still exists and its checksum matches the saved pointer, then atomically swaps active and rollback pointers. It does not delete candidate versions.

## Boundaries

- This is a local model registry foundation; the running wake-word service does not automatically hot-reload the pointer yet.
- Runtime compatibility is not a substitute for held-out accuracy and false-activation testing.
- The validator imports the installed local openWakeWord package; it does not claim to sandbox a malicious ONNX file. Only stage trusted models from sources whose terms permit intended use.
- Rights fields in manifests are declarations, not independent legal verification.
- Keep audio, models, and registries outside Git.
