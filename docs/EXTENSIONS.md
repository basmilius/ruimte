# Extensions

What an author reads lives at https://ruimte.app/docs/extensions (`apps/site/src/app/docs/extensions`). This file keeps what only matters to working on Ruimte itself: the POCs, the store's setup and the choices behind the API.

An extension adds panels, canvas nodes, views, sidebar cards, commands or themes to Ruimte, optionally with a process on the machine. It runs as trusted code, like a plugin in an IDE: its React sits in the client's page and its `server/` runs as the person who runs the machine. A `frame:` surface is the one place with isolation. Permissions in the manifest tell a person what it does and gate the API, but they are no sandbox.

## A package

```
manifest.json     id, name, version, api, color, permissions, themes
assets/icon.svg   its mark, always at this path
client/index.ts   runs in the client, calls define*
server/index.ts   runs on the machine, optional
locales/ assets/ views/ themes/   copied into the pack
```

The mark shows in Settings and the store: `assets/icon.svg` (up to 64 KB) is drawn as one ink on `color` (`#rrggbb`), so only its shape counts. Without an icon it gets a package, without a color a plain ground. A panel or node that names no Lucide `icon` shows the same mark.

Types come from `@ruimte/extension` on npm (`/client`, `/server`, `/ui`, `/testing`). The code comes with Ruimte, and `pack` rewrites those imports and React to what the client supplies.

## The CLI

```
bunx ruimte extension create    scaffold a project
ruimte extension dev            build on save and load it into the running Ruimte
ruimte extension test           bun test against a test host
ruimte extension pack           build a .rex
ruimte extension publish        open a pull request on the store
ruimte extension logs           what server/ wrote
```

