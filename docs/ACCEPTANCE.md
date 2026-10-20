# Acceptance

Manual checks that unit tests, simulators and CI cannot settle: the desktop app, devices, real networks, real
accounts and what is deployed. Each item stays open until someone ran it and wrote down the result. Remove an item
once it passed, file a defect when it did not, and record measurements in the table beside it. Open implementation
is in [NEXT.md](NEXT.md).

## Desktop, 0.19.0

In the Electron dev app (`bun dev`), light and dark, unless an item says otherwise. The iOS commits of 0.19.0 go out
with the next push to main, which starts Xcode Cloud.

- [ ] A node on another machine: the pill, the narrow header and the offline card; its menu group on a private
  canvas, and a shared canvas that cannot hold it; the dialog in its four Checkout states; Create closes at once,
  also with a slow or failing address book; the linked projects under Settings > Machines.
- [ ] Send your files to the other machine with its progress, then "Bring back" into the merge dialog. Fork a chat
  to another machine.
- [ ] `ruimte-context agent claude --machine <name> --task T --prompt P` while the other machine sleeps: the parent
  shows "Waiting for ...", the child "not started", "Stop waiting" asks first and stops the task. Wake the machine:
  the task starts by itself, the branch comes back and the parent wakes once. Several waiting tasks show their number.
- [ ] A Codex or terminal task for another machine is refused with a line a person understands. Stop a task on the
  machine that runs it, then unlink its project: the parent hears what happened each time. Remove the other
  machine's access under Settings > Apps with access and check that its confirm text matches what happens.
- [ ] `RUIMTE_MACHINE=none bun dev`: no "Stop the Machine and Quit", quitting asks nothing, the start screen leads
  with "Sign in", no "This machine", no Keep awake. First run (`ask`): the welcome, focus ring and arrow keys, "Use
  this machine" while the service installs, the task list after the restart. Settings > Machines > This computer:
  "Set up", the computer use row and the stop dialog with real counts and its restart.
- [ ] A packaged app in `none` on a clean macOS user: no `~/.ruimte`, no Ruimte plist in `~/Library/LaunchAgents`,
  nothing on port 4210; "Set up" brings them back. The same switch both ways with the Linux AppImage.
- [ ] Move a chat into a project: "Make project" and "Move" in Chats, the view menu, the menu bar and the palette,
  disabled while the chat works. A new folder with its own files: the window lands in the project and the next
  message runs there. A project open in a second window comes to the front. The refused, conflict, references,
  loading and smallest-width states.
- [ ] Terminal and chat: Clear in a terminal node's menus sends one clear and in a chat node's menu ends its
  children; find in a terminal node and view; a Finder drop types the quoted path and makes no file node, and on a
  remote project shows a toast; wide characters and emoji stay aligned after a resize; Continue after a stop; a
  stashed prompt keeps its attached chats.
- [ ] With a v0.17.1 daemon on the dev port: the older-Ruimte line on the start screen row, in Settings > Machines and
  on an open project's lost screen, and everything opens again after switching back without a reload.
- [ ] Intelligent UI: a device shot attached with `ruimte-context chat attach`; the "Map tiles" row; the Utrecht
  example with four markers and the list, zoom buttons, command-scroll zooming and plain scroll moving the thread;
  tiles off and airplane mode. Timeline, Gallery, Compare, TextField and Select once in a narrow window too.
- [ ] After the ADE CORE 0.25 cleanup: a finished `bash` block still shows "Prepare in terminal" beside Copy, the
  editor opens a file with hover and completion, and the database panel and the usage dialog open.

## Desktop

- [ ] The ADE CORE cutover, visually and with a screen reader: file navigation and selection, staged and mixed Git
  checkboxes, menus and drags, editor typing, undo and search, language popups and AI actions; tabs with browser and
  terminal state, unsaved database work, gap undo at 50% and 200% zoom, trackpad selection, browser and device pan
  ownership, the model chart by keyboard and touch.
- [ ] Two windows: two projects side by side, with menus, dialogs, browser guests, notifications, shared settings and
  project claims from both; reload and reopen with project addresses and window bounds, also with a removed display;
  close a window and its sessions survive; unsaved edits during a window move.
