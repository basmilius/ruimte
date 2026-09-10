# Ruimte

Terminals, agents and browsers on one infinite canvas. Sessions survive restarts. Focus stays where you put it. The camera moves only when you move it.

https://ruimte.app

## Principles

- **One canvas per view, many kinds of things on it.** A view is also a chat, a terminal, a browser or a drawing on its own. On a canvas: terminal, chat, browser, note, drawing and group nodes, plus free text that is not a node.
- **Focus and camera are explicit state.** Canvas mode or node mode, never decided by where the pointer happens to be. Nothing in the background moves the view.
- **Server first.** There is always a backend that owns sessions and talks to the UI over WebSocket. The desktop app embeds it; a remote machine is another endpoint.
- **Opinionated.** A handful of settings in the UI. Everything else is a default.
- **Written from scratch.** Shared ideas and open-source building blocks, never code copied from another product.

## Stack

React 19, TypeScript, Vite, Tailwind v4, Base UI, zustand, Lucide, xterm 6, shiki, react-markdown and `@pierre/diffs`. Bun for tooling.

## Develop

```sh
bun install
bun dev
```

`bun dev` starts the daemon on `localhost:4210` and the Vite client, which proxies `/ws` to it. `bun run dev:client` and `bun run dev:server` start one side. `bun run dev:desktop` opens the Electron shell against the running dev server; browser nodes only work there. `bun run check` typechecks every package and lints, `bun run build` builds the client, `bun test` runs the tests of all packages.

The repo is a Bun workspace: `apps/client` (React UI), `apps/server` (the daemon), `apps/desktop` (the Electron shell), `packages/contracts` (zod 4 schemas for the wire, the only place a message shape is defined) and `packages/drawing` (the geometry, the SVG painter and the reading order of a drawing, without a DOM). `docs/HANDOFF.md` says how the code got the way it is, `docs/PLAN.md` what comes next.

## Release

`bun run dist` builds the client, compiles the daemon for this machine and packages the desktop app into `apps/desktop/release` (signed when a Developer ID is in the keychain). A `v*` tag does the same on GitHub Actions for macOS and Linux and uploads a draft release that the app updates from; see `.github/workflows/release.yml` for the signing secrets. `bun run serve` is the Server Edition: the daemon serving the built client to browsers on the network.
