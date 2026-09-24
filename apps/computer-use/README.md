# Computer use

This macOS-only app lets an agent see and operate another Mac app. It reads the accessibility tree of a window, captures the window, and clicks, types, scrolls and runs menu items in it. It is an app of its own because macOS attaches the Accessibility and Screen Recording grants to a bundle, so they belong to **Ruimte Computer Use** and not to the daemon, a terminal or the agent that asks. It runs in the background (`LSUIElement`). While it acts it draws the phantom cursor, a session bar at the top of the screen and an item in the menu bar, and the person can pause it, take over or stop it at any time.

The daemon talks to it over a Unix socket. `cu` is a command line for the same socket, for development and debugging only; it is built into the dev app and never ships.

## Build

```sh
bun scripts/build.ts
```

This builds the package with Swift Package Manager and assembles `dist/Ruimte Computer Use Dev.app` (bundle id `app.ruimte.computer-use.dev`) with `cu` inside it and `dist/cu` linked beside it. `bun dev` in `apps/desktop` runs the same build first. The dev app has its own bundle id and name, so a checkout and an installed Ruimte never share an entry in System Settings.

The script signs with the first Apple Development identity in the keychain (`security find-identity -v -p codesigning`), with the hardened runtime and the empty entitlements in `Resources/entitlements.plist`. A stable identity keeps the grants across rebuilds. Without one it signs ad hoc and says so; macOS then asks for the grants again after every build. `--identity <name|hash|->` or `RUIMTE_COMPUTER_USE_IDENTITY` picks another identity, and `-` signs ad hoc.

`swift test` covers the parts that do not need a screen: key combos, menu paths, mapping screenshot pixels to screen points, the overlay config, the session control, the home and the local secret, and in `PhantomTests` the forms of the cursor against the design's path strings, the state table, the easings and where the label flips.

### In Ruimte.app

`apps/server/scripts/compile.ts` builds `--variant release` (`Ruimte Computer Use.app`, `app.ruimte.computer-use`) into `apps/server/dist/mac-<arch>/Helpers`. electron-builder copies that folder to `Ruimte.app/Contents/Helpers` and keeps it out of `Contents/Resources/bin`. `Contents/Helpers` is where a bundle expects a nested app. Codesign signs and verifies it there as nested code; under `Resources` it would only seal it as files. `apps/desktop/build/sign.cjs` signs it like everything else, with the app's Developer ID, the hardened runtime and a timestamp. Its entitlements are `Resources/entitlements.plist`, not the shell's. Those open up JIT and library validation for Electron and the daemon, and a helper with these grants has no use for either.

The daemon inside the app finds it at `../../Helpers/Ruimte Computer Use.app` from its own executable (`Contents/Resources/bin/ruimte`). A daemon from npm has no helper.

## Launch and authentication

The daemon starts the helper with the home it serves:

```sh
open -g "<path>/Ruimte Computer Use.app" --args --home "$RUIMTE_HOME"
```

Without `--home` the helper takes `~/.ruimte`, or `~/.ruimte-dev` for the dev app, which are the daemon's own defaults. macOS runs one instance per bundle id, so a helper that already serves another home has to quit before it can serve this one.

Everything it keeps sits under `$RUIMTE_HOME/computer-use/` (mode `0700`):

```
agent.sock        the socket, mode 0600
overlay.json      the words of the overlay, written by the daemon
screenshots/      window captures; one older than an hour goes at the next capture
```

A connection carries one request. The client writes one JSON object and half-closes, the helper answers with one JSON object and closes. The request is `Request` in `Sources/ComputerUseCore/Wire.swift`. It holds `command`, the fields that command takes, and `secret`, the content of `$RUIMTE_HOME/local.key`. The helper accepts a connection only from a process of the same user. It accepts a request only when `secret` matches that file, which it reads again for every request and compares in constant time. Whoever can read `local.key` can drive the daemon already, so the helper is no weaker than the daemon. The reply is `{"ok": true, "result": {...}}` or `{"ok": false, "error": "...", "code": "..."}`. `code` is there only for a refusal a caller branches on (`paused`, `taken-over`, `stopped`); the message is for people and may change. A request without the secret gets `refused: ...` before the helper looks at anything else in it.

The commands are the ones `cu` sends, listed below. `doctor` also takes `grant` (`accessibility` or `screenRecording`) beside `prompt`: then it asks macOS for that one grant only, which puts the helper in that list of System Settings, and leaves opening the pane to the caller. `cu` has no flag for it. `--state` is `withState`, a menu index or path is `path`, and the key combos of `key` are `combos`.

### The words