- [ ] Editor and language servers: zoomed file nodes, navigation to unopened files, multi-file create and rename
  edits, stale results, crash and restart, local and remote clients; install, update, rebuild and previous version
  with real server binaries.
- [ ] Earlier manual cases, after checking existing results: approval focus, sleep and reconnect, quit with no open
  window, preview script redirects, dictation and Voice across windows, resolve-with-agent through stdin, first
  service start on a fresh Mac, AppImage quit and daemon-crash recovery, cancellation during long computer or device
  input, wireless device streaming, terminal file links and port chips on a remote machine.
- [ ] The October 2 audit scenarios against current code: ACT-04, NAT-05, CLI-04, SRV-05, AGT-03, ACT-02, ACT-08,
  CLI-03, and the iOS fixtures in UnifiedProjectsTests, WorkspaceVisualTests, SessionVisualTests,
  AttentionStoreTests and PhaseZeroTests.

## Measurements

The hardware half of NEXT.md §3; the baseline that needed no person is in
[the report of October 17](reports/2026-10-17-measurements.html). In the Electron dev app (`bun dev`), on power,
with DevTools closed while sampling and no other heavy app running. Write down `sysctl -n machdep.cpu.brand_string`,
the memory, the display and the commit, and add every result to that report with its unit.

The palette (Mod+K) of a dev build has six "Measure:" rows. Each "build" row writes its scene into
`~/.cache/ruimte-measure/<variant>` as a throwaway project, opens it in the window and starts recording; running it
again puts the same scene back. "Measure: copy results as JSON" copies everything since the scene opened or the last
copy (frames, input to next frame, Event Timing entries of 16 ms and more, long animation frames, heap in MiB,
mounted terminals, chats and files, WebGL contexts, DOM size) and starts a fresh window. Copy once right after a
build and throw that one away: it holds the opening. In DevTools `__ruimteMeasure.snapshot()` reads the same without
starting afresh. Remove the folders and close the projects afterwards.

- [ ] 30-node scene (10 terminals, 10 chats, 10 files of 400 lines): 30 s idle, copy; 20 s panning and zooming with
  the trackpad over all nodes, copy; 20 s holding a key in a terminal, copy; 20 s typing in a chat composer, copy.
- [ ] Nine grid cells (three terminal, three chat and three file views, three by three): the same four takes, with
  the typing in the middle cell; also note whether every cell drew its body (`mounts`).
- [ ] Ten large file nodes (20,000 lines, 640 KB each, 6.1 MiB together): idle, copy; 20 s scrolling one file at the
  top of the canvas, copy; 20 s panning over all ten, copy. Note how long the first copy after the build took to
  show all ten files.
- [ ] WebGL budget, "Measure: build 16 terminals": the first copy has `webgl.terminalsHolding` 10 and `webgl.live`
  at most 10. Focus each terminal in turn and copy: the count stays at 10 and every focused one holds a context. Run
  `yes` in twelve terminals for 20 s and copy (frames and input with more writers than slots). Context loss: in
  DevTools `__ruimteMeasure.loseWebglContexts(3)`, wait 5 s and copy: `lostInWindow` is 3, the three terminals keep
  drawing with the DOM renderer and take a context again when focused. Repeat on the oldest supported Intel Mac or
  an integrated GPU, and on Linux. Change the budget only when one of these shows a reason.
- [ ] 100 idle chats, "Measure: build 100 idle chats" (empty chat nodes on one canvas): copy after 10 s, then after
  5 minutes untouched, then after zooming out to all of them and back. Note `heap.usedMb` and, in Activity Monitor,
  the memory of the renderer process of the window. The chats have no thread; repeat with a project whose chats do
  before touching cache or GC policy.
- [ ] Workspace startup: quit the app, start it with a project window, then copy at once. `page` has
  `domContentLoadedMs`, `firstContentfulPaintMs` and `scripts.lastEndMs` (when the last chunk, the workspace's
  among them, had arrived). Five starts, keep the median. Split CodeMirror only when its 87 KiB gzip chunk shows
  in that time (Performance panel, one start with DevTools open: the parse and compile of the chunk).
- [ ] Latency over a direct connection with Chromium on the client side: a project on this machine opened from
  another machine of the account, `yes` in one terminal and a held key in a second; note whether the second one's
  echo stalls the way the daemon script's does (p95 5008 ms) or only slows.

