# Devices

`apps/server/README.md` ("Devices") compares the iOS and Android kinds. The verb: `apps/server/src/canvas/device-verb.ts`.

- On macOS and Linux the daemon drives Android emulators and phones with the SDK a person installed (`adb`, and `emulator` to start one; `android.ts`). It pushes the pinned scrcpy server for screen, touch and typing, which pastes through the device clipboard. Nothing is installed on the device.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- An agent drives any device of this machine by the id `device_list` gives it (the devices of the side panel), or by a device node of its project, with no line or view: screenshots, taps and the tools beside them (settings, a link, the clipboard, a recording, biometrics, permissions, a push, installing an app, adding media). No approval card: the device is its own sandbox. Work another machine gave drives no device here.
- An agent starts a simulator or emulator with `device_start`, the same `boot` a person's start runs. A phone it never starts (`device-not-startable`). Stopping, restarting, erasing, folding and the camera stay with the person.
- One agent per device at a time. Its first call on a device, `device_start` included, claims it (`device-claims.ts`, in memory); another agent gets `device-in-use`, which names nothing of the holder. The claim ends when the holder's terminal exits or its chat or node closes. An extension with `devices.control` claims nothing.
- A path an agent hands a device lies inside the project folder, its worktrees, its chat's own folders (`attachments/<chatId>/`, `chats/<chatId>.visuals/`) or the system temp folder (`os.tmpdir()`, `/tmp`), compared on real paths.
- Only a person erases a device, after confirming.