`overlay.json` is optional and read again at the start of every session and every `presence`, so a language switched in Ruimte reaches a helper that is already running. Every key is optional; a missing file or key keeps the English default:

```json
{
  "title": "Ruimte is using your computer",
  "menuTitle": "Ruimte is using this Mac",
  "pause": "Pause",
  "resume": "Resume",
  "takeOver": "Take over",
  "stop": "Stop session",
  "accent": "#155dfc",
  "labels": { "click": "Click", "scroll": "Scroll", "look": "Looking", "think": "Working", "waiting": "Needs you", "permission": "Waiting for permission", "error": "Something went wrong", "done": "Done", "takeover": "You have control", "paused": "Paused", "tap": "Tap" },
  "steps": { "idle": "Ready", "click": "Clicking {target}", "type": "Typing in {target}", "think": "Deciding what to do next", "...": "..." }
}
```

`title` is the session bar, `menuTitle` the first line of the menu. `labels` is the pill beside the cursor per state; a state without one shows no label. `steps` is the second line of the menu per state, with `{target}` for the element or app an action is aimed at. The full lists are in `Sources/ComputerUseCore/OverlayConfig.swift`. `accent` replaces the accent of the cursor.

### Presence

The helper sets the action states itself from the commands it runs. What it cannot see, the daemon tells it:

```json
{ "command": "presence", "state": "think", "label": "Reading the inbox", "step": "Step 12 · Reading the inbox", "secret": "..." }
```

`state` is `think`, `waiting`, `permission`, `error`, `done` or `idle`; `label` replaces the words beside the cursor and `step` the step line of the menu, both optional. The reply is `{"session": true, "shown": "<state on screen>", "mode": "running|paused|takenOver"}`. While the person holds the session, the state is kept and shows once they resume. `think`, `waiting`, `permission` and `error` start a session when none runs; `done` and `idle` without one answer `{"session": false, "shown": null}`. After a stop the first four are refused like an action. `done` ends the session once its cursor has faded.

## Grant the permissions

Run `cu doctor`. It asks macOS for what is missing and opens System Settings. Then:

1. **Accessibility**: System Settings > Privacy & Security > Accessibility. Turn on **Ruimte Computer Use Dev**. If it is not listed, click +, pick `dist/Ruimte Computer Use Dev.app` and turn it on.
2. **Screen Recording**: System Settings > Privacy & Security > Screen & System Audio Recording. Turn on **Ruimte Computer Use Dev** the same way.
3. Run `cu quit`. Screen Recording only applies to a fresh launch; the next `cu` command starts the agent again.
4. Run `cu doctor --no-prompt` and check that `ready` is `true`.

## Usage

`cu` needs a daemon that has run once for its home, since it presents that home's `local.key`. There is no separate start step: the first command starts the app `cu` sits in with `open`, and `cu quit` stops it. `RUIMTE_COMPUTER_USE_APP` points it at another app, such as the one inside a packaged Ruimte.

```
cu doctor [--no-prompt]                  check Accessibility and Screen Recording;
                                         without --no-prompt it asks macOS for what is missing
cu apps                                  list running apps with name, bundle id, pid, frontmost
cu open <app>                            launch an app, or bring it to the front (and unhide it)
cu state <app>                           accessibility tree of the key window, plus a PNG of it
cu click <app> --element N [--count 2] [--button right]
cu click <app> --x PX --y PX [--count 2] [--button right]
cu scroll <app> (--element N | --x PX --y PX) --direction up|down|left|right [--pages N]
cu type <app> <text>                     type text into the focused element
cu key <app> <combo> [<combo>...]        press keys: cmd+n, return, escape, tab, shift+tab, up
cu set-value <app> --element N <value>   set the AXValue of element N
cu menu <app>                            list the menu bar with indices
cu menu <app> <index | "File > Save">    run a menu item
cu presence <state> [--label T] [--step T]
                                         think, waiting, permission, error, done or idle
cu pause | resume | stop                 what the buttons of the session bar do
cu quit                                  stop the agent
cu render sheet|<state>|bar [<state>]    development: the overlay as PNGs, see below
```

Every command takes `--home <dir>`; without it `cu` uses `RUIMTE_HOME`, else the default of the app it sits in. Options for `state`, and for every action together with `--state`:

```
--state            after the action, wait until the UI settles and answer with a new state
--text             print the tree (or menu) as plain text instead of JSON
--no-screenshot    --max-depth N (60)    --max-elements N (500)    --max-text N (100)
```

`<app>` is a name, a bundle id or a pid from `cu apps`. The name may be the localized one (`Rekenmachine`) or the bundle's file name (`Calculator`).

