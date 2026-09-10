# Ruimte

Terminals, agents and browsers on one infinite canvas. Sessions survive restarts. Focus stays where you put it. The camera moves only when you move it.

https://ruimte.app

## Principles

- **One canvas, many kinds of things on it.** Terminal, chat, browser and group nodes, plus free text that is not a node.
- **Focus and camera are explicit state.** Canvas mode or node mode, never decided by where the pointer happens to be. Nothing in the background moves the view.
- **Server first.** There is always a backend that owns sessions and talks to the UI over WebSocket. The desktop app embeds it; a remote machine is another endpoint.
- **Opinionated.** A handful of settings in the UI. Everything else is a default.
- **Written from scratch.** Shared ideas and open-source building blocks, never code copied from another product.

## Stack

React 19, TypeScript, Vite, Tailwind v4, Base UI, motion, zustand, Font Awesome Pro. Bun for tooling.

## Develop

```sh
bun install
bun dev
```

`bun dev` starts the daemon on `localhost:4210` and the Vite client, which proxies `/ws` to it. `bun run dev:client` and `bun run dev:server` start one side. `bun run dev:desktop` opens the Electron shell against the running dev server; browser nodes only work there. `bun run check` typechecks every package and lints, `bun run build` builds the client, `bun test` runs the tests of all packages.

The repo is a Bun workspace: `apps/client` (React UI), `apps/server` (the daemon), `apps/desktop` (the Electron shell) and `packages/contracts` (zod 4 schemas for the wire, the only place a message shape is defined). Phase 1 was a browser-only UI prototype; see the issues for the phases that follow.

## Release

`bun run dist` builds the client, compiles the daemon for this machine and packages the desktop app into `apps/desktop/release` (signed when a Developer ID is in the keychain). A `v*` tag does the same on GitHub Actions for macOS and Linux and uploads a draft release that the app updates from; see `.github/workflows/release.yml` for the signing secrets. `bun run serve` is the Server Edition: the daemon serving the built client to browsers on the network.
