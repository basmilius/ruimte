# Handoff

State of Ruimte on 2026-09-09, written for whoever picks this up next (human or agent). Read
`CLAUDE.md` first for the rules; this file says where things are and what is next.

## What works today

Run `bun run dev` at the root (daemon on 4210, client on 5173), open the client, click a
terminal body, type. Reload the tab: the shell is still running with its screen. Stop the
daemon and start it again: the scrollback comes back with a `[session restored]` marker.

- **Phase 1, UI prototype** (`apps/client`): sidebar, floating dock, custom canvas with
  canvas/node modes, live grid snapping, per-aspect locks, zoom presets menu, node context menu
  with a color submenu, text elements, Base UI tooltips with a shared provider, light and dark
  tokens in `src/styles.css`. Chat and browser nodes are still placeholders.
- **Phase 2, monorepo**: `apps/client`, `apps/server`, `packages/contracts` (zod 4). The client
  talks only through `src/transport` (WebSocket, reconnect with backoff). CI runs check, build
  and test on ubuntu and macos.
- **Phase 3, daemon** (`apps/server`): `Bun.spawn({ terminal })` PTYs, one `@xterm/headless`
  per session so the daemon owns the screen, output coalesced per 16 ms, snapshots under
  `$RUIMTE_HOME/sessions` with atomic writes, 42 tests with real shells,
  `bun run --cwd apps/server smoke`.
- **Phase 4, terminal node**: xterm 6 with WebGL and a DOM fallback, reattach after
  reconnect, viewport culling with a static plate after 10 s offscreen, exit bar with Restart,
  session status in the sidebar, a Playwright e2e in `apps/client/e2e`.

- **Phase 5, agent status via hooks**: the daemon installs command hooks for Claude Code and
  Codex at startup (`--no-hooks` to skip), receives them on `POST /hooks/<kind>` with a
  per-session bearer token from the shell's environment, and folds them into `running`,
  `needs-you`, `idle`, `error`. `session.status` events feed the sidebar, node header and the
  dock's status summary; an OS notification fires for needs-you when the window is not
  focused. Agent records live in `sessions/<id>.agent.json`; after a daemon restart the client
  calls `agent.resume`, which types `claude --resume <id>` into the restored shell.
- **Phase 6, chat node**: `claude -p` on the stream-json protocol, spawned by the daemon on
  the first message and kept alive between turns (`apps/server/src/chat`). Thread items go
  over `chat.event`; `chat.attach` answers the whole thread so a reload rebuilds it; threads
  persist in `chats/<id>.json`. "Open in chat" on a terminal with a Claude agent and "Open in
  terminal" on a chat continue the same CLI session in the other kind of node.
