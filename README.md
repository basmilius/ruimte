<img src="assets/AppIcon.export/AppIcon%20Exports/AppIcon-iOS-Default-128@2x.png" alt="" width="96" height="96">

# Ruimte

Space for AI Engineering.

Ruimte is a workspace for running AI agents next to the rest of your work. Terminals, chats, browsers, devices, files and databases live in views you switch between from a sidebar. Sessions run on your machine and not in the window, so they survive a restart and reattach where they left off.

[Website](https://ruimte.app) · [Guide](https://ruimte.app/docs/guide) · [Download](https://ruimte.app/download) · [Releases](https://github.com/basmilius/ruimte/releases)

## What it is

Ruimte is for anyone running several Claude Code, Codex or other agent sessions and losing track of which one needs attention.

- **Projects and views.** A project has views you open from the sidebar. A canvas holds nodes side by side, and a grid of up to three by three shows several views at once.
- **Agents.** An agent runs in a terminal, in its CLI's own interface, or in a chat Ruimte draws. You answer its questions and approvals from the app or your phone. Agents start other agents, hand them tasks and wake up when the work is done.
- **Browsers and devices.** A browser node is a real page next to your terminals. A device node shows an iOS simulator, an Android emulator or a connected phone, which an agent can screenshot and tap.
- **Files and git.** An editor backed by language servers, a git panel that works across every repository in the project folder, and merge conflicts you resolve in the app.
- **Databases.** SQLite, MySQL and MariaDB with table views and a SQL console. Agents use the same connections and only read, unless you set a connection to write.
- **Launches.** A project's commands, such as a dev server or a test suite. You approve a launch before it runs, and an agent starts only an approved one.
- **Machines.** Put your machines on your account and open a project on any of them like a local one.

The [guide](https://ruimte.app/docs/guide) covers each of these, plus plans, routines, tunnels, drawings, voice and computer use.

## Install

Download the desktop app from [ruimte.app/download](https://ruimte.app/download). It runs on Apple silicon Macs, on Linux (x64 and arm64) and on Windows (x64), and updates itself.

A computer without the app, such as a server, runs only the machine:

```sh
npx ruimte            # start the machine
npx ruimte login      # add it to your Ruimte account
```

You reach it from the desktop app on another computer or from [station.ruimte.app](https://station.ruimte.app). See [`packages/npm`](packages/npm/README.md) for the background service and the other commands.

The iPhone and iPad app is in beta on [TestFlight](https://testflight.apple.com/join/9Qb4TzzQ).

Ruimte is pre-1.0. Stable versions and betas both ship from this repository, and things still move between releases.

## How it fits together

A daemon owns the sessions, and every interface is a client of it.

- **The daemon** (`apps/server`, Bun) owns terminals, chats, agents and persistence under `~/.ruimte`. Its API is one WebSocket on `localhost:4210` and never leaves loopback.
- **The client** (`apps/client`, React) is the whole UI. It reaches a daemon only through a transport, so the same client runs in the desktop app and at station.ruimte.app.
- **The desktop shell** (`apps/desktop`, Electron) runs a daemon beside the client.
- **The contracts** (`packages/contracts`) hold a zod schema for every message on the wire. Both ends validate against them.

A client on another computer reaches a daemon over a direct WebRTC channel, signaled through a broker that never reads a message. Agents work on views and nodes through the daemon's MCP tools, and Ruimte learns what an agent is doing from its CLI's hooks, never by parsing terminal output.

| Folder | What |
| --- | --- |
| `apps/client`, `apps/server`, `apps/desktop` | The UI, the daemon and the Electron shell |
| `apps/ios` | The native iPhone and iPad client (Swift) |
| `apps/station`, `apps/bench`, `apps/site` | The web client, the bench build and ruimte.app with its documentation |
| `apps/pulsar-broker`, `apps/pulsar-worker`, `apps/maps-worker` | Signaling, the address book of accounts and machines, and the map tile proxy |
| `apps/computer-use`, `apps/speech-bridge`, `apps/ios-device-bridge` | Native helpers in Swift and Rust |
| `packages/` | Wire contracts, actions, voice and the `ruimte` npm launcher |
| `extensions/` | Extensions developed in this repository |

`CLAUDE.md` is the full map, with the invariants and product rules the code does not show. Shared UI, terminal and agent packages come from [ADE CORE](https://github.com/basmilius/adecore), pinned on npm.

## Principles

- **Projects and views.** Organize work into projects and choose which views to show together.
- **Selection and camera are explicit state.** A node is selected or it is not, never decided by where the pointer happens to be. Nothing in the background moves the view.
- **Server first.** A backend always owns the sessions and talks to the UI over WebSocket. The desktop app runs one beside it, and a remote machine is another endpoint.
- **Opinionated.** Settings cover what differs per person or per machine, such as the theme, keys, providers and what agents may do. Everything else is a default.

## Develop

You need [Bun](https://bun.sh).

```sh
bun install
bun dev
```

`bun dev` starts the daemon on `localhost:4211`, the Vite client and the Electron shell as "Ruimte Dev". The daemon keeps its state in `~/.ruimte-dev`, or in `RUIMTE_DEV_HOME`. An installed Ruimte keeps `4210` and `~/.ruimte`, so both run on one machine.

`bun run dev:client`, `bun run dev:server` and `bun run dev:desktop` start one part. Browser nodes only work in the Electron shell. `bun run dev:built` runs the same setup against a production build of the client, on `localhost:4212`. Restart it to rebuild after client changes.

| Command | What |
| --- | --- |
| `bun run format` | Formats the code and sorts imports |
| `bun run check` | Types, lint, formatting and generated files of every package |
| `bun run build` | Builds the client and the desktop shell |
| `bun run test` | Unit tests |
| `bun run test:dom` | Client tests that draw the window |
| `bun run test:integration` | Integration tests with real shells, sockets and processes, including the compiled daemon and the npm launcher |
| `bun run test:package` | The packaged daemon |
| `bun run test:devices` | Tests that need a running simulator or device, on request only |

One test file runs with `bun test --conditions=source <file>`. A DOM test adds `--config=dom.bunfig.toml` and an integration test `--config=integration.bunfig.toml`, both before `test`.

CI (`.github/workflows/ci.yml`) runs the types, lint and formatting checks, the builds, the unit tests on Linux and Windows, the DOM tests, and the integration and packaged suites on macOS and Linux. The Rust and Swift checks run only when their paths changed.

To work on ADE CORE alongside Ruimte, `bun run adecore:link` uses the live packages in `../adecore` and `bun run adecore:npm` restores the pins. See [developing with ADE CORE](docs/ADECORE-DEVELOPMENT.md).

## Extensions

An extension adds panels, canvas nodes, views, sidebar cards, commands or themes, optionally with a process on the machine. `bunx ruimte extension create` scaffolds one. The API is documented at [ruimte.app/docs/extensions](https://ruimte.app/docs/extensions), and [`extensions/limits`](extensions/limits) is a worked example on the public API alone.

## Contributing

Contributions are welcome. Bugs and ideas go to [issues](https://github.com/basmilius/ruimte/issues).

A fix can come straight as a pull request. A product choice starts as an issue: a new feature, a change in how something behaves, a new setting. Ruimte is opinionated, and a pull request that makes such a choice on its own waits on that conversation anyway.

Before you open a pull request:

- `bun run format` and `bun run check` pass, and so do the tests of what you changed.
- Commits follow conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).
- Code, comments and UI text are in American English.
- Everything is written from scratch. Ideas and npm packages are fine, code copied from another product is not.

`CLAUDE.md` holds the conventions in full. An agent working in the checkout reads the same file.

## Release

`bun run dist` builds the client, compiles the daemon for this machine and packages the desktop app into `apps/desktop/release`. A `v*` tag does the same on GitHub Actions for macOS, Linux and Windows and publishes the release once every build succeeds. The app updates from that release. See [`docs/RELEASE.md`](docs/RELEASE.md).

## License

Ruimte is source available under the [Functional Source License](LICENSE), version 1.1, with an MIT future license. Read it, run it, change it and use it for your own work. The one thing it does not allow is building a competing product with it. Two years after a version is published, that version becomes MIT.
