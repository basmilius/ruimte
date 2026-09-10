# Plan

What comes after the UI round of 2026-09-10, in the order that makes sense. Each phase becomes one
GitHub issue when it starts. Sizes are rough: hours, a day, several days. Sources: the handoff, the
open issues (#11, #12, #13), and three design studies.
Recorded decisions still hold: no kanban, no scheduler, no minimap for now, no checkpoint restore,
no telemetry, releasing waits until there is time for it.

## Phase 14: UI round (running)

Lucide through the `Icon` component, node header 39px, icon sizes that follow the text beside them,
a folder icon for the files panel. Then: a collapsible sidebar, the Files and
Git panels spanning the full main column with the toolbar pushed aside and an open and close
transition, one `Select` on Base UI for every native `<select>`, and the improvement list from the
UI study, picked over by hand.

## Phase 15: housekeeping

Hours to a day, before anything else lands on top.

- CI: the hook test that times out on ubuntu (`a command given at create runs as the first line`),
  a `format:check` step, then push main.
- Contracts: drop `interactionMode` (contracts, `chat-session`, both backends, the provider args and
  their tests; stored chats keep parsing) and `ProviderCapabilities.planMode`.
- Code: remove `motion`, `.app-no-drag`, the duplicated header constant in `WebviewLayer`, the empty
  `apps/client/src/lib`, and the `export` on symbols with no importer. Decide what `docs/reports`
  and `docs/prompts` are for; delete them if nothing.
- Docs: the handoff's date, test count, issue status, the "Next" list, the README stack line; tick
  the finished boxes on #11 and #12. Silence the Timeline lint warning with a reason.

## Phase 16: the gaps and a test floor

Two to three days.

- WebGL context budget: a cap in the terminal registry, contexts for the focused and most recent
  terminals only, re-acquire on focus instead of disposing for good.
- Backpressure: watch `getBufferedAmount()` per client, drop output frames while it is high, resync
  that client with a fresh attach when it drains.
- A 30-node harness (dev-only palette command or a Playwright spec, out of CI) and whatever it finds.
- Component tests: a DOM setup for `bun test`, first specs for the composer and the canvas wiring; a
  daemon-backed e2e job in CI for the terminal spec.

## Phase 17: Git panel and Files panel

Several days each. The panels exist as empty surfaces; the checkpoints module and `UnifiedDiff`
already do most of the diff work.

- Git: `git.status` (branch, ahead and behind, changed files, streamed), `git.diff` per path with
  three scopes (working tree, against the base branch, this turn), a file tree, refresh on focus.
  Then one stacked `git.action` for commit, push and PR through `gh`, the message written by the
  chat CLI when left empty, progress as a toast, acting on the folder or a selected group's worktree.
  Pull when behind from the branch chip.
- Files: done. `fs.list`, `fs.watch` and `fs.changed` are on the wire, the tree (`@pierre/trees`),
  the filter over `fs.search`, the drag onto a chat node as a mention and the tabbed viewer are in,
  and so is the reading: a bounded `fs.read` with a binary sniff, an image route next to it, and the
  renderers behind them (shiki, markdown, images). No file manager.
- Open in editor: an editor probe and preference, `fs.open` with `path:line`, used from menus, diff
  rows and paths in terminal output.

## Phase 18: agents on the canvas

Several days. This is where Ruimte earns its name.

- Canvas control for agents: verbs on `ruimte-context` (`list`, `open`, `note`, `link`, `group`,
  `spawn-team`) that the daemon applies to `project.json` so the watcher carries them to the client.
  No write or close verbs. Spawn team on top: up to eight roles, opened in a group and linked back.
- Hook-reply approvals for terminal agents: hold Claude's `PermissionRequest` on the daemon and
  answer it from the node header or the notification.
- Hooks for Gemini and Copilot (a day per CLI), and the Codex hook contract in a terminal (#12).
- Attention: an unseen dot on a node whose turn settled while it was not focused, a "Finished"
  count in the status summary, turn-done notification with a sound toggle, a dock badge with the
  needs-you count, keep awake while an agent runs, confirm before quitting with a running agent.

## Phase 19: terminal basics

About two days.

- Search on Cmd+F, clickable file paths and URLs across wrapped rows (paths to reveal, later to the
  editor node), OSC 52 clipboard, a dropped file types its quoted path, Unicode 11 widths on both
  xterms, "Clear" in the node menu.
- "Send to linked chat": a terminal selection lands as a fenced block in the composer of the chat
  the node has an edge to.
- Port discovery: an `lsof` poll tied to the owning session, an "Open :5173" chip on the terminal
  that adds a browser node with an edge.

## Phase 20: canvas ergonomics

About two days, all machine state.

- Directional focus on Cmd+Arrow, maximize a node on Cmd+Shift+Enter, camera history on Cmd+[ and
  Cmd+], Cmd+1..9 to focus the nth node.
- Arrange, align and tidy as pure functions with palette entries; palette ranking (exact, prefix,
  substring), `>` for actions, recent nodes on an empty query, settings rows as entries.
- Images on the canvas from paste or drop, stored under `<folder>/.ruimte/images`; a color or an
  arrowhead per plain line.

## Phase 21: chat depth

Several days.

- Proposed plan card with "Implement" and "Implement in a new node" (a chat node next to it with a
  context edge, so the new agent reads the plan through `ruimte-context`).
- A thinking row before the first output, subagent rows that stay anchored, "Copy code" per block,
  citations from selected assistant text, review comments from a diff into the prompt, approval
  choices with the provider's warning text, branch a conversation into a new node.

## Phase 22: providers and projects

Several days.

- A third chat provider (Gemini, Copilot or opencode, whichever has a stable machine protocol) as
  the proof that the backend seam holds: one provider value, one backend, one mapper, one fake.
- Per-project settings in `.ruimte/settings.json` (terminal agent mode first), worktree merge and
  removal from the group menu, shared paths (`node_modules`, `.env`) linked into a new worktree,
  clone a repository as a project.

## Phase 23: editor, image and diff nodes

Several days, after the Files panel gives the daemon `fs.read`.

- Editor node with save, markdown preview, image and PDF preview; an image node; a diff node that
  reuses the Git panel's scopes.

## Phase 24: keyboard

A day for the table, several days for remapping.

- One binding table with `when` contexts, read by the handlers and the Keyboard pane; then
  overrides with press-to-record, conflict labels and reset. Settings search that the palette reads.

## Phase 25: shipping (when there is time)

Issue #11 as it stands: Apple secrets and a `v0.1.0` tag, Pages with source "GitHub Actions", a
real app icon, the 30-second video, Windows (PTY on Bun or Node), the daemon as a background service.
Browser streaming (`docs/research/browser-streaming.md`) and a relay only once a remote daemon is in
daily use. Issue #13 (webview z-order, measured inset, Linux and Windows runs) goes with the runs.

## Skipped on purpose

Skipped: kanban, loop and trigger nodes, minimap, dictation, notch HUD, agent-to-agent
messages through the PTY, mobile app, managed accounts, terminal color schemes, most of its settings
panes. Also left out: a pull request client, a hosted cloud account and relay, SSH and WSL environments, MCP browser
automation, cookie and theme import, usage scanning, the mobile app. Neither has fork, retry or
edit-and-resend in a shape worth building yet.