- **Phase 6b, the chat the way T3 Code does it** (studied, then written from scratch):
  a model catalog with generic option descriptors (`apps/server/src/providers`), one runtime
  mode vocabulary (`supervised`, `auto-accept-edits`, `auto`, `full-access`) plus plan or
  build, turns as items so a settled turn folds behind "Worked for 12s", runs of tool calls
  folded into "Read 4 files", a changed-files card per turn with the diffs behind it, markdown
  with shiki, and a floating glass composer: model picker, option picker, mode picker, plan
  toggle, context ring with compact, slash menu, prompt recall with the arrow keys, drafts in
  localStorage. Pending approvals and questions dock on top of the composer, never in the
  transcript; only their outcome stays as a line. `@` opens a file picker over the chat's
  folder (chips in the text and in the timeline), and images pasted or dropped into the
  composer go along as attachments; drafts keep both. A running tool shows "running for 12s"
  on its line (the timer counts from the CLI's `tool_progress` start when one came, else from
  the item's own timestamp) and, for a provider that streams partial output, the last lines
  under it; the reducer folds `tool_progress` and `task_started` into an optional `progress`
  on the tool item and `fake-claude.ts` emits both on `run: <cmd>`.

- **Phase 1, remaining checklist**: command palette on Cmd+K (jump to a node, every app
  action), Option+T/C/B/G add nodes, Cmd+G wraps the selection in a group, Cmd+, opens
  settings. A group node is a dashed frame under its nodes that drags whatever sits inside it
  (`carriedByGroups` in `state/canvas.ts`), groups always paint below other nodes and stay out
  of the sidebar. Rename by double-click in the node header and in the sidebar. Node frames
  are focusable, Enter steps into one, every control has a visible keyboard focus ring. Text
  elements join box selection with Shift. No minimap: the sidebar and the palette cover
  jumping around; decide again once real projects have many nodes.

- **Settings, the way T3 Code lays them out** (studied, then written from scratch): one
  dialog with a section list on the left (Base UI Tabs, arrow keys move, `activateOnFocus`)
  and a pane on the right, built from `SettingsSection` (a titled card) and `SettingsRow`
  (label and description left, control right) in `apps/client/src/shell/settings/`.
  Sections: Appearance (theme, accent, terminal font and font size; the size lives in
  `state/settings.ts` and every terminal refits on change), Canvas (zoom presets, locks and
  layouts, all acting on the open canvas, nothing stored), Agents (the remembered defaults for
  a new chat from `chat/preferences.ts`, now a zustand store the composer and the dialog
  share, plus the providers the daemon found), Machines (a thin frame around
  `EndpointsSection`), Keyboard (a searchable read-only list: commands with a chord from
  `commands.ts` plus the canvas chords `Canvas.tsx` binds by hand, mirrored in
  `settings/shortcuts.ts`), About (version from `server.hello`, the machine, links).
  `useUi.setSettings({ open, section })` opens it on a section; the palette has "Keyboard
  shortcuts" and "Machines" entries that do. Canvas chords are off while the dialog is up, so
  Backspace in it cannot delete nodes. `RUIMTE_DAEMON` points the Vite proxy at another
  daemon for a second dev setup.

- **Phase 8, projects and persistence**: `apps/server/src/projects` owns the registry
  (`projects.json`), the canvas files and a directory watcher per open project. The client
  (`apps/client/src/project`) saves edits 400 ms after the last one against the rev it loaded,
  the camera a second after it stops moving into the machine-local file, and shows a banner
  with "Take the file" or "Keep mine" when the file changed under unsaved edits. Folders are
  picked the way T3 Code does it: type a path in the command palette (`/`, `~/`, `./`) and it
  lists the daemon's directories (`fs.browse`), Enter steps in, Cmd+Enter opens the typed path
  as a project; the native dialog comes with Electron as an extra. "Open in Finder" (label from
  the daemon's platform: Finder, Explorer, Files) sits in the project menu, the palette and a
  node's context menu, through `fs.reveal`. The project menu also creates canvases without a
  folder, closes (sessions keep running) and deletes with a confirm. Undo and redo
  (Cmd+Z, Cmd+Shift+Z) cover placement, adding and deleting; the history resets when another
  project loads. Node ids are random now, since they end up in a shared file.

- **Phase 7, Electron shell and browser node**: `apps/desktop` is a small main process
  (`src/main.ts`) plus a preload that exposes `window.ruimteDesktop` (platform, native folder
  dialog, open external, guest devtools). `bun run dev:desktop` opens the window against the
  Vite dev server while `bun dev` runs; without `RUIMTE_DEV_URL` the shell spawns the daemon
  from the repo through bun with `--serve apps/client/dist`, so one origin serves client and
  socket (a packaged app runs the compiled daemon from its resources, phase 11). Browser nodes are `<webview>` elements owned by
  `apps/client/src/browser/registry.ts` and positioned by `WebviewLayer` over the canvas in world
  space; they are created once and never re-parented, and a project switch only hides them, so
  a form keeps what was typed. The layer passes pointer events to a page only while its node is
  focused and no canvas gesture is running. Inspect opens the guest's devtools in a window of
  ours that stays above a fullscreen app. `electron-updater` reads the feed electron-builder
  writes into a packaged app; a checkout skips it. `bun run --cwd apps/desktop smoke` boots the
  shell, adds a browser node through the keyboard and waits for its page to load. The title
  bar follows T3 Code: `hiddenInset` with the traffic lights at (16, 18) on macOS and a native
  controls overlay elsewhere, the sidebar's top strip is the drag region (children reset to
  `initial`, controls `no-drag`), the inset is only applied outside fullscreen (the shell sends
  `window:fullscreen`), and the overlay colors follow the client's theme over IPC.

- **Phase 9, groups, worktrees, context links and layouts**: groups nest (a group inside a
  group carries its members along), collapse to their header with the members hidden and
  remembered (`memberIds`), and bind to a git worktree from their context menu
  (`apps/server/src/git/worktrees.ts` makes it under the app data dir); a node made inside such
  a group starts in that checkout. Edges are drawn from a port on a selected node or text to a
  terminal or chat node (only agent nodes can be targets), hover shows a delete button, a
  double-click on the label edits it, clicking an edge selects it for Delete. The client
  derives from the edges what each agent may read and tells the daemon (`context.set`); the
  agent reads it with `ruimte-context`, a bun script the daemon puts on the PATH of every shell
  and chat, over `GET /context` with the session's token. Layouts are named arrangements saved
  from the palette and applied or deleted from there.

- **Phase 10, remote endpoints and pairing**: `apps/server/src/auth` holds session tokens as
  hashes, one-time pairing tokens with a ten-minute life, origin and loopback rules
  (`access.ts`), and a `Relay` seam that does nothing yet. The daemon prints a pairing URL when
  it listens beyond loopback; `bun src/main.ts pair` mints another through a loopback-only
  route. The client keeps endpoints in localStorage (`state/endpoints.ts`), pairs from the
  settings dialog by pasting the link (`endpoint/index.ts`), and switches by emptying the
  canvas first and pointing the one transport at the other daemon; the project client boots
  again on the new socket. The header names the machine when it is not loopback. The
  settings dialog lists the clients paired with the active daemon (`auth.sessions`) with a
  revoke per row behind a confirm; revoking the client's own session forgets the endpoint and
  goes back to the loopback daemon. On a loopback daemon "Show pairing link" asks
  `auth.pairingToken` (loopback only, the socket twin of `POST /auth/pairing-token`) and
  shows the URL with a copy button, plus a hint when the daemon only listens on loopback.
  `bun run serve` is the Server Edition. Tested by pairing this client with a second daemon on the LAN
  address of this machine and switching both ways.

Issues #1 to #10 on GitHub describe each phase; #2, #3 and #4 are closed, #1 and #5 to #10
are implemented but wait for a review before closing.

Research on showing a live browser page without a `<webview>` (for the web build and remote
daemons) is in `docs/research/browser-streaming.md`: the recommendation is a headless
Chromium owned by the daemon with CDP `Page.startScreencast` JPEG frames over our socket and
input back through CDP, behind a `BrowserBackend` seam next to the webview registry. Not
started; it fits after #10, when a remote daemon makes it worth its weight.

- **Phase 11, packaging and releases**: `apps/server/scripts/compile.ts` turns the daemon into
  one Bun executable per platform (`dist/<os>-<arch>/ruimte`, folder names are electron-builder's
  macros) with the `ruimte-context` shell script next to it; `ruimte pair` and `ruimte context`
  are subcommands of that binary, so `src/main.ts` is a dispatcher and the daemon lives in
  `src/daemon.ts`. The desktop app (`apps/desktop/electron-builder.yml`) puts that folder and the
  built client in its resources outside the asar, spawns `bin/ruimte --serve client` from there
  when packaged, asks the login shell for its PATH once (an app from the Dock has none), and logs
  the daemon to the app's log directory. `bun run dist` at the root builds everything for this
  machine; `.github/workflows/release.yml` builds macOS (arm64 and x64) and Linux (AppImage and
  deb, both arches) on a `v*` tag, stamps the tag's version into the app and the daemon, and
  uploads a draft GitHub release with the update manifests. Signing and notarization run when the
  secrets exist (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`); without them the build is unsigned and says so. `site/` is the landing page
  for ruimte.app, published to GitHub Pages by `site.yml`. No telemetry, nothing phones home
  except the update check against the release feed.

## Decisions that are not in the code

- No kanban view, ever. Bas dislikes that workflow.
- No bare single-letter shortcuts. Every chord needs a modifier and becomes remappable in a
  later settings phase; until then the Keyboard section only lists them.
- Never highlight the canvas grid in the accent color. The dots stay neutral in every state.
- Icon buttons get equal padding on every side. Buttons that belong together sit in a
  `.btn-group` with 1px gaps; groups keep the wider gap of their container.
- Tooltips are the `Tooltip` component in `src/ui/Tooltip.tsx`, never a `title` attribute.
  One `TooltipProvider` at the app root gives the shared 150 ms delay.
- Escape leaves node mode unless a terminal node has "Send Escape to the app" on (its context
  menu; `escapeToApp` in `project.json`, an "Esc" chip in the header). Cmd+Escape and
  Ctrl+Escape always leave, so a node can never trap the keyboard. On Windows Ctrl+Escape is
  the Start menu, so a Windows build needs another always-works chord.
- Formatting is prettier (`.prettierrc`: single quotes, width 160, 4 spaces). Run
  `bun run format` before a commit.
- Status hooks are `command` hooks with curl, not Claude Code's `http` hooks: the http kind
  cannot read the daemon's port from the environment and reports an error whenever Ruimte is
  not running. The command hook is a no-op without `RUIMTE_HOOK_URL`.
- A chat process is not started when the node mounts, only on the first message, so a canvas
  full of chat nodes costs nothing until used.
- The demo canvas is gone. A fresh install boots into an empty "Untitled canvas" project; the
  last opened project id lives in localStorage.
- Terminal and chat nodes without their own directory start in the project folder.
- Switching or closing a project swaps the canvas with `loading` set, which the session
  lifecycle reads as "not a delete": nothing is killed. Deleting a node still kills its session.
- New chats start in full access, as in T3 Code; the composer remembers the last model and
  modes in localStorage. A supervised chat is one click away in the mode picker.
- A model or mode change restarts the CLI process with `--resume` on the next send instead of
  using the control protocol's `set_model`; one path, and the resumed session keeps everything.
- Fast mode is not offered: the installed CLI has no flag for it, only the `/fast` command.
- Claude Code 2.1.266 emits `tool_progress` (`tool_use_id`, `tool_name`, `parent_tool_use_id`,
  `elapsed_time_seconds`, `task_id`, `heartbeat`) for a local Bash only when
  `CLAUDE_CODE_REMOTE` or `CLAUDE_CODE_CONTAINER_ID` is set, throttled to one per 30 s, and
  it never streams partial Bash output. Neither variable is set on purpose: both change other
  behavior (headers to Anthropic, temp dir checks). The live timer therefore counts on the
  client, and partial output is plumbing for a provider that has it (Codex streams command
  output).
- The Codex chat backend (app-server protocol) is not built; only the Codex hooks are. The
  Agent submenu opens Codex, Gemini and Copilot as terminals with the CLI typed in.
- `@file` mentions are plain `@path` text in the prompt, because that is what the Claude CLI
  expands itself (checked with `claude -p` 2.1.266); the chosen paths travel next to the text
  as `mentions` only so the timeline can draw them as chips. The picker searches through
  `fs.search`: `git ls-files` (tracked plus untracked, minus .gitignore) inside a repo, a
  bounded walk elsewhere, ranked by a small fuzzy score on the daemon.
- Image attachments go over the wire as base64 in `chat.send` (5 MB and 8 per message, the
  API's own limits) and become `image` content blocks in the CLI's stream-json `user` frame,
  the Anthropic API shape passed through as is. The user item keeps the full data, so the
  thread file and `chat.attach` grow with every image; move them to files under the app data
  dir when that starts to hurt. No `$skills` in the composer yet.

## Gotchas already paid for

- React registers `wheel` listeners as passive. Pinch zoom needs the native, non-passive
  listener in `Canvas.tsx`, and the document-level guard keeps a pinch over the sidebar from
  zooming the page.
- A `mousedown` after `pointerdown` moves focus to `body` after the node's focus effect ran.
  The body-click branch in `Canvas.tsx` calls `preventDefault` for that reason.
- A zustand selector that builds a new array or object each call (`Object.keys(...)`) loops
  forever under `useShallow`. Select the object and derive with `useMemo`.
- Tailwind's `dark:` variant follows `data-theme`, not the OS (`@custom-variant` in
  `styles.css`).
- `bun test` would pick up the Playwright spec; `bunfig.toml` excludes `e2e/`.
- The stream-json `assistant` frames arrive one content block at a time under the same
  message id, and their block index does not match the streaming index. Text items are keyed
  by process generation, message id and the ordinal of the text block (`claude-stream.ts`);
  the generation is there because a resumed process numbers its messages from the start again.
- `AskUserQuestion` arrives as a `can_use_tool` request; the answer is an allow with
  `updatedInput.answers` keyed by the question text, not by an id.
- `@pierre/diffs` marks itself side-effect free, so `import '@pierre/diffs/worker/worker.js'`
  in a worker entry is tree-shaken to nothing. The pool uses Vite's `?worker` import instead.
- `bun --watch` restarts the daemon on every file change and the daemon installs hooks at
  startup, so editing the server while `bun dev` runs also rewrites the hook settings (idempotent).
- A terminal inside another Electron app (an IDE, an agent shell) exports
  `ELECTRON_RUN_AS_NODE`, which turns `electron .` into plain Node where `require('electron')`
  is a path string. `apps/desktop/scripts/launch.ts` clears it before spawning Electron.
- Bun's CommonJS interop copies enumerable keys, and electron's exports are getters; the main
  process uses a plain `require('electron')` for that reason.
- Bun does not run Electron's install script unless it is in `trustedDependencies` (root
  `package.json`); without it `node_modules/electron/dist` is missing and nothing starts.
- `ruimte-context` is a shell script: next to a compiled `ruimte` it runs `ruimte context`,
  in a checkout it runs the source through bun, so a checkout still needs bun on the PATH.
- Bun 1.4 leaves a `bun build --compile` executable with an invalid code signature on macOS; the
  kernel kills it at launch (exit 137, even for hello world). The compile script re-signs it
  ad hoc, and electron-builder signs it again with the real identity.
- electron-builder copies `extraResources` from a folder that does not exist without a word;
  `build/after-pack.cjs` fails the build when the daemon or the client is missing. The arch
  is a command-line flag for the same reason: a daemon is compiled per arch on purpose.
- Electron names its log and user-data folders after `package.json`'s `name` unless
  `productName` is set, which gave `~/Library/Logs/@ruimte/desktop`.
- The update feed is the GitHub release of a private repository, which electron-updater cannot
  read without a token; the repository goes public with the first release, or the feed moves to
  ruimte.app (`publish.provider: generic`).
- How an agent learns that `ruimte-context` exists (`apps/server/src/context/context-note.ts`):
  a chat gets a sentence in its system prompt when it has links at process start and a note in
  front of the next prompt when the set changed between turns (also shown as an info note in
  the thread); a shell that has links when it is created gets one dimmed line above its first
  prompt (on the screen only, never typed into the PTY); a Claude Code agent inside a shell
  gets the hint as `additionalContext` from its `SessionStart` and `UserPromptSubmit` hooks,
  which is why the hook command prints curl's reply now. A link made while a shell is already
  running is only visible as the "context" chip in the node header and to the hooks. The
  shell's line depends on `context.set` reaching the daemon before `session.create`; on a
  fresh project load the client's sync (300 ms settle) can lose that race, so the chip and the
  hooks are the ones to rely on.

## Next

In the order that makes sense, each one an issue on GitHub:

1. **#5 and #6 follow-ups**: a Codex chat backend on the app-server protocol, real partial
   tool output once a provider streams it (the thread, the contract and the live row already
   take a `delta` on a tool item), and per-turn checkpoints so the changed-files card can show
   real diffs against the working tree instead of the edit's before and after. Mentions,
   attachments and the "send Escape to the app" toggle are done.
2. **#7 follow-ups**: a webview keeps the canvas's z-order only by being above everything, so
   a node dragged over a browser node slides under its page; the traffic-light inset is fixed,
   not measured; no Windows or Linux run yet.
3. **#9 follow-ups**: the mid-conversation note, the shell's first-prompt line and the hook
   answer are done (see the gotcha above). Left: Codex inside a terminal gets no hint, since
   its hook output contract is not verified; and a link made while a shell already runs could
   be announced at the next shell prompt without typing into the PTY (a `precmd`/`PROMPT_COMMAND`
   probe of a daemon-owned flag file), which was judged too invasive for now.
4. **Settings follow-ups**: remappable chords (the Keyboard pane is the natural home), a
   "restore defaults" action once there is more than a handful of stored values, and the
   canvas font size for chat and text elements if anyone asks for it.
5. **#10 follow-ups**: one endpoint at a time is the model; a project list that spans machines
   would need a transport per endpoint. TLS is a reverse proxy's job and is only documented.
6. **#11 follow-ups**: put the Apple secrets in the repository and tag `v0.1.0` to get the
   first signed, notarized build (the local `bun run dist` already signs with the Developer ID
   in the keychain); enable Pages with source "GitHub Actions" and point ruimte.app at it; the
   30-second video for the landing page; Windows (the daemon on Bun's Windows PTY or Node with
   node-pty); an app icon that is more than a placeholder; the daemon as a background service
   so closing the app keeps sessions alive.

Known gaps to keep in mind: no WebGL context budget (many visible terminals may lose
contexts), no backpressure for a slow client, the 30-node performance target is unmeasured.