`test` writes the preload into the project's `node_modules/.cache`, so it imports the project's own React, and runs `bun test` with it. With a `*.dom.test.tsx` file in the project it puts happy-dom's page first, and says what to add when `@happy-dom/global-registrator` is missing; it warns when the project's React has another major than `CLIENT_REACT_MAJOR` (`scaffold.ts`, held to the client's `package.json`).

`createTestHost` (`test-host.ts`, `test-client.ts`, `test-hosts.ts`) is a client with a project in memory. It decides what the client host decides from the same rules in `@ruimte/contracts/extension-client`: the permission of each call, the slot names, a lazy component, a shortcut and a path in the project. What only the machine or a person knows comes from the test's `answers`, and an unanswered call is `unavailable`, as in a test server. `render` (`test-dom.ts`) draws with the project's own React and waits over turns of the event loop, never a clock. `createTestServer` loads `server/index.ts` in the test's own process on the API and policy of the machine (below, under Failure). For each test host and test server, `test-loader.ts` bundles the entry with the project's own files, so no module state carries over, and binds `@ruimte/extension/client` or `/server` in that bundle to its own host. An extension in this repository keeps its tests in `test/`, which `bun run test` leaves out: `apps/server/src/cli/extension-test.integration.test.ts` runs those of `limits`, `poc-server`, `poc-agents`, `poc-workspace` and `poc-contract`, and the test a new project starts with.

The contract suite keeps the test hosts from drifting from the real ones. `extensions/poc/contract/contract` holds one set of scenarios for the client (every call refused without its permission, storage per scope, a slot's context and run, a note and its link, what a context read selects, a client event, a node's defaults and its migration, a read of the wrong kind, where an agent starts, the UI components, a kept answer after a reload and a reconnect, what another window wrote, a stream aborted before it began, failing halfway or stopped after a piece, a throw and an inherited name of `server/`, a key deleted with undefined or by `server/`, the canvas `createCanvas` opens, a new note's size, title and place, a group's members and frame, lines to itself and between agents, what `remove` takes, a node of another canvas, a chat in a view of its own, the kind of an extension's view, a file watch, opening the view in front and an action a person stopped) and one for `server/` (an event behind its permission, an await as its module loads, a tool, the send limit, a refusal, a machine action's input, an emit without payload). The client host's world answers through JSON and the reply schemas, as a machine does, and the machine's world reads each event through its schema. Each runs against the test hosts in `extensions/poc/contract/test`, against `clientApiFor` on a `FakeMachine` in `apps/client/src/extensions/host/contract.dom.test.tsx`, and against `ExtensionHost` with a real process in `apps/server/src/extensions/contract.integration.test.ts`. A call the permission table gains needs a row in its scenario, or the suite fails.

`extensions/limits` is a worked example on the public API alone. Try it with `bun run dev` in that folder while Ruimte runs.

## Slots

A slot is a place, with a function that gets what is true there and answers `false`, `true` or changes (`title`, `icon`, `disabled`, `badge`, `order`). `defineAction`, `defineMenu` and `defineWidget` all go in slots: a button or menu item, a menu of the extension's own, and its own React. An action without slots only shows where a menu puts it.

The places are `selectionBar`, `nodeHeader`, `nodeMenu`, `canvasMenu`, `viewToolbar`, `viewMenu`, `panelHeader`, `commandPalette`, `projectMenu`, `sidebarFooter`, `editorStatusBar`, `composer`, `messageActions`, `lineMenu`, `fileMenu`, `editorToolbar`, `editorMenu`, `diffToolbar`, `terminalToolbar` and `browserToolbar`. `sidebarRow`, `tabMenu`, `emptyCanvas`, `startScreen`, `projectBanner`, `threadHeader`, `emptyThread`, `toolActions`, `fileRowBadge`, `fileBreadcrumb`, `terminalMenu`, `browserMenu`, `textMenu`, `noteToolbar` and `routineMenu` come on top. In a menu an extension always comes below Ruimte's own items. A widget works in every slot, also in a menu.

While `extension dev` runs, "Show extension slots" in the command palette outlines every slot on its spot with its name, and its tooltip lists what the slot tells.

While `run` is pending, the nodes it is about show a spinner that also stops it through `signal`, and its button is disabled for those nodes. A throw reaches the person as a toast. Work that is no action uses `host.busy`.

`defineOverlay` opens your own UI over the app and answers what it closed with. `host.confirm`, `host.prompt` and `host.pick` ask through the dialogs of Ruimte.

## Permissions

Reading what is on screen needs none. The ones that open something are `EXTENSION_PERMISSIONS` in `packages/contracts/src/extension-permissions.ts`, plus `net:<host>` for a frame. `ruimte extension pack`, the machine's install and link, and the shell's install refuse any other name and a `net:` that is no host name (`extensionPermissionProblems`), and only a host name reaches a frame's `connect-src`. An extension already installed with an unknown name keeps loading, and Settings does not show that name. A permission the API gains is a row in that list, in the table on `/docs/extensions/manifest`, and in the call or policy table that needs it.

`chats.send` from `server/` is limited to 20 messages per chat per hour, so a loop with a chat stops on its own. Typing into a terminal and answering a permission prompt stay out of reach.

## Logging

`ruimte extension dev` prints what the extension says while it runs. That is `console.*` and `log` in `server/`, and `console.*` in `client/` marked `[client]`, with failed actions, failed surfaces and a failed load. An installed extension's client logs only to the page's own console.

## Proof-of-concept extensions

The extensions in `extensions/poc` exist to try the API by hand and in tests. They are never shipped: the client imports only what `apps/client/src/extensions/built-in.ts` names, and neither the desktop app nor npm packs that folder. Run `bun run dev` in one, beside `bun dev`.

| Folder | What to look for |
| --- | --- |
| `poc-surfaces` | A panel, view, node (with `migrate`), sidebar card, overlay and settings detail. An action in every slot, a menu of its own, a widget in a note's header, a viewer for `.csv`, a `poc` fence in a chat and its own view of a `Read` call. Its logs reach the terminal. The node's count survives a reload through the project file, the card's through storage. |
| `poc-server` | `.use()` shows pong, storage counts on across a restart, a secret is kept, an event comes back, machine events are counted, Throw reports an error and goes on, Crash restarts on the next call. Add its node from Extensions in the canvas menu, or the palette; a line from it to a chat gives the chat the fact. |
| `poc-workspace` | Its menu writes to the canvas and the project, reads git, opens an overlay and asks through dialogs. Its panel hears events, shows params, keeps storage per project and machine, and speaks Dutch and English. A chat's composer gets a button that sends, and a chat's menu starts a second opinion. |
| `poc-chat` | `/review` and `/readme` in a chat, POC issues after `#`, a panel that streams an answer and queries a database, Three notes under Extensions in the canvas menu, mod+alt+k, an icon and a diff view for `.poc` files, buttons in the project menu, the sidebar footer and the editor's status bar, and settings Ruimte draws. |
| `poc-machine` | Type a number in the palette for a row from the extension. Its panel lists launches, routines, Output and devices, and adds a language server. A terminal's menu reads it, a browser's bar inspects it, and a node's menu opens a terminal. |
| `poc-agents` | Summarize in the bar, a node's header, its menu or the palette writes a linked note, with a spinner on the nodes meanwhile. The card lists agents. |
| `poc-frame` | Shows an opaque origin, refused storage and refused fetch, and still gets an answer from its server. |
| `poc-themes` | Paper is tokens alone. Midnight adds an image and outlines through `data-surface`. Your accent stays on top. |
| `poc-broken` | Each panel fails inside its own rectangle. A throwing command leaves the app alone. Three calls to the dead server turn it to crashed in Settings. |
| `poc-broken-load` | Settings shows the error on its row. |
| `poc-contract` | Nothing by hand: the probe of the contract suite, with the scenarios in `contract/`. |

## Themes

A theme is data. It needs no `client/` and applies before the first render. It sits in the picker beside System, Light and Dark with its required `thumbnail`, and Palette is only there for Ruimte's own themes.

```json
{
    "name": "Midnight",
    "side": "dark",
    "tokens": { "--surface": "#0b1020" },
    "css": "themes/midnight.css"
}
```

`css` is optional. `url()` reaches only files in the pack and `@import` is refused, both when packing and when loading. The stable hooks are `[data-surface='sidebar']`, `'panel'` and `'node'` (the first two sit on a column, so its ground is `> div`); an internal class can change in any release. Safe mode starts without a theme.

## The store

An author builds a `.rex` and `publish` opens a pull request on `ruimte-app/extensions`. Ruimte never builds someone else's code, and every update gets a human review before it is signed.

Still to set up before the store opens:

1. Create the repository `ruimte-app/extensions`.
2. Generate an ed25519 key and keep its private half out of every repository.
3. Put the public half in `EXTENSION_STORE_PUBLIC_KEY` (`packages/pulsar/src/extension-store.ts`). While it is empty, the store shows as unavailable.
4. Publish the placeholder of `@ruimte/extension` and have npm trust `npm.yml` for it (`docs/RELEASE.md`, "npm"). From then on every release publishes it at the app version.

## Safe mode

A window with `?safe-mode` on its address loads no extension and no theme, so a person can always remove one that hangs the app. A desktop window has no address bar: Help, Restart Without Extensions starts the app again with `--safe-mode`, which puts it on every window of that start (`apps/desktop/src/main/safe-mode.ts`). A page that no longer answers its menu needs the app quit and started with the flag by hand (`open -a Ruimte --args --safe-mode` on macOS). The next ordinary start loads them again.

## The machine

`definePaletteSource({ id, title, search })` adds rows to the command palette. It runs after a pause in the typing, and a slow or failing one costs only its own rows.

`launches`, `routines`, `artifacts`, `browser` and `devices` call the actions of the same name (`launches.start({ launch })` is `launch.start`). The daemon checks each call against `EXTENSION_ACTIONS` and the manifest, and `apps/server/src/extensions/machine-actions.ts` turns the extension's input (refs, not ids) into the action's and the output into the smaller one `MachineActions` promises. From `server/`, `machine.run(project, 'launch.start', input)` does the same.

## Failure

A call that can fail answers a `Result`, under one of `EXTENSION_ERROR_CODES`, which `packages/contracts/scripts/generate-extension-vocabularies.ts` reads from the `ExtensionErrorCode` of `client.d.ts` (and fails when `server.d.ts` names others), as it does the slot names from `SlotContexts`. A new call is a row of `EXTENSION_CLIENT_PERMISSIONS` or of `EXTENSION_CALLS_WITHOUT_PERMISSION` (`extension-client.ts`), which `extension-client.test.ts` requires of every call the `.d.ts` files declare. The daemon refuses with `ExtensionRefusal` (`apps/server/src/extensions/refusal.ts`); the client host maps any other wire code with `extensionErrorCodeOf`. Only `invalid-input` or `bad-request`, an argument of the wrong shape, reaches an extension as a throw; the input of a machine action is checked by `parseExtensionActionInput`, on the machine and in a test server alike. A `Result<void>` always carries `value: undefined`, with the key there, while a method of `server/` crosses as JSON, so one that returns nothing answers `null` (`Returned` in the types). A refusal is no throw, so the host writes it to the log of `extension dev`: the client with `sendDevLog`, the daemon to the extension's log file for what `server/` asked. `client-api.tsx`, `server-api.ts` and the fakes of `test-runtime.ts` each `satisfies` their `.d.ts`, so the types and the hosts cannot drift apart.

What `server/` may do is decided in `apps/server/src/extensions/policy.ts`: which events it follows and what of them it hears, the permission of each ask and action, the sends per chat and the clock of `schedule`. It is pure, so the host refuses with it and `ruimte extension test` holds an author's code to the same answers. `server-api.ts` is `@ruimte/extension/server` with its pipes, files and clock handed in; `server-runtime.ts` hands in the real ones inside the extension's process, and answers the daemon before the extension's module loads, so a top-level `await` gets its answer. Its `storage` asks the daemon, the one writer of `storage.json`, which a client's `useStorage` writes too. A compiled daemon has no source tree, so `apps/server/scripts/generate-extension-runtimes.ts` bundles it, and the preload of `ruimte extension test`, into `apps/server/src/extensions/generated`, which the daemon and the CLI carry as text. Run `bun run generate:extension-runtimes` after a change; `bun run check` fails on a stale bundle.

The host makes one change to what an extension runs at a time: turning it on or off, a new version, its removal, and a language server its process adds. A start waits for a change under way and reads the store again after a stop, so it never acts on what the store said before. It also waits until a stopped process exited, which a kill only asks for. A save under `extension dev` starts an extension again when it runs with the machine. `lifecycle-harness.ts` holds every step of the store, the files, the language servers and the processes, its exit included, until a test lets it go. `extension-host-lifecycle.test.ts` forces orders with it, and `extension-host-interleavings.test.ts` runs 300 seeded interleavings against the invariants: one process per extension, none that was stopped and never exited, nothing running, no language server and no tool after a turn off or removal, no lost storage write, and nothing heard after a client or process is forgotten. A failure prints its seed, and `RUIMTE_SEED=<seed>` runs that one alone.

`terminals.read(node)` returns a terminal's screen and `terminals.open()` opens a shell. Nothing types into one.

`defineLanguageServer` in `server/` adds a server like one a person added, and it starts without asking: installing the extension was the approval. The same name changes it, and removing the extension removes it, unless a person edited it in Settings.

## Station

Station has no shell, so it runs what the machine in front has. `extension.clientFiles` hands over everything but `server/`, the page caches it under the machine it came from (a dev link under a digest of its files, since its build number starts over with the machine), and `extension-files-sw.js` answers it on the page's own origin, under the same `script-src 'self'`. A window runs the extensions of its own machine. A `frame` surface shows a notice there: a sandboxed frame gets no policy from the worker.

## Choices against the report

`ruimte-ui` gets no components of an extension: the iPhone validates that catalog whole, and `defineMarkdownBlock` draws a fence an agent writes. Git stays as it is, by choice. Plans stay out: a plan belongs to a chat and only that chat may ask for it. `browser.control` and `devices.control` drive any page or device of the project without a line, since an extension has no node for a line to reach. Editor decorations and the selection in `editorMenu` stay out, by choice.

`defineStatusItem` became the slots `sidebarFooter` and `editorStatusBar`, `defineMessageBlock` is `defineMarkdownBlock`, and `messageMenu` is `messageActions`. A `defineNotificationAction` is `host.notify` with an `action`. `defineTemplate` shows under Extensions in the canvas menu. A reference and a slash command come down to text in the prompt, which the person still sends. `agents.start` runs under the `extension` actor, bound as Voice is when it starts a chat: an AI Chat under the person's own CLI, supervised at most, on a canvas or as a view of its own. `server/` names the project. `hosts` are the `net:` permissions of a frame. Webhooks and `secrets.request` stay out. Voice reaches an extension through the two actions `extension.voiceList` and `extension.voiceRun`, since the catalog of tools is fixed.
