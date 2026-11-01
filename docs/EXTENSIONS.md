# Extensions

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
ruimte extension test           bun test against a fake host
ruimte extension pack           build a .rex
ruimte extension publish        open a pull request on the store
ruimte extension logs           what server/ wrote
```

`extensions/limits` is a worked example on the public API alone. Try it with `bun run dev` in that folder while Ruimte runs.

## Slots

A slot is a place, with a function that gets what is true there and answers `false`, `true` or changes (`title`, `icon`, `disabled`, `badge`, `order`). `defineAction`, `defineMenu` and `defineWidget` all go in slots: a button or menu item, a menu of the extension's own, and its own React. An action without slots only shows where a menu puts it.

The places are `selectionBar`, `nodeHeader`, `nodeMenu`, `canvasMenu`, `viewToolbar`, `viewMenu`, `panelHeader`, `commandPalette`, `projectMenu`, `sidebarFooter`, `editorStatusBar`, `composer`, `messageActions`, `lineMenu`, `fileMenu`, `editorToolbar`, `editorMenu`, `diffToolbar`, `terminalToolbar` and `browserToolbar`. In a menu an extension always comes below Ruimte's own items.

While `run` is pending, the nodes it is about show a spinner that also stops it through `signal`, and its button is disabled for those nodes. A throw reaches the person as a toast. Work that is no action uses `host.busy`.

`defineOverlay` opens your own UI over the app and answers what it closed with. `host.confirm`, `host.prompt` and `host.pick` ask through the dialogs of Ruimte.

## Permissions

Reading what is on screen needs none. These do: `canvas.write`, `views.write`, `context.read`, `database.read`, `files.read`, `files.write`, `git.read`, `chats.read`, `chats.send`, `agents.run`, `agents.start`, `agents.status`, `agents.tools`, `usage.read`, `clock`.

`chats.send` from `server/` is limited to 20 messages per chat per hour, so a loop with a chat stops on its own. Typing into a terminal and answering a permission prompt stay out of reach.

## Logging

`ruimte extension dev` prints what the extension says while it runs. That is `console.*` and `log` in `server/`, and `console.*` in `client/` marked `[client]`, with failed actions, failed surfaces and a failed load. An installed extension's client logs only to the page's own console.

## Proof-of-concept extensions

`extensions/poc-*` exist to try the API by hand and in tests. They are never shipped: the client imports only what `apps/client/src/extensions/built-in.ts` names, and neither the desktop app nor npm packs that folder. Run `bun run dev` in one, beside `bun dev`.

| Folder | What to look for |
| --- | --- |
| `poc-surfaces` | A panel, view, node (with `migrate`), sidebar card, overlay and settings detail. An action in every slot, a menu of its own, a widget in a note's header, a viewer for `.csv`, a `poc` fence in a chat and its own view of a `Read` call. Its logs reach the terminal. The node's count survives a reload through the project file, the card's through storage. |
| `poc-server` | `.use()` shows pong, storage counts on across a restart, a secret is kept, an event comes back, machine events are counted, Throw reports an error and goes on, Crash restarts on the next call. Add its node from Extensions in the canvas menu, or the palette; a line from it to a chat gives the chat the fact. |
| `poc-workspace` | Its menu writes to the canvas and the project, reads git, opens an overlay and asks through dialogs. Its panel hears events, shows params, keeps storage per project and machine, and speaks Dutch and English. A chat's composer gets a button that sends, and a chat's menu starts a second opinion. |
| `poc-chat` | `/review` and `/readme` in a chat, POC issues after `#`, a panel that streams an answer and queries a database, Three notes under Extensions in the canvas menu, mod+alt+k, an icon and a diff view for `.poc` files, buttons in the project menu, the sidebar footer and the editor's status bar, and settings Ruimte draws. |
| `poc-agents` | Summarize in the bar, a node's header, its menu or the palette writes a linked note, with a spinner on the nodes meanwhile. The card lists agents. |
| `poc-frame` | Shows an opaque origin, refused storage and refused fetch, and still gets an answer from its server. |
| `poc-themes` | Paper is tokens alone. Midnight adds an image and outlines through `data-surface`. Your accent stays on top. |
| `poc-broken` | Each panel fails inside its own rectangle. A throwing command leaves the app alone. Three calls to the dead server turn it to crashed in Settings. |
| `poc-broken-load` | Settings shows the error on its row. |

## Themes

A theme is data. It needs no `client/` and applies before the first render.

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
4. Publish `@ruimte/extension` to npm (`packages/extension`).

## Safe mode

Opening a window with `?safe-mode` loads no extension and no theme, so a person can always remove one that hangs the app.

## Choices against the report

`defineStatusItem` became the slots `sidebarFooter` and `editorStatusBar`, `defineMessageBlock` is `defineMarkdownBlock`, and `messageMenu` is `messageActions`. A `defineNotificationAction` is `host.notify` with an `action`. `defineTemplate` shows under Extensions in the canvas menu. A reference and a slash command come down to text in the prompt, which the person still sends. `agents.start` is the client's: a chat needs a canvas, so `server/` uses `emit` and lets a client start it. `hosts` are the `net:` permissions of a frame. Webhooks and `secrets.request` stay out. Voice reaches an extension through the two actions `extension.voiceList` and `extension.voiceRun`, since the catalog of tools is fixed.
