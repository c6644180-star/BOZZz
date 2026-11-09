"""Backend tests for the BOZZ computer agent.

Run from the repository root:
    .venv/Scripts/python.exe -m unittest discover -s backend/tests -v
"""

from __future__ import annotations

from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
