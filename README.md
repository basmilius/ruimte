# Ruimte

Space for AI Engineering.

Terminals, agents, browsers, drawings and files, organized into views you switch between from a sidebar. Sessions survive restarts and reattach right where they left off. Pair with any machine on your network and work on it like it's your own.

https://ruimte.app

## What it does

A project is a sidebar of views, not a folder of tabs. A view is usually a canvas, where terminal, chat, browser, file, drawing and group nodes sit next to each other, plus free text that isn't a node. But a chat, a terminal, a browser, a drawing or a file can also stand on its own as a view, so a Claude Code session that matters gets its own row in the sidebar instead of hiding among five other things on a canvas. Open several views at once in a grid up to three by three, so a terminal, an agent session and a browser each keep their own cell instead of taking turns in the same window.

Ruimte is for anyone running several Claude Code or Codex sessions at once and losing track of which one needs attention. A chat shows the moment an agent stops and waits for input, so there's no tailing a log to catch it. Close the window mid-session and open it again later. The terminal is exactly where you left it, scrollback included, because the session itself keeps running on your machine, not inside the window you closed.

Pair another machine on your network once and its projects open like local projects. A processes panel shows each session's CPU and memory use. The usage page adds up costs across models and providers.

## Principles

- **Views, not tabs.** A project is a sidebar of views. Most are canvases holding many kinds of things at once; a chat, terminal, browser, drawing or file can also stand as a view of its own.
- **Selection and camera are explicit state.** A node is selected or it is not, never decided by where the pointer happens to be. Nothing in the background moves the view.
- **Server first.** There is always a backend that owns sessions and talks to the UI over WebSocket. The desktop app embeds it; a remote machine is another endpoint.
- **Opinionated.** A handful of settings in the UI. Everything else is a default.

## Stack

React 19, TypeScript, Vite, Tailwind v4, Base UI, zustand, Lucide, xterm 6, shiki, react-markdown and `@pierre/diffs`. Bun for tooling.

## Develop

```sh
bun install
bun dev
```

`bun dev` starts the daemon on `localhost:4211`, the Vite client and the Electron shell. The daemon keeps its state in `~/.ruimte-dev`; set `RUIMTE_DEV_HOME` to choose another folder. The Vite client proxies `/ws` to it. An installed Ruimte keeps `4210` and `~/.ruimte`, so both versions can run on one machine.

`bun run dev:client` and `bun run dev:server` start one side. `bun run dev:desktop` opens the Electron shell against the running development server as "Ruimte Dev", with a profile of its own. Browser nodes only work there. `bun run check` typechecks and lints every package. `bun run build` builds the client, and `bun test` runs all package tests.

The repo is a Bun workspace: `apps/client` (React UI), `apps/server` (the daemon), `apps/desktop` (the Electron shell), `packages/contracts` (zod 4 schemas for the wire, the only place a message shape is defined) and `packages/drawing` (the geometry, the SVG painter and the reading order of a drawing, without a DOM).

## Release

`bun run dist` builds the client, compiles the daemon for this machine and packages the desktop app into `apps/desktop/release` (signed when a Developer ID is in the keychain). A `v*` tag does the same on GitHub Actions for macOS and Linux and uploads a draft release that the app updates from; see `docs/RELEASE.md` for the icon, the signature and the notarization. `bun run serve` is the Server Edition: the daemon serving the built client to browsers on the network.

## License

Ruimte is source available under the [Functional Source License](LICENSE), version 1.1, with an MIT future license. Read it, run it, change it and use it for your own work. The one thing it does not allow is building a competing product out of it. Two years after a version is published, that version becomes MIT.
