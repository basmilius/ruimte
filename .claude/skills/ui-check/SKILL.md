---
name: ui-check
description: Check UI work in Ruimte Dev with computer use before calling it done. Restarts the dev launch so the window runs the new code, opens a throwaway project there, and looks at the result with a screenshot. Use after any change a person sees in the desktop client (apps/client, apps/desktop, extensions with UI, ADE CORE components Ruimte draws), and when asked to test, check or verify UI in Ruimte. Says what an agent can check itself and what only Bas can.
---

# UI check

UI work is done once you saw it work in Ruimte Dev, with a screenshot. Tests and types do not show what a person sees.

## Rules

- Operate only Ruimte Dev (`app.ruimte.desktop.dev`), never the installed Ruimte, and only the throwaway project from step 3. Leave Bas's other projects there alone, also when the window opens on one.
- Stay behind the person's work: never `front`. Something that needs the front goes on the list for Bas.
- Ask nothing of the person but the card that lets you into Ruimte Dev ("this time" is enough).

## Steps

1. **ADE CORE.** `bun run adecore:status --brief`. A change in `../adecore` shows in Ruimte Dev only while it says `linked`. Linking changes resolution for every agent in this checkout, so run `bun run adecore:link` only when your task says so; otherwise say the check waits for the link.
2. **Fresh window.** Restart the dev launch (`launch_control` with `restart` and `dev`), so Ruimte Dev runs the code you wrote and not a build from before. Call `computer_apps` until it lists Ruimte Dev; that takes up to a minute.
3. **Throwaway project.** `bun run ui-check` opens a new empty project in a temp folder on the dev machine and prints its name. Open it in Ruimte Dev from the project menu (`computer_state` with `find`, then `computer_act` click).
4. **Check.** Bring about the state your change is for, then `computer_state` and look at the picture. A window another one covers shows a stale picture: read the tree then (`find`), or say so.
5. **Report.** Say what you saw, with the screenshot path, and list what you could not check for Bas.

## What an agent can check, and what only Bas can

An agent can check what shows in the window and what the accessibility tree says: layout, text, states, empty and error states, a dialog or menu opening, focus moving, a value typed into a field, a click on a control with a press (also by pixel), scrolling a list.

Only Bas can check, so put these on his list:

- macOS notifications, sounds, Dock badges and anything outside the window.
- The real pointer and keyboard: hover, drag and drop, double clicks, shortcuts with select all, copy, paste, undo, and a click on something that has no press, which all need the front.
- Animations and timing beyond one still picture, and how something feels.
- Grants and system dialogs (TCC, file pickers, the keychain), the menu bar and the tray.
- Another Space, full screen, a second display, and Windows or Linux.
- A click that seemed to do nothing: from outside an agent cannot tell a lost click from a missing reaction, so say which it was not able to rule out.
