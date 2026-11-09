"""Playwright browser adapter.

The agent uses its own persistent Chromium profile inside the BOZZ data folder.
It never opens the user's normal Chrome profile, cookies, saved passwords or
logged-in accounts. The browser is headed so the user can watch. Clicks and
typing use roles, labels and placeholders rather than pixel coordinates.

Playwright is optional at install time. If it or a Chromium browser is missing,
``start`` raises AdapterUnavailable with the exact install command. Nothing
pretends a browser exists.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
import time

from app.agent.adapters.base import AdapterError, AdapterUnavailable
from app.agent.policy import PolicyEngine
from app.agent.schemas import ActionResult, AgentAction, Observation, VerificationCheck

try:  # optional dependency; the rest of the backend stays importable without it
    from playwright.sync_api import TimeoutError as PlaywrightTimeout
    from playwright.sync_api import sync_playwright
except Exception:  # noqa: BLE001 - report a missing install honestly
    PlaywrightTimeout = Exception  # type: ignore[assignment,misc]
    sync_playwright = None  # type: ignore[assignment]

_ELEMENTS_JS = """
() => {
  const nodes = Array.from(document.querySelectorAll('a,button,textarea,input,select,[role]'));
  return nodes.slice(0, 140).map((el) => {
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      name: text.slice(0, 120),
      type: el.getAttribute('type'),
      href: el.getAttribute('href'),
      disabled: !!el.disabled,
    };
  });
}
"""

_VISIBLE_BUTTONS_JS = """
() => {
  const nodes = Array.from(document.querySelectorAll('button,a,[role=button]'));
  return nodes
    .filter((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    })
    .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim())
    .filter(Boolean)
    .slice(0, 40);
}
"""

_FIELD_VALUES_JS = """
(value) => {
  const nodes = Array.from(document.querySelectorAll('input,textarea'));
  const values = [];
  for (const el of nodes) {
    if ((el.getAttribute('type') || '').toLowerCase() === 'password') continue;
    const current = String(el.value || '');
    if (current) values.push(current.slice(0, 120));
    if (current.includes(value)) return {ok: true, values};
  }
  return {ok: false, values};
}
"""

_CONSENT_TEXT = ("cookie", "consent", "privacy choices", "gdpr")
_DECLINE_ORDER = ("reject all", "decline", "reject", "deny", "close", "dismiss", "not now", "×", "x")
_ACCEPT_WORDS = ("accept", "allow all", "agree", "got it", "ok")


def _trim(value: str, limit: int) -> str:
    text = (value or "").strip()
    return text[:limit]


class BrowserAdapter:
    name = "Playwright Chromium"
    method = "browser_dom"

    def __init__(
        self,
        *,
        profile_dir: Path,
        screenshots_dir: Path,
        downloads_dir: Path,
        headed: bool = True,
        observation_chars: int = 6000,
    ):
        self.profile_dir = Path(profile_dir)
        self.screenshots_dir = Path(screenshots_dir)
        self.downloads_dir = Path(downloads_dir)
        self.headed = headed
        self.observation_chars = max(1000, min(int(observation_chars), 20_000))
        self._playwright: Any = None
        self._context: Any = None
        self._started = False
        self.last_method = self.method
        self._assert_private_profile()

    def _assert_private_profile(self) -> None:
        text = str(self.profile_dir).casefold()
        forbidden = ("google/chrome", "google\\chrome", "microsoft/edge", "microsoft\\edge", "brave-browser")
        if any(item in text for item in forbidden):
            raise AdapterError("The agent profile path points at a normal browser profile and was refused.")

    @property
    def available(self) -> bool:
        return sync_playwright is not None

    @property
    def started(self) -> bool:
        return self._started and self._context is not None

    # ---------------------------------------------------------------- lifecycle

    def start(self) -> None:
        if self._started and self._context is not None:
            return
        if sync_playwright is None:
            raise AdapterUnavailable(
                "Playwright is not installed. Run: pip install playwright && python -m playwright install chromium"
            )
        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        self.downloads_dir.mkdir(parents=True, exist_ok=True)
        try:
            self._playwright = sync_playwright().start()
            self._context = self._playwright.chromium.launch_persistent_context(
                user_data_dir=str(self.profile_dir),
                headless=not self.headed,
                args=["--no-first-run", "--no-default-browser-check", "--disable-extensions"],
                viewport={"width": 1280, "height": 860},
            )
            self._context.set_default_timeout(10_000)
            if not self._context.pages:
                self._context.new_page()
            self._started = True
        except Exception as exc:  # noqa: BLE001 - missing Chromium is a normal state
            self.close()
            raise AdapterUnavailable(
                "Chromium could not start for the agent. Run: python -m playwright install chromium "
                f"(details: {exc})"
            ) from exc

    def close(self) -> None:
        self._started = False
        context, self._context = self._context, None
        playwright, self._playwright = self._playwright, None
        try:
            if context is not None:
                context.close()
        except Exception:  # noqa: BLE001 - closing must never mask the task result
            pass
        try:
            if playwright is not None:
                playwright.stop()
        except Exception:  # noqa: BLE001
            pass

    def _page(self) -> Any:
        if self._context is None:
            raise AdapterUnavailable("The agent browser is not running.")
        pages = [page for page in self._context.pages if not page.is_closed()]
        if not pages:
            return self._context.new_page()
        return pages[-1]

    # ------------------------------------------------------------------ inspect

    def inspect(self) -> Observation:
        page = self._page()
        try:
            page.wait_for_load_state("domcontentloaded", timeout=8_000)
        except Exception:  # noqa: BLE001 - a page may still be usable
            pass
        url = _trim(page.url, 500)
        try:
            title = _trim(page.title(), 200)
        except Exception:  # noqa: BLE001
            title = ""
        try:
            text = _trim(page.locator("body").inner_text(timeout=6_000), self.observation_chars)
        except Exception:  # noqa: BLE001
            text = ""
        try:
            hidden_text = _trim(page.evaluate("() => (document.body ? document.body.textContent : '')"), self.observation_chars)
        except Exception:  # noqa: BLE001
            hidden_text = ""
        try:
            elements = page.evaluate(_ELEMENTS_JS)
        except Exception:  # noqa: BLE001
            elements = []
        try:
            visible_buttons = page.evaluate(_VISIBLE_BUTTONS_JS)
        except Exception:  # noqa: BLE001
            visible_buttons = []
        lower_text = (text or "").casefold()
        consent = None
        if any(word in lower_text for word in _CONSENT_TEXT) and visible_buttons:
            consent = "Cookie or consent banner visible."
        login_or_payment = any(
            (element.get("type") or "").casefold() == "password" for element in elements
        ) or PolicyEngine.looks_like_login_or_payment(text)
        return Observation(
            application="Browser",
            url=url,
            title=title,
            text=text,
            hidden_text=hidden_text,
            elements=elements if isinstance(elements, list) else [],
            consent_banner=consent,
            login_or_payment=bool(login_or_payment),
        )

    def observe(self) -> Observation:
        return self.inspect()

    # ---------------------------------------------------------------------- act

    def act(self, action: AgentAction) -> ActionResult:
        action_type = action.type
        page = self._page()
        try:
            if action_type == "browser.open":
                url = str(action.params.get("url") or "")
                if not url.casefold().startswith(("http://", "https://")):
                    return ActionResult(action_type, "attempted", False, "Only http and https pages can be opened.")
                page.goto(url, wait_until="domcontentloaded", timeout=25_000)
                self._settle(page, 700)
                return ActionResult(action_type, "completed", True, f"Opened {_trim(page.url, 200)}.", self.method)
            if action_type == "browser.type":
                field = str(action.params.get("field") or "")
                text = str(action.params.get("text") or "")
                locator = self._field(page, field)
                input_type = (locator.get_attribute("type") or "").casefold()
                if input_type == "password":
                    return ActionResult(action_type, "attempted", False, "Password fields are never typed by the agent.")
                locator.fill(text, timeout=8_000)
                return ActionResult(action_type, "completed", True, f"Typed into '{field}' with a role/label locator.", self.method)
            if action_type == "browser.click":
                name = str(action.params.get("name") or "")
                role = str(action.params.get("role") or "button")
                target = page.get_by_role(role, name=name, exact=False)
                if target.count() == 0:
                    target = page.get_by_text(name, exact=False)
                target.first.click(timeout=10_000)
                self._settle(page, 700)
                return ActionResult(action_type, "completed", True, f"Clicked '{name}' by role '{role}'.", self.method)
            if action_type == "browser.click_link":
                text = str(action.params.get("text") or "")
                target = page.get_by_role("link", name=text, exact=False)
                if target.count() == 0:
                    target = page.get_by_text(text, exact=False)
                target.first.click(timeout=10_000)
                self._settle(page, 700)
                return ActionResult(action_type, "completed", True, f"Opened the link '{text}'.", self.method)
            if action_type == "browser.scroll":
                delta = int(float(action.params.get("delta") or 600))
                page.mouse.wheel(0, delta)
                time.sleep(0.2)
                return ActionResult(action_type, "completed", True, f"Scrolled by {delta}px.", self.method)
            if action_type == "browser.read_text":
                limit = int(float(action.params.get("max_chars") or 1000))
                text = _trim(page.locator("body").inner_text(timeout=6_000), max(100, min(limit, 4000)))
                return ActionResult(
                    action_type,
                    "completed",
                    True,
                    f"Read {len(text)} characters of visible text.",
                    self.method,
                    {"text_excerpt": text, "url": _trim(page.url, 300), "title": _trim(page.title(), 200)},
                )
            if action_type == "browser.verify":
                check = VerificationCheck(
                    str(action.params.get("check") or ""),
                    str(action.params.get("value") or ""),
                )
                ok, detail, evidence = self.verify(check)
                return ActionResult(
                    action_type,
                    "verified" if ok else "completed",
                    ok,
                    detail,
                    self.method,
                    evidence,
                    ok,
                )
            if action_type == "browser.wait":
                seconds = max(0.0, min(float(action.params.get("seconds") or 1.0), 10.0))
                time.sleep(seconds)
                try:
                    page.wait_for_load_state("networkidle", timeout=int(seconds * 1000) + 2_000)
                except Exception:  # noqa: BLE001
                    pass
                return ActionResult(action_type, "completed", True, f"Waited {seconds:.1f}s for the page.", self.method)
            if action_type == "browser.screenshot":
                stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                path = self.screenshots_dir / f"agent-{stamp}.png"
                page.screenshot(path=str(path), full_page=False)
                return ActionResult(
                    action_type,
                    "completed",
                    True,
                    "Saved a screenshot locally in the BOZZ data folder.",
                    self.method,
                    {"path": str(path), "local_only": True},
                )
            if action_type == "browser.dismiss_consent":
                return self.dismiss_consent()
            if action_type == "browser.download":
                name = str(action.params.get("name") or "")
                target = page.get_by_text(name, exact=False).first
                with page.expect_download(timeout=20_000) as info:
                    target.click()
                download = info.value
                self.downloads_dir.mkdir(parents=True, exist_ok=True)
                path = self.downloads_dir / (download.suggested_filename or f"download-{int(time.time())}")
                download.save_as(str(path))
                return ActionResult(action_type, "completed", True, f"Downloaded to {path.name}.", self.method)
            if action_type == "browser.upload":
                path = Path(str(action.params.get("path") or ""))
                if not path.is_file():
                    return ActionResult(action_type, "attempted", False, "The chosen upload file is not available.")
                page.locator("input[type=file]").first.set_input_files(str(path))
                return ActionResult(action_type, "completed", True, "Uploaded the file you chose.", self.method)
            if action_type == "browser.inspect":
                observation = self.inspect()
                return ActionResult(
                    action_type,
                    "completed",
                    True,
                    f"Inspected {observation.title or observation.url}.",
                    self.method,
                )
            if action_type == "browser.close":
                self.close()
                return ActionResult(action_type, "completed", True, "Agent browser closed.", self.method)
            return ActionResult(action_type, "none", False, f"The browser adapter does not implement '{action_type}'.", self.method)
        except PlaywrightTimeout as exc:
            return ActionResult(action_type, "attempted", False, f"The page did not respond in time: {exc}", self.method)
        except Exception as exc:  # noqa: BLE001 - one failed action must not kill the loop
            return ActionResult(action_type, "attempted", False, f"The browser action failed: {exc}", self.method)

    def _settle(self, page: Any, milliseconds: int) -> None:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=max(1500, milliseconds))
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.15)

    def _field(self, page: Any, field: str) -> Any:
        candidates = []
        lowered = field.casefold()
        try:
            candidates.append(page.get_by_label(field, exact=False))
        except Exception:  # noqa: BLE001
            pass
        try:
            candidates.append(page.get_by_placeholder(field, exact=False))
        except Exception:  # noqa: BLE001
            pass
        if "search" in lowered:
            try:
                candidates.append(page.get_by_role("searchbox"))
            except Exception:  # noqa: BLE001
                pass
            candidates.append(page.locator("input[type=search], input[name=q], input[name=search]"))
        if "comment" in lowered:
            candidates.append(page.locator("textarea, input[name*=comment i], [contenteditable=true]"))
        try:
            candidates.append(page.get_by_role("textbox", name=field, exact=False))
        except Exception:  # noqa: BLE001
            pass
        candidates.append(page.locator("input[type=text], input:not([type]), textarea"))
        for candidate in candidates:
            try:
                if candidate.count() > 0:
                    return candidate.first
            except Exception:  # noqa: BLE001
                continue
        raise AdapterError(f"No visible field matching '{field}' was found.")

    def dismiss_consent(self) -> ActionResult:
        page = self._page()
        try:
            buttons = page.evaluate(_VISIBLE_BUTTONS_JS)
        except Exception:  # noqa: BLE001
            buttons = []
        lowered = [(str(item), str(item).casefold()) for item in buttons if str(item).strip()]
        for preferred in _DECLINE_ORDER:
            for original, value in lowered:
                if preferred in value and not any(word in value for word in _ACCEPT_WORDS):
                    try:
                        page.get_by_role("button", name=original, exact=False).first.click(timeout=4_000)
                        self._settle(page, 400)
                        return ActionResult(
                            "browser.dismiss_consent",
                            "completed",
                            True,
                            f"Dismissed the banner with '{original}' (least-permissive option).",
                            self.method,
                        )
                    except Exception:  # noqa: BLE001
                        try:
                            page.get_by_text(original, exact=False).first.click(timeout=4_000)
                            self._settle(page, 400)
                            return ActionResult(
                                "browser.dismiss_consent",
                                "completed",
                                True,
                                f"Dismissed the banner with '{original}'.",
                                self.method,
                            )
                        except Exception:  # noqa: BLE001
                            continue
        return ActionResult(
            "browser.dismiss_consent",
            "attempted",
            False,
            "The consent banner has no decline or close option. The agent did not accept anything; please choose manually.",
            self.method,
        )

    # ------------------------------------------------------------------- verify

    def verify(self, check: VerificationCheck) -> tuple[bool, str, dict[str, Any] | None]:
        page = self._page()
        kind = check.check
        value = check.value
        try:
            if kind == "url_contains":
                url = page.url
                ok = value.casefold() in str(url).casefold()
                return ok, f"Observed URL {url[:240]!r}; expected it to contain {value!r}.", {"source": "browser_dom", "url": url}
            if kind == "title_contains":
                title = page.title()
                ok = value.casefold() in title.casefold()
                return ok, f"Observed title {title[:200]!r}; expected {value!r}.", {"source": "browser_dom", "title": title}
            if kind == "text_contains":
                text = page.locator("body").inner_text(timeout=6_000)
                ok = value.casefold() in text.casefold()
                return ok, f"Expected visible text {value!r}: {'found' if ok else 'not found'}.", {
                    "source": "browser_dom",
                    "url": page.url,
                }
            if kind == "element_present":
                target = page.get_by_text(value, exact=False)
                ok = target.count() > 0
                return ok, f"Element text {value!r}: {'present' if ok else 'missing'}.", {
                    "source": "browser_dom",
                    "url": page.url,
                }
            if kind == "field_value_contains":
                result = page.evaluate(_FIELD_VALUES_JS, value)
                ok = bool(result.get("ok"))
                return ok, f"Field value {value!r}: {'observed' if ok else 'not observed'}.", {
                    "source": "browser_dom",
                    "values": result.get("values", [])[:5],
                }
            return False, f"Unknown verification check '{kind}'.", None
        except Exception as exc:  # noqa: BLE001
            return False, f"Verification failed: {exc}", None
