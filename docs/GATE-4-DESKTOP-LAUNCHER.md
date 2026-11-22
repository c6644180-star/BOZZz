# Gate 4 — Desktop App and Window Intelligence

## Included: fixed app launcher

BOZZ's native tray offers explicit menu actions for Calculator, Notepad and Paint on Windows. The launcher uses a fixed executable allowlist and starts each application with an empty argument list, `shell: false`, and detached stdio. No command text, path, or arguments are accepted from the renderer or an AI model.

The Settings page includes an in-app launcher. Each button asks the user to confirm, then invokes a narrow preload bridge. The main process validates the sender and app ID again before launching. In a browser, the controls are unavailable. No AI/chat pathway is connected to this IPC handler.

## Included: BOZZ-owned window intelligence

The Settings page can list and focus only BOZZ-owned windows (the main BOZZ window and optional mini orb). It returns fixed IDs and limited state metadata. Focus accepts only `main` or `mini`, and the UI asks for confirmation first.

## Included: external application intelligence

On Windows, the Settings page can discover visible top-level windows belonging to this fixed process allowlist:

- Notepad (`notepad`)
- Paint (`mspaint`)
- Calculator (`calculatorapp` / `calc`)
- Microsoft Edge (`msedge`)
- Google Chrome (`chrome`)
- Visual Studio Code (`code`)

Discovery is performed by a fixed, non-interactive PowerShell script launched without a shell. No user-provided command, path, process name, or argument is accepted. The renderer receives only an opaque, one-use ID and a friendly app label. Native window handles remain in the Electron main process.

The inventory deliberately does not return window titles, browser-tab titles, document names, process IDs, screenshots, or application contents. A user must confirm each focus request. The native focus action restores the selected window and asks Windows to bring it forward; Windows may deny foreground activation. A fresh scan is required after a focus attempt because each ID is single-use.

## Security and privacy boundaries

- Windows only; other platforms report that external discovery/focus is unavailable.
- Discovery is limited to the explicit process allowlist above. Unknown apps are ignored.
- No titles or application contents are read or sent to the renderer.
- Native handles are not exposed to the renderer and are accepted only from the current in-memory scan.
- Focus tokens expire on refresh and are consumed on use.
- PowerShell is invoked with fixed source text, no profile, no interactive prompt, a timeout, and no shell. No user text is interpolated into the script; the only value added to the focus script is a validated numeric handle obtained from Windows.
- This milestone does not type, click, read, close, or automate inside external apps.
- No arbitrary shell, terminal, executable path, or command execution is exposed.
- External application discovery is initiated by the Settings panel; it is not continuous background monitoring.

## Automated coverage

Tests cover the fixed app launcher, unsupported IDs/platforms, process-start errors, BOZZ window focus, supported external process filtering, metadata minimization, opaque IDs, malformed handle rejection, one-use focus tokens, and safe PowerShell failure handling. CI runs these tests and the frontend production build.

## Manual acceptance on Windows

1. Start BOZZ and confirm the tray menu still opens Calculator, Notepad and Paint only after a direct menu click.
2. Open Settings and scan supported apps.
3. Open Notepad, Paint, Calculator, Edge, Chrome or VS Code, then scan again. Only supported apps with a visible main window should appear.
4. Confirm the UI shows app labels only—not tab titles, document names, or window titles.
5. Select one app, confirm the prompt, and verify Windows brings that app forward when allowed.
6. Confirm an unknown app is not listed and that scanning does not start, close, type into, or otherwise control any app.
7. Close an app, refresh, and confirm it disappears from the inventory.
8. Verify non-Windows platforms display the unsupported message.

## Next increments

1. Add narrow app-specific keyboard/mouse actions only after a separate threat-model review, with per-action approval, visible execution state, cancellation, and verification.
2. Keep arbitrary command execution, hidden monitoring, and unrestricted control out of the renderer and AI tool surface.

Do not describe Gate 4 as full computer control until later automation increments are implemented and verified on the target Windows PC.
