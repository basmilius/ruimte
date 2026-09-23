# Next

What is still open, roughly in the order that makes sense.

The two open issues first, then the rest. Sizes are rough: hours, a day, several days. Each of the
larger ones becomes a GitHub issue when it starts.

1. **#13**: a webview keeps the canvas's z-order only by being above everything, so a node
   dragged over a browser node slides under its page.
2. **#15**: Windows, which can wait. The daemon on Bun's Windows PTY or Node with node-pty, the
   shell and a release build (`docs/research/windows.md` is the design for a project in its own
   window, not for the platform). Linux runs, see `docs/LINUX.md`; the signed and notarized
   macOS build, the icon and the update path are done, see `docs/RELEASE.md`.
3. **The daemon as a background service** is built (`apps/desktop/src/service`, `packages/service`)
   and waits for a packaged release to be tried, updates included (`apps/server/src/service`).
   Accepting a window of previous protocol versions (the last three, say) instead of only the
   same one is for later, once a bump is in sight. The ruimte.app landing page comes later and gets
   an issue when it starts. A known gap in the checkpoints: the turn diff is of the chat's own folder
   (or its worktree), so an edit the person made there during a turn lands in the card too.
4. **A third chat provider** (Gemini, Copilot or opencode) as the proof that the backend seam
   holds: a provider value, a backend and a protocol mapper, plus one literal in `AgentKind`.
   Hooks for Gemini and Copilot are a day per CLI on top.
5. **Approvals for the other terminal CLIs.** Hook-reply approvals are Claude Code's alone, because
   it is the only terminal CLI with a hook that offers one: Codex waits on such a contract, Gemini
   and Copilot on their hooks in 4.
6. **Terminal basics**, about two days. Search on Cmd+F, clickable file paths and URLs across
   wrapped rows, OSC 52 clipboard, a dropped file types its quoted path, Unicode 11 widths on both
   xterms, "Clear" in the node menu. Then "Send to linked chat" (a terminal selection lands as a
   fenced block in the composer of the chat the node has an edge to) and port discovery: an `lsof`
   poll tied to the owning session, an "Open :5173" chip that adds a browser node with an edge.
