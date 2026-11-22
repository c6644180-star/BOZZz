# Gate 14 — final wake-word training pipeline preparation

Gate 14 is the final planned development gate. It adds a local-only training preflight and an openWakeWord-compatible configuration generator. It does not download training data, generate speech, train a model, or claim that BOZZ has a working custom classifier.

## Why this is a preflight rather than one-click training

The upstream openWakeWord custom training workflow depends on additional training code, a Piper sample generator, local room-impulse-response and background-audio assets, precomputed feature arrays, and optional ML packages. Its reference configuration recommends at least 20,000 positive training samples and notes that much larger sets may be beneficial. This can be too resource-intensive for an 8 GB integrated-graphics PC. BOZZ therefore validates that you have the required local assets and produces a config, but leaves the expensive training step explicit and under your control. See the upstream [custom model configuration](https://github.com/dscripka/openWakeWord/blob/main/examples/custom_model.yml) and [training implementation](https://github.com/dscripka/openWakeWord/blob/main/openwakeword/train.py).

## Prepare a local plan

Create a JSON file outside the BOZZ repository, for example `C:\\BOZZ-data\\wake-word\\training-plan.json`:

```json
{
  "model_name": "bozz",
  "target_phrase": ["BOZZ"],
  "piper_sample_generator_path": "C:\\BOZZ-data\\piper-sample-generator",
  "output_dir": "C:\\BOZZ-data\\wake-word\\training-output",
  "rir_paths": ["C:\\BOZZ-data\\rir"],
  "background_paths": ["C:\\BOZZ-data\\background"],
  "false_positive_validation_data_path": "C:\\BOZZ-data\\validation-features.npy",
  "feature_data_files": {
    "licensed_features": "C:\\BOZZ-data\\licensed-features.npy"
  },
  "tts_batch_size": 1,
  "augmentation_batch_size": 1,
  "batch_positive": 16,
  "batch_negative": 16,
  "batch_external": 64,
  "steps": 5000
}
```

All directories and files must already exist locally. The Piper folder must contain `generate_samples.py`. Only use training data, feature sets, background audio and impulse responses whose license and permission terms allow your intended use. Do not include personal names or identifying metadata in paths or manifests.

## Run the preflight

From the `backend` directory:

```powershell
python scripts/prepare_wake_word_training.py --plan "C:\\BOZZ-data\\wake-word\\training-plan.json" --output-config "C:\\BOZZ-data\\wake-word\\openwakeword-config.yml"
```

The output file is JSON syntax, which is also valid YAML, and is accepted as an openWakeWord YAML configuration. The command only validates local paths and writes the config. It does not contact the network or start a microphone.

## Training and packaging workflow

1. Prepare and audit the dataset with the Gate 9 dataset tool.
2. Obtain the upstream openWakeWord training source and its optional training dependencies separately; review their licenses and requirements.
3. Prepare licensed local feature, negative validation, room-response and background-audio assets.
4. Run the upstream trainer manually using the generated config, following its current documented command-line flags. Do not enable any automatic data download unless you have reviewed and approved the source and terms.
5. Evaluate the exported ONNX classifier using held-out speakers and sessions, including sufficient negative audio to estimate false activations per hour.
6. Create a Gate 10 model bundle manifest with real evaluation metrics, validate and stage it, then use Gate 11 explicit activation.
7. Confirm the model loads locally and manually test the listener on the target PC. Stop/restart the listener after activation.

## Hardware guidance

The default preflight profile uses single-item TTS and augmentation batches and small classifier batches. It is a low-memory starting point, not a promise that full feature extraction or model training will fit in 8 GB RAM. Feature extraction and audio augmentation may still be slow or exceed available memory. Start with small local experiments, close unnecessary applications, and do not run a long training job while the PC is unstable. Use a more capable machine if the full dataset cannot be processed.

## Completion criteria and limits

- Training plan and local asset paths are validated.
- A reproducible openWakeWord configuration is written.
- The generated config can feed the upstream training workflow.
- Gate 8 evaluation, Gate 10 artifact validation, and Gate 11 activation remain the required release path.
- No trained BOZZ model is included or claimed. A trained model only exists after the user runs training and passes independent evaluation.
