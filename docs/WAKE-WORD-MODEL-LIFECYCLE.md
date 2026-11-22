# BOZZ wake-word model lifecycle

Gate 11 adds isolated candidate load-checking and explicit local activation/rollback. Gate 12 connects the approved active model pointer to each new wake-word listener session.

## Configure the local registry and feature models

Keep the registry and all ONNX files outside the Git repository. Configure these environment variables for the BOZZ backend process:

```powershell
$env:BOZZ_WAKE_WORD_REGISTRY = "C:\BOZZ-models\registry"
$env:BOZZ_WAKE_WORD_MELSPEC_MODEL = "C:\BOZZ-models\melspectrogram.onnx"
$env:BOZZ_WAKE_WORD_EMBEDDING_MODEL = "C:\BOZZ-models\embedding.onnx"
```

When registry mode is enabled, BOZZ resolves the classifier only from `registry\active.json` and its matching `candidates\<version>` folder. It verifies the manifest, model checksum, version, and model filename before loading. It never falls back to `BOZZ_WAKE_WORD_MODEL` if the registry pointer is missing or invalid.

## Runtime behavior

- Each newly started, explicitly consented listener session reads and verifies the current active pointer, then constructs its own CPU detector.
- A listener session keeps the detector version it started with. Changing the active pointer does not replace a model while a session is processing audio; stop and restart the listener to use the newly active version.
- If pointer or checksum verification fails, detector startup is refused. A candidate load failure closes that session; it does not execute actions or replace an already running session's detector.
- The status endpoint reports whether registry mode is configured and the active version, without exposing local filesystem paths.
- Model loading and pointer verification do not open a microphone. The existing explicit consent and OS microphone permission gates remain required before audio streaming.
- Rollback remains an explicit local CLI action. After rollback, stop and restart the listener to use the restored version.

## Explicit activation

Review the candidate manifest and independent evaluation report first. Then run from the backend directory:

```powershell
python scripts/manage_wake_word_model.py --registry "C:\BOZZ-models\registry" --activate 1.0.0 --approve
```

The approval flag is mandatory. Activation is blocked if bundle metadata/checksum validation or isolated runtime loading fails. BOZZ writes an atomic `active.json` pointer and preserves the prior active pointer as `rollback.json`. It does not overwrite model files.

## Rollback

```powershell
python scripts/manage_wake_word_model.py --registry "C:\BOZZ-models\registry" --rollback --approve
```

Rollback checks that the previous candidate still exists and its checksum matches the saved pointer, then atomically swaps active and rollback pointers. It does not delete candidate versions.

## Boundaries

- Runtime compatibility is not a substitute for held-out accuracy and false-activation testing.
- The validator imports the installed local openWakeWord package; it does not claim to sandbox a malicious ONNX file. Only stage trusted models from sources whose terms permit intended use.
- Rights fields in manifests are declarations, not independent legal verification.
- Keep audio, models, and registries outside Git.
