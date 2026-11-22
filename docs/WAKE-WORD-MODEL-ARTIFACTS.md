# BOZZ wake-word model candidate artifacts

Gate 10 adds a local candidate validator and staging command. It does not train a model, execute an ONNX graph, change the active wake-word model, or upload any files.

## Bundle format

Create a local folder containing:
- `manifest.json`
- The candidate classifier ONNX file referenced by `model_file`

The manifest must declare schema/artifact type, model ID and semantic version, target phrase `BOZZ`, 16 kHz sample rate, ONNX filename and SHA-256, training dataset/code identifiers, a license/rights declaration, and held-out evaluation metrics.

Example manifest (replace every example value with real metadata and a real model checksum):

```json
{
  "schema_version": 1,
  "artifact_type": "bozz-wake-word-classifier",
  "model_id": "bozz-wake-word",
  "version": "1.0.0",
  "target_phrase": "BOZZ",
  "sample_rate_hz": 16000,
  "model_file": "bozz.onnx",
  "sha256": "REPLACE_WITH_64_CHARACTER_SHA256",
  "training_dataset_id": "local-dataset-v1",
  "training_code_version": "git-commit-or-release",
  "license": {
    "identifier": "license-name-or-documented-rights-basis",
    "commercial_use_allowed": true
  },
  "evaluation": {
    "positive_recall": 0.0,
    "false_activations_per_hour": 0.0,
    "test_audio_hours": 1.0,
    "test_speakers": 3,
    "held_out_test": true
  }
}
```

The license fields are declarations supplied by the packager, not legal verification. Only use model code, datasets, and pretrained feature models whose terms permit the intended BOZZ use. Do not infer commercial permission from a dataset being publicly downloadable.

## Validate and stage locally

From the `backend` directory:

```powershell
python scripts/stage_wake_word_model.py --bundle "C:\\BOZZ-data\\candidate-v1" --registry "C:\\BOZZ-data\\model-registry"
```

The command checks required metadata, target phrase, sample rate, semantic version, declared commercial-use rights, held-out evaluation fields, path containment, and SHA-256. It then copies the ONNX file and manifest into:

```text
model-registry/
  candidates/
    1.0.0/
      manifest.json
      model.onnx
```

A version is never overwritten. The command is local-only, opens no microphone, and leaves the active model unchanged. The report status is `staged_pending_user_approval`.

## Important limitations

- A matching checksum proves file integrity, not that the ONNX graph is valid or compatible with openWakeWord.
- The command does not load or execute the model.
- Evaluation values are metadata declarations; they are not independently recomputed by this gate. Keep the actual held-out evaluation report and dataset provenance.
- License declarations are not legal advice or independent rights verification.
- Staging is not installation. Runtime activation, compatibility loading, approval UI, and rollback are separate future work.
- Keep candidate bundles, model files, audio, manifests containing provenance, and registry directories outside Git.
