# Devices

`apps/server/README.md` ("Devices") compares the iOS and Android kinds. The verb: `apps/server/src/canvas/device-verb.ts`.

- On macOS and Linux the daemon drives Android emulators and phones with the SDK a person installed (`adb`, and `emulator` to start one; `android.ts`). It pushes the pinned scrcpy server for screen, touch and typing, which pastes through the device clipboard. Nothing is installed on the device.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A device node is driven only over a line to the agent, by screenshots, taps and the tools of `ruimte-context device` (settings, a link, the clipboard, a recording, biometrics, permissions, a push, installing an app, adding media), with paths only inside the project folder or its worktrees. Starting, stopping, restarting, erasing, folding and the camera stay with the person. No approval card: the device is its own sandbox.
- The one exception to the line is a chat view, which operates any device node of the canvas it names with `--view`; `node new device` from a chat view draws no line (`src/canvas/chat-view.ts`).
- Only a person erases a device, after confirming.
