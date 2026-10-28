# Ruimte

Space for AI Engineering.

Terminals, chats and agents, browsers, devices, drawings, diagrams, files and databases, organized into views you switch between from a sidebar. Sessions survive restarts and reattach where they left off. Put your machines on your account and work on any of them like it's the one in front of you.

https://ruimte.app

## What it does

Each project has views you open from the sidebar. A canvas holds nodes side by side, and a grid of up to three by three shows several views at once, so an agent, a terminal and a browser each get a cell of their own.

Ruimte is for anyone running several Claude Code or Codex sessions at once and losing track of which one needs attention. A chat shows the moment an agent stops and waits for input, so there's no tailing a log to catch it. Close the window mid-session and open it again later. The terminal is where you left it, scrollback included, because the session keeps running on your machine and not inside the window you closed.

An agent runs in a terminal, in its CLI's own interface, or in a chat that Ruimte draws, where you answer its questions and approvals from the app or your phone. Agents open other agents, hand them tasks and wake up when the work is done. A child never gets a wider permission mode than its parent, and an agent started with `--worktree` gets a worktree of its own. A chat keeps a plan you and the agent both edit, and an agent can answer with a page it wrote instead of a wall of text.

A browser node is a real page next to your terminals. A device node shows an iOS simulator, an Android emulator or a phone connected to the machine, and an agent you connect to it can take screenshots and tap. On a Mac, computer use lets an agent operate another app, but only an app you let it into.

Files open in an editor backed by language servers the machine runs for the project, for TypeScript, Vue, PHP, SQL, CSS, Python and more. The git panel commits, pulls and pushes across every repository in the project folder, and a merge conflict is resolved in the app, never through markers in the file. Drawings and diagrams are views of their own, saved with the project.

The databases panel connects to SQLite and MySQL or MariaDB, with table views, a SQL console, a table designer and row editing. Agents query through the same connections and only read, unless you set a connection to write.

Launches are the commands a project runs, such as a dev server or a test suite, picked up from its `package.json`, `composer.json` or run configurations. You approve a launch before it runs, and an agent can start only a launch you approved.

On a Mac, Speech to Text dictates into a text field or a terminal once you turn it on. Its model runs on your computer, so audio is never uploaded or saved. Voice Control is a separate feature on a cloud model, which you ask about what is on screen or tell to focus another view or open a terminal.

Projects on another machine of your account open like local ones, in the desktop app or on the web at station.ruimte.app. A processes panel shows each session's CPU and memory use. The usage page adds up costs across models and providers.

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

`bun dev` starts the daemon on `localhost:4211`, the Vite client and the Electron shell. The daemon keeps its state in `~/.ruimte-dev`; set `RUIMTE_DEV_HOME` to choose another folder. The Vite client proxies `/ws` to it. An installed Ruimte keeps `4210` and `~/.ruimte`, so both versions can run on one machine.

`bun run dev:built` builds the production client, then starts its preview server on `localhost:4212`, the development daemon with watch and the Electron shell. The shell waits for the daemon before opening, so native helper preparation stays in the terminal. It uses the same dev profile, data folder and daemon proxy as `bun dev`. Restart the command to rebuild after client changes. `bun run dev:client:built` serves an existing client build on its own.

`bun run dev:client` and `bun run dev:server` start one side. `bun run dev:desktop` opens the Electron shell against the running development server as "Ruimte Dev", with a profile of its own. Browser nodes only work there. `bun run check` typechecks, lints and checks the formatting and the generated files of every package. `bun run build` builds the client, `bun run test` runs the unit tests, and `bun run test:dom` the client tests that need a page.

`bun run test:integration` runs all automatic integration tests, including the compiled daemon and npm launcher. CI runs the core suite (`bun run test:integration --suite core`) and the packaged daemon (`bun run test:package`) in parallel. Tests that need an already running simulator or device run only on request with `bun run test:devices`. Browser and Electron checks run only on request, with `bun run test:browser` (which builds the client first) or the Browser tests workflow in GitHub Actions.

CI (`.github/workflows/ci.yml`) runs the unit tests in two shards with isolated files, balanced by the per-file durations in `test-timings.json`; `bun run test:timings` measures them again. Type, lint and formatting checks, the unit shards and the DOM tests run on Linux, since every platform a unit test names is passed in. The core integration tests and the packaged daemon run on macOS and Linux (`ubuntu-latest`; the packaged daemon on `ubuntu-22.04`, the release's glibc floor). Generated native fixtures, builds and the file system tests again on a case-insensitive volume run on macOS only. Checks, the client and desktop build, the core integrations and the packaged daemon run as independent jobs, and the final CI check requires them all.

`bun run adecore:link` uses the live shared packages in `../adecore`; `bun run adecore:npm` restores the pinned npm versions. `bun run adecore:status` shows which mode is active. Restart `bun dev` after switching. See [developing with ADE CORE](docs/ADECORE-DEVELOPMENT.md) for setup, source updates and release order.

The repo is a Bun workspace. The core is `apps/client` (React UI), `apps/server` (the daemon), `apps/desktop` (the Electron shell) and `packages/contracts` (zod 4 schemas for the wire, the only place a message shape is defined); the iPhone app, the web client, the website and the native helpers sit beside them, and `CLAUDE.md` maps every one. Shared code comes from ADE CORE packages on npm, such as `@adecore/drawing` (the geometry, the SVG painter and the reading order of a drawing, without a DOM).

## Release

`bun run dist` builds the client, compiles the daemon for this machine and packages the desktop app into `apps/desktop/release` (signed when a Developer ID is in the keychain). A `v*` tag does the same on GitHub Actions for macOS and Linux and uploads a draft release that the app updates from; see `docs/RELEASE.md` for the icon, the signature and the notarization.

## License

Ruimte is source available under the [Functional Source License](LICENSE), version 1.1, with an MIT future license. Read it, run it, change it and use it for your own work. The one thing it does not allow is building a competing product with it. Two years after a version is published, that version becomes MIT.