Every command prints JSON on stdout. On failure the exit code is 1, stdout holds `{"error": "..."}` and stderr repeats the message. Put `--` before text that starts with `--`: `cu type TextEdit -- --flag`.

### A typical loop

```sh
cu open TextEdit
cu state TextEdit --text                      # read the tree, look at the screenshot
cu click TextEdit --element 2                 # focus the text area
cu type TextEdit "Hello"
cu menu TextEdit "File > Save" --state --text # run a menu item, get the sheet it opens
```

With `--state` an action waits until the tree stops changing (the same tree three polls in a row, 120 ms apart, 3 seconds at most) and returns the new state under `state`, with `settled` saying whether it did settle. That replaces a separate `state` call and guessing at sleeps.

### `state`

One line per meaningful element: controls, anything with a title, value or description, and landmarks such as windows, sheets, scroll areas, web areas, tables, lists and open menus. Plain containers are left out and their children move up.

```
[0] Window:StandardWindow "Untitled 2" (292,161 586x488)
  [1] ScrollArea (292,229 586x420)
    [2] TextArea value="1\n2\n3…"(cut: 1091 chars) id="First Text View" (292,261 586x382) focused
  [26] Sheet "save" id="save-panel" (391,296 388x218)
    [36] Button "Save" id="OKButton" (679,469 81x26)
```

