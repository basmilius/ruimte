# Ruimte

Space for AI Engineering.

Terminals, agents, browsers, drawings and files, organized into views you switch between from a sidebar. Sessions survive restarts and reattach where they left off. Put your machines on your account and work on any of them like it's the one in front of you.

https://ruimte.app

## What it does

Each project has views you open from the sidebar. A grid of up to three by three shows several at once, so an agent session, a terminal and a browser each get a cell of their own.

Ruimte is for anyone running several Claude Code or Codex sessions at once and losing track of which one needs attention. A chat shows the moment an agent stops and waits for input, so there's no tailing a log to catch it. Close the window mid-session and open it again later. The terminal is where you left it, scrollback included, because the session keeps running on your machine and not inside the window you closed.

Projects on another machine of your account open like local ones. A processes panel shows each session's CPU and memory use. The usage page adds up costs across models and providers.

## Principles

- **Projects and views.** Organize work into projects and choose which views to show together.
- **Selection and camera are explicit state.** A node is selected or it is not, never decided by where the pointer happens to be. Nothing in the background moves the view.
- **Server first.** A backend always owns the sessions and talks to the UI over WebSocket. The desktop app runs one beside it; a remote machine is another endpoint.
- **Opinionated.** A handful of settings in the UI. Everything else is a default.

## Stack

React 19, TypeScript, Vite, Tailwind v4, Base UI, zustand, Lucide, xterm 6, shiki, react-markdown and `@pierre/diffs`. Bun for tooling.

## Develop

```sh
bun install
bun dev
```

`bun dev` starts the daemon on `localhost:4211`, the Vite client and the Electron shell. The daemon keeps its state in `~/.ruimte-dev`; set `RUIMTE_DEV_HOME` to choose another folder. The Vite client proxies `/ws` to it. An installed Ruimte keeps `4210` and `~/.ruimte`, so both versions can run on one machine.

`bun run dev:client` and `bun run dev:server` start one side. `bun run dev:desktop` opens the Electron shell against the running development server as "Ruimte Dev", with a profile of its own. Browser nodes only work there. `bun run check` typechecks and lints every package. `bun run build` builds the client, and `bun run test` runs the unit tests.

`bun run test:integration` runs the integration tests CI uses. Browser and Electron checks run only on request, with `bun run test:browser` (which builds the client first) or the Browser tests workflow in GitHub Actions.

`bun run adecore:link` uses the live shared packages in `../adecore`; `bun run adecore:npm` restores the pinned npm versions. `bun run adecore:status` shows which mode is active. Restart `bun dev` after switching. See [developing with ADE CORE](docs/ADECORE-DEVELOPMENT.md) for setup, source updates and release order.

The repo is a Bun workspace: `apps/client` (React UI), `apps/server` (the daemon), `apps/desktop` (the Electron shell) and `packages/contracts` (zod 4 schemas for the wire, the only place a message shape is defined). Shared code comes from ADE CORE packages on npm, such as `@adecore/drawing` (the geometry, the SVG painter and the reading order of a drawing, without a DOM).

## Release

`bun run dist` builds the client, compiles the daemon for this machine and packages the desktop app into `apps/desktop/release` (signed when a Developer ID is in the keychain). A `v*` tag does the same on GitHub Actions for macOS and Linux and uploads a draft release that the app updates from; see `docs/RELEASE.md` for the icon, the signature and the notarization.

## License

Ruimte is source available under the [Functional Source License](LICENSE), version 1.1, with an MIT future license. Read it, run it, change it and use it for your own work. The one thing it does not allow is building a competing product with it. Two years after a version is published, that version becomes MIT.
