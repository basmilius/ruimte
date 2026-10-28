# Computer use

The macOS-only app that lets an agent see and operate another Mac app. Root `CLAUDE.md` says why it is an app and how it ships. It runs in the background (`LSUIElement`), and every command works behind the person's work unless it asks for the front. `cu` is a debugging CLI for the daemon's socket; it is built into the dev app and never ships.

## Build

```sh
bun scripts/build.ts
```

This builds `dist/Ruimte Computer Use Dev.app` (bundle id `app.ruimte.computer-use.dev`) with `cu` inside and `dist/cu` linked beside it. `bun dev` runs the same build before the daemon starts. The dev bundle id keeps a checkout and an installed Ruimte apart in System Settings.

The script signs with the first Apple Development identity in the keychain (`security find-identity -v -p codesigning`), with the hardened runtime and the empty entitlements in `Resources/entitlements.plist`. A stable identity keeps the grants across rebuilds. Without one it signs ad hoc and says so, and macOS asks for the grants again after every build. `--identity <name|hash|->` or `RUIMTE_COMPUTER_USE_IDENTITY` picks another identity; `-` signs ad hoc.

### In Ruimte.app

`apps/server/scripts/compile.ts` builds `--variant release` (`Ruimte Computer Use.app`, `app.ruimte.computer-use`) into `apps/server/dist/mac-<arch>/Helpers`, which electron-builder copies to `Ruimte.app/Contents/Helpers` so codesign treats it as nested code. `apps/desktop/build/sign.cjs` signs it with the app's Developer ID and `Resources/entitlements.plist`, not the shell's JIT entitlements. The daemon finds it at `../../Helpers/Ruimte Computer Use.app` from `Contents/Resources/bin/ruimte`. A daemon from npm has no helper.

## Launch and authentication

The daemon starts the helper with its home:

```sh
open -g "<path>/Ruimte Computer Use.app" --args --home "$RUIMTE_HOME"
```

Without `--home` the helper takes `~/.ruimte`, or `~/.ruimte-dev` for the dev app. macOS runs one instance per bundle id, so a helper serving another home must quit first.

Its files sit under `$RUIMTE_HOME/computer-use/` (mode `0700`):

```
agent.sock        the socket, mode 0600
overlay.json      the words of the overlay, written by the daemon
screenshots/      window captures; one older than an hour goes at the next capture
```

A connection carries one request: the client writes one JSON object and half-closes, the helper answers one object and closes. `Request` in `Sources/ComputerUseCore/Wire.swift` holds `command`, its fields, and `secret`, the content of `$RUIMTE_HOME/local.key`.

- The helper accepts a connection only from a process of the same user.
- It accepts a request only when `secret` matches `local.key`, read again per request and compared in constant time. A request without it gets `refused: ...` before anything else is read.
- The reply is `{"ok": true, "result": {...}}` or `{"ok": false, "error": "...", "code": "..."}`. `code` appears only for refusals a caller branches on (`paused`, `taken-over`, `stopped`, `needs-front`).

The commands are those `cu` sends, with field names in `Wire.swift`. `doctor` also takes `grant` (`accessibility` or `screenRecording`) to ask macOS for one grant without opening the pane; `cu` has no flag for it.

Acting commands run one at a time, in order. `wait` only reads and may take two minutes, so it runs beside the queue; a pause, take-over or stop cancels it too. Every state carries `instance`, a UUID per helper run, because handles restart at 0 after a restart.

The daemon writes the overlay's words to `overlay.json`, reread at every action; English defaults are in `Sources/ComputerUseCore/OverlayConfig.swift`.

### Presence

The daemon tells the helper what it cannot see itself:

```json
{ "command": "presence", "state": "think", "label": "Reading the inbox", "step": "Step 12 · Reading the inbox", "secret": "..." }
```

`state` is `think`, `waiting`, `permission`, `error`, `done` or `end`. Optional `label` replaces the words beside the cursor and `step` the menu's step line. The reply is `{"session": true, "shown": "<state on screen>", "mode": "running|paused|takenOver"}`.

`think`, `waiting`, `permission` and `error` start a session when none runs and are refused after a stop. `done` ends the session once its cursor faded; `"ends": true` makes any state do that after three seconds. `end` ends it at once, also paused or taken over, without the checkmark. Without a session, `done` and `end` answer `{"session": false, "shown": null}`.

## Grant the permissions

Run `cu doctor`. It asks macOS for what is missing and opens System Settings.

