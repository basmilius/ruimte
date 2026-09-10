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
  terminal" on a chat continue the same CLI session in the other kind of node. A turn does not
  have to start with a message: Claude Code wakes the agent itself when a background sub-agent
  settles (`task_notification`, a second `init`, an assistant message and a `result`, with no
  user frame in between), so content that arrives while no turn is open opens one with
  `origin: 'agent'`, the notification's summary as its label and a checkpoint of its own. The
  node goes back to running, the timeline shows "Sub-agent finished: <summary>" where a user
  bubble would be. That header is one line and stays one line: the CLI is free to hand its whole
  report as the summary, so the projector keeps the first line of it (`summaryLine`, 80
  characters) as the turn's label and the report itself goes to the sub-agent row, behind "Show
  result", where it renders as markdown. The fold and the changed-files card work as for any turn, and an OS
  notification fires when the window is not focused, the same rule as needs-you. A frame with a
  `parent_tool_use_id` belongs to the sub-agent's own row and never opens a turn; a message sent
  while such a turn runs settles it as stale instead of being refused as busy. A delegation is a
  `subagent` item of its own, keyed by the Agent call's `tool_use_id`: the row says what it is
  doing, for how long, whether it runs in the background and which tool it reached for last, and
  opening it shows the sub-agent's own tool calls and text in a bounded scroller with its report
  behind a "Show result" fold. The sub-agent's items stay top-level thread items with
  `parentToolUseId` (flat, not nested, so deltas keep working) and the timeline groups them under
  the row. The wake-up turn's "Sub-agent finished: ..." header is a button that scrolls to that row
  and opens it (`taskToolUseId` on the turn item). Codex has no unsolicited turn, but its
  `collabAgentToolCall` items are visible too: `spawnAgent` is a sub-agent row, the rest are tool rows.
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
  diff of the working tree against that tree on the turn item; `diffTrees` (`apps/server/src/git/diff.ts`)
  is where that comparison and its caps live, shared with the git panel's own diffs. The card prefers that diff, then the
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
  never in `project.json`) shows and hides the list of views. The `<aside>` is a wrapper that
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
  palette has "Toggle sidebar". The rows are 32px and come from `shell/sidebar-rows.ts` (a pure
  list module with its own tests) as one tree: a "Needs you" section over the whole project when
  something waits, with the view a node lives in named beside it, then the views in the order the
  file lists them, with the nodes of an open canvas under it. Only the canvas that is on screen is
  open, the rest folds out on its chevron, and a folded one keeps a count and the heaviest status
  of what it holds. The status grouping of the old flat list is gone: the order is the project's
  and the dock keeps the counters. Rows carry a roving tabindex: Tab reaches one row, Up and Down
  walk the list in reading order without wrapping, Left and Right fold a canvas, F2 renames, the
  view that is up and the selected node are `aria-current`. A chat and an agent terminal wear the
  mark of their CLI through `AgentIcon` instead of the glyph of their kind, in the same 16px slot;
  a plain terminal keeps `Terminal`, a page its favicon, a canvas `Frame`. A view row has a context
  menu (Rename, Duplicate for a canvas, Delete, which asks first when something in the view still
  runs) and drags to reorder: the pointer's y against the row midpoints says which gap it is asking
  for, a 2px accent line is drawn in that gap and the drop writes the order into the file; the
  nodes under a canvas are no gap a view can land in. A separator is a view of kind `separator` in
  the file: a 24px row of a 1px line that holds nothing, says nothing, never opens, is
  skipped by Cmd+1 to Cmd+9 and by the previous and next chords, and is no target for "Move node to
  view". It carries no name (the schema still allows one, which nothing writes and nothing reads),
  so it drags like any other row and its menu is Delete alone. A view that is one node carries that node's
  status and draft dot on its own row, and its menu offers "Put on canvas" where a canvas offers
  "Duplicate". The footer button says "New view" and opens the same choice the breadcrumb does: a
  canvas, a plain shell, an agent chat or terminal from the daemon's catalog, a page, or a
  separator; nodes are one plus away in the dock.

- **Connection tooltip**: the `ConnectionDot` says what it is showing. `shell/connection-info.ts`
  (a pure module with its own tests) writes the four lines: the state (Connected, Reconnecting with
  the attempt count and a countdown to the next try, Disconnected), the machine (a loopback daemon
  is "This Mac", a remote one its endpoint label and hostname), the daemon version and the round
  trip. `transport/ping.ts` measures `server.ping` every 10 s while the socket is open, never while
  it is not, and once more the moment the tooltip opens; the value lives in a store, so a dash is
  what "not measured yet" looks like. `PingMonitor` (`transport/ping-monitor.ts`) is the timing on
  its own, with the transport injected, which is what its tests drive. The reconnect loop's attempt
  count and next retry come from the transport itself (`ConnectionState`), moved in the same tick as
  the status they belong to. Over 250 ms the dot keeps its color and gets an amber ring; the color
  still says connected, reconnecting or gone.

- **Toolbar and panel slot**: `apps/client/src/shell/Toolbar.tsx` is a 48px bar at the top of
  the canvas column, next to the sidebar's strip, `bg-surface` with a bottom border and the drag
  region. Left is the breadcrumb: the machine when the daemon is not loopback, the
  `ProjectMenu` as a ghost button (it left the sidebar), the `ViewMenu` with the name of the view
  that is up, and the unsaved dot; the floating chip over the canvas is gone and `ProjectBanner`
  now floats under the bar. The view menu lists every view with its chord, makes one of any kind,
  renames and deletes; renaming, deleting, the question before a promotion and the address of a new
  browser view all go through `shell/ViewDialogs.tsx`, which the sidebar and the palette open as
  well. `ViewToolbar` sits beside the breadcrumb with what a standalone view's node header would
  have carried. Right is
  the `ConnectionDot` and `shell/PanelControls.tsx`, the button group of Preview, Files and Git
  over `useUi.panel` and `useUi.preview` (machine state, never in `project.json`). The preview
  toggle is only there while a file is open, because with no tabs there is nothing to show.
  `<main>` is a row of the canvas column, `shell/PreviewPanel.tsx` and `shell/Panel.tsx`, so both
  panels span the full height and their own 48px headers (a drag region, with the panel's name or
  the tab strip and a close button) continue the band the sidebar strip and the toolbar start.
  `PanelControls` stays in the toolbar whether a panel is open or not, so a toggle never moves out
  from under the pointer, and a hairline separates it from the palette group that keeps the
  toolbar's right end; the panel's own header carries its title, a slot for the panel's own
  controls (`shell/PanelHeaderSlot.tsx`: the header is above the body, so the panel portals its
  controls up instead of holding its state in two components; the git panel puts its checkout
  chip, its branch chip, the ahead and behind pills and its Push button there) and its close
  button. On Windows and Linux the native controls overlay covers that right end, so exactly one
  element takes `toolbar-overlay-inset`: the Files or Git panel's header while it is open, the
  preview's header while the preview is open on its own, and the palette group when neither is.
  The panel stays mounted and animates its width between 0 and the stored
  width in 200 ms over a fixed inner column; a resize drag sets `[data-resizing]`, which turns the
  transition off, and the contents unmount when the closing transition ends (immediately under
  reduced motion). Resizable from its left edge, min 240 and default 540, through
  `shell/useColumnResize.ts`, the one handle implementation both panels share: it owns the drag and
  nothing else, the width belongs to whoever asks for the handle. Which panel is up, whether the
  preview is up next to it and both widths belong to the project, in its machine-local file
  (**Phase 8** below); the old `ruimte.panel`, `ruimte.preview`, `ruimte.panel.width` and
  `ruimte.preview.width` keys are read once as what a project that has none of its own starts from
  and are never written again. Cmd+Alt+B toggles the Files or Git panel that was open last; the
  palette has "Toggle preview panel", "Toggle files panel" and "Toggle git panel".

