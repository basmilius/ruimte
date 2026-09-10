# Handoff

State of Ruimte on 2026-09-10, written for whoever picks this up next (human or agent). Read
`CLAUDE.md` first for the rules; this file says where things are and how the code got that way.
`docs/PLAN.md` says what comes next.

## What works today

Run `bun run dev` at the root (daemon on 4210, client on 5173), open the client, click a
terminal body, type. Reload the tab: the shell is still running with its screen. Stop the
daemon and start it again: the scrollback comes back with a `[session restored]` marker.

- **Phase 1, UI prototype** (`apps/client`): sidebar, floating dock, custom canvas with
  canvas/node modes, live grid snapping, per-aspect locks, zoom presets menu, node context menu
  with a color submenu, text elements, Base UI tooltips with a shared provider, light and dark
  tokens in `src/styles.css`. Chat and browser nodes arrived in phases 6 and 7.
- **Phase 2, monorepo**: `apps/client`, `apps/server`, `packages/contracts` (zod 4). The client
  talks only through `src/transport` (WebSocket, reconnect with backoff). CI runs check, build
  and test on ubuntu and macos.
- **Phase 3, daemon** (`apps/server`): `Bun.spawn({ terminal })` PTYs, one `@xterm/headless`
  per session so the daemon owns the screen, output coalesced per 16 ms, snapshots under
  `$RUIMTE_HOME/sessions` with atomic writes, tests with real shells (`bun test` at the root
  runs 338 across 48 files today),
  `bun run --cwd apps/server smoke`. A socket that falls behind (over 1 MB queued, or a frame
  Bun reports as dropped or backpressured) stops getting `session.output`; on `drain` every
  session that lost bytes gets a `session.resync` with a fresh screen and streams on
  (`src/backpressure.ts`), so a slow client costs a repaint instead of the daemon's memory.
