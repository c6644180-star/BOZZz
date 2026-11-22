from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.voice.dataset import prepare_dataset


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate a local, permission-cleared wake-word dataset and create speaker-disjoint manifests."
    )
    parser.add_argument("--manifest", required=True, help="Local JSONL source manifest.")
    parser.add_argument("--output-dir", required=True, help="Local output directory for split manifests and audit report.")
    parser.add_argument("--seed", default="bozz-wake-word-v1", help="Deterministic split seed.")
    parser.add_argument("--train-ratio", type=float, default=0.7)
    parser.add_argument("--validation-ratio", type=float, default=0.15)
    args = parser.parse_args()
    try:
        report = prepare_dataset(
            args.manifest,
            args.output_dir,
            seed=args.seed,
            train_ratio=args.train_ratio,
            validation_ratio=args.validation_ratio,
        )
    except Exception as exc:
        print(f"Dataset preparation failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2))
    print("\nDataset manifests and audit report were written locally. No model was trained.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