- **Files panel**: `shell/panels/FilesPanel.tsx`, the tree on `@pierre/trees` (pinned to
  `1.0.0-beta.6`), which renders itself with Preact inside a shadow root and takes the app's
  tokens through the `--trees-*-override` variables on its host (`.files-tree` in `styles.css`).
  The glyphs are the set the library bundles, `complete`, the only one it colors and the only one
  that carries the brand marks. `ui/file-icon.ts` names it once: the tree takes it as
  `FILE_TREE_ICONS`, and everything else that shows a file name draws the same glyph through
  `ui/FileIcon.tsx`, which resolves against the library's own `createFileTreeIconResolver` and puts
  a copy of its sprite in the document, because the tree keeps its own out of reach inside the
  shadow root. Those icons carry their file type's color, which is the one place a component may
  reach past the semantic tokens: the values are the library's, as `--file-icon-*` in `styles.css`,
  so a tab and a tree row never disagree. The set ships no folder glyph, so a directory keeps the
  chevron that turns as it opens, and the palette's folder rows stay on Lucide, where `Folder` and
  `FolderCheck` also say whether a folder already has a canvas.
  The model is a flat list of paths relative to the project folder, POSIX, a directory with a
  trailing slash. The library sorts that flat list itself, and a directory is only in it when it is
  empty or unloaded: `src/index.ts` is the only row that says `src` exists. So `compareRows` walks
  the two paths segment by segment and lets the first segment they differ on decide, a directory
  before a file, case-insensitively. Comparing the last segment alone put `src/index.ts` wherever
  `index.ts` happened to fall, which is how directories ended up mixed in among the files.
  Directories load one at a time: `fs.list` on the folder, and a directory nobody
  has opened yet carries one hidden placeholder row so its chevron is there. The library reports
  an expansion nowhere, so the panel subscribes to the model and diffs `isExpanded()` over the
  directories it knows; a directory that just opened and has never been listed is the one the
  daemon hears about. What was open belongs to the project: the panel starts from the directories
  its local file names, lists every one of them at once so the tree can unfold that deep, and
  `mergeExpanded` keeps a remembered directory the tree has not heard of yet from being dropped
  before its parent arrives. "Collapse all" clears it. `buildTreeInput` and the path helpers are
  pure and tested (`shell/panels/files-tree.ts`). Hidden entries are always fetched and filtered in the client, so
  the eye button costs no request; what git ignores goes to the tree's git lane as `ignored` and
  dims. A single click on a directory toggles it and on a file selects it; double-click and Enter
  open it in the preview panel. The panel's controls sit in two rows, the way the git panel's do: the
  panel header carries one muted chip with the name of the project folder, and the 40px row under it
  is the same `FILE_TOOLBAR` the preview and the git panel use. In it the filter field grows, and a
  `Separator` divides it from the group of `FileToolbarToggle` buttons: hidden files (pressed while
  they are shown), Expand all, Collapse all and Refresh. Expand all opens only the directories the
  tree already holds, so what they list unfolds on the next click. The filter field runs `fs.search`
  (150 ms, 200 results) into a second
  model, so a flat result list and lazy loading never fight; Escape clears it. While the first
  listing is on its way, when the folder holds nothing and when the filter answers with nothing, an
  `EmptyState` stands where the tree would be. Right-click is a Base UI
  `ContextMenu` of the app's own (Open, Reveal in Finder with the daemon's file manager name, Copy
  path, Copy relative path): the library's own context menu slots a node into its shadow root, and
  the app's menu style, layer and portal are worth more than that hook. A row drags with
  `application/x-ruimte-mention` next to the library's own `text/plain`, and the chat composer's
  drop zone takes it: the paths land as `@path` at the end of the prompt and join the draft's
  mentions. While the panel is open the daemon watches the folder (`fs.watch`) and `fs.changed`
  re-lists only the directories the client has loaded. The panel is the tree and nothing else: the
  preview stands next to it and stays where it is when the tree closes.