- **Phase 4, terminal node**: xterm 6 with WebGL and a DOM fallback, reattach after
  reconnect, viewport culling with a static plate after 10 s offscreen, exit bar with Restart,
  session status in the sidebar, a Playwright e2e in `apps/client/e2e`. A budget of 10 live
  WebGL contexts keeps a zoomed-out canvas under what a browser holds
  (`DEFAULT_WEBGL_CONTEXTS` in `terminal/webgl-slots.ts`, later a setting): the ranking is the
  focused terminal, then the ones most recently focused or written to, and the rest draw with
  the DOM renderer until a slot frees up. `terminal/webgl-budget.ts` turns that into addons
  loaded and disposed (a refit on every swap, `window.ruimte.webglContexts()` to see who
  holds one); the ranking itself is pure and tested in `webgl-slots.test.ts`.

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
- **Phase 6b, the chat** (designed and written from scratch):
  a model catalog with generic option descriptors (`apps/server/src/providers`), one runtime
  mode vocabulary (`supervised`, `auto-accept-edits`, `auto`, `full-access`), turns as items
  so a settled turn folds behind "Worked for 12s", runs of tool calls
  folded into "Read 4 files", a changed-files card per turn with the diffs behind it, markdown
  with shiki, and a floating glass composer: model picker, option picker, mode picker,
  context ring with compact, slash menu, prompt recall with the arrow keys, drafts in
  localStorage. The model picker shows the provider's mark plus the short model name
  plus a chevron as the trigger, a search field over the popup, a group per provider with its
  glyph, the legacy models behind an expander, arrow keys and Enter, and `/model` in the slash
  menu opens it. A chat without a fixed provider lists the models of every installed chat CLI,
  and picking another CLI's model before the first message re-points the chat at it
  (`chatClient.retarget` drops the empty chat and registers it again, since the daemon fixes a
  chat's provider at `chat.create`). A chat opened from "Agent (Chat)", the canvas menu or the
  palette carries `providerFixed` on its node and shows a read-only badge instead of the picker.
  After the first message the provider is locked but the models stay switchable: the next send
  restarts the CLI with `--resume` anyway. There is no build or plan toggle: `/plan`, `/build`
  and `interactionMode` are gone, and plan-style work goes through the prompt until a
  proposed-plan card earns its own phase. Pending approvals and questions dock on top of the composer, never in the
  transcript; only their outcome stays as a line. `@` opens a file picker over the chat's
  folder (chips in the text and in the timeline), and images pasted or dropped into the
  composer go along as attachments; drafts keep both. A running tool shows "running for 12s"
  on its line (the timer counts from the CLI's `tool_progress` start when one came, else from
  the item's own timestamp) and, for a provider that streams partial output, the last lines
  under it; the reducer folds `tool_progress` and `task_started` into an optional `progress`
  on the tool item and `fake-claude.ts` emits both on `run: <cmd>`. The changed-files card shows
  real diffs now: a turn takes a checkpoint of the chat's folder when it starts (a git tree written
  through an index of ours under `$RUIMTE_HOME/checkpoints`, so the person's index and stashes stay
  untouched, `apps/server/src/git/checkpoints.ts`), and when the turn settles the daemon puts the
  diff of the working tree against that tree on the turn item. The card prefers that diff, then the
  provider's own `changes`, then the edit's before and after; `chat.turnDiff` answers a turn whose
  diff has not arrived, which is also how a client asks while a turn runs.
- **Phase 6c, Codex chat backend and one session for every CLI**: a chat node with
  `provider: 'codex'` runs `codex app-server` (JSON-RPC over stdio). Approvals for commands and
  file changes, both kinds of Codex question (blocking `request_user_input` and the async one
  that arrives as an agent message), interrupt, compact, model and effort, the runtime modes as
  approval policy plus sandbox, restart with `thread/resume`. Both CLIs sit behind one seam now:
  `ChatSession` owns the thread and the turns for every provider, a `ChatBackend`
  (`claude-backend.ts`, `codex-backend.ts`) owns one process and its protocol and reports
  `BackendEvent`s, the frame mapping is pure and tested on its own (`claude-protocol.ts`,
  `codex-protocol.ts`), and `ThreadProjector` is the only writer of thread items. Each CLI is a
  `ChatProvider` value (`apps/server/src/providers/*-provider.ts`) with its catalog, its
  capabilities and its resume template, which the client reads from `provider.list` instead of
  branching on the kind. `fake-claude.ts` and `fake-codex.ts` stand in for the CLIs in tests.
  The Agent submenu lists the providers the daemon has; "Open in chat" and "Open in terminal"
  work for both CLIs.

- **Phase 1, remaining checklist**: command palette on Cmd+K (jump to a node, every app
  action; the last five commands come back under "Recent" on an empty query,
  `shell/palette-recents.ts` in localStorage, and the field is a real combobox over the option
  list), Option+T/C/B/G add nodes, Cmd+G wraps the selection in a group, Cmd+, opens
  settings. A group node is a dashed frame under its nodes that drags whatever sits inside it
  (`carriedByGroups` in `state/canvas.ts`), groups always paint below other nodes and stay out
  of the sidebar. Rename by double-click in the node header and in the sidebar. Node frames
  are focusable, Enter steps into one, every control has a visible keyboard focus ring. Text
  elements join box selection with Shift. No minimap: the sidebar and the palette cover
  jumping around; decide again once real projects have many nodes.

- **Collapsible sidebar**: `useUi.sidebarOpen` (localStorage `ruimte.sidebar`, machine state,
  never in `project.json`) shows and hides the session list. The `<aside>` is a wrapper that
  animates its width between 248 and 0 in 200 ms over a fixed 248px inner column, so nothing
  reflows on the way out; it keeps its children mounted and goes `inert` while closed, and
  `prefers-reduced-motion` drops the motion through the global rule in `styles.css`. One
  `SidebarToggle` moves between the sidebar strip and the toolbar: both apply the traffic-light
  inset through `useTrafficLightInset()` (`desktop/useFullscreen.ts`), so the button sits at the
  same x either way and reads as one control that stays put. The `Brand` lockup stays in the strip,
  centered in what the traffic lights leave of it, and goes with the list; only the
  `ConnectionDot` moved to the toolbar, so the connection stays readable while the list is gone.
  Cmd+B toggles it from the app-wide chord block in `Canvas.tsx`, so it works from inside a node;
  off macOS Ctrl+B belongs to readline and tmux, so there it only fires outside node mode. The
  palette has "Toggle sidebar". The rows are 32px, grouped by status through
  `shell/sidebar-rows.ts` (a pure list module with its own tests), and they carry a roving
  tabindex: Tab reaches one row, Up and Down walk the list in reading order without wrapping,
  F2 renames and the selected row is `aria-current`. The footer button says "New terminal",
  which is what it opens; agents and chats are one plus away in the dock. An empty list says so
  instead of showing nothing.

- **Toolbar and panel slot**: `apps/client/src/shell/Toolbar.tsx` is a 48px bar at the top of
  the canvas column, next to the sidebar's strip, `bg-surface` with a bottom border and the drag
  region. Left is the breadcrumb: the machine when the daemon is not loopback, the
  `ProjectMenu` as a ghost button (it left the sidebar), "Canvas" and the unsaved dot; the
  floating chip over the canvas is gone and `ProjectBanner` now floats under the bar. Right is
  the `ConnectionDot` and `shell/PanelControls.tsx`, the `.btn-group` of Files and Git over
  `useUi.panel` (machine state, never in `project.json`). `<main>` is a row of the canvas column
  and `shell/Panel.tsx`, so the panel spans the full height and its own 48px header (a drag
  region, with the panel's name and a close button) continues the band the sidebar strip and the
  toolbar start. `PanelControls` renders in the toolbar while the panel is closed and in the
  panel's header once it is open, at the same x, and the overlay-controls inset on Windows and
  Linux travels with it. The panel stays mounted and animates its width between 0 and the stored
  width in 200 ms over a fixed inner column; a resize drag sets `[data-resizing]`, which turns the
  transition off, and the contents unmount when the closing transition ends (immediately under
  reduced motion). Resizable from its left edge, min 360 and default 540 in localStorage
  (`ruimte.panel.width`). Cmd+Alt+B toggles the panel that was open last; the palette keeps
  "Toggle files panel" and "Toggle git panel". The file browser and the git panel themselves are
  the next phase.

- **Settings** (written from scratch): one
  dialog with a section list on the left (Base UI Tabs, arrow keys move, `activateOnFocus`)
  and a pane on the right, built from `SettingsSection` (a titled card) and `SettingsRow`
  (label and description left, control right) in `apps/client/src/shell/settings/`. The controls
  are `settings/controls.tsx` (`Segmented`, `Toggle`, `Stepper`, `Badge`) plus `ui/Select.tsx`,
  one Base UI `Select` in the `.menu-popup` style the menus use, with a description, an icon and
  groups per item. It is the only dropdown of its kind: the composer's `ModePicker` uses it too,
  there is no native `<select>` left, and the model picker, the options menu and the dock menus
  stay the custom popups they are.
  Sections: Appearance (theme, accent, interface font size, terminal font and font size; the
  sizes live in `state/settings.ts`, the interface one sets the root font size and every
  terminal refits on a change of its own), Canvas (zoom presets, locks and
  layouts, all acting on the open canvas, nothing stored), Agents (the remembered defaults for
  a new chat from `chat/preferences.ts`, now a zustand store the composer and the dialog
  share: one model row per provider with that model's knobs under it, the permissions a chat
  starts in and the mode a terminal agent starts in, plus the providers the daemon found),
  Machines (a thin frame around
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
  picked in the command palette: type a path (`/`, `~/`, `./`) and it
  lists the daemon's directories (`fs.browse`), Enter steps in, Cmd+Enter opens the typed path
  as a project; the native dialog comes with Electron as an extra. "Open in Finder" (label from
  the daemon's platform: Finder, Explorer, Files) sits in the project menu, the palette and a
  node's context menu, through `fs.reveal`. The project menu also creates canvases without a
  folder, closes (sessions keep running) and deletes with a confirm. Undo and redo
  (Cmd+Z, Cmd+Shift+Z) cover placement, adding and deleting; the history resets when another
  project loads. Node ids are random now, since they end up in a shared file.
  A project has an identity: `name` and an optional `icon` (an emoji or one of 40 Lucide names)
  in the canvas file, and everything else read from the folder. Without a chosen icon the daemon
  walks `.ruimte/icon.*`, `.idea/icon.*`, `.vscode/icon.*`, the usual favicon paths and the
  `<link rel="icon">` of a root `index.html`, jailed inside the folder, typed by magic bytes,
  capped at 256 KB, and falls back to the first letter on the project color. The name is seeded
  once: a folder that gets its first canvas takes what `.idea/.name` declares, and from then on
  the name lives in `project.json`, where only "Rename project" changes it, so an editor renaming
  its own project never renames ours. Bytes travel over `GET /projects/<id>/icon?v=<version>`
  (the same access rules as the socket, `nosniff`, a `default-src 'none'` policy for SVG), never
  as a data URL on the wire. `ProjectGlyph` draws it in the breadcrumb, the project menu and the
  palette's project rows, `document.title` becomes `<name> - Ruimte` (which is the Electron
  window title too), and the project menu renames and sets the icon: an emoji, the Lucide grid,
  an image that `project.setIcon` writes to `.ruimte/icon.<ext>`, or the folder's own again.
  Derived answers are cached for five minutes per folder and re-read on `project.open`; the
  watcher covers `.ruimte/icon.*` and ships a `project.summary` event, so an icon dropped in by
  hand shows up while the app is open.

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
  bar is `hiddenInset` with the traffic lights at (16, 18) on macOS and a native
  controls overlay elsewhere, the sidebar's top strip and the toolbar next to it are both drag
  regions and together make one 48px band (children reset to `initial`, controls `no-drag`),
  the traffic-light inset comes from `useTrafficLightInset()` and belongs to the leftmost strip
  (the sidebar's when it is open, the toolbar's when it is closed), only outside fullscreen
  (the shell sends `window:fullscreen`), the rightmost strip keeps the width of the
  overlay controls free through `env(titlebar-area-*)` on Windows and Linux, and the overlay
  colors follow the client's theme over IPC.

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

Issues #1 to #10 on GitHub describe each phase and are all closed. Open: #11 (packaging and
releases), #12 (chat follow-ups) and #13 (browser node follow-ups).

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

- **Phase 12, notes and connections**: a `note` node (Option+N, the dock's Add menu, the
  canvas menu, the palette) is a sticky: markdown rendered with the chat's `Markdown`
  component, a textarea while the node has focus (click the body, Escape leaves), one of five
  colors from its context menu (`--note-*` tokens in `styles.css`, both themes,
  `canvas/note-colors.ts`), `body` and `color` in `project.json`. Linked into an agent it is a
  text source with its title and body (`context/sources.ts`), so `ruimte-context read <id>`
  prints it; a browser node linked in hands over its address the same way. Edges connect any
  node or text to any other now (`addEdge`), one line per pair whichever way it was drawn; the
  port shows on every selected node, groups included, and a drop on a text works too. A line
  into a terminal or chat is still the context edge (accent, dashed, labeled `context` by
  default); any other line is plain (solid, border color), unlabeled until a double-click on
  the line names it. "Connect to..." in a node's context menu starts the same draft from that
  node and waits for a click on a target (`linkDraft.aiming`, crosshair, Escape or a click on
  empty canvas cancels). `ProjectEdge` is unchanged.

- **Phase 13, one agent catalog for chat and terminal nodes**: the daemon's provider list is
  the only place an agent CLI is named. It holds Claude Code, Codex, Gemini and GitHub Copilot;
  `capabilities` says of each one whether it opens as a chat, as a terminal and whether the
  daemon understands its hooks. Gemini and Copilot are terminal only, so they launch, are
  titled and iconed, and show the session's own status; the hook receiver answers 404 for a
  kind without a normalizer and the installer skips it. The dock's plus menu and the canvas
  menu both show "Agent (Chat)" and "Agent (Terminal)" from one component
  (`apps/client/src/agents/AgentMenus.tsx`), in catalog order, a CLI the daemon did not find
  disabled with "Not installed"; the palette has `agent-chat-<kind>` and `agent-terminal-<kind>`
  commands, and a missing CLI opens Settings > Agents instead of failing. No new chords: "Chat"
  and Option+C open a chat without a fixed provider, whose picker lists every installed chat
  CLI; the menu rows and the palette open one that is fixed to the CLI it names. A terminal agent is launched by the daemon:
  `session.create` takes `agent: { kind, runtimeMode?, model?, resume? }` and
  `apps/server/src/providers/launch.ts` builds the line the shell gets, per CLI
  (`--permission-mode`, `--ask-for-approval` plus `--sandbox`, `--approval-mode`, nothing for
  Copilot). "Open in terminal" on a chat sends the CLI and the session id instead of a command
  line. One setting, "Terminal agents start in" (Settings > Agents, default full access), is
  saved on the node as `runtimeMode`, so a reload starts the same CLI the same way. The menus,
  the palette rows and an agent node's header show the CLI's brand mark from simple-icons,
  monochrome in `currentColor` (`agents/AgentIcon.tsx`).

## Feature decisions

Features worth weighing for the
canvas, against Ruimte, one verdict each.

| Feature | Ruimte | Verdict |
| --- | --- | --- |
| Terminal node, agent CLIs as terminals | Terminal node, chat nodes for Claude and Codex, and every CLI in the catalog as a terminal agent the daemon launches | Done, phase 13 |
| Sticky note (7 colors, markdown, title, agent reads it over a link) | Note node (5 colors, markdown, title, text source over an edge) | Done, phase 12 |
| Context links (agent to agent, sticky to terminal, drag from handles, delete by double-click) | Edges from any node or text to any other; into an agent they are context, "Connect to..." in the menu | Done, phase 12 |
| Group frame with a bound worktree | Group node with collapse, nesting and a worktree | Done |
| Browser node (navigable Chromium) and Web node (one page, fits content) | Browser node in the desktop app | Done; the fit-to-content web node is a browser node with a size, skip |
| Editor node (Monaco, image and PDF preview, Cmd+S) | None | Later: an agent's edits already show as diffs in the chat; a file viewer is worth it once the daemon has an upload and file index (the composer's `@` picker is the start) |
| Diff node (HEAD vs index vs worktree per file) | Changed-files card with the turn's checkpoint diff | Done for a turn; a standalone diff node for a folder is still later |
| Files node (folder listing pinned to one directory) | Folder browsing in the palette | Skip: the palette browses; a directory pane on the canvas invites a file manager, which is not the product |
| Subagent node (live card per Claude subagent from hooks) | Subagent tool calls fold into the chat's work rows | Later, only if hooks carry enough: a card per subagent on the canvas is a status view, and the chat's folded rows already show it |
| Loop node and Trigger node (cron and schedule into a terminal) | None | Skip: scheduling belongs to the agent's own tools or the OS; a canvas is not a scheduler |
| Video node (local or remote file) | None | Skip: a browser node plays a file URL |
| Image and PDF preview (inside the editor node) | None | Later, with the editor node |
| Dino minigame | None | Skip |
| Kanban board (separate view, session cards in columns) | None | Skip, a decision in this file: no kanban, ever |
| Spawn team (agents wired to their opener) | None | Later, phase 18: the chat backends, the edges and the worktrees it needs are there |
| Remote pairing and relay | Endpoints with pairing, tokens and origin checks | Done, relay is a seam |

## Decisions that are not in the code

- No kanban view, ever. Bas dislikes that workflow.
- No bare single-letter shortcuts. Every chord needs a modifier and becomes remappable in a
  later settings phase; until then the Keyboard section only lists them.
- Never highlight the canvas grid in the accent color. The dots stay neutral in every state.
- Icon buttons get equal padding on every side. Buttons that belong together sit in a
  `.btn-group` with 1px gaps; groups keep the wider gap of their container.
- The shared components in `src/ui/` are `Icon`, `Brand`, `Tooltip`, `Select`, `Button`
  (primary, secondary, ghost, danger; 28 and 32 pixels), `Pill` (the rounded label in a node
  header) and `EmptyState` (icon, one sentence, one action). A node's own "connecting" or
  "failed" card is `canvas/nodes/NodeNotice.tsx`. Every text input is `.field` in `styles.css`,
  one height and one focus ring; `.section-label` is the uppercase label outside a popup and
  `.menu-hint` the trailing hint inside one, with `<kbd>` left for chords only.
- The class rules in `styles.css` live in Tailwind's `components` layer. An unlayered rule beats
  every utility of the same specificity, so `icon-btn h-7 w-7` silently stayed 32 pixels and
  `menu-popup min-w-48` kept the wider default; inside the layer a call site's utility wins,
  which is what the heights in the code already claimed.
- What floats over what is four numbers in `styles.css`: dialog backdrop 80, dialog 90,
  `.popup-layer` 100 (every menu, select and popover positioner, so one opened inside a dialog
  is not swallowed by it), tooltip 110.
- An icon-only button gets its accessible name from its tooltip: `<Tooltip label="Close node"
  name>` puts the same string on `aria-label`, so the two can never drift apart.
- Every icon is a Lucide icon drawn by the `Icon` component in `src/ui/Icon.tsx`
  (`lucide-react`). The pixel box, the 1.75 stroke weight and the optical alignment live there, so
  a call site only picks the icon and its pixel size. An icon inline with 12px text is 12px, next
  to 14px text 14px, and a standalone icon button is 16px in a 28 or 32 pixel square. The agent
  CLIs' brand marks are simple-icons paths in `AgentIcon`; Codex has none, so it takes Lucide's
  `Bot`.
- The brand is the symbol from `assets/logo.svg` plus the word "Ruimte", drawn together by
  `src/ui/Brand.tsx` (`BrandSymbol` is the symbol on its own). The symbol is inline SVG, never
  an `<img>`, so it takes its two fills from `--brand-front` and `--brand-back`. The wordmark is
  always live text in Geist Semibold, never an outlined path.
- The brand gray scale is "iron", eleven steps in `styles.css` as `--color-iron-*`. It sits
  outside `@theme` on purpose, so there is no `bg-iron-*` utility and nothing can reach past the
  semantic tokens; the interface palette is unchanged and only `--brand-front` and `--brand-back`
  read from iron. Light is iron-300 on iron-900, the file's own colors. Dark keeps the front at
  iron-300 and lifts the back to iron-700, because the symbol's iron-900 back is darker than the
  dark surface it sits on and the shape would disappear.
- Icons and tiles (the favicon, `site/icon.svg`, `apps/desktop/build/icon.*`) carry fixed brand
  colors and never follow the theme: the silhouette on an iron-900 tile. The back shape there is
  the tile's own color, so what those tiles center is the visible silhouette, not the bounding
  box of both shapes.
- Geist is in the client for the wordmark only (`@fontsource-variable/geist`, imported once in
  `main.tsx`, family "Geist Variable" behind `--font-brand`). The interface font stays the system
  stack; no other text may use `font-brand`.
- No fractional pixels. Type sizes, paddings and stroke widths are whole numbers; a `rem` value
  has to land on a whole pixel at the 16px root, and an `em` at the size it inherits. Ratios
  (line height, opacity, letter spacing) are not lengths and stay as they are.
- One type scale, declared once in `@theme` in `apps/client/src/styles.css`, never a bracket
  size at a call site: `text-xs` is 12/16 for meta (hints, pills, kbd, tooltips, badges,
  counters, section labels), `text-sm` 14/20 for body (rows, inputs, menus, chat text, the
  composer, node titles), `text-base` 16/24 for dialog titles and markdown h2, `text-lg` 18/24
  for markdown h1. Nothing sits below 12px. The four are `rem`, so a change of the root font
  size moves text and the rem-based layout together.
- Code keeps a size of its own, `--text-code` (13px mono on a 20px line), for code blocks,
  inline code, diffs, tool output and the mono inputs. It is absolute, so it never scales twice
  with the root, and the terminal has its own `fontSize` setting (default 13) next to it.
- The interface font size (Settings > Appearance, 12 to 20, whole numbers, default 16) is the
  root `font-size` on `<html>`, written by `state/settings.ts`. Sizes fixed in world
  coordinates do not follow it: the node header stays `39px` (`GROUP_HEADER_PX`,
  `WebviewLayer`), because a header that moved would move every node's contents on the canvas.
- Tooltips are the `Tooltip` component in `src/ui/Tooltip.tsx`, never a `title` attribute.
  One `TooltipProvider` at the app root gives the shared 150 ms delay.
- Escape in a terminal node goes to the program (Claude Code interrupts on it, vim lives on it).
  Leaving the node is Cmd+Escape on macOS and Ctrl+Shift+Escape elsewhere, plus the dock's mode
  chip and a click on the canvas; the chord is `isLeaveNodeChord` in
  `apps/client/src/terminal/keymap.ts`, and the terminal's key handler swallows every other
  Escape before the canvas listener sees it. Chat, browser and note nodes still leave on plain
  Escape. Ctrl+Escape is the Windows Start menu and Ctrl+Shift+Escape is its Task Manager, so a
  Windows build still has no chord the OS leaves alone: the mode chip is the way out there.
- On macOS a terminal node has the line and word motions a native terminal has and xterm does
  not: Cmd+Left and Cmd+Right send Home and End in the form the application cursor keys mode
  asks for (`\x1b[H` / `\x1b[F`, `\x1bOH` / `\x1bOF` under DECCKM), Option+Left and
  Option+Right send `\x1bb` / `\x1bf`, and Cmd+Backspace sends Ctrl+U. `macMotionSequence`
  (`apps/client/src/terminal/keymap.ts`) is the whole mapping; the key handler writes the bytes
  itself and returns false, so xterm adds nothing and the chord never reaches the canvas. Other
  platforms keep their own conventions.
- An image icon is a file in the folder, never a blob in `project.json`: every save rewrites
  that file and every `project.changed` ships it, so 256 KB of base64 would ride along each time.
  A derived name or icon is never written back either, so the folder stays the one place that
  decides and a person can change it from outside the app.
- Formatting is prettier (`.prettierrc`: single quotes, width 160, 4 spaces). Run
  `bun run format` before a commit.
- A line between two non-agent nodes means nothing to the daemon; it is a drawing. Only the
  client's `context/sources.ts` decides what an edge means, from the target's kind, so the
  daemon never learns about plain lines and `ContextSource` needs no new kinds: a note travels
  as `text` with its title and body. Notes are not in the sidebar; that list is about what
  runs.
- "Connect to..." is a click mode, not a drag: the draft follows the pointer without a button
  held, because a menu item cannot hand over a pointer capture. Escape and empty canvas cancel.
- Status hooks are `command` hooks with curl, not Claude Code's `http` hooks: the http kind
  cannot read the daemon's port from the environment and reports an error whenever Ruimte is
  not running. The command hook is a no-op without `RUIMTE_HOOK_URL`.
- A chat process is not started when the node mounts, only on the first message, so a canvas
  full of chat nodes costs nothing until used.
- A turn's checkpoint diff compares two trees of ours, not the tree against the working tree:
  `git diff <tree>` only sees what git already tracks, so a file the agent created would be
  missing. The prompt waits for the checkpoint (a few milliseconds on a warm index), because a
  tree taken after the first edit is not a checkpoint. Nothing restores a checkpoint; going back
  would undo the person's own edits of that turn as much as the agent's.
- The demo canvas is gone. A fresh install boots into an empty "Untitled canvas" project; the
  last opened project id lives in localStorage.
- Terminal and chat nodes without their own directory start in the project folder.
- Switching or closing a project swaps the canvas with `loading` set, which the session
  lifecycle reads as "not a delete": nothing is killed. Deleting a node still kills its session.
- New chats start in full access; the composer remembers a model per provider
  (`selectionByProvider` in `chat/preferences.ts`) and the modes in localStorage, with the
  provider picked last as the default for a chat that names none. A slug only means something
  inside its own catalog, which is why the older global `selection` is dropped on read instead
  of mapped. A supervised chat is one click away in the mode picker.
- A model or mode change restarts the CLI process with `--resume` on the next send instead of
  using the control protocol's `set_model`; one path, and the resumed session keeps everything.
- `interactionMode` and `ProviderCapabilities.planMode` are off the wire (phase 15). A stored
  chat written before that keeps parsing: zod strips what the schema no longer knows.
- Fast mode is not offered: the installed CLI has no flag for it, only the `/fast` command.
- Claude Code 2.1.266 emits `tool_progress` (`tool_use_id`, `tool_name`, `parent_tool_use_id`,
  `elapsed_time_seconds`, `task_id`, `heartbeat`) for a local Bash only when
  `CLAUDE_CODE_REMOTE` or `CLAUDE_CODE_CONTAINER_ID` is set, throttled to one per 30 s, and
  it never streams partial Bash output. Neither variable is set on purpose: both change other
  behavior (headers to Anthropic, temp dir checks). The live timer therefore counts on the
  client, and partial output is plumbing for a provider that has it (Codex streams command
  output).
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
- A chat item id is the backend's own key for the item with the process generation in front
  (`1:toolu_x`), so a resumed CLI that numbers its messages from the start cannot overwrite an
  older item. An approval keeps `approval-<requestId>` as it was, since that id round-trips to
  the client; Codex's request ids carry the generation themselves, because its JSON-RPC ids
  start at 0 in every process.
- A model or mode change restarts the CLI for both providers, even though Codex takes the model
  per turn. One rule is easier to reason about than a per-provider one, and a restart with
  `thread/resume` keeps everything.
- Codex chats hear about linked context too: the app-server has no system prompt, so the
  `ruimte-context` sentence goes in front of the first prompt instead of on a flag.
- An async Codex question stays pending until the turn ends; there is no `chat.dismiss` yet,
  because the composer shows no difference between the two kinds of question.
- Codex runtime modes: `supervised` = `untrusted` + `read-only`, `auto-accept-edits` =
  `untrusted` + `workspace-write`, `auto` = `on-request` + `workspace-write`, `full-access` =
  `never` + `danger-full-access`. Not mapped: cost (Codex reports none), the deny reason, slash commands, permission-profile
  requests and MCP elicitations (refused with a JSON-RPC error). Gemini and Copilot open as
  terminals only; the daemon builds their launch line like every other CLI's.

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
- `WebglAddon.dispose()` puts the DOM renderer back but leaves its canvas to the garbage
  collector, so the browser keeps counting that context. The budget loses it by hand
  (`WEBGL_lose_context`) after the dispose, when the addon's own listeners are already gone.
- The stream-json `assistant` frames arrive one content block at a time under the same
  message id, and their block index does not match the streaming index. Text items are keyed
  by message id and the ordinal of the text block (`claude-protocol.ts`), and the projector puts
  the process generation in front, because a resumed process numbers its messages from the start
  again.
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
- The app-server frames have no `jsonrpc` field: `{ id, method, params }` out, `{ id, result }`
  or `{ id, error }` back, `{ method, params }` for notifications, and the server's own requests
  (approvals, questions) arrive with an `id` that starts at 0 for every process. Approval item
  ids therefore carry the process generation (`<generation>-<rpcId>`); Codex item ids are
  globally unique and are used as they are.
- Codex asks questions two ways. The blocking one is a server request
  (`item/tool/requestUserInput`); the async one is an `agentMessage` with `questions` and
  `delivery: "async"`, after which Codex polls with `sleep` items until a `turn/steer` arrives.
  Both are question items; the session answers the first by id and steers for the second.
- The decisions the real binary takes differ from its `availableDecisions` hint: `decline` is
  accepted even when the hint lists only `accept`, the amendment and `cancel`.

## Next

`docs/PLAN.md` holds the phases and their order. What is open here, in short:

1. **#12**: the Codex hook contract in a terminal (the other four boxes are done). On the
   checkpoints: no way back to one (a restore reads as a revert of the person's own work as
   much as the agent's), and the diff is of the whole folder, so an edit the person made
   during a turn lands in the card too.
2. **#13**: a webview keeps the canvas's z-order only by being above everything, so a node
   dragged over a browser node slides under its page; the traffic-light inset is fixed, not
   measured; no Windows or Linux run yet.
3. **#11**: the Apple secrets and a `v0.1.0` tag for the first signed, notarized build; Pages
   with source "GitHub Actions" so ruimte.app deploys; the landing video; Windows (the daemon
   on Bun's Windows PTY or Node with node-pty); a real app icon; the daemon as a background
   service so closing the app keeps sessions alive.
4. **A third chat provider** (Gemini, Copilot or opencode) as the proof that the backend seam
   holds: a provider value, a backend and a protocol mapper, plus one literal in `AgentKind`.
   Hooks for Gemini and Copilot are a day per CLI on top.
5. **Files and Git panels**: both render "Nothing here yet." A tree needs `fs.list` and
   `fs.read`, a status view needs `git.status` and `git.diff` (phase 17).
6. **Settings**: remappable chords (the Keyboard pane lists them read-only), a "restore
   defaults" action, a canvas font size for chat and text elements.
7. **Smaller ones**: a link made while a shell already runs is only visible in the header and
   to the hooks (a `precmd` probe was judged too invasive); a color or an arrowhead per plain
   line; a note's title as the first heading of its body; a per-project override of the
   terminal agent mode.

Known gaps to keep in mind: the WebGL budget is a fixed 10 contexts, not a setting and not
measured against what a given machine really keeps alive; the 30-node performance target is
unmeasured. Backpressure is handled per socket (output dropped over the high-water mark,
repaired with `session.resync` on drain); what is not there is a per-session cap, so one very
loud shell can still be the reason a client is dropped.
