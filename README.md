# Ruimte

Space for AI Engineering.

Terminals, chats and agents, browsers, devices, drawings, diagrams, files and databases, organized into views you switch between from a sidebar. Sessions survive restarts and reattach where they left off. Put your machines on your account and work on any of them like it's the one in front of you.

https://ruimte.app

## What it does

Each project has views you open from the sidebar. A canvas holds nodes side by side, and a grid of up to three by three shows several views at once.

Ruimte is for anyone running several Claude Code or Codex sessions and losing track of which one needs attention. A chat shows the moment an agent waits for input. Close the window mid-session and the terminal is still there when you come back, scrollback included, because the session runs on your machine and not in the window.

An agent runs in a terminal, in its CLI's own interface, or in a chat Ruimte draws, where you answer its questions and approvals from the app or your phone. Agents open other agents, hand them tasks and wake up when the work is done. A child never gets a wider permission mode than its parent, and `--worktree` gives it a worktree of its own. A chat keeps a plan you and the agent both edit, and an agent can answer with a page it wrote.

A browser node is a real page next to your terminals. A device node shows an iOS simulator, an Android emulator or a connected phone, which an agent can screenshot and tap. On a Mac, computer use lets an agent operate another app, but only one you let it into.

Files open in an editor backed by language servers for TypeScript, Vue, PHP, SQL, CSS, Python and more. The git panel commits, pulls and pushes across every repository in the project folder, and you resolve merge conflicts in the app. Drawings and diagrams are views of their own.

The databases panel connects to SQLite and MySQL or MariaDB, with table views, a SQL console, a table designer and row editing. Agents use the same connections and only read, unless you set a connection to write.

Launches are a project's commands, such as a dev server or test suite, picked up from `package.json`, `composer.json` or run configurations. You approve a launch before it runs, and an agent can start only an approved launch.

On a Mac, Speech to Text dictates into a text field or terminal with a model on your computer, so audio is never uploaded or saved. Voice Control runs on a cloud model; you ask it about the screen or tell it to switch views or open a terminal.

Projects on another machine of your account open like local ones, in the desktop app or at station.ruimte.app. A processes panel shows each session's CPU and memory, and the usage page adds up costs across models and providers.

## Principles

- **Projects and views.** Organize work into projects and choose which views to show together.
- **Selection and camera are explicit state.** A node is selected or it is not, never decided by where the pointer happens to be. Nothing in the background moves the view.
- **Server first.** A backend always owns the sessions and talks to the UI over WebSocket. The desktop app runs one beside it; a remote machine is another endpoint.
- **Opinionated.** Settings cover what differs per person or per machine, such as the theme, keys, providers and what agents may do. Everything else is a default.

## Stack

React 19, TypeScript, Vite, Tailwind v4, Base UI, zustand, Lucide, xterm 6, shiki, react-markdown and `@pierre/diffs`. Bun for tooling.

## Develop

```sh
bun install
bun dev
```

`bun dev` starts the daemon on `localhost:4211`, the Vite client (which proxies `/ws` to it) and the Electron shell. The daemon keeps its state in `~/.ruimte-dev`, or in `RUIMTE_DEV_HOME`. An installed Ruimte keeps `4210` and `~/.ruimte`, so both can run on one machine.

`bun run dev:built` builds the production client and serves its preview on `localhost:4212`, with the watched development daemon and the Electron shell on the same profile, data folder and proxy as `bun dev`. Restart it to rebuild after client changes. `bun run dev:client:built` serves an existing client build on its own.

`bun run dev:client` and `bun run dev:server` start one side. `bun run dev:desktop` opens the Electron shell against the running server as "Ruimte Dev", with its own profile. Browser nodes only work there.

| Command | What |
| --- | --- |
| `bun run check` | Types, lint, formatting and generated files of every package |
| `bun run build` | Builds the client |
| `bun run test` | Unit tests |
| `bun run test:dom` | Client tests that need a page |
| `bun run test:integration` | All automatic integration tests, including the compiled daemon and npm launcher (`--suite core` for the core only) |
| `bun run test:package` | The packaged daemon |
| `bun run test:devices` | Tests that need a running simulator or device, on request only |
| `bun run test:browser` | Browser and Electron checks, on request only (builds the client first) |
| `bun run test:timings` | Measures the per-file durations CI balances its shards by |

How CI splits these jobs is in `CLAUDE.md` ("Conventions") and `.github/workflows/ci.yml`.

`bun run adecore:link` uses the live shared packages in `../adecore`, `bun run adecore:npm` restores the pinned npm versions, and `bun run adecore:status` shows which is active. Restart `bun dev` after switching. See [developing with ADE CORE](docs/ADECORE-DEVELOPMENT.md).

The repo is a Bun workspace. The core is `apps/client` (React UI), `apps/server` (the daemon), `apps/desktop` (the Electron shell) and `packages/contracts` (the zod schemas of the wire). `CLAUDE.md` maps the rest. Shared code comes from ADE CORE packages on npm.

## Release

`bun run dist` builds the client, compiles the daemon for this machine and packages the desktop app into `apps/desktop/release`, signed when a Developer ID is in the keychain. A `v*` tag does the same on GitHub Actions for macOS and Linux and uploads a draft release the app updates from. See `docs/RELEASE.md`.

## License

Ruimte is source available under the [Functional Source License](LICENSE), version 1.1, with an MIT future license. Read it, run it, change it and use it for your own work. The one thing it does not allow is building a competing product with it. Two years after a version is published, that version becomes MIT.