- **Git panel**: `shell/panels/GitPanel.tsx`, one checkout: what changed in it, what is committed
  in it and everything a person does to it. Which
  checkout is a pure rule (`state/git-target.ts`, tested): a selected group with a worktree, or a
  selected node inside one, puts the panel on that worktree, everything else on the project folder,
  the same rule that decides where a node made inside such a group starts. The panel's controls
  sit in two rows: the panel header carries one chip for the checkout and the branch (they are one
  question, so they are one chip: the branch name, with the worktree's group in front of it in
  muted text when the checkout is not the project folder), the ahead and behind
  pills (the first thing to go when the panel is narrow) and the primary button, which says "Push"
  or "Publish branch" when the branch has no upstream and is disabled with the reason in its
  tooltip when there is nothing to push (`shell/panels/git-actions.ts`, pure and tested). The 40px
  row under it is the same `FILE_TOOLBAR` the preview panel uses: Expand all and Collapse all over
  every folder of every group at once, a refresh, and the overflow menu with Pull, Push, Sync,
  Fetch, Force Push (`--force-with-lease`, behind a confirm), Merge Branch, Rebase onto, Rename
  Branch, Delete Branch (a pick, a confirm, and a second confirm when git says the branch is not
  merged), Stash Changes, Pop Stash (the newest, or a pick when there are several) and Create pull
  request, which is only there when the daemon reports `gh` (`git.capabilities`). The branch chip
  is `shell/panels/BranchMenu.tsx`, one menu in two sections: Checkout, which is every checkout the
  panel could be on (the project folder and the worktrees `git.worktree-list` knows, with the group
  that binds one named beside it, the current one checked), and Branches, with "Create branch..."
  on top, every branch newest tip first, a search field past ten of them and a branch another
  worktree has out disabled with the reason. A switch with changes in the tree asks first and
  offers to stash them. `git.status` groups the changed
  files as Conflicted, Staged, Changes and Untracked, and a file that is staged and changed again
  since is in two of them with the counts of its own side in each. A checkout picked by hand
  outranks the selection until the selection points somewhere else of its own. A group is a tree of the folders
  its files sit in (`shell/panels/git-tree.ts`, pure and tested: directories first, a chain nothing
  branches in is one row, a collapse takes its subtree with it); the `gitTree` setting in Settings >
  Git lists them flat instead, and the folded folders travel with the project's local file. Every
  row ends in the same three cells, right-aligned and fixed, so the status letter and the `+n -n`
  line up down the list, with the stage and discard buttons after them on hover. Discarding is
  stash-backed: the paths go into a stash named `ruimte-discard-<timestamp>` first, which is also
  what resets the working tree, and the toast that says so carries the name to `git stash pop`. While the
  panel is open the daemon watches the repository (`git.watch`) and pushes a `git.status` event per
  burst; a repository it gives up on says `live: false` and the panel refreshes on focus instead.
  Clicking a change opens its diff in the preview: one tab named "Changes", the way a review pane
  works, whose path and scope follow the next change unless it is pinned. Its toolbar holds the
  scope, stacked against split, whitespace and wrap; the first three are `diffLayout` and
  `diffWhitespace` in Settings > Git, so the toolbar and the settings are the same switch, and
  whitespace off means `--ignore-all-space` on the daemon, counts included. That tab is the row the panel marks as
  selected, and the Files panel does the same the other way around: the file of the active preview
  tab is the selected row there, revealed by expanding its parents and scrolled only if it is out
  of view.
  Under the list is the commit box (`shell/panels/CommitBox.tsx`): one field whose first line is
  the subject and whose rest is the body, Cmd+Enter to commit, "Commit" (which reads "Stage all and
  commit" when nothing is staged and does exactly that), "Commit & Push", and "Write message",
  which asks the daemon for a message through the agent CLI on that machine in one-shot mode
  (`git.suggestMessage`) and is not there at all when `git.capabilities` reports none. A conflicted
  file has no discard button: staging it or a merge tool is how a conflict ends, and discarding one
  side of it silently is the way out nobody can name afterwards.
  Under that again is the commit log (`shell/panels/CommitLog.tsx`), in a split whose height is
  dragged in whole pixels and travels with the project's local file: `git.log` by the page with
  "Load more" at the end, grouped by the day it was written on (`shell/panels/commit-log.ts`, pure
  and tested), each row the short hash, the subject, the refs on it, the author and how long ago.
  It reads again whenever the status moves, since a commit, a pull and a rebase all move both.
  Clicking a commit opens it in the preview as a tab of its own, named after the commit: one
  `git.diff` with `scope: 'commit'` answers the whole commit, and `DiffFile` draws the subject, the
  author, the file list and then every patch under it.
  Every action is one `git.action` request (`shell/panels/use-git-actions.ts`): a toast goes up the
  moment it leaves, follows the `git.progress` phases the daemon streams back, and ends as the
  summary or as the failure with what git wrote behind a "Copy output" button. The toast's Cancel
  ends the git that is running (`git.cancel`). A pull request that is opened gets an "Open" button
  on its toast and goes to the system browser.

- **Toasts**: `state/toasts.ts` and `shell/Toasts.tsx`, bottom right over everything, one card per
  action: a title, one line of what the command wrote, an action button and, on a failure, "Copy
  output". A success takes itself away after four seconds; a failure and a running action stay
  until they are dismissed. Every git action reports through it, which is what took the inline
  `role="status"` lines out of the git panel. The chat's own notifications stay OS notifications.

- **Preview panel**: `shell/PreviewPanel.tsx` is a panel of its own between the canvas and the
  Files or Git panel, so the row reads sidebar, canvas, preview, panel. Its header is the same 48px
  drag region, with `shell/panels/FileTabs.tsx` in it and a close button; `shell/panels/FileViewer.tsx`
  is the body underneath, and the renderer's own toolbar (Preview and Source, wrap, Fit and 1:1)
  sits under that. A tab is the file's own icon, the name, a close button and a reserved dot
  for a future dirty mark, and a pin next to the close button on a pinned tab. `state/files.ts`
  holds them (tested pure helpers): past `filesTabLimit` the oldest unpinned tab closes, never the
  active one, double-click pins, and the tabs travel with the project's machine-local file, so a
  reload keeps them, another canvas starts with its own and nobody else sees them. A tab is keyed
  by its `key`, not its path, because a file and its diff are two tabs of one path: a diff tab
  carries a `view { kind: 'diff', cwd, scope, staged }`, reads as "Changes" with the file's name in
  its tooltip and the diff's `+n -n` beside it, and is drawn by `shell/panels/DiffFile.tsx` over
  `UnifiedDiff`, in the same toolbar every renderer uses. A whole commit is a view with a `commit`
  on it and is keyed by that hash instead of by a path, since no file in it is the one it is about;
  it reads as the short hash and draws the commit's own header, its file list and every patch. The store owns
  the panel with them: the first open file brings the preview up and the last close takes it away.
  Opening it takes half of what the canvas had (`floor(width / 2)`, at most 720, at least 360)
  every time, until a drag of its left edge gives the project a width of its own, which outranks
  the rule from then on. It opens and closes
  the way the panel beside it does, and the two animate independently.

- **Drawing a file**: the viewer reads the active tab through `useFileRead`
  (`shell/panels/use-file-read.ts`) and hands the result to `renderFile`
  (`shell/panels/renderers.tsx`): the name picks a renderer for a text file, what the read found
  picks everything else. `FileBody` owns the one loading state and the one error state (with "Try
  again"), so a renderer only ever sees a file that is there, and the body is keyed on the path so
  a tab switch starts a read of its own. An `fs.changed` under the file's own folder re-reads it in
  place: the state stays `ready` while the new read is on its way, nothing unmounts and the scroll
  position lives through a save.
  Markdown (`.md`, `.mdx`, `.markdown`) is the chat's own `Markdown` component with a Preview and
  Source switch in the viewer's toolbar; Source is the code view, and both share one toolbar so the
  switch does not move when it is used. The preview reads the way a chat of its own reads: the
  scroller sets `--text-sm: 15px` and `--text-sm--line-height: 24px`, the same overrides
  `ViewHost` puts on a chat view, and centers the prose in a 768px column while the scrollbar keeps
  the panel's edge. Prose takes its size from that override, so the preview reads at the same
  rhythm a chat view does; code blocks stay on `--text-code`.
  HTML (`.html`, `.htm`) has the same switch (`shell/panels/HtmlFile.tsx`). Preview loads the file as
  a `file://` URL (`localFileUrl`, every segment percent-encoded, tested) in a `<webview>` of the
  panel's own, so the stylesheet and the images next to it resolve the way they do from Finder. That
  webview stays out of the browser registry: it belongs to the tab, is made once, goes with it, stays
  in the tree while the source is up (switching back keeps the page) and reloads on an `fs.changed`
  under the file's folder. It runs in the `preview` partition, in memory and apart from the one the
  browser nodes share, sandboxed and without node integration, and the shell cancels every request
  out of that partition that is not `file:`, `data:`, `blob:` or `about:` (`sealPreviewSession` in
  `apps/desktop/src/main.ts`), because the daemon asks a loopback caller for no token and a script in
  a previewed page must not be able to reach its routes. A thin progress line runs while it loads and
  a failed load is an `EmptyState` with "Try again". A `file://` path only means something while the
  daemon runs on this machine, so a non-loopback endpoint shows the source with the line "Preview
  needs the file on this machine"; in a browser tab Preview is inert with the tooltip "Preview needs
  the desktop app", and streaming a page to a browser tab from the daemon is still open.
  Every renderer's toolbar ends in an overflow menu (`FileMenu` in `shell/panels/FileToolbar.tsx`, so
  no renderer repeats it): Reveal in the daemon's file manager, Open in a browser node for an HTML
  file (`addNodeAtCenter('browser')` with the `file://` address), Copy path, Copy relative path
  (against the project's folder, inert without one), Refresh, Pin or Unpin the tab, Close tab and
  Close other tabs. The file it acts on comes down from the viewer through `FileActionsContext`
  (`shell/panels/file-actions.ts`), which also carries the re-read behind Refresh.
  Code is shiki through a dynamic import of the full bundle
  (`shell/panels/highlight.ts`), not the chat's web one, because a folder holds Go and TOML as
  readily as TypeScript; the language comes from the daemon and falls back to plain text.
  A file is cut into blocks of 400 lines, each of which reserves its height (20 px a line), draws
  nothing until it comes within 600 px of the viewport, then plain text, then the highlighted
  version, so a 2 MB file paints at once and never blocks. Line numbers are a CSS counter each
  block starts at its own offset, which is what keeps the blocks independent; a shiki transformer
  drops the newline it puts between line spans, so the lines can be blocks. Wrap is an icon button
  in the toolbar, per viewer session, nothing stored; it is drawn in every view and inert outside
  the source, so the switch next to it never moves.
  Video (MP4, WebM, MOV, Matroska, Ogg, all named by their magic bytes) is a native `<video controls>`
  on the same route, which serves it in ranges so the scrubber works. `canPlayType` is the gate: a
  container the runtime cannot play (a MOV full of HEVC, most Matroska) draws the `EmptyState` with
  the size and a "Reveal in Finder" button instead of a player that would only sit there.
  Images (PNG, JPEG, GIF, WebP, SVG) are an `<img>` on `GET /fs/file` (`shell/panels/file-url.ts`,
  the endpoint's token the way the project icon carries it), on a plain sunken surface with a Fit
  and 1:1 switch and a footer with the dimensions, the size and the mime. Everything else, a PDF or
  a text file past 2 MB, is an `EmptyState` naming the size with a "Reveal in Finder" button
  (`shell/panels/UnsupportedFile.tsx`).

- **Copy is a right-click away everywhere**: the app draws all of its own menus, so a surface
  without one offers nothing at all, and every surface that carries selectable text has to offer
  Copy. `TextMenu` (`ui/TextMenu.tsx`) is the small one: a div that carries text, Copy for what is
  selected inside it and Select all for the whole of it, on Cmd+A as well. `FileScroll` is that
  component now, so every file the preview draws has it (a diff is not selectable at all, so it
  gets none). The thread has one of its own (`chat/ui/TimelineMenu.tsx` over
  `chat/logic/timeline-target.ts`): Copy for the selection inside the thread, Copy message for the
  item under the pointer (`messageTextOf` in `chat/logic/timeline-copy.ts`, which is an answer's
  markdown as plain text), Copy code when the click landed in a code block, Copy as markdown for an
  answer, Select all, and Open in preview for the file a mention chip or a changed-files row names.
  The row under the pointer is found through the `data-item-id` the timeline puts on every virtual
  row, the file through a `data-file-path`. A note that is being written and a terminal carry what
  their own field needs instead of a document selection: Cut, Copy, Paste and Select all over the
  textarea's value, and Copy, Paste and Select all over xterm's own selection. A right-click in one
  of these no longer opens the node's menu, which the frame around it still has; Cmd+C is untouched
  everywhere, since a browser copies a selection by itself.

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
  layouts, all acting on the open canvas, nothing stored), Files (`filesTabLimit`, how many files
  the viewer keeps open, 1 to 20 and 5 by default, and `filesShowHidden`, the same value the
  panel's eye button writes), Git (`gitTree`, whether the status list groups its files by folder
  or lists them flat, plus `diffLayout` and `diffWhitespace` for the diff), Agents (the remembered defaults for
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
  (`projects.json`), the project files and a directory watcher per open project. The client
  (`apps/client/src/project`) saves edits 400 ms after the last one against the rev it loaded,
  the camera a second after it stops moving into the machine-local file, and shows a banner
  with "Take the file" or "Keep mine" when the file changed under unsaved edits.
  The machine-local file (`<projectId>.local.json`, `ProjectLocalSchema`) holds which view was
  open, the camera and the focused node per view, and the panels: which panel is up and its width,
  whether the preview is up and its width, the open file tabs with the active one and their pins,
  and the directories the file tree had open. Every panel field is optional, so a file from before them parses as "use the defaults".
  `project/panels-port.ts` is the seam: it puts a project's panels on screen in the same tick as
  its canvas, so nothing flashes the project that left, and it reports a change made afterwards so
  the client can write it a second later. What it applies itself is never reported, which is what
  keeps a load from saving itself back. A canvas without a folder has such a file too. Folders are
  picked in the command palette: type a path (`/`, `~/`, `./`) and it
  lists the daemon's directories (`fs.browse`), Enter steps in, Cmd+Enter opens the typed path
  as a project; the native dialog comes with Electron as an extra. "Open in Finder" (label from
  the daemon's platform: Finder, Explorer, Files) sits in the project menu, the palette and a
  node's context menu, through `fs.reveal`. The project menu also creates projects without a
  folder (one canvas view to start with), closes (sessions keep running) and deletes with a
  confirm. Undo and redo (Cmd+Z, Cmd+Shift+Z) cover placement, adding and deleting; the history
  resets when another project or another view loads. Node ids are random now, since they end up in
  a shared file. A project has an identity: `name` and an optional `icon` (an emoji or one of 40
  Lucide names) in the project file, and everything else read from the folder. Without a chosen icon the daemon
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

- **Views**: a project is a folder with a list of views, not one canvas. `project.json` is version
  2: name, color, icon and `views`, at least one, in sidebar order. A canvas view carries the
  nodes, texts, edges and layouts the file used to carry itself; a chat, terminal or browser view
  is one node without a place on a canvas, under the id that is also its session id. Two invariants hold at
  parse time, both because a view id and a node id are keys of one flat session map on the daemon:
  every id is unique across the whole project, and an edge points at two things in its own canvas
  view. An edge that does not is dropped on the way in; a repeated id is refused with a message
  that names it (`project-invalid`). `migrateDocument` and `migrateLocal` (`packages/contracts`)
  read version 1 and wrap it in one canvas view with the fixed id `main` and the name "Canvas".
  The id is fixed on purpose: the file can be shared through a repository, and two machines that
  migrate it on their own have to land on the same id or the second save adds a ghost view. The
  daemon writes only version 2, so a project that is opened and never saved stays readable for an
  older build. On the client `useDocument` (`state/document.ts`) owns the list and which view is
  up; `useCanvas` is the editor of the canvas view that is on screen. A switch writes the canvas
  back into the document, remembers that view's camera and focus, and loads the next one, which
  resets undo the way a project switch does. Nothing else notices: `terminal/lifecycle.ts` derives
  the live set from every node of every view, so a switch ends no session and deleting a view is
  what ends the sessions on it; `context/sync.ts` derives readable context over every view, so an
  agent keeps its lines while its canvas is off screen; `shell/notifications.ts` and the dock's
  counters span the project, and "Needs you" jumps across views. The browser pages live in
  `browser/WebviewParking.tsx`, a layer outside the canvas transform that owns one host per node
  for the life of the app and places it in screen coordinates: a `<webview>` loses its page the
  moment it leaves the DOM, so a host is never moved and a page whose view is off screen goes
  `visibility: hidden` instead. It is also the seam a browser view will take its host from.
  Cmd+1 to Cmd+9 open the nth view, Cmd+Shift+[ and Cmd+Shift+] step through them and Cmd+T makes
  one; the palette has a "Views" section and its "Jump to" spans every view, naming the one a node
  lives in. Files, Git and the preview stay per project: they are about the folder.

- **A view that is one node**: `shell/ViewHost.tsx` is the main column. A canvas view draws the
  canvas; every other kind draws the body of its one node without a frame. The canvas stays mounted
  and goes `invisible` and `inert` under it, because it owns the app's pointer and key handling and
  its terminals would otherwise rebuild on the way back; `Canvas.tsx` skips its own keys while a
  view of its own is up. The bodies moved out of the canvas folder to `src/nodes` (`ChatBody`,
  `TerminalBody`, `BrowserBody`), where `NodeFrame` and the host both take them, and `node-host.ts`
  is what they read instead of the canvas store: one `NodeHost` for a node in a frame and for a
  view of its own, so no body knows which of the two it is in. What a node header carried moves to
  the toolbar (`ViewToolbar`): the folder and the permission mode of a terminal, the navigation bar
  of a browser. A chat of its own reads in a column: 768px of content, centered, at 15px over 24px
  (`--text-sm` and its line height, overridden on the wrapper, so every `text-sm` inside follows
  while code keeps `--text-code`). The scroller stays the full width of the main column, so its
  scrollbar sits at that column's edge and only the rows and the composer are centered in it
  (`.chat-column` and `.chat-column-content` in `styles.css`). In a node nothing of this applies:
  there the thread is 14px over the 22px `NodeFrame` gives a chat body. The rhythm of a turn is two
  gaps on the timeline's own rows, not on the markdown, so the tool rows inside a turn stay tight:
  16px from a question to its answer and 24px from the end of a turn to the next question in a
  node, 20px and 32px in a view (`--chat-answer-gap` and `--chat-turn-gap`). A browser view is the parked host over the whole column, so a page keeps its
  session and its scroll position between a canvas and a view; without the desktop app it shows the
  same "opens in the desktop app" notice a browser node does. Focus is explicit here too:
  `useDocument.bodyFocused` says whether the keyboard is in the body, a switch puts it there, and
  Escape (Cmd+Escape in a terminal, the chord a terminal node uses) leaves to the view's row in the
  sidebar, because there is no canvas to fall back to. The dock belongs to the canvas and stays
  away here, so a click in the body is the way back in and the counters are the sidebar's
  "Needs you" section.

- **Open as view and Put on canvas**: two document changes that move a chat, terminal or browser
  between a canvas and a view of its own. The id never changes, so the daemon sees nothing: the
  session, the thread and the page go on. Promoting drops the lines drawn into the node, since an
  edge belongs to one canvas, and asks first when there are any; putting one back lands it in the
  middle of what the target canvas last looked at, selected, on the canvas that was up last
  (`lastCanvasViewId`). Both sit in the node's context menu, the view's row, the breadcrumb and the
  palette. `ruimte-context` answers a standalone chat with nothing, the way it answers a node with
  no lines: `context/sync.ts` derives per canvas view, and a promotion clears what the node had.

- **Phase 7, Electron shell and browser node**: `apps/desktop` is a small main process
  (`src/main.ts`) plus a preload that exposes `window.ruimteDesktop` (platform, native folder
  dialog, open external, guest devtools). `bun run dev:desktop` opens the window against the
  Vite dev server while `bun dev` runs; without `RUIMTE_DEV_URL` the shell spawns the daemon
  from the repo through bun with `--serve apps/client/dist`, so one origin serves client and
  socket (a packaged app runs the compiled daemon from its resources, phase 11). Browser nodes are `<webview>` elements owned by
  `apps/client/src/browser/registry.ts` and placed by `WebviewParking` over the canvas in screen
  space; they are created once and never re-parented, and a project switch only hides them, so
  a form keeps what was typed. The address field reads short while nobody is in it (`prettyUrl` in
  `apps/client/src/browser/pretty-url.ts`, with its own test): `https://` goes, and so does the
  slash of a bare origin, while `http://` stays because it is a warning and every other scheme
  stays because it says something. Focusing it brings the whole address back, selected, and what
  Enter sends is what was typed. The layer passes pointer events to a page only while its node is
  focused and no canvas gesture is running. Inspect opens the guest's devtools in a window of
  ours that stays above a fullscreen app.
  A load says that it is one: the reload button becomes a stop while the page is on its way
  (`webview.stop()`), and a 2px line sweeps under the address field, from `did-start-loading` to
  `did-stop-loading` or `did-fail-load`. It sweeps rather than fills because a guest reports a start
  and a stop and nothing in between, so a percentage would be invented. A main-frame load that fails
  (anything but the aborted `-3`) gets a plate of the app's own instead of Chromium's gray page:
  `classifyLoadError` (`apps/client/src/browser/load-error.ts`, pure, with its own test) turns the
  code and the description into a class (offline, dns, refused, certificate, timeout, blocked,
  address, other), a title, a line about what to check where there is one, and Chromium's own
  symbol, which is the part worth searching for. An unknown code falls back to the generic sentence
  plus that symbol rather than an invented reason. The plate names the address that failed and
  offers Try again and Open in the system browser, never a way past a certificate; Try again is
  withheld for the address class, where running that exact navigation again cannot end differently.
  It is drawn into the parked host, over the page it replaces, so a browser node and a browser view
  show the same surface, and it clears on `did-start-loading` and nowhere else: a failed navigation
  leaves Chromium on its own error page under the address that failed, so clearing it from
  `did-navigate` would wipe the plate the moment it appeared. A page whose load failed also stops
  naming its node, because the title on offer is then the error page's.
  A right-click inside a page gets one of two menus, and `params.isEditable` picks which. An
  editable field is the platform's: `editableGuestMenu` (`src/main.ts`) builds a native menu and
  pops it, so macOS can hang whatever it hangs off a text field. Everything else is the client's,
  because Electron ships no menu for web content and a native one reads as another program's.
  For that half the shell keeps the `context-menu` listener on the guest (`guestContextMenu`) and
  forwards what the click landed on over `browser:context-menu`: the point, the link, the image,
  the selection, the edit flags and the guest's web contents id. An editable click never leaves the
  shell, so nothing on the wire carries a spelling suggestion any more.
  The native menu is roles wherever a role exists, which is what the platform recognizes:
  the spellchecker's guesses first (plain items calling `replaceMisspelling`), then `undo` and
  `redo`, `cut`, `copy`, `paste`, `pasteAndMatchStyle` on a rich field, `delete` and `selectAll`,
  each enabled from the click's own edit flags. On macOS a selection adds Look Up and Search with
  Google, ours because Electron has no role for either (`showDefinitionForSelection` and the same
  search URL the client's menu opens). Share and Services left the template: the menu is popped
  with `frame: params.frame`, which is what makes macOS append its own rows, so keeping ours would
  list them twice. Every native menu ends in Inspect element, the same row the client's does.
  `BrowserContextMenu` (`apps/client/src/browser/BrowserContextMenu.tsx`, mounted once in
  `WebviewParking`) turns a forwarded click into a Base UI `ContextMenu` with the app's own rows:
  Back, Forward and Reload, then what the click landed on. A link adds "Open link in new browser
  node" (`openLinkBeside` puts it beside the one the link came from, or opens another view when the
  page is one), "Open link in system browser", "Copy link address" and "Copy link text"; an image
  adds Copy image, Copy image address and Save image as...; a selection adds Copy and "Search the
  web for ...". Every menu ends in Inspect element. Which rows there are is `buildBrowserMenu`
  (`apps/client/src/browser/browser-menu.ts`), a pure function over the params with its own test;
  it answers editable params with no groups at all, so a shell old enough to still forward one
  draws nothing instead of a menu missing its edit rows.
  The click happened in a page, so no event in the window can anchor the popup: the component maps
  the page's point through the host's bounding rect (the camera's zoom is the box against the
  element's own width) and hands the trigger a `contextmenu` event at that point. The rows the
  client owns it runs itself (the history through the registry, the new node, a string to the
  clipboard); the rest goes back as `browser:context-action` and the shell carries it out on the
  guest that asked (`copy`, `copyImageAt`, `downloadURL`, the inspector, `shell.openExternal`).
  AutoFill, Writing Tools and Services are now expected on that native menu, though nobody has seen
  them yet. Electron leaves the OS rows off unless the menu is popped with the frame that invoked
  it, and passing `params.frame` is the whole fix. AutoFill there is
  Apple's Passwords app and nothing else: Electron ships only the datalist autofill popup
  (`shell/browser/ui/views/autofill_popup_view.cc`), not Chrome's password manager. An earlier probe
  (a throwaway Electron app around the same `<webview>`, right-clicking a `type="password"` field
  through `sendInputEvent`) showed the menu pops on `formControlType: 'input-password'` and stays
  up, but this machine grants neither screen recording nor accessibility to a scripted reader, so
  the popped NSMenu could not be read back, and Electron's own JS `menu.items` shows only the
  template. To check by hand: restart the shell, open a browser node on a page with a login form and
  right-click the password field, and see whether AutoFill sits above Undo.
  Only guests of the browser
  partition get one: the preview partition is sealed, with nowhere to navigate and nothing to
  inspect. `electron-updater` reads the feed electron-builder
  writes into a packaged app; a checkout skips it. `bun run --cwd apps/desktop smoke` boots the
  shell, adds a browser node through the keyboard and waits for its page to load; with
  `RUIMTE_CAPTURE=<path>` it writes the left end of the band to a PNG in device pixels instead,
  which is how that band gets measured rather than guessed. The title bar is
  `hiddenInset` with the traffic lights at (12, 17) on macOS, not the naive `(48 - 12) / 2`,
  because `trafficLightPosition` places the top of the buttons' frame and that frame measures
  14pt on current macOS; a native controls overlay elsewhere, the sidebar's top strip and the
  toolbar next to it are both drag regions and together make one 48px band (children reset to
  `initial`, controls `no-drag`),
  the traffic-light inset comes from `useTrafficLightInset()` (84px, `TRAFFIC_LIGHTS_INSET_PX` in
  `desktop/bridge.ts`) and belongs to the leftmost strip
  (the sidebar's when it is open, the toolbar's when it is closed), only outside fullscreen
  (the shell sends `window:fullscreen`), the rightmost element in the band keeps the width of the
  overlay controls free through `env(titlebar-area-*)` on Windows and Linux. The client reports its
  theme over IPC (`setTheme`, with the resolved theme, whether the app follows the system, and the
  value of `--bg`), and the shell spends it three ways: the overlay colors, the window's own
  background, and `nativeTheme.themeSource`, which is what Chromium answers `prefers-color-scheme`
  with. Without that last one a page in a browser node reads the OS while the app is set to the
  other theme. Only "follows the system" maps to `'system'`; a fixed choice pins it. A page also
  paints on `--bg` until it brings a background of its own, through the parked host and the
  `<webview>` element, and the preview partition keeps its deliberate white.
  The window runs under a content security policy, in two places because two things serve the
  client: the daemon sends it as a `Content-Security-Policy` header on everything under `--serve`
  (`CLIENT_CSP` in `apps/server/src/daemon.ts`, which is what a packaged app gets), and the same
  policy sits as a `<meta http-equiv>` in `apps/client/index.html` for the Vite dev server. It is
  `default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; media-src 'self' data: blob: http: https:; font-src 'self' data:; connect-src 'self' ws: wss: http: https:; worker-src 'self' blob:`. `'wasm-unsafe-eval'` is
  there for shiki's oniguruma, `'unsafe-inline'` for styles because Tailwind, shiki and Base UI
  all set them on the element, and `blob:` under `worker-src` for the diff worker. `connect-src`,
  `img-src` and `media-src` are broad on purpose: a paired endpoint is any host the person adds
  (phase 10) and its socket, project icons, attachments and file bytes all come from there, so
  narrowing them to the loopback daemon would break every remote endpoint. There is no
  `'unsafe-eval'` and no inline script; the built `index.html` has none, and Vite's dev preamble
  is injected above the meta tag, so it predates the policy. Without this Electron logged
  "Insecure Content-Security-Policy" on every start, because a renderer without a policy may
  `eval`. The `<webview>` guests are not covered by it: a browser node's page brings its own
  policy, and `frame-src 'none'` does not touch a webview. A webview attribute counts as set the
  moment it is there, so `allowpopups="false"` was popups turned on; browser nodes carry no
  `allowpopups` at all and `HtmlFile.tsx` only ever names settings that turn something on.

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

- **Drawing view**: a fifth kind of view, a sketch in the spirit of Excalidraw, written from
  scratch. `project.json` knows it as `{ kind: 'drawing', id, name }` and nothing else; its
  elements live in `<folder>/.ruimte/drawings/<viewId>.json` (version 1, a `rev`, one element per
  line so a git diff reads), under the same discipline the project file has: `drawing.open`,
  `drawing.save { baseRev }`, `drawing.close`, `drawing.copy`, and `drawing.changed` from a
  watcher of its own on that directory (`apps/server/src/projects/drawing-store.ts`). A view that
  a person deletes takes its file with it; a view an outside edit drops never does. The client is
  `useDrawing` plus `DrawingClient` (`apps/client/src/drawing`), shaped after `useCanvas` and
  `ProjectClient`: autosave 400 ms after the last edit, a flush before every switch, and the
  conflict banner shared with the project's. The camera goes to `<projectId>.local.json` under the
  slot every view already has. Six element kinds (rect, diamond, ellipse, line, freehand, text),
  ten palette names instead of hex values (`--draw-*` in both themes), three levels of sloppiness
  through roughjs with a seed per element, strokes through perfect-freehand. The surface is two
  canvases (the drawing and the stroke in the making) with a DOM overlay for the handles, the
  marquee and the text editor, so handles stay whole pixels at every zoom. The pure half of all
  that (geometry, hit tests, paths, SVG, reading order) is `packages/drawing`, which the daemon
  uses too. Export is PNG and SVG, to the clipboard or as a file (a native dialog in the desktop
  app through `saveFile`); copy and paste inside the app carry elements, not a picture. A drawing
  can also be a node on a canvas: a read-only mirror that follows the file and opens the view on a
  double-click ("Show on canvas" in the view menus). An edge from such a node into an agent makes
  the drawing readable: the daemon serves the texts in reading order with the arrows as `A -> B`
  lines, and the SVG behind a heading of its own.

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
  later settings phase; until then the Keyboard section only lists them. The one exception is a
  drawing view: it has the keyboard the way a terminal has it, and its tools are the bare letters
  and digits every sketching app uses (V/1 select, H hand, R/2 rect, D/3 diamond, O/4 ellipse,
  A/5 arrow, L/6 line, P/7 freehand, T/8 text, E/0 eraser, Q keeps the tool). They fire only while
  no text is being typed and no dialog is up, and they are listed under "Drawing" in the Keyboard
  pane like every other chord.
- Never highlight the canvas grid in the accent color. The dots stay neutral in every state.
- A drawing keeps its elements beside `project.json`, in `<folder>/.ruimte/drawings/<viewId>.json`,
  and they go into git with it: a sketch that explains a repository belongs to that repository. The
  file is named after the view id, never the view name, so a rename moves nothing, and every color
  in it is a palette name, never a hex value, so the same file reads in both themes.
- Icon buttons get equal padding on every side. Buttons that belong together sit in a
  `BTN_GROUP` with 1px gaps; groups keep the wider gap of their container.
- The shared components in `src/ui/` are `Icon`, `Brand`, `Tooltip`, `Select`, `Button`
  (primary, secondary, ghost, danger; 28 and 32 pixels), `Pill` (the rounded label in a node
  header) and `EmptyState` (icon, one sentence, one action). A node's own "connecting" or
  "failed" card is `canvas/nodes/NodeNotice.tsx`. Every text input is `.field` in `styles.css`,
  one height and one focus ring; `SECTION_LABEL` (`src/ui/classes.ts`) is the uppercase label
  outside a popup and `MENU_HINT` the trailing hint inside one, with `<kbd>` left for chords only.
- `styles.css` is the tokens, the themes and the rules a utility cannot write: Base UI's `data-*`
  states shared by every menu, picker, dialog and tooltip, the `:not()` chain that keeps a node's
  focus ring behind its focused and selected outlines, the panel shell's `[data-instant]` and
  `[data-resizing]`, `[data-modality]`, `::selection`, the keyframes, and everything that styles
  DOM the JSX never sees (xterm, shiki and its line-number counter, the `@pierre/diffs` and
  `@pierre/trees` variable overrides, the file icon hues, the `<webview>` a preview is drawn in).
  Every rule that was only a bundle of utilities moved to its call site, or to a class string next
  to the component that uses it: `src/ui/classes.ts` (the glass card, the button group, the menu
  and section labels, the chord), `src/shell/panels/classes.ts` (the file toolbar, the git rows,
  the commit box) and `src/chat/ui/chips.ts` (the mention and skill pills). That took the
  components layer from 157 rules to 92.
- What is left in that layer stays in Tailwind's `components` layer. An unlayered rule beats
  every utility of the same specificity, so `icon-btn h-7 w-7` silently stayed 32 pixels and
  `menu-popup min-w-48` kept the wider default; inside the layer a call site's utility wins,
  which is what the heights in the code already claimed.
- Markdown is Tailwind Typography (`@plugin "@tailwindcss/typography"`), not a stylesheet of its
  own: the `Markdown` component carries `prose prose-sm max-w-none text-sm` next to
  `.chat-markdown`, and `.chat-markdown` is only what the app decides instead of the plugin. The
  plugin registers `prose` with `addComponents`, so its rules land in the same `components` layer
  and are written after the app's own, which lose a tie on order. Whatever has to beat them says
  so: the variables through `.prose.chat-markdown`, the rest through a selector of its own (an
  element next to the class outranks the `:where()` prose wraps its own in), and the size through
  the `text-sm` utility, since a utility is a layer later. That is why the size is not in
  `.chat-markdown`.
- The colors are the semantic tokens mapped onto the prose variables (`--tw-prose-body` and
  `--tw-prose-headings` from `--text`, `--tw-prose-links` from `--accent`, `--tw-prose-code` and
  `--tw-prose-pre-code` from `--text` with `--tw-prose-pre-bg` from `--surface-sunken`, counters
  and bullets from `--text-faint`, every border and rule from `--border`, captions from
  `--text-muted`). The tokens flip with the theme themselves, so both themes come free and
  `dark:prose-invert` would only be a second source of truth. The size is `--text-sm` and its line
  height, which a chat node, a chat view and the file preview each set for themselves, so prose
  reads 14/22 on the canvas and 15/24 in a view and in a preview; every margin prose sets is an
  `em`, so the air follows the size. Headings stay on the app's flatter scale (h1 `--text-lg`, h2
  `--text-base`, h3 and h4 `--text-sm`) and code stays on `--text-code`, without the quotes prose
  puts around inline code. What is left in `.chat-markdown` is what prose lacks: task lists
  without a bullet, and a table in a `.chat-table` wrapper that scrolls on its own instead of
  widening the column.
- What floats over what is four numbers in `styles.css`: dialog backdrop 80, dialog 90,
  `--z-popup` 100 (`z-[var(--z-popup)]` on every menu, select and popover positioner, so one
  opened inside a dialog is not swallowed by it), tooltip 110.
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
  stack; no other text may use `font-brand`. The second bundled face is Kalam
  (`@fontsource/kalam`, weight 400, OFL 1.1), the hand a drawing writes in. It is imported lazily
  by the first drawing view, never at startup, and only a `text` element in a drawing may use it;
  its other two fonts are `--font-sans` and `--font-mono`. Excalifont was rejected on purpose: it
  is Excalidraw's own face, and a Ruimte drawing should not look like an Excalidraw one.
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
- Fast mode is offered on the models that have it. `--settings '{"fastMode":true}'` is both the
  switch and the opt-in the CLI asks for: without it the init frame answers `fast_mode_state: off`
  with `fast_mode_disabled_reason: sdk_opt_in_required`, with it the reason is gone, and on
  2.1.267 only Claude Opus 5 answers `fast_mode_state: on` (Sonnet 5, Fable 5.1, Haiku 4.5 and
  Opus 4.6 all stay off). So the boolean descriptor sits on Opus 5 alone, in a profile of its own;
  move it as soon as another model answers on. Codex's counterpart is the priority service tier,
  which `model/list` reports per model as `serviceTiers: [{ id: 'priority', name: 'Fast' }]` for
  everything except Codex Spark; it goes out as `serviceTier` on `thread/start` and `turn/start`.
  Both are ordinary option descriptors, so they are remembered per provider with the model.
- Claude Code 2.1.266 emits `tool_progress` (`tool_use_id`, `tool_name`, `parent_tool_use_id`,
  `elapsed_time_seconds`, `task_id`, `heartbeat`) for a local Bash only when
  `CLAUDE_CODE_REMOTE` or `CLAUDE_CODE_CONTAINER_ID` is set, throttled to one per 30 s, and
  it never streams partial Bash output. Neither variable is set on purpose: both change other
  behavior (headers to Anthropic, temp dir checks). The live timer therefore counts on the
  client, and partial output is plumbing for a provider that has it (Codex streams command
  output).
- `@file` mentions are plain `@path` text in the prompt, because that is what the Claude CLI
  expands itself (checked with `claude -p` 2.1.266); the chosen paths travel next to the text
  as `mentions` only so the timeline can draw them as chips. In the composer a chip is painted on
  a layer behind the textarea, so it may only add a tint, an inset ring and a radius
  (`CHIP_BEHIND_TEXT` in `src/chat/ui/chips.ts`): the caret is placed by the textarea from its own
  raw text, so a weight, a font size or a horizontal padding on the chip moved the drawn text off
  its characters and left the caret sitting in the wrong word. Padding cannot be handed back as a
  negative margin, since a wrapped chip takes it again on every line, and `chipText` is what the
  layer draws so a test can hold it against the textarea's value. The pill with the file icon in
  front of the path is the sent message's (`CHIP_IN_MESSAGE`). The picker searches through
  `fs.search`: `git ls-files` (tracked plus untracked, minus .gitignore) inside a repo, a
  bounded walk elsewhere, ranked by a small fuzzy score on the daemon.
- An attachment goes over the wire as base64 in `chat.send` once (25 MB and 8 per message) and
  never again: the daemon writes it under `$RUIMTE_HOME/attachments` and the thread keeps its
  name, mime, size and path. The prompt names the file by path instead of carrying an `image`
  block, because both CLIs read a file with their own tools and a path costs no tokens until
  the agent looks. A remote client uploads over the socket like a loopback one; a signed HTTP
  upload is only worth it once someone attaches a video over a slow link.
- A thinking row shows what the model weighed before it answered: "Thinking..." with the text
  under it while it streams, "Thought for 8s" with the text behind a fold once the answer
  starts. Claude's thinking deltas and Codex's reasoning summaries both become one `thinking`
  item per stretch, and `ProviderCapabilities.reportsThinking` says which CLI hands it over.
  Codex is otherwise silent for long stretches, which is where this earns its place.
- Any file can be attached now, up to 25 MB and 8 per message. The bytes go to
  `$RUIMTE_HOME/attachments/<chatId>/<id>.<ext>` and the thread keeps name, mime, size and path,
  which also ends the growth the old inline images caused: a thread written before this is
  migrated on the read that opens it. The prompt names the files by path, since both CLIs open a
  file with their own tools, and `GET /attachments/<chatId>/<id>` serves thumbnails and downloads
  behind the project icon's access rules.
- Enter while a turn runs queues the message instead of refusing it. The queue lives on the
  daemon (`ChatInfo.queue`, written with the thread, so a reload keeps it) and drains when the
  turn settles; the composer draws the waiting messages above itself with remove and "Send now",
  which interrupts the turn and puts that message first. One explicit queue for both CLIs
  instead of Claude's silent steer and Codex's own turn queue. A chat's record is written one
  write at a time now: two in flight together renamed in either order, so an older snapshot
  could land last and take the queue back.
- `$` in the composer opens the skill picker, the same shape as `@`: search, arrow keys, the
  description on a second line. A picked skill becomes a `$name` chip in the text and a name in
  `skills` on `chat.send`, and the slash menu labels the entries that are skills, inserting
  `$name` so both spellings end on one path. Claude Code expands a skill only from the last text
  block of a message when that block starts with `/name` (measured against 2.1.267 with a skill
  that writes a marker file), so the daemon splits the prompt and puts the invocation last;
  Codex reads `$name` in the text itself. Discovery is the daemon's (`apps/server/src/skills`),
  narrowed after the first message to the `skills` array the CLI's own init frame carries.
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
- The composer guards a long prompt: past 100k characters a counter appears, past 120k the send
  is refused, which is the size where a turn gets slower than the answer is worth. Commands only
  the CLI's own terminal can run (`/clear`, `/login`, `/theme`, `/doctor`, ...) are filtered out of
  the slash menu even though the init frame lists them (`chat/guards.ts`); `/clear` is in that list
  for a reason of its own, since it would empty the CLI's context while the thread still shows
  every item. PageUp and PageDown page the thread from the composer, through a scroller the
  timeline registers per chat (`chat/timeline-scroll.ts`), and a chat node with an unsent draft
  gets a dot on its sidebar row (`useHasDraft` in `chat/drafts.ts`, the store next to the
  localStorage the composer already wrote).
- Cmd+S in the composer stashes the draft and clears the box; on an empty box the same key takes
  the newest one back. The shelf is one list for the whole app in localStorage, twenty entries
  deep, because a stashed prompt usually moves to another node on the canvas. A stashed entry
  keeps the text, the mentions, the skills and what the files were called; the bytes are not kept,
  so the row says so and the files are not restored.
- Prompt recall is the other half of that shelf and keeps no storage of its own: Arrow Up in an
  empty composer walks back through the last fifty user items of that chat's own thread, Arrow
  Down walks forward, and Escape puts the empty box back instead of leaving the node (a plain
  Escape still leaves when nothing was recalled).
- An image attachment and an image an agent read open large in a dialog with zoom and pan
  (`chat/ui/ImageView.tsx`): the wheel zooms around the pointer, dragging pans, Escape closes. A
  `Read` of a path with an image suffix asks `fs.read` what the file is and draws it under the row;
  the bytes come from `GET /fs/file` like every other image the client draws.
- Codex has a `@` picker too. It has no mention part in its protocol, so the path travels as text
  in the prompt, which is all the model needs to open the file with its own tools. A bare `@` lists
  what is in the folder instead of waiting for a query.
- An async Codex question carries `async` on its item, which is what lets the dock offer Dismiss:
  `chat.dismiss { chatId, itemId }` settles it as `dismissed` and tells the CLI nothing, because it
  asked beside its turn and goes on either way. A blocking question and an approval refuse the call.
  The dock also says how many other approvals and questions wait ("2 more"), and a decline can
  carry a note for the agent where the CLI takes one (`ProviderCapabilities.denyReason`, Claude
  only); the note travels as the `message` the approval contract always had.
- Codex runtime modes: `supervised` = `untrusted` + `read-only`, `auto-accept-edits` =
  `untrusted` + `workspace-write`, `auto` = `on-request` + `workspace-write`, `full-access` =
  `never` + `danger-full-access`. Not mapped: cost (Codex reports none), the deny reason, slash commands, permission-profile
  requests and MCP elicitations (refused with a JSON-RPC error). Gemini and Copilot open as
  terminals only; the daemon builds their launch line like every other CLI's.
- The title of a node follows the session until someone sets it. `titleSource` on the node says
  who named it: absent means nobody has, `'auto'` means the session did, `'user'` means a person
  did and nothing overwrites it again. A chat takes its name from the prompt that opens it
  (`deriveNodeTitle` in `apps/client/src/chat/title.ts`: the first line, cut around 48 characters
  on a word boundary, without the punctuation that ended the sentence), once, so a later prompt
  never renames a node you are looking at. Every rename goes through `renameNode`, which writes
  `'user'` unless a caller says otherwise. A terminal agent cannot follow this rule yet: the hooks
  of Claude Code and Codex carry `session_id`, `hook_event_name`, `transcript_path`, a tool name
  and a notification type, and no name the CLI gave the session, so the name would have to come
  out of the transcript file. That is a reader per CLI and is not built.
- A CLI that goes down with its shell is `exited`, not `error`. The daemon sees the PTY child end
  while its agent record is still live and writes `status: 'exited', live: false`
  (`SessionManager.handleExit`), the record outlives the shell, and the node shows `[session ended]`
  with a Resume button next to Restart. Resume puts the CLI's own session id on the node
  (`resume`) and starts a fresh shell, which the daemon launches with the CLI's resume line; the
  status is no longer `running`, so the sidebar and the dock's summary stop counting it. This is the
  daemon's own reading, the one thing the hooks structurally cannot report.
- A note starts an agent: "Start agent from note" in a note's context menu makes a chat node beside
  it, fixed to the CLI you picked, seeds the note's body as the composer's draft (never sent, the
  person presses Enter) and draws the edge from the note into the chat, so the note stays readable
  through `ruimte-context` after it is edited.
- Usage is a page, not a view. A view lives in `project.json`, a shared file that goes into git, and
  what both CLIs cost on this machine has nothing to do with a project. It would also add a literal
  to a zod union the daemon and the migration both read, and give every project a sidebar row for
  it. So it is `page: 'usage' | null` in the ui store, beside `paletteOpen` and the settings flag,
  drawn by `ViewHost` over the canvas the way a standalone view is. The settings dialog was the
  other candidate and is too small for a chart and two tables; what does belong there later is the
  price override editor. Nothing about the page is persisted: a reload lands on the project's own
  view. It closes at the top of `showView` (`project/views.ts`) rather than in the store, because
  every route to a view runs through there and the ui store may not import the document store.
- The usage index is JSON, not SQLite. It is derived data: 1,400 transcripts cold-scan in 2.2 s and
  a warm pass is 50 ms, so losing the file costs seconds and nothing else. Records of a transcript
  Claude Code has since cleaned up do stay in it, which is the one thing a rescan cannot rebuild.
  `bun:sqlite` is the way out if the file ever grows past a few megabytes (4.9 MB here).
- Nothing in usage reads a credential. The plan windows come from the CLIs themselves: a probe
  process is started, asked and ended, and the events of a running turn fill the gaps. Reading the
  keychain or `~/.codex/auth.json` and calling the vendors' usage endpoints was tried in ai-usage
  and removed there: a keychain prompt on every token refresh, 429s, and no way to refresh. The
  LiteLLM fetch is the daemon's first outgoing HTTP request; a snapshot ships with the app so it is
  optional, and `--no-price-fetch` turns it off entirely.
- Provider colors are tokens of their own, `--chart-claude` and `--chart-codex` (Apple's system
  orange and teal, the pair ai-usage uses), with `--chart-gemini` and `--chart-copilot` reserved.
  They are not the status colors: a bar segment names which CLI did the work, and red, amber and
  green already mean something else everywhere in this app.
- The limits look like ai-usage's: the used percentage as a whole number, a bar capped at 100, red
  from 90% and amber from 70%, and the reset as a clock time ("resets 16:18" today, "resets Tue
  09:00" otherwise). No countdown that ticks, no hairline for the elapsed share, and no amount on
  the sidebar button.
- The chart is 150 lines of SVG rather than a library. Recharts is 7.4 MB unpacked, chart.js 6.2 MB,
  and the only arithmetic a library would bring is a nice scale of ten lines. It draws in real
  pixels from a `ResizeObserver` instead of a stretched view box, so a bar lands on whole pixels.

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
- A background sub-agent settles twice over: the Agent call is answered at once with "Async agent
  launched successfully", and what it came to only arrives much later as `task_notification`. Its
  report is not in that frame (`summary` is a line, the real report goes to the CLI's own internal
  message), so the projector keeps the last text the sub-agent wrote as the result. A foreground one
  answers its own call with the report plus an `agentId ... <usage>` footer, which is stripped with a
  tolerant regex: when the CLI rewords it the row shows a stray line and nothing breaks. Because a
  background agent outlives the turn that launched it, the end of a turn may not settle its row;
  only a process that is gone marks it failed.
- `@pierre/diffs` marks itself side-effect free, so `import '@pierre/diffs/worker/worker.js'`
  in a worker entry is tree-shaken to nothing. The pool uses Vite's `?worker` import instead.
- `bun --watch` restarts the daemon on every file change and the daemon installs hooks at
  startup, so editing the server while `bun dev` runs also rewrites the hook settings (idempotent).
- A `bun --watch` reload does run the SIGTERM handler in the same pid, but the module restarts
  before anything the handler awaits comes back (measured: a 500 ms timer never fired, a real
  `kill` lets it through). So `shutdown` writes the chats synchronously before its first await
  (`ChatManager.persistAllSync`), and a chat is written when a turn opens and after every tool
  call, not only when the turn settles. Without that, editing the server during a turn lost the
  whole turn and left the CLI process orphaned, still writing files nobody would see.
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
5. **The rest of the git panel** (phase 17, part 2): commit, push and a PR through `gh` as one
   stacked action with its progress as a toast, the branch chip with a ref picker, pull when
   behind, and a commit message written by the chat CLI when the field is left empty.
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
