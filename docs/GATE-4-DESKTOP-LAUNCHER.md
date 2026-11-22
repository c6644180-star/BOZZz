# Gate 4 — Desktop App Launcher Foundation

## Included

BOZZ's native tray now offers explicit menu actions for Calculator, Notepad and Paint on Windows. The launcher uses a fixed executable allowlist and starts each application with an empty argument list, `shell: false`, and detached stdio. No command text, path, or arguments are accepted from the renderer or an AI model.

## In-app launcher

The Settings page now includes a small app launcher. In the installed Electron desktop app, each button first asks the user to confirm, then invokes a narrow preload bridge. The main process validates the sender and app ID again before calling the fixed allowlist helper. In a browser, the controls are unavailable and display that limitation. No AI/chat pathway is connected to this IPC handler.

## BOZZ window intelligence

The Settings page can list and focus only BOZZ-owned windows (the main BOZZ window and the optional mini orb). The main process returns a small metadata snapshot: fixed window ID, title, visibility, focus and minimized state. Focus actions accept only `main` or `mini`, and the UI asks for confirmation first. No external application windows, titles, processes, screenshots, or contents are enumerated or inspected in this milestone.

Automated tests cover inventory filtering, restoring/focusing a minimized BOZZ window, rejecting unknown IDs, missing-window handling, the fixed app allowlist, empty launch arguments, `shell: false`, unsupported platforms, and process-start failures.

## Boundaries

- Windows only in this milestone; other platforms return an unsupported result.
- Only the three fixed application IDs are accepted.
- Opening an app requires a direct human click on its tray menu item.
- This is app launching only. It does not inspect, type into, control, close, or automate other applications.
- No arbitrary shell, PowerShell, terminal, executable path, or command execution is exposed.

## Manual acceptance on Windows

1. Start BOZZ and open its tray menu.
2. Select Calculator, Notepad and Paint individually; confirm each opens.
3. Confirm BOZZ remains running and the tray menu can be reopened.
4. Confirm no app starts merely by launching BOZZ.
5. Confirm no app action occurs from AI-generated text or a background event.
6. Verify unsupported IDs, unsupported platforms, and spawn failures are rejected by the automated helper tests.

## Next increments

1. Add app-specific window discovery and focus adapters only after selecting a maintained, Windows-compatible implementation and reviewing its permissions and failure modes.
2. Add keyboard/mouse automation only through narrow, user-approved, app-specific actions with visible execution state and a reliable stop control.
3. Keep arbitrary command execution, hidden monitoring, and unrestricted control out of the renderer and AI tool surface.

Do not describe Gate 4 as full computer control until those later increments are implemented and verified.
