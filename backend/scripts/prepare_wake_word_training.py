from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.voice.training import prepare_training_config


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate local BOZZ wake-word training inputs and prepare an openWakeWord config.")
    parser.add_argument("--plan", required=True, help="Local JSON training plan.")
    parser.add_argument("--output-config", required=True, help="Output .yaml/.yml config path for the upstream trainer.")
    args = parser.parse_args()
    try:
        report = prepare_training_config(args.plan, args.output_config)
    except Exception as exc:
        print(f"Training preflight failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2))
    print("\nPreflight complete. No training, microphone capture, audio generation, or network access was started.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
