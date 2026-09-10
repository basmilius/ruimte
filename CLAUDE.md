# Ruimte

Terminals, agents and browsers on one infinite canvas. Read `README.md` for the principles and `docs/HANDOFF.md` for the current state, the decisions that are not in the code, and what comes next. This file is for anyone (human or agent) changing code.

## Layout

Bun workspaces (`bun install` at the root):

- `apps/client`: the React UI (Vite). Never imports Node or Bun APIs. Talks to the server only through the `Transport` interface.
- `apps/server`: the daemon (Bun runtime). Owns sessions, PTYs and persistence. Serves the WebSocket API on `localhost:4210` by default (`--host`, `--port`), and a built client with `--serve`.
- `apps/desktop`: the Electron shell. One window, the client inside it, the daemon next to it. Only window chrome, native dialogs and guest devtools cross IPC (`src/preload.ts` mirrors `apps/client/src/desktop/bridge.ts`). Start it with `bun run dev:desktop` while `bun dev` runs. A packaged app (`bun run dist`, `electron-builder.yml`) carries the compiled daemon (`apps/server/scripts/compile.ts`) and the built client as resources.
- `packages/contracts`: zod 4 schemas for every message on the wire, plus the TypeScript types derived from them. Both apps import from here; nothing else may define a wire shape. `REQUEST_SCHEMAS` and `EVENT_SCHEMAS` are the tables both sides derive `RequestMap` and `EventMap` from.

Shared config at the root: `tsconfig.base.json` (every package extends it), `.oxlintrc.json`, `.editorconfig`, `bun.lock`. `bun run check` runs `typecheck` in every workspace and then oxlint. In dev the Vite server proxies `/ws` to the daemon, so the client always connects to its own origin.

## Wire protocol

One WebSocket. JSON frames validated with zod on both ends.

- Request from client: `{ id: string, type: string, payload }`. Reply from server: `{ id, ok: true, result }` or `{ id, ok: false, error: { code, message } }`.
- Event from server (no `id`): `{ type: 'event', event: string, payload }`.
- Terminal output travels as `{ event: 'session.output', payload: { sessionId, data } }` where `data` is a UTF-8 string, coalesced per animation frame on the server.
- Agent status travels as `session.status` (`agent: AgentInfo | null`), chat threads as `chat.event` (`item` upsert, `delta`, `info`). The daemon also serves `POST /hooks/<kind>` for the CLIs' hooks, bearer token per session.

## Terminal sessions (the daemon)

- A session is keyed by an id the CLIENT chooses (the node id), so a node reattaches to its own session after a reload.
- PTY via `Bun.spawn({ terminal: { cols, rows } })` behind the `PtyAdapter` interface (`apps/server/src/pty`). No node-pty, no tmux.
- Every session runs `@xterm/headless` with `@xterm/addon-serialize` in the daemon. `session.attach` answers with the serialized screen, then streams raw output. A client never replays history itself.
- Output is buffered per attached client and flushed every 16 ms, on detach and on exit. `Session.attach` registers the client in the same tick the serialize resolves, so a byte is either in the screen or in the stream, never both.
- Scrollback snapshot to `$RUIMTE_HOME/sessions/<id>.txt` (default `~/.ruimte`) every 30 s and on SIGINT/SIGTERM; written temp-file plus atomic rename, file name via `encodeURIComponent(id)`.
- A shell that ends on its own leaves the session listed as `exited` (last screen still attachable). `session.kill` removes the session after its `session.exit` event and deletes the snapshot. `session.create` on an exited or snapshotted id starts a fresh shell with the old screen above a `[session restored, previous shell ended]` line.
- `ClientConnection.id` is the per-socket client id; `main.ts` subscribes each socket to the `SessionManager` and the `ChatManager` and calls `detachAll` on both when it closes. See `apps/server/README.md` for flags, hooks, chats and the on-disk layout.
- Agent status comes from the CLIs' hooks only (`apps/server/src/agents`), never from parsing output. A chat node is the CLI's stream-json protocol (`apps/server/src/chat`), no SDK.
- A project's canvas is `<folder>/.ruimte/project.json` with a monotonic `rev` (`apps/server/src/projects`); machine state (camera, focus) never goes into that file. The client saves through `project.save` with the rev it loaded and reacts to `project.changed` from the daemon's watcher.
- A loopback client needs no token; any other client pairs once (`POST /auth/pair`) and sends its session token as `?token=` on the socket (`apps/server/src/auth`). The client keeps one active endpoint at a time (`apps/client/src/state/endpoints.ts`).
- Edges into an agent node become readable context: the client sends `context.set`, the daemon serves `GET /context` with the session's token, and `ruimte-context` (a script on every session's PATH that runs `ruimte context`) is how an agent reads it. Worktrees live under `$RUIMTE_HOME/worktrees` (`apps/server/src/git`).

## Conventions

- TypeScript everywhere, 4 spaces, LF, `.editorconfig` is the rule.
- American English in code, comments, commit messages and UI text. No em dashes or en dashes anywhere; use a comma, colon or parentheses.
- Always curly braces, also for one-line early returns. No one-letter variable names except `i`, `e`, `x`, `y`.
- Arrow functions inside functions; class methods are never arrow properties.
- Comments explain WHY, never what the code already says. Delete a comment that restates the line below it.
- Components: only semantic tokens from `styles.css` (`bg-surface`, `text-text-muted`, ...). No raw colors outside that file. Tooltips are the `Tooltip` component (`src/ui/Tooltip.tsx`), never a `title` attribute. Icon buttons that belong together go in a `BTN_GROUP` (`src/ui/classes.ts`, where the class strings more than a couple of call sites share live). Icons are Lucide through the `Icon` component (`src/ui/Icon.tsx`), never another icon set. The one exception is the icon of a file, which is the `@pierre/trees` set through `FileIcon` (`src/ui/FileIcon.tsx`) and keeps that set's own colors. No fractional pixels: sizes, spacing and stroke widths are whole numbers, and a `rem` or `em` has to resolve to one.
- Tests with `bun test` next to the code they test (`foo.test.ts`). A test that needs a real shell may spawn one; it must clean up its own processes.
- `bun run format` (prettier, `.prettierrc`) and `bun run check` (typecheck plus lint) must pass before a commit. Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).
- Written from scratch. Do not copy code from nodeterm, T3 Code or any other product; sharing ideas and npm packages is fine.
