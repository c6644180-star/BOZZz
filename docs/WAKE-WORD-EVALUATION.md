# BOZZ wake-word evaluation lab

This tool compares wake-word score thresholds against a labelled local WAV dataset. It is an evaluation tool, not a model trainer. BOZZ does not ship a trained classifier for the phrase “BOZZ”.

## Privacy and dataset rules

- Use only audio you created yourself or have clear permission and rights to use.
- Keep the WAV files and manifest on your own PC. Do not put voice samples, personal names, or identifying details in Git.
- Do not collect samples from people without their informed permission.
- Keep the test set separate from any data used to train or tune a classifier.
- The evaluator opens no microphone, makes no network requests, and writes only the optional JSON report you explicitly request.
- Use non-sensitive filenames such as `positive_001.wav` and `negative_room_001.wav`.

## Audio format

Every sample must be uncompressed, mono, signed 16-bit PCM WAV at 16 kHz, and at least 80 ms long. Positive clips contain the target phrase “BOZZ”; negative clips contain ordinary speech, silence, and representative background sound without the target phrase.

Create a local JSON Lines manifest, for example `wake-word-manifest.jsonl`:

```jsonl
{"path":"samples/positive_001.wav","label":"positive"}
{"path":"samples/positive_002.wav","label":"positive"}
{"path":"samples/negative_001.wav","label":"negative"}
{"path":"samples/negative_002.wav","label":"negative"}
```

Paths are resolved relative to the manifest file. The sample WAV files and manifest stay outside version control.

## Run a threshold sweep

From the `backend` directory, after installing the optional wake-word runtime and configuring the three local model paths:

```powershell
python scripts/evaluate_wake_word.py --manifest "C:\\path\\to\\wake-word-manifest.jsonl" --threshold 0.5 --thresholds 0.3,0.4,0.5,0.6,0.7,0.8 --cooldown-ms 1000 --output "C:\\path\\to\\wake-word-report.json"
```

The detector is loaded once and the same frames are scored against every threshold. The report includes:

- Positive clip recall at each threshold.
- False activations and false activations per hour of negative audio at each threshold.
- Evaluation wall time, real-time factor, and Python-traced peak allocations.
- Per-clip peak score and the selected primary threshold result.

A higher threshold may reduce false activations but also miss more positive examples. Do not choose a threshold from recall alone.

## How to interpret results

- A few seconds of negative audio cannot establish a useful false-activation rate. Use hours of varied negative audio for meaningful screening.
- Include different speaking distances, room acoustics, microphones, accents, ordinary conversation, silence, and background media only when you have rights and permission for those samples.
- Evaluate on speakers and recording sessions not used to train or tune the model. Otherwise the results can overstate generalization.
- The report's Python memory number excludes native ONNX Runtime allocations and total process memory.
- Offline clip metrics do not guarantee performance during live use. Test missed detections and false activations on the actual Windows PC before considering the listener reliable.
- No threshold makes wake-word detection “100% accurate”. Keep push-to-talk available and retain the visible microphone stop control.

## Current Gate 8 change

The evaluator now supports a multi-threshold sweep in a single model session. The default `--threshold` remains the primary result for backwards compatibility; `--thresholds` adds comparison points. The primary threshold is always included in the sorted sweep.

This gate does not train or bundle a BOZZ classifier, download model files, collect audio, or enable microphone capture automatically.
