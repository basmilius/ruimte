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
  transcript; only their outcome stays as a line.
- **Phase 6c, Codex chat backend**: a chat node with `provider: 'codex'` runs `codex app-server`
  (JSON-RPC over stdio, `apps/server/src/chat/codex-*.ts`). Approvals for commands and file
  changes, both kinds of Codex question (blocking `request_user_input` and the async one that
  arrives as an agent message), interrupt, compact, model and effort, the runtime modes as
  approval policy plus sandbox, restart with `thread/resume`. The Codex catalog is
  `apps/server/src/providers/codex-models.json`, `fake-codex.ts` stands in for the CLI in
  tests. The Agent submenu opens Codex as a chat; "Open in chat" and "Open in terminal" work for
  both CLIs.

Issues #1 to #6 on GitHub describe each phase; #2, #3 and #4 are closed, #1 stays open for
its remaining checklist, #5 and #6 are implemented but wait for a review before closing.

## Decisions that are not in the code

- No kanban view, ever. Bas dislikes that workflow.
- No bare single-letter shortcuts. Every chord needs a modifier and becomes remappable in a
  later settings phase.
- Never highlight the canvas grid in the accent color. The dots stay neutral in every state.
- Icon buttons get equal padding on every side. Buttons that belong together sit in a
  `.btn-group` with 1px gaps; groups keep the wider gap of their container.
- Tooltips are the `Tooltip` component in `src/ui/Tooltip.tsx`, never a `title` attribute.
  One `TooltipProvider` at the app root gives the shared 150 ms delay.
- Escape always leaves node mode, so it never reaches a fullscreen program in a terminal. A
  later "send Escape to the app" toggle is the planned fix.
- Formatting is prettier (`.prettierrc`: single quotes, width 160, 4 spaces). Run
  `bun run format` before a commit.
- Status hooks are `command` hooks with curl, not Claude Code's `http` hooks: the http kind
  cannot read the daemon's port from the environment and reports an error whenever Ruimte is
  not running. The command hook is a no-op without `RUIMTE_HOOK_URL`.
- A chat process is not started when the node mounts, only on the first message, so a canvas
  full of chat nodes costs nothing until used.
- New chats start in full access, as in T3 Code; the composer remembers the last model and
  modes in localStorage. A supervised chat is one click away in the mode picker.
- A model or mode change restarts the CLI process with `--resume` on the next send instead of
  using the control protocol's `set_model`; one path, and the resumed session keeps everything.
- Fast mode is not offered: the installed CLI has no flag for it, only the `/fast` command.
- `CodexChatSession` is a second class with the same surface as `ChatSession` instead of one
  session over a backend interface: the Claude session had three other changes landing on it at
  the same time, so it was left alone. Folding both onto one `ChatBackend` (spawn, reduce,
  answer) is the refactor to do once the parallel work is in.
- Codex runtime modes: `supervised` = `untrusted` + `read-only`, `auto-accept-edits` =
  `untrusted` + `workspace-write`, `auto` = `on-request` + `workspace-write`, `full-access` =
  `never` + `danger-full-access`. Plan mode is a read-only sandbox plus an instruction in the
  prompt, because app-server 0.153 reports the collaboration mode but never takes it. Not
  mapped: cost (Codex reports none), the deny reason, slash commands, permission-profile
  requests and MCP elicitations (refused with a JSON-RPC error). Gemini and Copilot still open
  as terminals with the CLI typed in.
- No attachments, `@file` mentions or `$skills` in the composer yet; those need an upload path
  and a file index on the daemon.

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

In the order that makes sense, each one an issue on GitHub:

1. **#1 remaining checklist**: command palette (Cmd+K), group node, rename in the sidebar,
   settings dialog with only theme, font and accent, keyboard-only pass.
2. **#5 and #6 follow-ups**: attachments and `@file` mentions in the composer, a "send Escape
   to the app" toggle, tool output streaming (`tool_progress`, and Codex's
   `item/commandExecution/outputDelta`), per-turn checkpoints so the changed-files card can show
   real diffs against the working tree instead of the edit's before and after, and the Codex
   `fileChange` diffs (unified, not before/after) in that same card.
3. **#7 Electron shell and browser node**, **#8 projects and persistence**, then #9 to #11.

Known gaps to keep in mind: no WebGL context budget (many visible terminals may lose
contexts), no backpressure for a slow client, the 30-node performance target is unmeasured.