## Devices

On a Mac with Xcode 27.1, an iOS 27.1 simulator, an iPhone Duo simulator, an Android emulator (one AVD with a hinge)
and, where an item says so, a phone. Start with `bun run test:devices` and note which files could not run.

- [ ] `side-buttons.device.integration.test.ts` passes; then announce volume, power and play/pause on a simulator
  (the `todo(Bas)` above `IOS_BUTTONS` in `apps/server/src/devices/ios-simulator.ts`).
- [ ] Biometrics and shake on Xcode 27: enroll Face ID, then match and no match in an app that asks for Face ID, the
  same for Touch ID on a simulator that has it, and Shake in an app that listens for it.
- [ ] `fold.device.integration.test.ts` on both platforms; on the node, the five poses and the hinge slider of an
  iPhone Duo, the picture following the cover and inner screen, and Closed and Open on the emulator with the picture
  at its new size.
- [ ] `android-media.device.integration.test.ts`: a picture and a video added to an emulator on Android 14 or later
  show up in Photos.
- [ ] Camera: a test pattern, then a QR code picture, in an app that scans, on the dev daemon and on a packaged app
  whose daemon runs as a launchd service; Off launches the app with its own camera again.
- [ ] Keyboard: typing, arrows, Shift and ⌘V on a simulator and an emulator while the screen has the focus, while
  every other ⌘ chord stays Ruimte's; the same on an Android phone over USB.
- [ ] Clipboard both ways on a simulator, an emulator and an Android phone; text with accents and emoji.
- [ ] Capture and record: copy, save and place a screenshot; a recording on a simulator ended by hand and one ended
  by its limit, and on an emulator past 3 minutes.
