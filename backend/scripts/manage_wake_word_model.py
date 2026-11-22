from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.voice.model_lifecycle import activate_candidate, rollback_active_model


def main() -> int:
    parser = argparse.ArgumentParser(description="Explicitly activate or roll back a staged BOZZ wake-word model.")
    parser.add_argument("--registry", required=True, help="Local model registry directory.")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--activate", metavar="VERSION", help="Validate and activate a staged candidate.")
    action.add_argument("--rollback", action="store_true", help="Restore the previous model version.")
    parser.add_argument("--approve", action="store_true", help="Confirm this model change after reviewing it.")
    args = parser.parse_args()
    if not args.approve:
        parser.error("Model changes require --approve after reviewing the candidate.")
    try:
        report = rollback_active_model(args.registry, approved=True) if args.rollback else activate_candidate(args.registry, args.activate, approved=True)
    except Exception as exc:
        print(f"Model lifecycle operation failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
