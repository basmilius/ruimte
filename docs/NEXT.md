# Next

What is still open, roughly in the order that makes sense.

The one open issue first, then the rest. Sizes are rough: hours, a day, several days. Each of the
larger ones becomes a GitHub issue when it starts.

1. **#15**: Windows, which can wait. The daemon on Bun's Windows PTY or Node with node-pty, the
   shell and a release build (`docs/research/windows.md` is the design for a project in its own
   window, not for the platform). Linux runs, with its own list in `docs/LINUX.md`; the signed and
   notarized macOS build, the icon and the update path are done, see `docs/RELEASE.md`.
2. **A third chat provider** (Gemini, Copilot or opencode) as the proof that the backend seam
   holds: a provider value, a backend and a protocol mapper. `AgentKind` already names `gemini` and
   `copilot`, which today only launch in a terminal; opencode would be one more literal. Hooks for
   Gemini and Copilot are a day per CLI on top, approvals included, the way Claude Code and Codex
   answer theirs. Two things come before it. The iPhone app with open enums (`AgentKind`, `RuntimeMode` and `AgentStatus` are `x-open-enum` in `schemas.json`, since
   1a42876c) has to be out in an iOS release first, since an older build refuses a whole answer over
   one value it does not know. And the desktop client validates `AgentKind` with zod just as closed
   (`packages/contracts/src/agent.ts`), so a newer machine elsewhere with a new provider breaks the
   desktop the same way. Decide how it reads an unknown provider before this starts.
3. **Terminal basics**, about two days. Search on Cmd+F (the shared find bar in
   `apps/client/src/find` has no terminal host yet), clickable file paths across wrapped rows (URLs
   already are), OSC 52 clipboard, a dropped file types its quoted path, Unicode 11 widths on both
   xterms, and "Clear" in the node menu and the terminal's right-click menu (Cmd+K, the app menu
   and `terminal.clear` have it). Then "Send to linked chat" (a terminal selection lands as a fenced
   block in the composer of the chat the node has an edge to) and port discovery: an `lsof` poll
   tied to the owning session, an "Open :5173" chip that adds a browser node with an edge. The
   browser node's splash already probes a fixed list of ports (`apps/server/src/browser/dev-servers.ts`);
   that is not this.
4. **Canvas ergonomics**, about two days, all client state. Directional focus between nodes and
   maximize for a node on the canvas; the keys the plan named for them now move between and fill
   the cells of the grid (Mod+Alt+Arrow, Mod+Shift+Enter), so both need keys of their own. Camera
   history (Cmd+[ and Cmd+] belong to a browser while one is focused; the history stays in the
   editor and stores nothing). Arrange, align and tidy as pure functions with palette entries (only
   the alignment guides while dragging exist). Palette ranking (exact, prefix, substring), `>` for
   actions, recently visited nodes on an empty query (it shows recent commands and the canvas's
   nodes in stacking order today). Images on the canvas from paste, stored under
   `<folder>/.ruimte/images`; an image already in the folder is a file node and needs none of this.
5. **Chat depth**, several days. Review comments from a diff into the prompt, and approval choices in the
   provider's own words (the provider's description is shown; the allow-always labels are ours).
   From branching: "Restore files to this turn" as its own action on a turn (the shared-folder
   undo) and a verb for agents to fork (`chat.fork` is a person's and voice's). Two small ones: a
   question in a finished turn stays outside its fold, since it explains the answer below it, and
   after Stop an empty composer offers "Continue" in place of the send button.
6. **Settings and keyboard**: one binding table with `when` contexts, read by the handlers and the
   Keyboard pane (which lists them by hand and read-only today), then overrides with
   press-to-record, conflict labels and reset. A "restore defaults" action, a canvas font size for
   chat and text elements, and settings search that the palette reads, so a settings row is a
   palette entry (only a few settings panes are, as jump commands).
7. **Worktree leftovers**: the iOS app shows none of them beyond forking into one, and a merge
   into a branch checked out nowhere is refused (`target-not-checked-out`) rather than offered as a
   ref-only merge.
8. **Around the editor.** A text file opens in the editor (`packages/editor`) in the files panel
   and in a file node from a zoom of 0.6, and saves over the mtime it was read at. Left: a PDF
   renderer; a diff node that reuses the git panel's scopes (the files preview has a diff tab with
   them, there is no node kind); a line number in a file node's path (`file.preview` already takes
   one); and "open in editor": an editor probe and preference, `fs.open` with `path:line`, used from
   menus, diff rows and paths in terminal output. Still unmeasured: what a canvas of ten file nodes
   on the largest files of a repository costs, now that the plate and the highlighting cap are the
   two things standing between it and the thirty-node goal.
9. **A test floor**: a dev-only 30-node palette command and whatever it finds; a DOM setup for
   `bun test` with first specs for the composer and the canvas wiring.