- [ ] Erase a simulator and an emulator after the dialog: both start again empty; a phone offers no Erase.
- [ ] Install an `.app` on a simulator, an `.apk` on an emulator and an `.ipa` on an iPhone, picked and dropped.
- [ ] An agent with a line to a device sets the status bar, writes the clipboard (reading a simulator's is refused), records 10 seconds and installs an
  app from the project folder; a path outside it is refused, and Erase, Fold and Camera are not offered to it.
- [ ] A Flutter launch: "Show device" opens the simulator `flutter run -d` names, and the web run opens in a browser.
- [ ] The iPhone app on a device: the tools sheet of a simulator shows only what it announces; share a screenshot,
  send and copy the clipboard, set the appearance, a clean status bar, the battery, Face ID match and a location;
  Erase asks in an alert and the simulator comes back empty. On an iPad with a keyboard: typing, arrows and ⌘V reach
  the simulator while ⌘K still opens Search.

## Accounts and networks

- [ ] Two real Claude account folders keep separate logins after a restart of the daemon, the app and the Mac, each
  with its own email; a real Codex conversation continues on another account in the same thread ("Continue on
  account"). Record versions; never read a vendor credential.
- [ ] Login from the iPhone and the station for each provider: what works, and what a browser on another machine
  than the CLI needs.
- [ ] An expired station login at cold start and during reconnect shows the reason and a working sign-in.
- [ ] Audio in the dev app over a socket and a direct connection: seek, reconnect, repeated playback.
- [ ] TURN on real carrier-grade NAT: the selected route, throughput and latency.
- [ ] The LAN door on a fresh Linux machine: login, connection, and whether its firewall asks.
- [ ] What runs: broker, address book (peer statement route, migration 0016), map service (`TOMTOM_API_KEY`, the same
  `MAP_TICKET_SECRET` as the address book, a usage alert at TomTom), station, desktop and iOS versions against their
  upgrade rules; a bounded TURN allocation test. Read TomTom's terms on caching tiles at the edge.
- [ ] Linux packages: deb on Debian trixie and Ubuntu noble, arm64, the AppImage on Ubuntu, GNOME and KDE, X11 and
  Wayland.

## Captured when they occur

Nobody spends budget to force these; keep a capture with a bounded probe against the current packages.

- [ ] A natural provider limit and reset sequence.
- [ ] Early metadata before a tool, or a child's model changing mid-run.

## iPhone and iPad

Use a current Ruimte on a MacBook that is already on your Pulsar account. Keep the MacBook awake and its broker and
TURN configuration as they are. The checks below use Connection diagnostics in the app.

- [ ] Sign in. Continue with an available provider, cancel once and check you can retry. Complete the login, close
  the app and reopen it. The account and machine list come back without another login, and the public key stays the
  same. Test Apple too when `/v1/providers` offers it.
- [ ] Wi-Fi. With "Require relay for this test" off, select the MacBook. Record `server.hello`, the machine version,
  "Route" and the milliseconds in "Connection to server.hello". The target is below 5,000 ms. "Not measured" proves
  neither direct nor relay.
- [ ] 5G. Turn Wi-Fi off and keep mobile data on. Wait for the reconnect and record the same fields. Repeat five times
  with Reconnect, and record every failure, the median and the slowest success.
- [ ] TURN. Turn on "Require relay for this test" and reconnect on Wi-Fi and on 5G. Only `server.hello` together with
  "Relayed" proves the selected candidate uses TURN. If it fails, record the error and the network. Turn the switch
  off afterward.
- [ ] Background. While connected, go Home for at least 30 seconds, return and record the new `server.hello` time.
  Repeat five times, one of them with a lock and unlock. The target is below 3,000 ms after foreground; only a new
  hello counts. An unreachable machine shows its error and reconnects when its network returns.
- [ ] Two iPad windows. Select the same machine in both and hide one. The visible connection stays live. Background
  the whole app and return: the windows share one new connection, and disconnecting one leaves the other.
- [ ] Statement origin. On the desktop, open Settings > Account, open the MacBook and look at Apps with access. Find
  "Ruimte on iPhone" or "Ruimte on iPad" and compare its public key with the one Connection diagnostics shows.
  `auth.sessions` must report `origin: "statement"`. A device paired before keeps its origin, so test with a fresh
  key.
- [ ] Path change and cancellation. Disconnect while a connection is still opening, then select it again. No late
  result of the canceled attempt replaces the current one. Switch between Wi-Fi and 5G while connected and check a
  new hello arrives.
- [ ] Local network. On the MacBook's Wi-Fi the route reads "Local network", also when its daemon runs with
  `--no-broker` after a first connection. On 5G it reads "Via broker" or "Relayed", at most a second slower. Turn
  Ruimte off under Privacy & Security > Local Network and reconnect on Wi-Fi: the route reads "Via broker" without an
  error.

| Device / OS | Network | Relay required | Route | Hello ms | Foreground ms | Result / error |
| ----------- | ------- | -------------- | ----- | -------- | ------------- | -------------- |
|             |         |                |       |          |               |                |

Features, in a disposable project where something writes:

- [ ] Open one project in two iPad windows and close one; the other's chat or terminal stays live. Rename a view on
  the phone and the desktop at once to exercise conflict resolution, and move a node on the desktop while renaming it
  on the phone.
- [ ] Stream a long chat with tools, images, an approval and a question. Check scrolling, selection during streaming,
  keyboard access, draft recovery, reconnect and a 300-line code block.
- [ ] Attach to `vim` and `htop`, reconnect, resync and paste several lines. The desktop's rows and columns stay
  unchanged. Note memory and responsiveness under large output.
- [ ] Pan a 30-node canvas with 20 edges, rotate, return to the saved camera and use the list view. Compare drawing
  paths and text against the desktop.
- [ ] File watching, image and video previews, Git stage, unstage and commit, and confirmed process signals.
- [ ] Edit a file on the phone while the desktop changes it: the save refuses and keeps the edit. Delete a file and
  find it in the machine's Trash. Mention a file in a chat that is open and in one that is not. Bind a group to a
  worktree and start a chat in it on the desktop. Stop a rebase halfway and finish it from the Changes segment.
- [ ] VoiceOver and larger text on the main pages, the chat and the composer.
- [ ] Voice in a Debug build, against a machine with `RUIMTE_EXPERIMENTAL_VOICE=1` and a key: the reply plays on the
  speaker with the phone away from the ear, and moves to a Bluetooth headset and back. A call, a locked screen, the
  owner's scene in the background and a refused microphone each end it with a reason. Playing an audio or video file
  while it runs keeps it listening, and it never shows Listening once it cannot hear.
- [ ] Visual replies in both themes, links opening in Safari, and the machine's off switch; the same on the desktop
  and the station.
- [ ] The appearance review of every Intelligent UI element against the desktop, in light, dark, narrow and with
  accessibility settings; file what differs in NEXT.md.
- [ ] The app's own test target on CI or a Mac beside the Swift package tests, and the other consumers of
  `@adecore/intelligent-ui` against the published release.
- [ ] Intelligent UI blocks in a chat, on a device. Timeline: VoiceOver reads time, title and tone per
  event. Gallery: three device shots attached with `ruimte-context chat attach` show as a grid. Compare:
  the handle drags and VoiceOver adjusts it. TextField and Select take input, refuse text over the
  limit and lock after an answer. Map: the Utrecht example shows four markers and the list, airplane
  mode keeps the list, the "Map tiles" switch in Settings off shows no map, and VoiceOver reads each
  place.
- [ ] Remove a view on the desktop while the phone has it open: the phone says it was removed instead of
  opening it forever. Also connect to a machine that names no `features`, if one is at hand: the
  session shows the older-Ruimte line.
- [ ] iPad multitasking: split view and Slide Over with a chat and a terminal open.
- [ ] Visual timing of streaming text and the composer's prompt transitions, with and without Reduce Motion.
- [ ] Long background runs and network switches during a turn.
- [ ] Startup time and memory on a device, recorded with the device and build.

## Work on another machine

Two machines of one account, such as the Linux workstation (the machine you work on) and the MacBook (the machine
that takes the task). The checks in the desktop app are under "Desktop, 0.19.0" above.

- [ ] The Docker bench on a host with Docker: `bun run --cwd apps/server docker:test` sets `RUIMTE_DOCKER=1` and
  runs `src/docker/remote-daemon.integration.test.ts` against a container of its own. All cases pass, those of
  "another machine of the account as a peer" included. Record the Docker version.
- [ ] Over a real network and not loopback: a task from the workstation's agent runs on the MacBook, the
  MacBook sleeps halfway and wakes, and the result arrives once. Note the route (broker or relay) and how long the
  link took to come back.
- [ ] A fifth task while four are open on the MacBook waits instead of failing, and starts once one settles.

## Intelligent UI evaluation

- [ ] Twenty real work questions per CLI and model, three runs each, with no syntax hint in the prompt, including an
  incident timeline, a gallery of device shots, a coffee map and a search form. The note names components and their
  required props per group, within 4,400 added characters (`context-note.test.ts`). Record CLI and model versions,
  language, fresh start or resume, compiles without diagnostics, empty renders, block or prose, and prompt cost. A
  map is accepted at 18 compiles out of 20; a recurring failure gets a catalog rule and a regression test.
- [ ] Cold replay, several concurrent chats and recorded real answers: agree on the limit first, then record input
  size, hardware, runtime, samples, medians and tails.

## Push notifications

Production delivery has never been tested. A sandbox test does not establish it; it needs a production-signed build
and its device token. `apps/pulsar-worker/APNS.md` has the environments and secrets.

- [ ] On a signed device, turn on notifications, background the app and check turn completion and both approval
  choices. Also check an expired request, a desktop answer arriving first, revocation, key loss and the generic
  fallback.
- [ ] A notification handled on the Mac clears on the phone.
- [ ] Live Activities: follow a turn and check phase changes, completion, expiry and push-to-start on the Lock Screen
  and in the Dynamic Island. Use the same node ID on two machines and check each activity stays with its machine.
- [ ] The same on a distribution-signed build from TestFlight, against the production environment.

## Speech to Text

- [ ] Recognition quality and latency with a real microphone, in English and Dutch.
- [ ] CPU-only performance on the oldest supported Apple silicon.
- [ ] Native undo after dictating into a prompt answer.
- [ ] A signed, packaged build downloads the model, dictates and removes the model again.

## Apple Foundation Models

`apps/foundation-models/verification.json` holds the recorded runs.

- [ ] The complete workday evaluation (`workflow-smoke.ts --evaluate-workday`) passes.
- [ ] The long native smoke passes, including the memory answer it last failed on.
- [ ] The helper runs on macOS 26.4, the deployment target.