- `[N]` is the handle for `--element`. An element keeps its number across `state` calls for as long as it is the same accessibility element, so buttons keep their numbers while a line appears above them. New elements get new, higher numbers, and a number is never reused for a different element. Numbers start over when the agent restarts.
- The role and subrole drop their `AX` prefix. Then come the label, `value=`, `desc=`, `placeholder=`, `id=` (the app's own AXIdentifier, when it set one), and the frame in screen points (`x,y widthxheight`, top-left origin of the main display). A line may end with `focused`, `selected`, `disabled`, or `offscreen` (outside the window, for example scrolled away).
- Text longer than `--max-text` ends in `…"(cut: N chars)`.
- The tree stops at 500 elements and 60 levels by default. `truncated` says when and why.
- When a sheet is up, the tree starts at its parent window and the sheet sits inside it; `window.sheet` names the sheet. An open context menu or pop-up menu shows up as a `Menu` with its items.
- `screenshot.path` is a PNG of the window area, at most 1280 px wide, composed of the app's own windows only: sheets and open menus are in it, other apps and the overlay are not. Map a pixel to a screen point with `screenX = origin.x + px / scale` and `screenY = origin.y + py / scale`; `click --x --y` does this for you. An open menu that hangs outside the window widens the area, so check `origin` and the size each time. Files older than an hour are removed at the next capture.
- A hidden app gets `hidden: true`. While hidden, its windows are off screen, cannot be captured, and AppKit reports them with subrole `Dialog`; `cu open` shows the app again.
- For Chromium and Electron apps the agent first sets `AXManualAccessibility`, and `AXEnhancedUserInterface` when the tree stays nearly empty. `note` says when it did.

### Actions

Every action result has `target`: role, label, identifier, and the window (and sheet) of what it acted on. For a mouse event that is the element the hit test found at the point.

- `click --element` uses `AXPress` (or `AXShowMenu` for `--button right`) when the element has it, without moving the real pointer. Otherwise, and for `--count 2`, it brings the app to the front and clicks the visible center of the element with synthesized mouse events, then puts the pointer back. The result's `method` is `AXPress`, `AXShowMenu` or `mouse`, and `point` is where the virtual pointer went.
- Before a mouse event for an element, the agent hit-tests the point. Unless it finds that element or something inside it, the click is refused with "element N is no longer at (x, y); the point now hits ... Run `cu state` again". This catches a new window that opened over the old one.
- `click --x --y` takes pixels in the last screenshot and always uses the mouse. It is refused when another app's window covers the point.
- `scroll` sends scroll wheel events at the element or pixel. A page is 90 percent of the element's height (or width), or of the scroll area under the pixel. The pointer is put back afterwards.
- `type` sends one unicode character per event; a newline becomes Return and a tab becomes Tab. `key` knows `cmd`, `shift`, `option`/`alt`, `ctrl` and `fn`, and the keys a-z, 0-9, punctuation, `return`, `escape`, `tab`, `space`, `delete`, `forwarddelete`, the arrows, `home`, `end`, `pageup`, `pagedown` and `f1`-`f12`. Use `cmd++` or `plus` for plus. Both bring the app to the front first and are refused when that fails. Their `target` is the focused element; they have no `point`, since nothing is clicked.
- `set-value` works only where the app lets `AXValue` be set (text fields and areas, sliders). A number element takes a number, `true` or `false`.
- `open` launches an app by name (searched in `/Applications`, `/System/Applications`, their `Utilities` folders and `~/Applications`) or bundle id, or activates and unhides it when it runs, then waits up to 5 seconds for a window.

### Menus

`cu menu <app>` lists the menu bar as an indented tree with shortcuts, `checked`, `disabled`, and `>` for a submenu. The first menu is the system's; its items are not listed, since they are the same everywhere and include recent files. `cu menu <app> 25` runs item 25 from the last listing; `cu menu <app> "File > Save As"` finds it by title, ignoring case and a trailing ellipsis, and names the choices when a step does not match. The agent brings the app to the front and presses the item through accessibility. Picking a top-level title opens that menu.

`disabled` is what the app reported when it last refreshed the menu, which it usually does only when the menu opens, so the agent tries a disabled item anyway.

### The phantom cursor

During a session the helper draws its own cursor in a click-through window above everything; the real pointer only visits a point for a mouse event and goes back. The cursor glides to each target (700 ms with a light overshoot), points, and shows the action: a press and a ring for a click, chevrons for a scroll, the typed text letter by letter for `type`, `key` and `set-value`, and a viewfinder around the window for `state`. A moment after the action it rests again. Between actions the daemon's `presence` shows the agent working, waiting for the person, asking for permission, failing or done. The cursor follows the light or dark appearance of the system, and under Reduce Motion it drops every loop and reads by color and label alone. Nothing of the overlay appears in a screenshot.

The session bar at the top of the screen shows a mini cursor with the state, the title, the time the agent held the Mac, a pause button and a stop button. The menu bar item shows the same mark and time, amber while the agent waits for the person, and a menu with the current step, Pause or Resume, Take over and Stop session. A session ends on a stop, on `done`, or two minutes after the last command unless it waits for the person or the person holds it.

### Pause, take over, stop

- ⌥Space, the pause button or the menu pauses the session and resumes it again. ⌥⎋, the stop button or the menu stops it. Both keys are registered only while a session runs and never reach the app in front.
- The person's own mouse (a click, or a move of a few points) takes over, and so does Take over in the menu. The cursor turns hollow and gray. Waiting for the person does not count: then the hand on the mouse is expected. The helper's own events carry a marker and are never mistaken for the person.
- While paused or taken over, every command that reads or operates an app, `state` included, is refused with "the person paused the session; wait until they resume" or "the person took over; wait until they resume", and an action under way is cancelled. Resume from the bar, the menu or ⌥Space.
- A stop cancels what runs and ends the session. Every later command fails with "stopped by the person" until the next `cu state`.
- `pause`, `resume` and `stop` on the socket are the same buttons for a person who presses them in Ruimte. Each answers `{"session": {...}}` in the shape of `doctor`, and one that would change nothing (a pause while paused, anything without a session) changes nothing.
- These three refusals carry `code` `paused`, `taken-over` and `stopped`. `doctor` answers with `session`, `{"active": true, "mode": "running|paused|takenOver", "stopped": false}`, so a caller can see how the session stands without changing it.

### The look

The look lives in `Sources/Phantom`, apart from how the helper moves it. `OverlayStyle.swift` holds the tokens per theme, sizes, durations and easings under the design's names; `PhantomForms.swift` the forms (every one four cubic segments, so any two morph into each other); `PhantomLook.swift` the state table: form, color, glyph, effect, motion and label per state. Every animation is a `Track` in `Motion.swift`, so the overlay plays it and a snapshot draws the same value at any moment.

`cu render` draws it offscreen in its own process, without the agent, a grant or a screen:

```sh
cu render sheet --theme both --scale all --out /tmp/phantom   # every state, the forms, the session bar
cu render click --at 0.2 --scale 3                            # one state, 0.2 s after it began
cu render bar think --time 02:31                              # the session bar; --held shows it paused
```

`--dots`, `--working`, `--direction`, `--label` and `--reduce-motion` pick the variants.

## Known limitations

- Keys are ANSI key codes: `cmd+z` on an AZERTY or Dvorak layout presses the key in the US position. `type` is not affected.
- No drag.
- Only the key window of an app is read, with its sheet and open menus. A window on another Space or minimized cannot be captured.
- The screenshot composes the app's windows in their own stacking order. Another window of the same app behind the key window shows where the key window does not cover it.
- Autocorrect and smart substitutions in the target app still apply to typed text.
- Some apps report an `AXPress` as done without acting on it. Then click on coordinates instead.
- Only a click or a move of the mouse takes over; typing does not.
- `cu doctor` exits 0 even when a grant is missing; read `ready`.
