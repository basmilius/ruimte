# Ruimte

Terminals, agents and browsers on one infinite canvas. Read `README.md` for the principles. This file is for anyone (human or agent) changing code.

## Layout

Bun workspaces (`bun install` at the root):

- `apps/client`: the React UI (Vite). Never imports Node or Bun APIs. Talks to the server only through the `Transport` interface.
- `apps/server`: the daemon (Bun runtime). Owns sessions, PTYs and persistence. Serves the WebSocket API on `localhost:4210` by default (`--host`, `--port`).
- `packages/contracts`: zod 4 schemas for every message on the wire, plus the TypeScript types derived from them. Both apps import from here; nothing else may define a wire shape. `REQUEST_SCHEMAS` and `EVENT_SCHEMAS` are the tables both sides derive `RequestMap` and `EventMap` from.

Shared config at the root: `tsconfig.base.json` (every package extends it), `.oxlintrc.json`, `.editorconfig`, `bun.lock`. `bun run check` runs `typecheck` in every workspace and then oxlint. In dev the Vite server proxies `/ws` to the daemon, so the client always connects to its own origin.

## Wire protocol

One WebSocket. JSON frames validated with zod on both ends.

- Request from client: `{ id: string, type: string, payload }`. Reply from server: `{ id, ok: true, result }` or `{ id, ok: false, error: { code, message } }`.
- Event from server (no `id`): `{ type: 'event', event: string, payload }`.
- Terminal output travels as `{ event: 'session.output', payload: { sessionId, data } }` where `data` is a UTF-8 string, coalesced per animation frame on the server.

## Terminal sessions (the daemon)

- A session is keyed by an id the CLIENT chooses (the node id), so a node reattaches to its own session after a reload.
- PTY via `Bun.spawn({ terminal: { cols, rows } })`. No node-pty, no tmux.
- Every session runs `@xterm/headless` with `@xterm/addon-serialize` in the daemon. `session.attach` answers with the serialized screen, then streams raw output. A client never replays history itself.
- Scrollback snapshot to `$RUIMTE_HOME/sessions/<id>.txt` (default `~/.ruimte`) on a timer and on shutdown; written temp-file plus atomic rename.

## Conventions

- TypeScript everywhere, 4 spaces, LF, `.editorconfig` is the rule.
- American English in code, comments, commit messages and UI text. No em dashes or en dashes anywhere; use a comma, colon or parentheses.
- Always curly braces, also for one-line early returns. No one-letter variable names except `i`, `e`, `x`, `y`.
- Arrow functions inside functions; class methods are never arrow properties.
- Comments explain WHY, never what the code already says. Delete a comment that restates the line below it.
- Components: only semantic tokens from `styles.css` (`bg-surface`, `text-text-muted`, ...). No raw colors outside that file.
- Tests with `bun test` next to the code they test (`foo.test.ts`). A test that needs a real shell may spawn one; it must clean up its own processes.
- `bun run check` (typecheck plus lint) must pass before a commit. Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).
- Written from scratch. Do not copy code from nodeterm, T3 Code or any other product; sharing ideas and npm packages is fine.
