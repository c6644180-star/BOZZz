from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.voice.evaluation import evaluate_manifest


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate BOZZ local wake-word detection using labelled WAV files. No microphone is opened."
    )
    parser.add_argument("--manifest", required=True, help="JSONL manifest with one path/label object per line.")
    parser.add_argument("--threshold", type=float, default=0.5, help="Detection threshold from 0 to 1 (default: 0.5).")
    parser.add_argument("--cooldown-ms", type=int, default=1000, help="Minimum time between counted activations (default: 1000).")
    parser.add_argument("--output", help="Optional path to write the JSON report.")
    args = parser.parse_args()

    try:
        report = evaluate_manifest(
            args.manifest,
            threshold=args.threshold,
            cooldown_ms=args.cooldown_ms,
        )
    except Exception as exc:
        print(f"Evaluation failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    rendered = json.dumps(report, indent=2)
    if args.output:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered + "\n", encoding="utf-8")
        print(f"Report written to {output}")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
