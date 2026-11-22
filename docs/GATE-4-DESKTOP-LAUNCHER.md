# Gate 4 — Desktop App Launcher Foundation

## Included

BOZZ's native tray now offers explicit menu actions for Calculator, Notepad and Paint on Windows. The launcher uses a fixed executable allowlist and starts each application with an empty argument list, `shell: false`, and detached stdio. No command text, path, or arguments are accepted from the renderer or an AI model.

## In-app launcher

The Settings page now includes a small app launcher. In the installed Electron desktop app, each button first asks the user to confirm, then invokes a narrow preload bridge. The main process validates the sender and app ID again before calling the fixed allowlist helper. In a browser, the controls are unavailable and display that limitation. No AI/chat pathway is connected to this IPC handler.

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
6. Verify unsupported IDs are rejected in the helper's tests or a local Node check.

## Next increments

1. Add a visible in-app app launcher with a confirmation step.
2. Add registered window listing and focus actions with explicit per-action consent.
3. Add app-specific adapters only after threat-model review and automated tests.

Do not describe Gate 4 as full computer control until those later increments are implemented and verified.
