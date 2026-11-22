# Gate 3 — Windows tray lifecycle acceptance

## Implemented in the Gate 2 integration branch

- BOZZ creates a local system-tray icon when Electron becomes ready.
- Closing the main window hides it instead of terminating the BOZZ process.
- Clicking the tray icon or choosing **Open BOZZ** restores the main window.
- The tray menu exposes an explicit **Quit BOZZ** action.
- A normal tray-idle state does not enable microphone or camera capture.
- The Electron before-quit path unregisters shortcuts, stops Mini Orb movement and destroys the tray icon.

## Required manual checks on the target Windows PC

Run these checks only after updating to the commit containing this change:

1. Start BOZZ normally and confirm the BOZZ tray icon appears.
2. Close the main window. Confirm the process remains available and the tray icon remains visible.
3. Open BOZZ from the tray icon and from the **Open BOZZ** menu item.
4. Enter Mini Orb mode, close/restore the main window and confirm there is only one active BOZZ UI state.
5. Confirm microphone and camera remain off while BOZZ is idle in the tray.
6. Choose **Quit BOZZ**. Confirm the tray icon disappears and the BOZZ process exits.
7. Start BOZZ again and confirm it can start cleanly after a normal quit.

## Not implemented by this change

- No wake-word model is bundled or started.
- No background microphone capture is started by tray creation, close-to-tray, or app startup.
- No claim is made that BOZZ wakes from the word “BOZZ” while the UI is closed.
- Explicit background-listening consent, persistent microphone-active UI, OS permission handling and wake-event handoff remain separate work.

## Evidence

CI validates Electron syntax and the repository's automated test/build suites. It does not validate Windows notification-area behaviour, process lifetime, camera release or microphone privacy. Record those results only after running the checks on the target Windows PC.


## Background-listening consent status

- The Settings page now exposes a separate, opt-in preference for future local wake-word listening. It is off by default and can be revoked at any time.
- This preference is not an active microphone grant. The current build has no installed local wake-word engine and does not start a background microphone listener.
- A shared gate requires all of: wake-word mode, explicit BOZZ consent, an available local engine, and OS microphone permission. Regression tests cover each missing prerequisite.
- The visible Settings microphone status distinguishes active voice input from the normal microphone-off state. Native tray status updates and OS permission handoff remain future work.