10. **More than one window**: a window shows a start screen or one project, and two projects side by
    side never share one (decided 16 September). A second project opens in a window of its own;
    `docs/research/windows.md` is the design and none of it is built. The empty states that stay a
    sentence: the Files and Git panels of a project without a folder, since linking a folder to a
    project needs a request the wire does not have.
11. **Smaller ones**: the ruimte.app landing page, which gets an issue when it starts;
    a color or an arrowhead per plain line; a note's title as the first heading
    of its body; "Clear" in a chat node's menu (`chat.clear` exists, only the composer offers it);
    what happens to a chat's background subagents on a clear (the CLI goes and `background` is
    emptied, but the subagents are not marked stopped the way a cancel does); splitting the
    composer's CodeMirror (~98 kB gzip) out of the workspace chunk, only if a measurement shows
    startup gains.
12. **Remote access leftovers**: a production broker on a server of its own, after which the test
    droplet goes (`apps/pulsar-broker/deploy` has what it runs on); TURN for phones behind
    carrier-grade NAT, built but not measured on real networks; a window of accepted protocol
    versions instead of only the same one (`docs/reports/2026-09-15-protocol-versions.html`, not
    decided); the desktop app overwriting a service `ruimte service install` set up (only the CLI
    checks who owns it); an expired login on station showing an error on the start screen,
    unverified.
13. **Devices** (`docs/reports/2026-09-13-devices.html`): the iOS Simulator, physical iPhones and
    iPads, and Android emulators and phones run as a panel, a view and a node, and an agent operates
    them with `ruimte-context device`. Left: typing on a physical iPhone (the simulator and Android
    have it), and the iPhone app, which knows a device from the generated schema and draws none of
    it. Out on purpose: installing an app and logs.
14. **Plugins** (`docs/reports/2026-09-14-plugins.html`, decisions pending): internal registries
    first (the action registry in `packages/actions` is the first), then a compatibility release in
    contracts, then declarative plugins from `$RUIMTE_HOME/plugins`, isolated code last. The report's
    alternative, plugins that only feed context to agents, is still to be weighed. Unproven: whether
    a compiled binary can `import()` plugin code; ad-hoc compiled binaries get SIGKILL on this Mac,
    so test it in the signed app and never as an agent experiment (one hung for four hours).
15. **Several accounts per CLI** (`docs/reports/2026-09-10-accounts.html`, not decided): one config
    folder per login passed as `CLAUDE_CONFIG_DIR` or `CODEX_HOME` at spawn, the CLI logs in
    itself and Ruimte never writes credentials. The account choice belongs in the local file, not
    in `project.json`.
16. **Orchestration leftovers** (`docs/reports/2026-09-24-orchestration-upstream.html`). Built and
    tested end to end in the dev app: limits and overload with a resume a person turns on, notes for
    a child waiting on input and `ruimte-context answer`, nested subagents, Codex spawned agents, a
    chat attached with `@`, a task that waits for the child's background work (commands up to 30
    minutes), a parent reading its own child, request ids in `read`, the phases of a workflow and a
    background agent's approval that outlives the turn. Open: a mode the CLI does not honor is
    silent (auto on Haiku falls back to default and asks on every tool); a workflow or subagent a
    restart took down settles its task as done, where background commands fail it; a workflow that
    hangs in the CLI holds its task until a person stops the child; a Codex spawned agent's request
    is still dropped at its own turn's end, unverified; the sub-agent list over the composer lacks a
    workflow's agents and background subagent rows fold into their turn; a Codex `subAgentActivity`
    of kind `interacted` is not handled; a resume whose CLI dies before the resume records itself
    ends without its attempt and its note; stashing a draft drops the chats attached to it.

Decided against, so not to be proposed again: a card for a proposed plan (plan mode is not how Bas
works, and Claude Code may drop it), per-project settings (a person keeps their own environment, so
`.ruimte/settings.json` and the paths it linked into new worktrees went), overrides for prices and
plans in usage (it reads the data it has), and a frame rate goal for devices (below 30 fps is fine).

Known gaps to keep in mind: the WebGL budget is a fixed 10 contexts, not a setting and not
measured against what a given machine really keeps alive; the 30-node performance target is
unmeasured, and so are nine cells of the grid at once. Backpressure is handled per socket (output
dropped over the high-water mark, repaired with `session.resync` on drain); what is not there is a
per-session cap, so one very loud shell can still be the reason a client is dropped. An agent's
`view delete` leaves the drawing or diagram file behind: `ProjectStore.mutate` updates the ids
without asking the stores, so orphans only go when a person saves the project. A `codex` typed by hand in a
terminal joins Codex's shared background server, whose hooks carry the token of the terminal that
started it, so its status can land on another node or nowhere. A turn's diff is of
the chat's own folder (or its worktree), so an edit the person made there during the turn lands in
its card too.

Research that is written but not built: `docs/research/windows.md` and the reports under
`docs/reports`. A report goes once its work is done.
