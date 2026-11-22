"""Portable smoke checks for BOZZ API router imports.

Run from the backend directory with: python test_imports.py
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.api.identities import router as identities_router  # noqa: E402
from app.api.bids import router as bids_router  # noqa: E402
from app.api.preferences import router as preferences_router  # noqa: E402


def main() -> None:
    routers = {
        "identities": identities_router,
        "bids": bids_router,
        "preferences": preferences_router,
    }
    for name, router in routers.items():
        if not router.routes:
            raise RuntimeError(f"{name} router imported but has no routes")
        print(f"{name}: {len(router.routes)} routes")


if __name__ == "__main__":
    main()
