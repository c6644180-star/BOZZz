from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.voice.model_artifacts import stage_model_candidate


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate and stage a local BOZZ wake-word ONNX candidate; does not activate it."
    )
    parser.add_argument("--bundle", required=True, help="Directory containing manifest.json and the ONNX model.")
    parser.add_argument("--registry", required=True, help="Local model registry directory.")
    args = parser.parse_args()
    try:
        report = stage_model_candidate(args.bundle, args.registry)
    except Exception as exc:
        print(f"Model staging failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2))
    print("\nCandidate staged only. BOZZ's active model was not changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
