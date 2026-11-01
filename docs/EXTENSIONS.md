# Extensions

An extension adds panels, canvas nodes, views, sidebar cards, commands or themes to Ruimte, optionally with a process on the machine. It runs as trusted code, like a plugin in an IDE: its React sits in the client's page and its `server/` runs as the person who runs the machine. A `frame:` surface is the one place with isolation. Permissions in the manifest tell a person what it does and gate the API, but they are no sandbox.

## A package

```
manifest.json     id, name, version, api, permissions, themes
client/index.ts   runs in the client, calls define*
server/index.ts   runs on the machine, optional
locales/ assets/ views/ themes/   copied into the pack
```

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

## Proof-of-concept extensions

`extensions/poc-*` exist to try the API by hand and in tests. They are never shipped: the client imports only what `apps/client/src/extensions/built-in.ts` names, and neither the desktop app nor npm packs that folder. Run `bun run dev` in one, beside `bun dev`.

| Folder | What to look for |
| --- | --- |
| `poc-surfaces` | A panel, view, node (with `migrate`), sidebar card, overlay, settings detail, commands, canvas action and node menu item. The node's count survives a reload through the project file, the card's through storage. |
| `poc-server` | `.use()` shows pong, storage counts on across a restart, a secret is kept, an event comes back, machine events are counted, Throw reports an error and goes on, Crash restarts on the next call. A line from its node to a chat gives the chat the fact. |
| `poc-agents` | With nodes selected, "POC: summarize the selection" writes a linked note. The card lists agents. |
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

`css` is optional. `url()` reaches only files in the pack and `@import` is refused, both when packing and when loading. The stable hooks are `[data-surface='sidebar']`, `'panel'` and `'node'`; an internal class can change in any release. Safe mode starts without a theme.

## The store

An author builds a `.rex` and `publish` opens a pull request on `ruimte-app/extensions`. Ruimte never builds someone else's code, and every update gets a human review before it is signed.

Still to set up before the store opens:

1. Create the repository `ruimte-app/extensions`.
2. Generate an ed25519 key and keep its private half out of every repository.
3. Put the public half in `EXTENSION_STORE_PUBLIC_KEY` (`packages/pulsar/src/extension-store.ts`). While it is empty, the store shows as unavailable.
4. Publish `@ruimte/extension` to npm (`packages/extension`).

## Safe mode

Opening a window with `?safe-mode` loads no extension and no theme, so a person can always remove one that hangs the app.

## Not built yet

`defineFileViewer`, `defineToolResult`, `defineReference`, `defineComposerAction`, `defineViewAction`, a streaming `agents.run`, and a `--safe-mode` flag on the launcher.

Open product decisions: whether `agents.start` on a server part is an exception to the rule that only `agent` starts anything, and whether a server part may keep a clock of its own.
