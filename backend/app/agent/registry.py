"""Application Capability Registry.

Profiles live in ``config/agent_capabilities.json``. A profile can only become
``Verified`` from a recorded test result written by the test runner. The UI
cannot promote a profile and neither can a model. With no recorded suite the
honest status is ``Experimental — Not measured yet``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import json
import re

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PROFILES_PATH = REPO_ROOT / "config" / "agent_capabilities.json"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_.-]", "-", value.strip())[:80].strip("-")
    return slug or "suite"


class CapabilityRegistry:
    def __init__(self, profiles_path: Path | str | None = None, results_dir: Path | str | None = None):
        self.profiles_path = Path(profiles_path) if profiles_path else DEFAULT_PROFILES_PATH
        self.results_dir = Path(results_dir) if results_dir else REPO_ROOT / "data" / "agent" / "test-results"
        payload = json.loads(self.profiles_path.read_text(encoding="utf-8"))
        if int(payload.get("version", 0)) != 1:
            raise ValueError("Unsupported capability profile version.")
        self.profiles: dict[str, dict[str, Any]] = {}
        for raw in payload.get("profiles", []):
            profile_id = str(raw.get("id") or "").strip()
            if not profile_id:
                raise ValueError("Every capability profile needs an id.")
            self.profiles[profile_id] = dict(raw)

    # ----------------------------------------------------------------- results

    def results(self) -> list[dict[str, Any]]:
        if not self.results_dir.is_dir():
            return []
        items: list[dict[str, Any]] = []
        for path in sorted(self.results_dir.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict) and payload.get("suite"):
                payload["file"] = path.name
                items.append(payload)
        items.sort(key=lambda item: str(item.get("at") or ""))
        return items

    def latest_result(self, suite: str) -> dict[str, Any] | None:
        matches = [item for item in self.results() if item.get("suite") == suite]
        return matches[-1] if matches else None

    def record_result(self, result: dict[str, Any]) -> Path:
        """Write a measured result. This is the only path to profile Verified."""
        suite = _safe_slug(str(result.get("suite") or ""))
        if not suite or suite == "suite":
            raise ValueError("A test result needs a suite name.")
        payload = dict(result)
        payload["suite"] = suite
        payload["at"] = str(payload.get("at") or _iso_now())
        self.results_dir.mkdir(parents=True, exist_ok=True)
        stamp = payload["at"].replace(":", "-").replace(".", "-")
        path = self.results_dir / f"{stamp}-{suite}.json"
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        return path

    # ---------------------------------------------------------------- profiles

    def profile_status(self, profile: dict[str, Any]) -> tuple[str, str]:
        suite = str(profile.get("required_test_suite") or "")
        if not suite:
            return "Experimental", "No test suite is assigned; this profile is not verified."
        latest = self.latest_result(suite)
        if latest is None:
            return "Experimental", f"Not measured yet. Required suite '{suite}' has no recorded results."
        runs = int(latest.get("runs") or 0)
        successes = int(latest.get("successes") or 0)
        if bool(latest.get("passed")) and runs > 0 and successes == runs:
            return "Verified", f"Recorded suite '{suite}' passed {successes}/{runs} run(s) at {latest.get('at')}."
        if bool(latest.get("passed")):
            return "Experimental", f"Suite '{suite}' passed with {successes}/{runs} successful run(s)."
        return "Experimental", f"Latest recorded suite '{suite}' failed ({successes}/{runs} passed)."

    def profiles_view(self) -> list[dict[str, Any]]:
        view: list[dict[str, Any]] = []
        for profile in self.profiles.values():
            status, status_detail = self.profile_status(profile)
            suite = str(profile.get("required_test_suite") or "")
            latest = self.latest_result(suite) if suite else None
            view.append(
                {
                    "id": profile["id"],
                    "name": profile.get("name") or profile["id"],
                    "version": profile.get("version") or "0.0.0",
                    "os": profile.get("os") or "Windows",
                    "identification": profile.get("identification") or "",
                    "documentation": list(profile.get("documentation") or []),
                    "methods": list(profile.get("methods") or []),
                    "supported_actions": list(profile.get("supported_actions") or []),
                    "common_workflows": list(profile.get("common_workflows") or []),
                    "verification_methods": list(profile.get("verification_methods") or []),
                    "known_limitations": list(profile.get("known_limitations") or []),
                    "recovery": list(profile.get("recovery") or []),
                    "status": status,
                    "status_detail": status_detail,
                    "required_test_suite": suite or None,
                    "last_result": latest,
                    "notes": profile.get("notes") or "",
                }
            )
        return view

    def status_of(self, profile_id: str) -> str:
        profile = self.profiles.get(profile_id)
        if profile is None:
            return "Unsupported"
        return self.profile_status(profile)[0]

    # -------------------------------------------------------------- reliability

    def reliability_view(self) -> dict[str, Any]:
        results = self.results()
        suites: dict[str, dict[str, Any]] = {}
        for item in results:
            suites[str(item.get("suite"))] = item
        mock = suites.get("mock-site-workflow")
        browser = suites.get("browser-playwright")
        youtube = suites.get("youtube-readonly")
        return {
            "measured": bool(results),
            "results_dir": str(self.results_dir),
            "mock_site": _suite_view(mock),
            "browser": _suite_view(browser),
            "youtube": _suite_view(youtube),
            "history": results[-10:],
            "note": (
                "Only recorded test results are shown. Real-model results will vary; the scripted-model "
                "suite measures the engine, not the quality of a particular model."
            ),
        }

    def serializable(self) -> dict[str, Any]:
        return {"version": 1, "profiles": self.profiles_view()}


def _suite_view(result: dict[str, Any] | None) -> dict[str, Any]:
    if result is None:
        return {
            "measured": False,
            "label": "Not measured yet",
            "runs": None,
            "successes": None,
            "success_rate": None,
            "avg_steps": None,
            "avg_seconds": None,
            "failures": [],
            "at": None,
        }
    runs = int(result.get("runs") or 0)
    successes = int(result.get("successes") or 0)
    return {
        "measured": True,
        "label": "Passed" if result.get("passed") else "Failed",
        "runs": runs,
        "successes": successes,
        "success_rate": (successes / runs) if runs else None,
        "avg_steps": result.get("avg_steps"),
        "avg_seconds": result.get("avg_seconds"),
        "failures": list(result.get("failures") or []),
        "at": result.get("at"),
    }