1. In Privacy & Security > Accessibility, turn on **Ruimte Computer Use Dev**. If it is missing, click +, pick `dist/Ruimte Computer Use Dev.app` and turn it on.
2. In Privacy & Security > Screen & System Audio Recording, do the same.
3. Run `cu quit`, since Screen Recording applies only to a fresh launch.
4. Run `cu doctor --no-prompt` and check that `ready` is `true` (it exits 0 either way).

## Usage

`cu` presents its home's `local.key`, so a daemon must have run once for that home. The first command starts the app with `open`, and `cu quit` stops it. `RUIMTE_COMPUTER_USE_APP` points it at another app, such as the one in a packaged Ruimte.

```
cu doctor [--no-prompt]                  check Accessibility and Screen Recording;
                                         without --no-prompt it asks macOS for what is missing
cu apps                                  list running apps with name, bundle id, bundle file name
                                         (bundleName), pid, frontmost
cu open <app>                            launch an app, or unhide it; --front brings it forward
cu state <app> [--find T] [--within N]   accessibility tree of the key window, plus a PNG of it
cu click <app> --element N [--count 2] [--button right]
cu click <app> --x PX --y PX [--count 2] [--button right]
cu scroll <app> (--element N | --x PX --y PX) --direction up|down|left|right [--pages N]
cu type <app> <text>                     type text into the focused element
cu key <app> <combo> [<combo>...]        press keys: cmd+n, return, escape, tab, shift+tab, up
cu set-value <app> --element N <value>   set the AXValue of element N
cu drag <app> (--from N | --from-x PX --from-y PX) (--to N | --to-x PX --to-y PX)
cu read <app> --element N                every text of element N whole, with its role and frame
cu wait <app> (--for T | --gone T | --element N --value V) [--timeout S]
                                         read the app until the condition holds (10 s, at most 110 s)
cu menu <app>                            list the menu bar with indices
cu menu <app> <index | "File > Save">    run a menu item
cu presence <state> [--label T] [--step T]
                                         think, waiting, permission, error, done or end
cu pause | resume | stop                 what the buttons of the session bar do
cu quit                                  stop the agent
cu render sheet|<state>|bar [<state>]    development: the overlay as PNGs, see below
```

