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

Issues #1 to #4 on GitHub describe each phase; #2, #3 and #4 are closed, #1 stays open for
its remaining checklist.

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

## Next

In the order that makes sense, each one an issue on GitHub:

1. **#1 remaining checklist**: command palette (Cmd+K), group node, rename in the sidebar,
   settings dialog with only theme, font and accent, keyboard-only pass.
2. **#5 agent status via hooks** and **#6 chat node** can run in parallel; they touch
   different code. #6 needs `@pierre/diffs` for inline diffs.
3. **#7 Electron shell and browser node**, **#8 projects and persistence**, then #9 to #11.

Known gaps to keep in mind: no WebGL context budget (many visible terminals may lose
contexts), no backpressure for a slow client, the 30-node performance target is unmeasured.