7. **Canvas ergonomics**, about two days, all client state. Directional focus on Cmd+Arrow,
   maximize on Cmd+Shift+Enter, camera history on Cmd+[ and Cmd+] (Cmd+1..9 belongs to the views,
   and Cmd+[ to a browser while one is focused; the history stays in the editor and stores nothing).
   Arrange, align and tidy as pure functions with palette entries; palette ranking (exact, prefix,
   substring), `>` for actions, recent nodes on an empty query, settings rows as entries. Images on
   the canvas from paste, stored under `<folder>/.ruimte/images`. An image that is already in the
   folder needs none of this: it is a file node, dragged in from the file manager included. What is
   left is the half with no path behind it, which is the clipboard.
8. **Chat depth**, several days. A proposed plan card with "Implement" and "Implement in a new
   node" (a chat node beside it with a context edge, so the new agent reads the plan through
   `ruimte-context`), subagent rows that stay anchored, citations from selected assistant text,
   review comments from a diff into the prompt, approval choices with the provider's warning text,
   branch a conversation into a new node. Branching is done in phases 1 to 4 ("Fork from here" on
   a turn, the strip's card, the node menu and a chat view's row; a worktree per fork with the work
   after the turn undone; another CLI with a handoff of the last whole turns; a summary written by
   the fork and delivered to the original as a note and a preamble). Left for later: "Restore files to this turn" as its own action on a turn
   (the shared-folder undo) and a verb for agents to fork. The iOS app forks too (a sheet from a
   message's menu, the way back, summaries and a message index in place of the strip). Two small ones:
   a question in a finished turn stays outside its fold, since it explains the answer below it, and
   after Stop an empty composer offers "Continue" in place of the send button.
9. **The action registry** (`packages/actions`): one typed layer under everything a person can do,
   so voice, the UI, shortcuts, the palette and `ruimte-context` become adapters on the same
   execution. The registry and its catalog stand, with the palette, the menus, the shortcuts, the
   sidebar, the view dialogs, the git panel, the conflict overlay, the worktree dialogs, the voice
   tools (generated from the catalog) and every `ruimte-context` verb but `help`, `list` and
   `read` on it (the daemon's handlers in `apps/server/src/actions`). Which actor may run what is
   decided per action; the report's "Wie mag wat" has the table, starting with Git. `agent.start`
   and `team.start` answer `running` with an operation id, which `operation.get`
   (`ruimte-context operation get`) reads off the outbox, the tasks and the agent's own state, with
   no store of its own. Left: operation events for a client, `operation.cancel` (a git run is still
   cancelled with `git.cancel`), a person's agent start on the registry, the domains after Git in
   "Wie mag wat", and a file dropped on a cell of the grid, which no action can place since none
   names a cell. The binding table in 10 hangs on it.
10. **Settings and keyboard**: one binding table with `when` contexts, read by the handlers and the
    Keyboard pane (which lists them read-only today), then overrides with press-to-record, conflict
    labels and reset. A "restore defaults" action, a canvas font size for chat and text elements,
    and settings search that the palette reads.
11. **Per-project settings** in `.ruimte/settings.json`: the file, `project.settings` and its first
    field (`worktrees.share`) are there; the terminal agent mode is next, then clone a repository as a
    project. Worktrees are done in all five phases: the register and safe removal, a tab of everything a worktree holds against the branch it
    came from, merging from the git panel, a node's menu and a group's menu (squash by default, loose
    work committed first, a conflict left for the panel with Abort), the `worktree` verb (`list`,
    `diff`, and `merge` for an agent's own children only, which leaves the worktree and branch for a
    person to remove), shared paths linked into new worktrees, and
    removing a clean worktree from the delete question of its node. Still open from the design: the
    iOS app shows none of it, and a merge into a branch checked out nowhere is refused rather than
    offered as a ref-only merge.
12. **The editor and the diff node**, the half of this the file node does not cover. Saving is the
    whole of it: there is no `fs.write` on the wire, and adding one is a decision about what a
    client may change on a machine, with a conflict question under it (an agent rewrote the file
    meanwhile). Plus a PDF renderer, a diff node that reuses the git panel's scopes, a line number
    in a file node's path, and "open in editor": an editor probe and preference, `fs.open` with
    `path:line`, used from menus, diff rows and paths in terminal output. Still unmeasured: what a
    canvas of ten file nodes on the largest files of a repository costs, now that the plate and the
    highlighting cap are the two things standing between it and the thirty-node goal.
13. **A test floor**: a dev-only 30-node palette command and whatever it finds; a DOM setup for
    `bun test` with first specs for the composer and the canvas wiring.
14. **Usage v2**: a Days table, price and plan overrides, a currency setting, and an export.
15. **More than one window**: a window shows a start screen or one project, and two projects side by
    side never share one (decided 16 September). A second project opens in a window of its own;
    `docs/research/windows.md` is the design. The empty states that stay a sentence: the Files and Git
    panels of a project without a folder, since linking a folder to a project needs a request the
    wire does not have.
16. **Smaller ones**: a color or an arrowhead per plain line; a note's title as the first heading
    of its body; "Clear" in a chat node's menu (`chat.clear` exists, only the composer offers it);
    what happens to a chat's background subagents when its backend goes away on a clear; lazy
    loading the composer's CodeMirror (~98 kB gzip), only if a measurement shows startup gains.
17. **Remote access leftovers**: a production broker on a server of its own, after which the test
    droplet goes; TURN for phones behind carrier-grade NAT, measured on real networks; a window of
    accepted protocol versions (`docs/reports/2026-09-15-protocol-versions.html`, not decided);
    the desktop app overwriting a service `ruimte service install` set up; an expired login on
    station showing an error on the start screen; the daemon installing hooks before its port check.
18. **Devices** (`docs/reports/2026-09-13-devices.html`): the iOS Simulator and physical iPhones and
    iPads run as a panel, a view and a node, on the stream hub a browser page uses. What is left is
    the acceptance on a real device: that device visible over the network again, and stream and
    control together in all three places. Unmeasured: LAN bandwidth, two viewers at once, rotation,
    click to paint, and a helper that crashes under an open view. The one local measurement was
    17.4 fps against a goal of 30. Android is the value `android` in `DevicePlatformSchema` and
    nothing more; the backend on `adb`, the emulator and a pinned scrcpy server is the next build.
    The iPhone app knows a device from the generated schema and draws none of it. Out on purpose:
    the iOS keyboard, installing an app, logs and agent control of a device.
19. **Plugins** (`docs/reports/2026-09-14-plugins.html`, nothing built, decisions pending): internal
    registries first, then a compatibility release in contracts, then declarative plugins from
    `$RUIMTE_HOME/plugins`, isolated code last. The report's alternative, plugins that only feed
    context to agents, is still to be weighed. Unproven: whether a compiled binary can `import()`
    plugin code; ad-hoc compiled binaries get SIGKILL on this Mac, so test it in the signed app and
    never as an agent experiment (one hung for four hours).
20. **Several accounts per CLI** (`docs/reports/2026-09-10-accounts.html`, not decided): one config
    folder per login passed as `CLAUDE_CONFIG_DIR` or `CODEX_HOME` at spawn, the CLI logs in
    itself and Ruimte never writes credentials. The account choice belongs in the local file, not
    in `project.json`.

Known gaps to keep in mind: the WebGL budget is a fixed 10 contexts, not a setting and not
measured against what a given machine really keeps alive; the 30-node performance target is
unmeasured, and so are nine cells of the grid at once. Backpressure is handled per socket (output
dropped over the high-water mark, repaired with `session.resync` on drain); what is not there is a
per-session cap, so one very loud shell can still be the reason a client is dropped. An agent's
`view delete` leaves the drawing or diagram file behind: `ProjectStore.mutate` updates the ids
without asking the stores, so orphans only go when a person saves the project.

Research that is written but not built: `docs/research/windows.md`, and the reports under
`docs/reports` for accounts and remote access.