Every command takes `--home <dir>` (default `RUIMTE_HOME`, else the app's default). Every command that reads or operates an app takes `--front`. Options for `state`, and for every action with `--state`:

```
--front            bring the app to the front and use the real pointer and keyboard (see below)
--state            after the action, wait until the UI settles and answer with a new state
--text             print the tree (or menu) as plain text instead of JSON
--no-screenshot    --max-depth N (60)    --max-elements N (500)    --max-text N (100)
```

`<app>` is a name (localized like `Rekenmachine`, or the bundle file name like `Calculator`), a bundle id or a pid from `cu apps`.

Output is JSON on stdout. On failure the exit code is 1, stdout holds `{"error": "..."}` and stderr repeats it. Put `--` before text that starts with `--`: `cu type TextEdit -- --flag`.

### A typical loop

```sh
cu open TextEdit
cu state TextEdit --text                      # read the tree, look at the screenshot
cu click TextEdit --element 2                 # focus the text area
cu type TextEdit "Hello"
cu menu TextEdit "File > Save" --front --state --text # save goes to the window, which needs the front
```

With `--state`, an action waits until the tree is the same three polls in a row (120 ms apart, 3 seconds at most) and returns it under `state`, with `settled` saying whether it settled.

### `state`

One line per meaningful element: controls, anything with a title, value or description, and landmarks (windows, sheets, scroll areas, web areas, tables, lists, open menus). Plain containers drop out and their children move up.

```
[0] Window:StandardWindow "Untitled 2" (292,161 586x488)
  [1] ScrollArea (292,229 586x420)
    [2] TextArea value="1\n2\n3…"(cut: 1091 chars) id="First Text View" (292,261 586x382) focused
  [26] Sheet "save" id="save-panel" (391,296 388x218)
    [36] Button "Save" id="OKButton" (679,469 81x26)
```

- `[N]` is the handle for `--element`, stable for the same element and never reused until `instance` changes.
- Frames are screen points, top-left origin of the main display. A mouse event on an `offscreen` element is refused until `scroll --element` brings it in.
- The tree stops at 500 elements and 60 levels by default (`truncated` says why). `--find T` reads up to 5000 elements and keeps matches with their ancestors. `--within N` lists only element `N`.
- `screenshot.path` is a PNG of the window alone, at most 1280 px wide, without other apps or the overlay. Map a pixel with `screenX = origin.x + px / scale`.
- For Chromium and Electron the helper sets `AXManualAccessibility`, and `AXEnhancedUserInterface` when the tree stays nearly empty.

### Background and front

Without `--front`, a command never activates the app, moves the real pointer or posts to the system event stream. The app in front keeps the focus and the person's keys.

- `click --element` uses `AXPress`, `AXFocused` for a field without a press, or `AXShowMenu` for `--button right`.
- `type` and `key` refocus the element (`KeyAim.swift`), raise its window with `AXMain`, and post keys to the app's process (`CGEvent.postToPid`), one character every 40 ms. `note` says when the focused value did not change.
- `scroll --element` uses page actions or the scroll bar's value, and in Chromium `AXScrollToVisible` (about half a page per step).
- `open` starts an app without activating it. The read commands and `menu` work as in front.

These need the front and are refused with `code` `needs-front`, never done in front on the helper's own: a click by pixel, a double click, a click on an element without a press, a drag, a scroll by pixel or of an area without accessibility scrolling, keys for a minimized window or one on another Space, and select all, cut, copy, paste, undo and redo by key or menu. Menu items that go to the focused view (save, export, print) do nothing in the background, and `note` says so.

With `--front` the app comes forward where an action needs it (a minimized window is restored first), keys go through the system event stream, and mouse events use the real pointer and put it back.

### Actions

Every result has `target`: the role, label, identifier and window acted on.

- Before a mouse event on an element, the helper hit-tests the point and refuses unless it finds that element or a descendant. `click --x --y` is refused when another app's window covers the point.
- `type` takes at most 500 characters and `key` at most 50 combos per call, refused before anything is typed.
- `set-value` reads the value back for up to a second; `note` says when it differs.
- `drag` releases the button also when the person interrupts. Only its start is hit-tested.
- `wait` reads every 250 ms and answers with the final state, also on timeout.

### Menus

`cu menu <app>` lists the menu bar as an indented tree with shortcuts, `checked`, `disabled`, and `>` for a submenu. The system menu's items are left out. `cu menu <app> 25` runs item 25 of the last listing. `cu menu <app> "File > Save As"` matches titles case-insensitively, ignoring a trailing ellipsis, and names the choices when a step does not match. A top-level title opens that menu. `disabled` is often stale, so the agent tries a disabled item anyway.

### The phantom cursor

During a session the helper draws its own click-through cursor, which never appears in a screenshot. The real pointer only visits a point for a mouse event and returns. A session ends on a stop, on `done`, or two minutes after the last command, unless it waits on the person or the person holds it.

### Pause, take over, stop

- ⌥Space, the pause button or the menu pauses and resumes. ⌥⎋, the stop button or the menu stops. Both keys are registered only during a session and never reach the app in front. A key another app holds is logged, and the menu then shows no shortcut.
- The person takes over with a click, or more than 12 points of mouse movement within half a second, inside the window the agent acts in. In the background, only bringing that app forward or clicking its window takes over. The helper marks its own events so they never count.
- While paused or taken over, every command that reads or operates an app is refused with `paused` or `taken-over`, and a running action is cancelled.
- A stop cancels what runs and ends the session. Later commands get `stopped` until the next `cu state` or a `clear-stop`, which the daemon sends once it told its agents.
- `pause`, `resume` and `stop` on the socket are the same buttons. `doctor` answers with `session` (`active`, `mode`, `stopped`) without changing it.

### The look

`Sources/Phantom` holds the look (`OverlayStyle.swift`, `PhantomForms.swift`, `PhantomLook.swift`, `Motion.swift`). `cu render` draws it offscreen without a grant or screen:

```sh
cu render sheet --theme both --scale all --out /tmp/phantom   # every state, the forms, the session bar
cu render bar think --time 02:31                              # the session bar; --held shows it paused
```

A render cannot draw glass.

## Known limitations

- `cmd+z` on AZERTY or Dvorak presses the US-position key, since keys are ANSI key codes. `type` is unaffected.
- Only the key window is read, with its sheet and open menus. A window on another Space cannot be read or captured; a minimized one gives its last frame.
- The screenshot composes the app's windows in stacking order, so another window of the same app can show behind the key window.
- Autocorrect and smart substitutions in the target app still apply.
- Some apps report an `AXPress` as done without acting. Click on coordinates then.
- Typing never takes over.
- In the background a fully covered Chromium or Electron window may show a stale picture and tree, unless the app runs with `--disable-backgrounding-occluded-windows`.
