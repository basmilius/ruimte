# Multiple daemons at once: research and design

State of the working tree on 2026-09-11, clean on `7782950`. Every path is relative to
`/Users/bas/Development/Projects/ruimte`. Line numbers are from the working tree. Nothing here is
implemented; this is the document an implementation agent executes.

Today the client talks to exactly one daemon. The goal is several daemons connected at the same
time, a project belonging to one of them, and eventually two projects from two machines open next
to each other.

## 0. Summary of the recommendation

- Seven phases, each shippable on its own. The first two are bug fixes and a contract addition that
  pay off whether or not the rest lands.
- **Phase 1** gives the daemon an id it keeps in `$RUIMTE_HOME` and returns on `endpoint.info`, so
  an endpoint is a machine and not an address. The client keys its endpoint list on it and treats
  `httpBaseUrl` as a hint that may change.
- **Phase 2** fixes what already goes wrong on a switch: the remembered project is not per
  endpoint, the usage page keeps the other machine's numbers, and the git watch refcount is keyed
  on a bare path.
- **Phase 3** replaces the one `WebSocketTransport` with a `TransportPool`, one socket per
  endpoint, each with its own reconnect loop. `transport` stays as a facade that forwards to the
  active endpoint, so none of the 33 files that import it change.
- **Phase 4** keys every store and every module-level map on the endpoint. The key becomes
  `${endpointId}:${nodeId}`, not because ids collide (they are random) but because a row has to
  say which daemon it is about.
- **Phase 5** makes the project list the union of `project.list` over every connected endpoint,
  grouped per machine. Opening a project sets the active endpoint; the remembered choice becomes
  `(endpointId, projectId)`.
- **Phase 6** replaces the facade with a React context, so a subtree carries its own connection and
  two projects can be open side by side. This is the phase with real unknowns: `useCanvas`,
  `useDocument` and `useDrawing` are singletons that hold one open project, and a split needs a
  store per workspace. Section 4.6 is honest about what is not designed yet.
- **Phase 7** makes a connection survive outside a test rig: a key pair per client instead of a
  token in a query string, the daemon pinned at pairing rather than trusted by address, and a way to
  find a machine that moved. It blocks nothing and comes last. Note that a session token does not
  expire today; re-pairing after a container restart is the harness wiping `$RUIMTE_HOME`.
- Nothing is stored in `project.json` about which daemon a project belongs to, and nothing needs
  to be: a project id is minted by the daemon that owns it (`randomBytes(6).toString('base64url')`,
  `apps/server/src/projects/project-store.ts:76`), so the same folder on two machines is two
  projects with two ids. The endpoint a project belongs to is the endpoint whose `project.list`
  answered with it.
- The daemon barely changes: one new field on `endpoint.info` in phase 1, and nothing after that.
  A daemon still knows nothing about other daemons.
- Testing happens against a real second daemon in a Docker container on Linux, locally, gated
  behind `RUIMTE_DOCKER=1`. Section 5 lists the scenarios per phase and what the container cannot
  cover.

## 1. How one daemon is wired today

### 1.1 The transport singleton

`apps/client/src/transport/index.ts`:

```ts
// L9-12
const socketUrl = (): string => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}/ws`;
};

export const transport: Transport = new WebSocketTransport(socketUrl());   // L14
```

One instance, built on module load, with an address taken from `location`. Importing the module
opens a socket: the constructor calls `connect()` (`websocket-transport.ts:33-36`). In dev that
address is the Vite origin, which proxies `/ws` to the daemon (`apps/client/vite.config.ts:15-38`,
`RUIMTE_DAEMON` at L6); in production it is whatever served the client.

`apps/client/src/transport/transport.ts`:

- `TransportStatus` (L3) is `connecting | open | closed`; `ConnectionState` (L5-11) adds `attempts`
  and `retryAt`, and its comment already says the object identity only changes when the state does,
  which is what lets `useSyncExternalStore` read it.
- `Transport` (L13-23): `request`, `on`, `status`, `connection?`, `subscribeStatus`, and
  `switchTo?(url)` at L22 with the comment "Reconnects to another daemon".
- `TransportError` (L26-34) always carries a code.

`apps/client/src/transport/websocket-transport.ts` is the only implementation:

- One `socket`, one `pending` map (L27), one `eventHandlers` map (L26), one `statusHandlers` set
  (L25), one `reconnectTimer`, one `url` (L31).
- `switchTo` (L51-68) replaces `this.url`, resets the attempt count and closes the socket; the
  normal close path then reconnects on the new address (L63-64). The instance, the handler sets and
  the pending map survive the move. `rejectPending` (L165-171) runs on close, so a request in flight
  when the switch happens rejects with `disconnected`.
- Backoff is `500 * 2 ** attempts` capped at `10_000` (L13-14, L157).

So "switching machines" today is a pointer swap inside one object. Every handler registered before
the switch keeps firing afterwards, now with the other machine's events.

### 1.2 The four clients built on that instance

All four take a `Transport` as their first constructor parameter, so the classes are already
injectable. Only their instantiation is global:

| Singleton | Built at | Class |
| --- | --- | --- |
| `chatClient` | `apps/client/src/chat/index.ts:8` | `chat/chat-client.ts` |
| `sessionClient` | `apps/client/src/terminal/index.ts:5` | `terminal/session-client.ts` |
| `drawingClient` | `apps/client/src/project/index.ts:18-20` | `drawing/drawing-client.ts` |
| `projectClient` | `apps/client/src/project/index.ts:22-43` | `project/project-client.ts` |

`panelsPort` (`project/index.ts:12`) is transport-free.

Three start functions and two lifecycle watchers run on module load, `apps/client/src/main.tsx:20-26`:

```
startSessionLifecycle();     // terminal/lifecycle.ts:19 -> lifecycle-watch.ts:33
startAgentNotifications();
startServerInfo();           // transport/server-info.ts:16-25
startPing();                 // transport/ping.ts:25-40
startContextSync();          // context/sync.ts:41-104
startEndpointSelection();    // endpoint/index.ts:75-80
startInputModality();
```

`startServerInfo` and `startPing` both hang off `transport.subscribeStatus` and re-ask on every
`open` (`server-info.ts:20-24`, `ping.ts:29-35`), which is why a switch refreshes `useServer` and
the latency by itself, one round trip late.

### 1.3 The 33 files that import `transport`

`grep -rn "from '@/transport'" apps/client/src` gives 33 files. What each one asks for:

| File | Uses |
| --- | --- |
| `canvas/NodeMenu.tsx:34,145` | `fs.reveal` |
| `chat/index.ts:3` | builds `chatClient` |
| `chat/ui/ImageView.tsx:7,165` | `fs.read` |
| `context/sync.ts:5,46,56,61,87,93` | `context.set`, `status`, `subscribeStatus` |
| `drawing/mirror.ts:6,46` | `drawing.changed` |
| `endpoint/index.ts:6,52,55,59` | `auth.sessions`, `auth.pairingToken`, `auth.revoke`, `switchTo` |
| `project/index.ts:5` | builds `projectClient` and `drawingClient` |
| `shell/CommandPalette.tsx:40,168,194` | `fs.browse`, `fs.search` |
| `shell/commands.ts:25,116` | `fs.reveal` |
| `shell/connection-info.ts:2` | type only (`ConnectionState`) |
| `shell/ConnectionDot.tsx:10` | types only |
| `shell/palette-grep.ts:3,78` | `fs.grep` |
| `shell/panels/CommitBox.tsx:9,46` | `git.cancel` |
| `shell/panels/CommitLog.tsx:6,45,64` | `git.log` |
| `shell/panels/DiffFile.tsx:12,52,187` | `git.diff` |
| `shell/panels/FilesPanel.tsx:53,183,213,221,511` | `fs.list`, `fs.unwatch`, `fs.changed`, `fs.reveal` |
| `shell/panels/FileToolbar.tsx:14,125` | `fs.reveal` |
| `shell/panels/GitPanel.tsx:26,104,148` | `git.status`, `git.status` event |
| `shell/panels/HtmlFile.tsx:10,100` | `fs.changed` |
| `shell/panels/UnsupportedFile.tsx:5,14` | `fs.reveal` |
| `shell/panels/use-file-read.ts:4,19,38` | `fs.read`, `fs.changed`, `TransportError` |
| `shell/panels/use-git-actions.ts:5,33,50,55` | `git.progress`, `git.cancel`, `git.action` |
| `shell/panels/VideoFile.tsx:8,27` | `fs.reveal` |
| `shell/ProjectMenu.tsx:12,127` | `fs.reveal` |
| `shell/settings/EndpointsSection.tsx:9,61,64` | `status`, `subscribeStatus` |
| `shell/usage/limits.ts:4,19,24` | `usage.limits`, `usage.limitsChanged` |
| `shell/usage/UsagePage.tsx:7,52,54,63,71` | `usage.subscribe`, `usage.unsubscribe`, `usage.summary`, `usage.changed` |
| `shell/WorktreeDialog.tsx:7,37` | `git.worktree-add` |
| `state/git-watch.ts:3,22,40,61,75` | `git.watch`, `git.unwatch`, `git.status` |
| `terminal/index.ts:2` | builds `sessionClient` |
| `transport/ping.ts:2` | `server.ping` |
| `transport/server-info.ts:2` | `server.hello`, `endpoint.info` |
| `transport/status.ts:2` | `subscribeStatus`, `status`, `connection` |

Two of the 33 (`shell/connection-info.ts`, `shell/ConnectionDot.tsx`) import only types. Almost
everything else is either cwd-shaped (`fs.*`, `git.*`) or node-shaped (`session.*`, `chat.*`), which
is the reason the facade in phase 3 works: none of them names a machine, they all mean "the daemon
this project is on".

### 1.4 Three HTTP URL builders

Bytes never travel over the socket, so three helpers build a URL against `activeEndpoint()`:

- `project/icon-url.ts:8-15`: `${endpoint.httpBaseUrl}/projects/<id>/icon?v=&theme=&token=`.
- `shell/panels/file-url.ts:9-16`: `${endpoint.httpBaseUrl}/fs/file?path=&v=&token=`.
- `chat/attachments.ts:83-87`: `${endpoint.httpBaseUrl}/attachments/<chatId>/<id>?token=`.

`localFileUrl` (`file-url.ts:23-28`) is a `file://` URL for the desktop shell and has no endpoint in
it, correctly: it only makes sense when the daemon is on this machine.

### 1.5 Stores and module maps with no endpoint dimension

Every one of these means "the daemon we are pointed at right now":

| Module | Shape | Note |
| --- | --- | --- |
| `state/server.ts:15-27` | `platform`, `home`, `version`, `label`, `reachability` | refilled on every `open` |
| `state/sessions.ts:28-56` | `byNodeId: Record<string, SessionState>`, `clear()` L53-55 | |
| `state/chats.ts:19-23` | `byNodeId: ChatsById`, `clear()` L80-82 | |
| `state/providers.ts:11-17` | `providers`, `loaded` | the Agent submenu's source |
| `state/usage.ts:73-125` | `asked`, `summary`, `loading`, `failed`, `limits` (L84) | preferences beside them are the viewer's, not the machine's |
| `state/project.ts:4-29` | `projects: ProjectSummary[]`, `current`, `rev`, `dirty`, `conflict` | one open project, one list |
| `transport/ping.ts:11-16` | `latency` | |
| `state/git-watch.ts:11` | `watches = new Map<string, Watch>()` keyed on `cwd` | refcount per checkout |
| `terminal/registry.ts:7-8` | `live`, `lastScreens`, keyed on node id | live xterms |
| `browser/registry.ts:26,119-120` | `useBrowser.byNodeId`, `BrowserRegistry.elements` | webview elements |
| `drawing/mirror.ts:24,33-34` | `useDrawingMirrors.byViewId`, `watchers`, `wired` | one `drawing.changed` listener for all |
| `shell/usage/limits.ts:9-10` | `readers`, `unsubscribe` | module-level refcount |
| `context/sync.ts:42-43` | `timer`, `sent` | closure state |

Two stores are already safe: `state/git.ts:9-27` and `state/files.ts:90-112` are project-scoped
machine state that travels in the project's local file through `project/panels-port.ts`, and a
project belongs to exactly one endpoint.

### 1.6 The endpoint list and the switch

`apps/client/src/state/endpoints.ts`:

- `Endpoint` (L7-15): `id`, `label`, `httpBaseUrl`, `wsBaseUrl`, `reachability`, `token`.
- `LOCAL_ENDPOINT_ID = 'local'` (L5); `localEndpoint()` (L27-37) builds it from `location.origin`
  with `token: null` and `reachability: 'loopback'`, and it is always in the list (L44-45).
- `read` (L39-51) and `persist` (L53-62) keep `{ endpoints, activeId }` in localStorage under
  `ruimte.endpoints` (L4), with the local row filtered out of what is written.
- `activeEndpoint()` (L95-98) is a `getState()` lookup, not reactive.
- `socketUrlFor` (L101) appends `?token=` because a browser cannot set a header on a WebSocket.
- `parsePairingUrl` (L104-116) reads `http://host:port/pair#token`.

`apps/client/src/endpoint/index.ts`:

- `pairEndpoint` (L12-36) POSTs to `/auth/pair` and stores the row. The id it picks is the address:

```ts
// L27
id: new URL(parsed.httpBaseUrl).host,
```

- The switch is one imperative function, L38-49:

```ts
export const activateEndpoint = async (id: string): Promise<void> => {
    if (id === useEndpoints.getState().activeId) { return; }
    await projectClient.flush();
    useDocument.getState().load(null, null);
    useProject.getState().setCurrent(null, 0);
    useProject.getState().setProjects([]);
    useEndpoints.getState().setActive(id);
    transport.switchTo?.(socketUrlFor(activeEndpoint()));
};
```

  There is no `useEndpoints.subscribe(...)` anywhere. Nothing reacts to the active endpoint; this
  function does everything by hand, which is exactly why adding a second connection means reading
  this function and nothing else.
- `startEndpointSelection` (L75-80) runs at boot and calls `switchTo` when the remembered endpoint
  has a token. The first socket therefore always goes to the page's own daemon and moves afterwards.
- `revokePairedClient` (L58-66) goes back to `LOCAL_ENDPOINT_ID` and forgets the row when the client
  revokes its own session.

### 1.7 The UI that says "one at a time"

- `shell/settings/EndpointsSection.tsx:203-205` has the comment and the radiogroup:

```
{/* One daemon is active at a time, so the list is a set of radios; forgetting a machine is
    something else and sits beside the radio, not inside it. */}
<div className="flex flex-col gap-2" role="radiogroup" aria-label="Machines this client talks to">
```

  Rows are `role="radio"` with `aria-checked` (L215-216) and `onClick={() => void activateEndpoint(endpoint.id)}`
  (L218). Pairing activates the new endpoint straight away (L191-193). `<PairedClients key={activeId} />`
  (L249) remounts the paired-clients block on every switch, and that block re-reads on every
  reconnect (L59-69).
- `shell/settings/panes/MachinesPane.tsx:7`: `description="One daemon at a time. Switching empties the canvas and loads the other machine's projects."`
- `shell/ConnectionDot.tsx:56-73` draws exactly one dot from `useConnection()`
  (`transport/status.ts:19`); its popover (L33-54) mixes the active endpoint's label (L35) with
  `useServer` (L36-39) and the ping.
- `shell/connection-info.ts:4-11,15-34,38-49` are pure formatters over a single `MachineInfo`.
- `shell/ProjectMenu.tsx:22-23,90-113` renders one flat list from `useProject.projects`, with no
  machine anywhere.
- `shell/CommandPalette.tsx:296-305` builds the project-switch entries the same way.

## 2. What the daemon already gets right

### 2.1 One registry per daemon

`$RUIMTE_HOME/projects.json`, read at `apps/server/src/projects/project-store.ts:521` and written at
`:535`. `RegistryEntrySchema` (L52-60) is `{ projectId, name, color, folder | null, lastOpenedAt, icon? }`.
`RUIMTE_HOME` comes from `apps/server/src/config.ts:59` (`env.RUIMTE_HOME ?? ~/.ruimte`). The layout
is documented in `apps/server/README.md:34-58`.

### 2.2 A project id is the daemon's, not the folder's

`newId()` (`project-store.ts:76`) is `randomBytes(6).toString('base64url')`. The same folder opened
on two machines gets two ids. Two consequences:

- Nothing has to be stored about which daemon a project belongs to. A project row comes from exactly
  one endpoint's `project.list`, and that endpoint is its home.
- No new field in `project.json`, which is in git and shared between machines. Putting a daemon id
  in it would make the file machine-specific and would conflict on every pull.

Machine state stays out of the shared file too: `$RUIMTE_HOME/projects/<encodeURIComponent(projectId)>.local.json`
(`project-store.ts:422-423`), written on `project.save-local` (L295-297).

### 2.3 Auth per daemon

`apps/server/src/auth/`:

- `auth-store.ts:40-49` keeps session tokens as sha256 hashes in `$RUIMTE_HOME/auth.json`; pairing
  tokens live ten minutes and once (`PAIRING_TTL_MS` L9, `issuePairingToken` L52-56, `pair` L59+).
- `access.ts:55-74` decides per request: a bearer or `?token=` that authenticates wins; otherwise
  loopback passes when `--require-token` is off; anything else is 401. `reachabilityOf` (L13) maps
  an address to `loopback | lan | public`; `originAllowed` (L21-38) lets any loopback origin through,
  which is why a Vite page on `http://localhost:5173` may open a socket to any daemon.
- `relay.ts:5-19` is a seam with a `NoRelay` and no implementation.
- `endpoint.info` (`apps/server/src/handlers/auth.ts:14-20`) answers
  `{ label, platform, version, reachability, authenticated }`; `EndpointInfoSchema` is
  `packages/contracts/src/auth.ts:7-16`, and `PairResultSchema` (L26-30) embeds it, so the pairing
  response already carries the daemon's self-description.
- `server.hello` (`apps/server/src/handlers/server.ts:9-13`) answers `{ version, platform, home }`
  with no client context at all.

### 2.4 What the daemon does not know

A daemon has no idea another one exists and does not need to. Its per-socket state is per
`ClientConnection.id` (`daemon.ts:243,252-253`), and every subscription and `detachAll` hangs off
that id (`daemon.ts:259-279`, `:294-305`). Two sockets from the same browser to two daemons are two
unrelated clients, which is exactly the model that scales to N.

The CSP already allows a second address: `connect-src 'self' ws: wss: http: https:` in both
`apps/server/src/daemon.ts:55-57` and `apps/client/index.html`, with a comment saying it is wide
because a paired endpoint is any host the person adds.

## 3. Three bugs that are there today

These disappear in phases 2 and 3. Two of the three are milder than they look, and the third is
sharper than it looks; the notes below say which is which.

### 3.1 The remembered project is not per endpoint

`apps/client/src/project/project-client.ts:6` is `const LAST_PROJECT_KEY = 'ruimte.lastProject'`,
one key for the whole client. `boot()` (L260-279) reads it at L267 and picks:

```ts
const target = projects.find((p) => p.projectId === remembered && p.available) ?? projects.find((p) => p.available);
```

After a switch, machine A's project id is not in machine B's list, so the fallback silently opens
whatever B lists first. The symptom is not an error, it is the wrong project. `open()` writes the
key at L297 and `closeProject` removes it at L158.

### 3.2 What a switch does and does not empty

Corrected from the brief. `activateEndpoint` calls `useProject.setCurrent(null, 0)` (endpoint/index.ts:45),
and `terminal/lifecycle-watch.ts:57-62` subscribes to exactly that:

```ts
const offProject = useProject.subscribe((state, before) => {
    if (state.current?.projectId !== before.current?.projectId) {
        useSessions.getState().clear();
        useChats.getState().clear();
    }
});
```

So `useSessions` and `useChats` **are** cleared on a switch, and `useDrawingMirrors` too
(`drawing/mirror.ts:56-61`). They are cleared for the wrong reason (a project change, not an
endpoint change), which is fine until phase 4 makes an endpoint switch stop nulling the project.

What is genuinely not cleared:

- `state/server.ts` keeps machine A's `platform`, `home`, `version`, `label` and `reachability`
  until B answers `server.hello` and `endpoint.info` on the new socket (`server-info.ts:20-24`).
  In that window "Reveal in Finder" is wrong on a Linux daemon and the About pane shows the other
  machine.
- `state/providers.ts` keeps A's CLI list until `chat-client.ts:228` reloads it.
- `transport/ping.ts` keeps A's latency until the next measurement.
- `state/usage.ts:84` keeps A's `limits`, and `summary`/`asked` beside it. Worse,
  `shell/usage/limits.ts:9-10` holds `readers` and `unsubscribe` at module level: the
  `usage.limitsChanged` handler was registered on the one transport instance and survives the
  switch, so after the switch the bars update with B's numbers while the snapshot underneath is
  still A's, and `usage.limits` is only re-asked when the reader count goes 0 to 1.
- `shell/usage/UsagePage.tsx:52` sent `usage.subscribe` to A. B never gets one, so while the page
  stays open across a switch, B never pushes `usage.changed` and the page stops refreshing itself.

The reattach storm the brief describes is a race rather than a certainty.
`SessionClient.onStatus` (`terminal/session-client.ts:227-236`) calls `reattachAll` (L238-253) on
every `open`, and that walks `this.mounted` (L37) calling `ensure` with the stored `cwd`. On a
switch the document is emptied first, every `TerminalBody` unmounts and its cleanup calls
`sessionClient.detach(id)` (`nodes/TerminalBody.tsx:199`), which deletes the entry (L129-132).
The new socket opens at least 500 ms later (`websocket-transport.ts:157`), so React normally wins.
`ChatClient.reattachAll` (`chat/chat-client.ts:238-249`) has the same shape. It is a hazard that
becomes routine in phase 3, when a socket reopens without the document ever having been emptied,
so it must be fixed there whether or not it fires today.

Also checked and safe: emptying the document does **not** kill machine A's sessions.
`useDocument.load` (`state/document.ts:142-158`) sets `loading: true` in the same `set` as the new
views (L147-155) and `loading: false` afterwards (L157), and `watchNodes` treats a change while
`loading` as settling (`lifecycle-watch.ts:50-55`), so `end(id, kind)` never runs.

### 3.3 The git watch refcount is keyed on a bare path

`state/git-watch.ts:11` is `const watches = new Map<string, Watch>()`, keyed on `cwd` alone.
`watchGit` (L19-44) counts holders and sends `git.unwatch` when the count hits zero (L40), on
whatever the transport points at by then.

Today the damage is small: the panels unmount before the new socket opens, so the unwatch either
rejects with `not-connected` or reaches the new daemon as a no-op, and the watch on the old daemon
dies with the socket anyway. The sharp version arrives with phase 3. With two endpoints connected
and the same path present on both (a container's `/work/repo-a` and a Mac's `/work/repo-a`, or two
machines with the same checkout under the same home), one map entry serves two daemons: the second
panel increments a refcount that belongs to the first machine's watch, never sends its own
`git.watch`, and gets no `git.status` events. `useGitStatus` (L51-83) also filters incoming events
on `payload.cwd === cwd` only (L76), so the other machine's status for the same path would paint
into this panel.

## 4. The design, in six phases

### 4.1 Phase 1: a stable endpoint identity

**Why.** An endpoint is currently `new URL(httpBaseUrl).host` (`endpoint/index.ts:27`). That breaks
on every address change (DHCP, a different published Docker port, Tailscale versus LAN), and it
happily reuses a row and its dead token when a different daemon answers on the same address. Once
stores are keyed per endpoint (phase 4), an id that moves takes the sessions, chats and remembered
projects with it.

**Where the id goes on the wire.** `endpoint.info`, not `server.hello`. Three reasons:
`EndpointInfoSchema` already carries the two fields the endpoint row is built from (`label`,
`reachability`); `PairResultSchema` (`packages/contracts/src/auth.ts:26-30`) embeds
`EndpointInfoSchema`, so `pairEndpoint` gets the id in the pairing response without a second round
trip; and `server.hello` is the machine-facts call with no client context
(`apps/server/src/handlers/server.ts:9-13`), used by `smoke.ts:59` and the About pane, where a
daemon identity does not belong.

**Server.**

- New `apps/server/src/endpoint-id.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isNotFound, writeAtomic } from './fs.ts';

const FileSchema = z.object({ version: z.literal(1), id: z.string().min(1) });

/* The daemon's own name for itself, stable across restarts and address changes. */
export const readOrCreateEndpointId = async (home: string): Promise<string> => {
    const path = join(home, 'endpoint.json');
    try {
        const parsed = FileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
        if (parsed.success) {
            return parsed.data.id;
        }
    } catch (e) {
        if (!isNotFound(e)) {
            console.warn('The endpoint id file would not parse; minting a new id', e);
        }
    }
    const id = randomBytes(8).toString('base64url');
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeAtomic(path, `${JSON.stringify({ version: 1, id }, null, 2)}\n`, 0o600);
    return id;
};
```

  `writeAtomic` is `apps/server/src/fs.ts:14-28`; `mode: 0o700` on the home directory matches
  `saveRegistry` (`project-store.ts:532`).

- `apps/server/src/daemon.ts`: read it before `registerAuthHandlers` (near L65 where the `AuthStore`
  is built), add `id` to the `EndpointIdentity` interface (`handlers/auth.ts:4-11`), pass it at
  L113-116, and return it from the `endpoint.info` handler (`handlers/auth.ts:14-20`) and from the
  `POST /auth/pair` route (`daemon.ts:190-200`), which builds the same object.
- `packages/contracts/src/auth.ts:7-16`: add `id: z.string().min(1)` to `EndpointInfoSchema` with a
  comment saying it is the daemon's own, stable across addresses. Every consumer is typechecked
  into updating; `apps/server/src/handlers/auth.ts` and the pair route are the only producers.
- `apps/server/README.md:39-58`: add `endpoint.json` to the layout block.

**Client.**

- `state/endpoints.ts`: `Endpoint` (L7-15) becomes

```ts
export interface Endpoint {
    /* The daemon's own id from `endpoint.info`, or `local` for the daemon that served this page. */
    id: string;
    label: string;
    /* Where this daemon last answered; a hint, not an identity. */
    httpBaseUrl: string;
    wsBaseUrl: string;
    reachability: Reachability;
    token: string | null;
}
```

  `LOCAL_ENDPOINT_ID = 'local'` (L5) stays a reserved id, because the client cannot know the id of
  the daemon behind its own origin before it connects, and in dev that origin is Vite rather than a
  daemon at all. Add one field to the local row and to every row, filled from `endpoint.info` on
  every connection:

```ts
/* The daemon that last answered on this address. `local` learns it too, which is how the client
   tells that a paired row and the page's own daemon are the same machine. */
daemonId: string | null;
```

- `pairEndpoint` (`endpoint/index.ts:26-33`) uses `endpoint.id` instead of
  `new URL(parsed.httpBaseUrl).host`, and sets `daemonId` to the same value. Pairing with a daemon
  that is already in the list under a different address now updates that row rather than adding a
  second one.
- `transport/server-info.ts:9-12` already asks `endpoint.info` on every `open`. Add: when the
  answered `id` differs from the row's `daemonId`, write it. When the row's `id` is not `local` and
  the answered `id` differs from the row's `id`, do **not** silently adopt it: the address now
  points at a different machine and the token is for the old one. Show it (a toast, and a "This
  address answers as another machine" line in the Machines pane) and leave the row alone. This is a
  new small module, `endpoint/identity.ts`, so `server-info.ts` stays a two-request loader.

**Migration of existing localStorage.** `ruimte.endpoints` today holds rows with host-shaped ids
and no version marker. In `read()` (`state/endpoints.ts:39-51`):

- Accept the old blob, set `daemonId: null` on every row, keep the ids as they are, and write back
  `{ version: 2, endpoints, activeId }`.
- On the first successful `endpoint.info` for a row whose `id` is not `local` and whose `daemonId`
  was null, rekey the row to the answered id, move `activeId` along if it pointed at the old key,
  and move the per-endpoint entries phase 2 adds (`ruimte.lastProject`). One function,
  `rekeyEndpoint(oldId, newId)` on the store, with a test in `state/endpoints.test.ts` next to the
  two tests already there (L5, L14).
- A row that never connects again keeps its host-shaped id forever. Harmless: it is a key, and the
  only thing that reads it is the same localStorage.

**What can break.** A client on this build talking to an older daemon gets no `id` in
`endpoint.info`, and zod rejects the whole reply, so `useServer.setEndpoint` never fires and the
Machines pane shows nothing. Two daemons on one machine (the dev setup with `RUIMTE_DAEMON`) sharing
one `RUIMTE_HOME` would share an id; that is already broken for `projects.json` and sessions, so it
is a pre-existing rule (one home per daemon), worth a line in `apps/server/README.md`.

### 4.2 Phase 2: the three bugs

No contract changes. Four commits.

**The remembered project per endpoint.** `project/project-client.ts:6` becomes a record:

```ts
const LAST_PROJECT_KEY = 'ruimte.lastProject';

interface LastProject {
    /* The last thing the person looked at, so a cold boot lands where they left off. */
    last: { endpointId: string; projectId: string } | null;
    /* What was open per machine, so switching back reopens that machine's project. */
    byEndpoint: Record<string, string>;
}
```

`ProjectClient` gets an `endpointId: () => string` constructor option next to the existing
`options.storage` seam (L106), so the tests keep their fake storage and get a fake endpoint id.
`boot()` (L260-279) reads `byEndpoint[endpointId()]` at L267; `open()` writes both fields at L297;
`closeProject` (L158) removes only this endpoint's entry. The existing
`project/project-client.test.ts` fake transport covers it.

**Emptying per endpoint.** Give the stores that keep a machine's answers an explicit reset and call
it from `activateEndpoint` (`endpoint/index.ts:39-49`) before `setActive`:

- `state/server.ts:15-27`: `clear()` setting every field back to null.
- `state/providers.ts:11-17`: `clear()` setting `providers: []`, `loaded: false`.
- `transport/ping.ts:13-15`: `setLatency(null)`.
- `state/usage.ts:94-125`: `clear()` setting `asked`, `summary`, `limits` to null and
  `loading`/`failed` to false; the three preferences stay.
- `shell/usage/limits.ts:9-10` and `shell/usage/UsagePage.tsx:50-75`: re-ask on an endpoint change,
  by adding `useEndpoints((s) => s.activeId)` to the effect's dependency array in both. That single
  change fixes both the stale snapshot and the missing `usage.subscribe` on the new daemon.

This is the phase where `endpoint/index.ts` first grows a `useEndpoints.subscribe(...)` instead of
doing everything inline, because phase 3 needs the same reactions to fire when the active endpoint
changes for reasons other than a click (opening a project on another machine, phase 5).

**The reattach guard.** `SessionClient` and `ChatClient` learn which endpoint they belong to. Before
phase 3 there is one of each, so the cheapest correct fix is to stamp the mounted entries: add
`endpointId` to `Mounted` (`terminal/session-client.ts:37`) at `open` (L88-89) and `attach`
(L101-103), and make `reattachAll` (L238-253) skip an entry whose `endpointId` is not the one the
transport now points at, dropping it from `mounted` instead. Same in `chat/chat-client.ts:238-249`.
Phase 3 then replaces the stamp with "this client owns one endpoint's socket", and the guard becomes
structural.

**The git watch key.** `state/git-watch.ts:11` becomes keyed on `${endpointId}:${cwd}`, and the
`git.status` filter (L76) checks the endpoint as well. Before phase 3 the endpoint id is
`useEndpoints.getState().activeId`; after phase 4 it comes from the same place as every other key.
Splitting the key now means the phase 4 change is mechanical.

### 4.3 Phase 3: `TransportPool` behind a facade

**Shape.** New `apps/client/src/transport/pool.ts`:

```ts
import type { Endpoint } from '@/state/endpoints';
import type { ConnectionState, Transport, TransportStatus } from './transport';
import { WebSocketTransport } from './websocket-transport';

/* The sockets this client holds, one per daemon. A daemon is a socket; a socket is never shared. */
export class TransportPool {
    private readonly byId = new Map<string, WebSocketTransport>();
    private readonly holds = new Map<string, number>();
    private readonly idle = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly listeners = new Set<() => void>();

    /* The socket for an endpoint, opened on the first call. */
    require(endpoint: Endpoint): Transport;
    /* The socket if there is one; null when nothing has asked for this endpoint yet. */
    peek(endpointId: string): Transport | null;
    /* Takes a hold: the socket stays up until every holder releases it. */
    hold(endpoint: Endpoint): () => void;
    /* The address of an endpoint changed (a re-pair, a new port); move the existing socket. */
    readdress(endpointId: string, url: string): void;
    /* Closes the socket and forgets it; used when an endpoint is forgotten or revoked. */
    drop(endpointId: string): void;

    statusOf(endpointId: string): ConnectionState;
    subscribeStatus(endpointId: string, handler: (status: TransportStatus) => void): () => void;
    /* Any endpoint's status changed; what a per-machine list in the UI re-renders on. */
    subscribe(handler: () => void): () => void;
}

export const pool = new TransportPool();
```

`WebSocketTransport` itself does not change. `switchTo` (L51-68) stays, but only `readdress` calls
it, and only when the same daemon moved to another address. Changing machines is never a `switchTo`
any more.

**The facade.** `apps/client/src/transport/index.ts` keeps exporting `transport`, now as an object
that forwards to the active endpoint:

```ts
class ActiveTransport implements Transport {
    private readonly handlers = new Map<EventType, Set<(payload: never) => void>>();
    private readonly statusHandlers = new Set<(status: TransportStatus) => void>();
    private bound: { transport: Transport; off: Array<() => void> } | null = null;

    // Re-binds every registered handler to the endpoint that just became active and tells
    // status subscribers, because the new socket's status is very likely another one.
    private rebind(): void { ... }

    request(type, payload) {
        const active = pool.peek(useEndpoints.getState().activeId);
        if (!active) { return Promise.reject(new TransportError('not-connected', 'The server is not connected')); }
        return active.request(type, payload);
    }
    on(event, handler) { /* stored here, forwarded to whichever transport is bound */ }
    subscribeStatus(handler) { this.statusHandlers.add(handler); ... }
    get status() { return pool.statusOf(useEndpoints.getState().activeId).status; }
    get connection() { return pool.statusOf(useEndpoints.getState().activeId); }
}

export const transport: Transport = new ActiveTransport();
```

Behavior on a switch, spelled out because it is the whole contract the 33 files depend on:

- **Event handlers.** A handler registered through the facade only ever hears the active endpoint.
  On a switch the facade unsubscribes every handler from the old transport and subscribes the same
  handler set to the new one, in the same tick `activeId` changes. Nothing has to re-register. A
  handler that was registered while endpoint A was active and is still registered when B becomes
  active starts hearing B, which is what every current caller means (`drawing/mirror.ts:46` wants
  the open project's drawings, `state/git-watch.ts:75` wants the open project's repository).
- **Pending requests.** A request goes to the transport that was active when `request` was called
  and stays there. A switch does not cancel it; it resolves or rejects against its own socket, and
  `rejectPending` (`websocket-transport.ts:165-171`) only fires if that socket closes. Two
  consequences worth a comment in the code: a slow `git.log` started on A still resolves after a
  switch to B, and whoever awaited it has to check that the answer is still wanted, which every
  caller already does with an `alive` or a generation counter (`shell/panels/CommitLog.tsx:44,49`,
  `shell/CommandPalette.tsx:166,172`).
- **`subscribeStatus`.** Fires when the active endpoint's status changes **and** when the active
  endpoint changes. `transport/status.ts:17,19` re-reads `transport.status` and
  `transport.connection` after each notify, so `useTransportStatus` and `useConnection` need no
  change. The `PLAIN` map (`status.ts:9-13`) stays as the fallback for a pool entry that does not
  exist yet; every real entry is a `WebSocketTransport` with its own live `ConnectionState`, whose
  object identity changes only when the state does, so `useSyncExternalStore` does not loop.
- **`switchTo`.** Removed from the facade. `activateEndpoint` sets `activeId` on the store; a
  `useEndpoints.subscribe` in `endpoint/index.ts` calls `pool.require(...)` for the new endpoint and
  `transport.rebind()`. The `switchTo?` member on the `Transport` interface
  (`transport/transport.ts:22`) becomes optional-and-unused by the facade; keep it on
  `WebSocketTransport` for `readdress`.

**The four clients.** Each takes a `Transport`, so each becomes one instance per endpoint, created
by the pool's owner rather than at module load:

```ts
// apps/client/src/transport/connections.ts
export interface Connection {
    endpointId: string;
    transport: Transport;
    sessions: SessionClient;
    chats: ChatClient;
    projects: ProjectClient;
    drawings: DrawingClient;
}
export const connectionFor = (endpoint: Endpoint): Connection;   // memoized per endpoint id
export const activeConnection = (): Connection;
```

`chat/index.ts:8`, `terminal/index.ts:5` and `project/index.ts:18-43` keep exporting `chatClient`,
`sessionClient`, `projectClient` and `drawingClient`, now as getters over `activeConnection()`, so
their ~40 call sites do not change in this phase. Phase 6 removes the getters.

Note the ordering constraint in `project/index.ts:14-20`: the drawing client is built before the
project client because the project client calls `drawingClient.flush()` as its `beforeSwitch` hook
(L41). `connectionFor` keeps that order inside one connection.

**Connection budget.** When the pool opens a socket:

- The active endpoint, always.
- Every endpoint with an open project (phase 5) or a mounted node.
- While the Machines pane is open, every known endpoint with a token, so the list can show a live
  dot per row. That is a `hold` taken by `EndpointsSection` in an effect and released on unmount.

When it lets go: an endpoint with no holds and not active closes after an idle grace of 30 seconds,
so a switch there and back is free. The local row never closes. A socket that closes this way is
forgotten from `byId`; `require` opens a fresh one, which starts the backoff at zero rather than
continuing the old attempt count.

Open, listed as a question in section 8: whether a hidden tab should drop the non-active sockets.
The daemon buffers output per attached client and flushes every 16 ms, so an idle socket is cheap;
a phone on a mobile connection is the case that argues the other way.

**Per-machine status in the UI.**

- `shell/ConnectionDot.tsx:56-73` keeps showing the active endpoint, because the toolbar has one
  dot and the person is in one project. Its popover (L33-54) grows a row per connected endpoint:
  label, dot, latency, so "is my container still up" is answerable without opening settings.
- `shell/settings/EndpointsSection.tsx:205-245`: each row gets a live dot from a new
  `useEndpointConnection(endpointId)` hook over `pool.subscribeStatus`. The radiogroup
  (L203-205) stays, because "which machine am I working on" is still one choice until phase 6; the
  comment changes to say the radio picks the active machine, not the only connection.
- `shell/settings/panes/MachinesPane.tsx:7`: the description becomes something like "Every paired
  daemon stays connected. The one you pick is where new projects open."
- `transport/ping.ts` becomes one `PingMonitor` per connected endpoint, and `usePing` a
  `Record<endpointId, number | null>`; `shell/connection-info.ts:53` (`describePing`) is unchanged,
  it is handed a number.

**What can break.** Two sockets means two `session.list-changed`, two `usage.changed`, two
`fs.changed` streams. Any handler that assumes global truth rather than "the active endpoint's
truth" now sees interleaving. The facade's rebinding contains that for the 33 files; the four
clients are the ones that must not be behind the facade, because each owns its own socket's events.
`context/sync.ts:87-92` resets `sent` on reopen and re-pushes; with one connection per endpoint
that becomes per endpoint too (phase 4).

### 4.4 Phase 4: per-endpoint state

**The key.** `${endpointId}:${nodeId}`. Node ids are random
(`state/canvas.ts:278`, `Math.random().toString(36).slice(2, 10)`), so this is not about collisions;
it is about ownership. A row in `useSessions.byNodeId` has to say which daemon it describes, or
`sessionClient.kill(id)` goes to the wrong machine and an agent status from B paints on a node of A.

Keep the stores flat `Record<string, T>` and change only the key, with one helper so the shape is
written once:

```ts
// apps/client/src/state/keys.ts
export const endpointKey = (endpointId: string, id: string): string => `${endpointId}:${id}`;
export const splitKey = (key: string): { endpointId: string; id: string } => { ... };  // first colon wins
export const dropEndpoint = <T,>(rows: Record<string, T>, endpointId: string): Record<string, T> => ...;
```

A colon is safe in the key: an endpoint id is base64url (phase 1) or the literal `local`, neither of
which contains one, and a node id is `<prefix>-<8 base36 chars>`.

Store by store:

| Module | Change |
| --- | --- |
| `state/sessions.ts:28-56` | `byNodeId` keyed with `endpointKey`; `clear()` becomes `clear(endpointId)` over `dropEndpoint`; every setter takes the endpoint |
| `state/chats.ts:19-23,80-82` | the same |
| `state/server.ts:15-27` | `byEndpoint: Record<string, ServerInfo>`; `useServer()` reads the active one |
| `state/providers.ts:11-17` | `byEndpoint: Record<string, { providers, loaded }>`; the Agent submenu must list the CLIs of the machine the node will run on |
| `state/usage.ts:73-125` | `asked`, `summary`, `loading`, `failed`, `limits` per endpoint; the three preferences (L15-24) stay global, they are the viewer's |
| `shell/usage/limits.ts:9-10` | `readers` and `unsubscribe` become `Map<endpointId, { readers, unsubscribe }>` |
| `transport/ping.ts:11-16` | `latency` per endpoint (already in phase 3) |
| `state/git-watch.ts:11` | key `${endpointId}:${cwd}`, request on that endpoint's transport (already in phase 2) |
| `terminal/registry.ts:7-8` | `live` and `lastScreens` keyed with `endpointKey`; `forgetScreen`, `lastScreenOf`, `registerTerminal` take the endpoint; the dev hooks (L59-68) follow |
| `browser/registry.ts:26,120` | `useBrowser.byNodeId` and `BrowserRegistry.elements` keyed with `endpointKey`. A webview runs on this machine regardless of the daemon, so this is only about not mixing two projects' nodes |
| `drawing/mirror.ts:24,33-34` | `byViewId` and `watchers` keyed with `endpointKey`; `wired` becomes `Set<endpointId>`, one `drawing.changed` subscription per endpoint transport instead of one on the facade |
| `context/sync.ts:42-43` | `sent` becomes `Map<endpointId, string>`; the push goes to the endpoint of the project it walked |
| `state/git.ts:9-27`, `state/files.ts:90-112` | unchanged: project-scoped machine state, carried by `project/panels-port.ts` into the project's local file |

**Readers.** The call sites are the work, not the stores. `useSessions((s) => s.byNodeId[node.id])`
and its siblings appear across `canvas/nodes/*`, `nodes/*`, `shell/Sidebar.tsx` and
`shell/sidebar-rows.ts`. Introduce reader hooks that do the keying once:

```ts
export const useSessionState = (nodeId: string): SessionState | undefined =>
    useSessions((s) => s.byNodeId[endpointKey(useEndpointId(), nodeId)]);
```

In phase 4 `useEndpointId()` reads `useEndpoints((s) => s.activeId)`. In phase 6 the same hook reads
the connection context, and not one reader changes again. Introducing the hooks is the whole reason
to do phase 4 before phase 6 rather than in one step.

**What can break.** Anything that iterates a store's keys and treats them as node ids:
`state/sessions.ts:58-88` (the status derivation), `shell/sidebar-rows.ts` and
`terminal/lifecycle-watch.ts:18-30`. `liveNodes()` builds a `Map<string, NodeKind>` of the open
project's nodes, so its keys must be keyed the same way as the store it is compared against, or
every node looks like it left the document and gets killed. That function is the single most
dangerous edit in this phase and deserves its own test in `terminal/lifecycle-watch` coverage:
nodes of endpoint A must not be ended when endpoint B's project changes.

### 4.5 Phase 5: the project list as a union

**State.** `state/project.ts:4-29` grows an endpoint per row:

```ts
export interface ProjectRow {
    endpointId: string;
    summary: ProjectSummary;
    /* From a remembered list of a daemon that is not answering right now. */
    stale?: boolean;
}

interface ProjectStore {
    projects: ProjectRow[];
    current: ProjectRow | null;
    ...
}
```

`ProjectSummary` (`packages/contracts/src/project.ts:368-380`) does not change; the endpoint is the
client's knowledge, not the daemon's.

**Who asks.** `ProjectClient` stays one instance for the open project, against the facade, because
the rev discipline, the dirty flag and the conflict banner are about one open document and phase 5
still opens one at a time. Listing is separated out:

```ts
// apps/client/src/project/list.ts
/* `project.list` on one endpoint, with the answer remembered so a machine that is asleep
   still shows its projects. */
export const listProjects = async (endpointId: string): Promise<ProjectRow[]>;
/* Re-asks every connected endpoint and folds the answers into `useProject.projects`. */
export const refreshAllLists = async (): Promise<void>;
```

`ProjectClient.refreshList` (`project-client.ts:133`) keeps doing the active endpoint and calls into
the same fold, so an open, a rename or a delete updates the union without a second round trip to the
other machines.

**The cache.** A machine that is asleep is exactly when you want to see its projects, so the last
`project.list` per endpoint goes to localStorage under `ruimte.projects.<endpointId>`, capped at,
say, 50 rows, dropped when the endpoint is forgotten. Rows from the cache carry `stale: true`.
Clicking one connects to that endpoint first (`pool.require`) and opens; if the socket does not come
up within a few seconds the open fails with the endpoint's own error rather than hanging, and the
row keeps its dimmed state.

**UI.**

- `shell/ProjectMenu.tsx:90-113`: one group per machine instead of one static "Projects" label at
  L90. The active endpoint's group first, then the rest in `useEndpoints.endpoints` order; a group
  header is the endpoint label, with a dot for its connection. A `stale` row is dimmed with a
  "Not connected" hint. The disabled rule at L93-94 (`!project.available`) stays and is separate:
  `available` means the daemon lost the folder, `stale` means the client lost the daemon.
- `shell/CommandPalette.tsx:296-305`: each entry gets the machine as its secondary line. The
  `Projects` section (L67, L333, L345) does not split; a palette with one list and a machine per
  row reads better than four sections. Entries for a `stale` project stay in the list, so
  "open the work laptop's project" is typeable.
- Opening sets the endpoint. Replace `projectClient.openProject(projectId)` with
  `openProject(endpointId, projectId)` in one place (`project/open.ts`), doing, in order: flush the
  current project on **its own** endpoint's transport, empty the document, set the active endpoint,
  wait for that socket to be open, `project.open`. That is `activateEndpoint`
  (`endpoint/index.ts:39-49`) and `ProjectClient.open` (`project-client.ts:281-300`) merged; both
  callers of `activateEndpoint` (`EndpointsSection.tsx:193,218`) keep working, since picking a
  machine without picking a project still means "make this the active machine and open what was last
  open there", which is `byEndpoint` from phase 2.
- The remembered choice becomes the phase 2 record used in full: `last` decides the cold boot,
  `byEndpoint` decides a switch.

**What can break.** `shell/ProjectMenu.tsx:127` reveals `current.folder` through `fs.reveal` on the
facade; with the union, `current` may belong to an endpoint that is not active for a moment during
an open. Route it through the current row's endpoint explicitly. The same for the icon URL
(`project/icon-url.ts:8-15`), which must use the row's endpoint, not `activeEndpoint()`, or a menu
listing two machines paints both sets of icons through one daemon's token. That is the first place
the facade genuinely does not hold, and it is a good argument for doing phase 6 soon after.

**Opening a folder on the machine that is active.** Two paths, and only one of them is right for a
remote daemon. `ProjectMenu.openFolder` (`shell/ProjectMenu.tsx:51-61`) asks the Electron bridge for
a native dialog when there is one, and falls back to the command palette on `~/` in a browser tab.
The palette path is correct already: it browses with `fs.browse` over the transport, so it lists the
active daemon's file system and opens a folder there. The native dialog is not: it picks a folder on
the machine Electron runs on, which is the wrong file system the moment the active endpoint is
somewhere else. Phase 5 should use the native dialog only when the active endpoint is the daemon on
this machine, and the palette browser otherwise. A native dialog cannot browse a remote file system,
so there is nothing to fix inside the bridge.

### 4.6 Phase 6: a context instead of a facade

**Why.** A facade can only answer "the active endpoint", so two projects side by side is exactly
the case it cannot express. The replacement is a React context carrying a whole connection, and a
subtree that reads it.

**Shape.** New `apps/client/src/transport/context.tsx`:

```tsx
export interface Connection {
    endpointId: string;
    transport: Transport;
    sessions: SessionClient;
    chats: ChatClient;
    projects: ProjectClient;
    drawings: DrawingClient;
    /* For the three URL builders: bytes never come over the socket. */
    httpBaseUrl: string;
    token: string | null;
}

const ConnectionContext = createContext<Connection | null>(null);

export const ConnectionProvider = ({ endpointId, children }: { endpointId: string; children: ReactNode }): ReactElement => { ... };

/* Throws outside a provider on purpose: a component that needs a daemon has to sit in a workspace. */
export const useConnection = (): Connection => { ... };
export const useTransport = (): Transport => useConnection().transport;
export const useEndpointId = (): string => useConnection().endpointId;
```

Today the only contexts in the client are `TooltipProvider` (`App.tsx:33,56`),
`shell/PanelHeaderSlot.tsx:5` and `shell/panels/file-actions.ts:18`, so this is a new pattern in the
app and worth writing into `docs/HANDOFF.md` as a decision.

**What goes inside the provider.** A workspace: one open project, its views, its canvas, its
panels, its nodes. `App.tsx:35-47` splits into a shell that is outside and one or more workspaces
that are inside. The provider wraps a workspace, never the app, or nothing is gained.

**How a panel or node knows its endpoint.** It does not ask, it inherits. A node is rendered inside
its project's subtree; there is no prop to thread and no id to look up. The 33 import sites become
`const transport = useTransport();` inside the component. For the non-component call sites
(`state/git-watch.ts`, `context/sync.ts`, `shell/palette-grep.ts`, the four clients) the endpoint is
already an explicit parameter after phase 4, so they take a `Transport` or a `Connection` instead of
importing one.

The three URL builders become hooks:

```ts
export const useProjectIconUrl = (): (projectId: string, version: string, theme: 'light' | 'dark') => string;
export const useFileBytesUrl  = (): (path: string, mtime: number, size: number) => string;
export const useAttachmentUrl = (): (chatId: string, attachmentId: string) => string;
```

each reading `httpBaseUrl` and `token` from the connection instead of `activeEndpoint()`
(`project/icon-url.ts:9`, `shell/panels/file-url.ts:10`, `chat/attachments.ts:84`). Threading an
`endpointId` prop through 33 files instead would be worse in every way.

**Global UI that belongs to no project.** The command palette, the settings dialog, the usage page
and the connection dot sit outside every provider and take an endpoint explicitly:

- **Settings and Machines**: already about endpoints, not about a project. They read `pool` and
  `useEndpoints` directly.
- **Usage**: becomes a page with a machine picker, or a page per machine. The store is already keyed
  per endpoint after phase 4, so this is a UI decision, not a plumbing one. Recommendation: one page
  with the machine as a segmented control next to the period, because the numbers are a person's
  spend and a person uses several machines.
- **Command palette**: two halves. Project switching is global and lists every machine (phase 5).
  `fs.browse`, `fs.search` and `fs.grep` (`CommandPalette.tsx:168,194`, `shell/palette-grep.ts:78`)
  are about "the project in front of me", which needs a focused workspace. Proposal:
  `useUi.focusedEndpointId`, set by the same pointer-down capture that already sets `bodyFocused`
  (`shell/ViewHost.tsx`, `StandaloneView`). The palette opens against the focused workspace's
  connection and says which machine it is searching in its placeholder.
- **Connection dot**: one dot per workspace in that workspace's chrome, plus the multi-machine
  popover from phase 3 in the toolbar.

**What is honestly still open.**

1. `useCanvas` (`state/canvas.ts`, 716 lines), `useDocument` (`state/document.ts`, 435 lines) and
   `useDrawing` are `create(...)` singletons holding one open project. Two projects side by side
   needs one instance per workspace. Zustand supports this through a store factory
   (`createStore` plus a context), but it is a mechanical change across every reader of those three
   stores, which is most of `canvas/` and `shell/`. Two options:
   - **Store factory per workspace**, handed through the same `ConnectionProvider` (or a
     `WorkspaceProvider` beside it). Correct, and the larger refactor.
   - **One editable project, the rest read-only**: keep the singletons for the focused workspace and
     render the others from a snapshot. Cheaper, and a lie the moment someone types in the second
     terminal.
   Recommendation is the factory, but this is not designed here and is the reason phase 6 is a
   phase rather than a step.
2. The split layout itself does not exist. Phase 6 is the plumbing that makes it possible; the pane
   layout, how a workspace is opened and closed, and what the sidebar shows are a separate feature.
3. Keyboard chords: which workspace gets Cmd+K, Cmd+S, Cmd+1..9. `canvas/Canvas.tsx` binds the
   app-wide chords on `window`. With two workspaces those bindings have to consult the focused one.
4. `docs/HANDOFF.md` decisions, the sidebar and the breadcrumb all assume one project. They need a
   pass, which is a design question for Bas, not an implementation detail.

### 4.7 Phase 7: a connection that survives

Last, and it blocks nothing. Phases 1 to 6 assume a paired client stays paired; this one makes that
true outside a test rig.

**What is true today, checked in the tree.** The pairing token is one time and expires after ten
minutes (`PAIRING_TTL_MS`, `apps/server/src/auth/auth-store.ts:9,54,61`). The session token it hands
out does not expire: a `SessionRecord` carries `id`, `label`, `tokenHash`, `createdAt` and
`lastSeenAt` and nothing else (`auth-store.ts:10-16`), nothing prunes the list, and only
`auth.revoke` removes a client. A paired client therefore stays paired until someone revokes it.

Re-pairing after a container restart is the harness, not the product: `docker/entrypoint.sh:6-7`
deletes `/work` and `$RUIMTE_HOME` on every start unless `RUIMTE_KEEP_STATE=1` is set, which takes
`auth.json` and `endpoint.json` with it, so the daemon comes back as a different machine with no
clients. Set `RUIMTE_KEEP_STATE=1` and a pairing survives a restart today.

**What the phase is actually for.** Four things, in order of how much they matter.

1. **A credential that can rotate.** The session token rides in the query string of the socket URL
   (`socketUrlFor`, `state/endpoints.ts`), because a browser cannot put a header on a WebSocket
   handshake. A query string ends up in logs and process lists, and the token never changes. The fix
   is a key pair per client: pairing registers the client's public key, every connect signs a
   challenge from the daemon, and nothing long lived travels on the wire again. `auth.json` stores
   public keys instead of token hashes, and `auth.sessions` keeps reading the same.
2. **Pinning the daemon.** Phase 1 notices that an address answers as another machine, but the
   client still believes whatever answers. Give the daemon a key pair too, record its public key at
   pairing (trust on first use), and the daemon id becomes a proof instead of a string it reads off
   the wire. This is the half that matters once a connection leaves the machine.
3. **Finding the machine again.** An endpoint keeps `httpBaseUrl` as a hint and nothing updates it,
   so a laptop that changes network is simply gone. Two options, and they compose: mDNS on a LAN, or
   the relay seam that already exists and does nothing (`apps/server/src/auth/relay.ts`, a `Relay`
   interface plus a `NoRelay` that answers null).
4. **Transport security.** A LAN connection is plain `ws://` today. The obvious answer is `wss` with
   a self signed certificate pinned at pairing, and it is the wrong one: the client is a browser
   page, so a self signed certificate means an interstitial the person has to click through, and a
   client certificate is not reachable from JavaScript at all. That is the argument for doing the
   crypto at the application layer (point 1 and 2, ed25519 through WebCrypto) over the existing
   socket, and leaving real TLS to a tunnel in front of the daemon for anyone who wants one.

**What this is not.** Not an account system, not a cloud, not a rendezvous service we run. A relay
stays a seam until someone needs it (`docs/PLAN.md` phase 25 says the same about browser streaming).

## 5. Testing against a second daemon in Docker

A second daemon in a container on Linux is the only way to test this that is not a lie: a different
operating system, a different file system, a different `RUIMTE_HOME`, a real network hop and a real
pairing. Locally only, never in CI, gated behind `RUIMTE_DOCKER=1` so `bun test` at the root stays
green everywhere else.

**The container setup landed in `47ae572`**, while this chapter was being written. It lives under
`apps/server/docker` (`Dockerfile`, `compose.yml`, `entrypoint.sh`, `pair.sh`, `workspace-package.json`,
`README.md`) with `.dockerignore` at the root and the suite in `apps/server/src/docker/remote-daemon.test.ts`.
Four scripts drive it: `docker:up`, `docker:test`, `docker:pair` and `docker:down` in
`apps/server/package.json`. The container publishes `127.0.0.1:4310`, labels itself `docker-linux` and
seeds two repositories under `/work`. This chapter is about which scenarios to run, not about how the
container is built.

### 5.1 What the container is, as Bas chose it

- A shell, git and bun. No agent CLIs, so chat nodes and agent status are out of the container's
  reach (section 5.4).
- Its own `/work` with one or two git repositories the test creates. No mount of the ruimte repo:
  genuinely separate machines.
- `RUIMTE_DOCKER=1` gates every test that needs it.

Three things the setup has to get right, all verified in the tree:

1. **The daemon must bind beyond loopback.** `DEFAULT_HOST` is `127.0.0.1`
   (`apps/server/src/config.ts:27`), so the container runs `--host 0.0.0.0`. From the host the
   published port then arrives from the Docker bridge (a `172.16.0.0/12` address), which
   `reachabilityOf` (`apps/server/src/auth/access.ts:10,13`) calls `lan`, so a token is required.
   That is the point: the container tests the paired path, not the loopback shortcut.
2. **The printed pairing URL is unusable from the host.** `pairingUrl`
   (`apps/server/src/cli/pairing.ts:3-7`) replaces `0.0.0.0` with `hostname()`, which inside a
   container is the container id. `docker exec <name> ruimte pair` has the same problem
   (`pairing.ts:10-19` asks `127.0.0.1` inside the container). The test harness takes the token out
   of the fragment and rebuilds the URL against the published host port. Worth a comment in the
   harness, because it looks like a bug the first time.
3. **The origin check passes as is.** The client page is `http://localhost:5173` in dev, and
   `originAllowed` (`access.ts:21-38`) lets any loopback origin through, so no `--allow-origin` is
   needed. If the client is ever served from a LAN address instead, it is.

Flags worth setting: `--no-hooks` (nothing to install hooks into) and `--no-price-fetch` (no
outbound network in a test), plus `RUIMTE_LABEL` so the machine has a readable name and
`SHELL=/bin/bash`, since `defaultShell` (`apps/server/src/pty/pty.ts:27-32`) falls back to
`/bin/bash` on Linux and runs it with `-l` (L39).

The image installs a trimmed workspace (only `apps/server` and `packages/*`) and runs the daemon from
source with bun. Compiling instead (`bun run --cwd apps/server compile --os linux --arch arm64`,
`apps/server/scripts/compile.ts:16-33`) would produce a single binary plus the `ruimte-context` script,
closer to what a person installs, at the cost of a slower rebuild. Running from source is the right
trade for a test harness.

Note for the dev setup: the Vite proxy forwards `/ws`, `/projects`, `/fs` and `/attachments` to one
daemon (`apps/client/vite.config.ts:15-38`). The container endpoint is addressed absolutely
(`ws://127.0.0.1:<port>/ws?token=...`) and bypasses the proxy entirely. That works, and it is the
reason the local row cannot learn its daemon id from its own URL (phase 1).

### 5.2 Scenarios per phase

**Phase 1, stable identity**

1. Pair with the container, then read `localStorage['ruimte.endpoints']`: the row's `id` is the
   daemon's id from `endpoint.info`, not `127.0.0.1:4210`.
2. `docker restart` with the same `RUIMTE_HOME` volume: the id is unchanged, the row still matches,
   the token still works, no second row appears.
3. Recreate the container with a fresh `RUIMTE_HOME`: the id changes and the client says the address
   answers as another machine instead of silently reusing the row. The old token is dead anyway,
   because `auth.json` went with the home.
4. Publish the container on another host port, edit the row's address: the row keeps its id, its
   token and its project history.
5. Write a pre-phase-1 blob into localStorage by hand (`id: '127.0.0.1:4210'`, no `version`), load
   the page, connect: the row is rekeyed to the daemon id and `activeId` follows.

**Phase 2, the three bugs**

6. Open project A locally, switch to the container, open project B, switch back: A reopens, not
   "the first available project".
7. The same, then reload: the last endpoint and its project come back together.
8. With the usage page open, switch to the container: the plan limits and the summary are the
   container's (empty, section 5.3), not the Mac's, and `usage.subscribe` reached the container.
9. With the git panel open on a local repo, switch: no `git.unwatch` for that path reaches the
   container, and a panel on `/work/repo-a` gets its own watch.

**Phase 3, the pool**

10. Both endpoints connected at once: two open sockets. `docker stop` the container: its dot goes
    red, and the local project keeps saving, its terminals keep streaming and its git panel keeps
    updating with no visible hiccup.
11. `docker start`: the container's socket reconnects on its own backoff and the local socket was
    never touched (check `attempts` stayed 0 on the local `ConnectionState`).
12. `docker network disconnect` mid-request: the pending requests on that endpoint reject with
    `disconnected` and the local endpoint's pending requests are untouched.
13. The Machines pane shows a live dot per row, and closing the pane releases the extra holds.
14. A terminal session running on the container survives an endpoint switch away and back: the
    screen comes from `session.attach`, not from a client-side replay.

**Phase 4, per-endpoint state**

15. A terminal node on the container and one locally, switching back and forth: each keeps its own
    screen and its own agent status; neither repaints with the other's.
16. Force a node id collision through the dev hooks (`terminal/registry.ts:59-68`,
    `exposeTerminalTestHooks`) and confirm the two registries stay separate.
17. Create `/work/repo-a` on the container and a directory with the same absolute path on the Mac,
    open a git panel on each: two watches, two refcounts, two `git.status` streams, no crosstalk.
18. `fs.browse` and `fs.list` on the container return Linux paths and Linux permissions while the
    local panel shows the Mac's, at the same time.
19. `context.set` for an edge into an agent node on the container writes the container's context,
    and `ruimte-context` inside that session's shell reads it back. This works without an agent CLI,
    because the script is just a shell wrapper on the session's PATH.

**Phase 5, the union**

20. `project.list` from both endpoints: the project menu shows two groups with the machine names,
    and the container's project opens with the endpoint following.
21. `docker stop`, reload the page: the container's projects are listed dimmed and "Not connected",
    the local project opens normally, and clicking a dimmed row reports the machine is not answering
    instead of hanging.
22. The palette's project entries name the machine, and a dimmed one is still typeable.
23. Forget the container endpoint in settings: its rows, its cached list and its socket all go.

**Phase 6, side by side**

24. Two projects open at once, one per machine: each terminal writes to its own daemon, each files
    panel browses its own file system, each git panel commits in its own repo, each saves to its own
    `project.json`.
25. The focused workspace decides what the palette's `fs.grep` searches, and the placeholder says
    which machine.
26. An image in the container's files panel loads from the container's `/fs/file` with the
    container's token; an image in the local project loads from the local daemon. Both on screen.
27. `docker stop` with both open: the container's half shows disconnected and the local half keeps
    working, saving included.

### 5.3 What this setup cannot test

- **Chat nodes and agent status.** No Claude Code and no Codex in the container, so `detectCli`
  (`apps/server/src/providers/detect.ts:7-20`) reports both as not installed, the Agent submenu is
  empty for that machine, `chat.create` fails and `session.status` never arrives.
- **Agent hooks.** `POST /hooks/<kind>` needs a CLI to call it.
- **Usage scans.** Nothing writes `~/.claude/projects/*.jsonl` in the container, so `usage.summary`
  is empty and `usage/limits` reports both CLIs missing.
- **Browser nodes.** The webview belongs to the Electron shell on the Mac. A browser node in the
  container's project renders locally and browses from the Mac's network, so it cannot reach the
  container's `localhost:3000`. That is a design gap, not a test gap, and it is exactly the gap
  `docs/research/browser-streaming.md` exists to close.
- **`fs.reveal` on Linux.** `revealCommand` (`apps/server/src/fs/reveal.ts:25`) runs
  `xdg-open` with no display in a container, so the reveal fails. Useful as a negative test (the UI
  must report it, not hang), not as a feature test.
- **Electron.** Bas tests in the browser; the desktop shell adds `window.ruimteDesktop`, the
  preview path and the webview host. Out of scope on purpose.

### 5.4 How to cover the rest

- **Chat and agent status on a remote daemon**: pair two Macs on the LAN, which is how phase 10 was
  tested (`docs/HANDOFF.md:697-698`). That is a manual session, not a suite.
- **A stub provider**: a script on the container's PATH answering `--version` and speaking enough of
  the stream-json protocol for an init and one assistant message would make chat-on-a-remote-daemon
  testable. Worth building only if chat on a remote daemon becomes a target; write it as a fixture
  under the container setup, never as a fake inside `apps/server`.
- **Usage**: the empty case is the one worth automating (an endpoint with no usage must not blank
  the page or throw). For a non-empty case, copy a handful of real transcripts into the container's
  home at build time as a fixture; the scanner reads them exactly as it reads a person's.
- **Hooks**: `curl` the daemon's `/hooks/<kind>` with a session's bearer token from inside the
  container. That proves the routing and the per-session token, not the CLI's behavior.
- **Agent status without an agent**: `session.status` arrives only from hooks, so there is no
  shortcut. It stays a two-Mac test.

**Gating and placement.** The tests are integration tests against a running container, so they sit
with the container setup rather than next to a source file, which is the one place where the
"tests next to the code they test" rule from `CLAUDE.md` does not fit. Every file skips itself
without the flag:

```ts
const docker = Boolean(process.env.RUIMTE_DOCKER);
test.skipIf(!docker)('a paired container daemon keeps its id across a restart', async () => { ... });
```

## 6. Out of scope

- The split layout itself. Phase 6 makes two workspaces possible; the panes, how a second workspace
  is opened and closed, and what the sidebar and breadcrumb become are a separate design.
- The relay (`apps/server/src/auth/relay.ts:5-19`). A daemon behind NAT is a different problem and
  the seam already exists.
- Browser streaming, which is what a remote project's browser node needs
  (`docs/research/browser-streaming.md`).
- Moving a project between machines, copying one, or any form of sync. A project lives on the daemon
  whose registry holds it.
- Anything in `project.json`. No field is added; the file stays machine-independent and in git.
- Running one client against two daemons that share a `RUIMTE_HOME`. That is already unsupported;
  phase 1 makes it visibly unsupported by giving them the same id.
- Cross-machine drag and drop of a node, and an edge between a node on one machine and a node on
  another. Both are interesting and neither is designed.

## 7. File index for the implementation agent

New:

- `apps/server/src/endpoint-id.ts`, `apps/server/src/endpoint-id.test.ts` (phase 1)
- `apps/client/src/endpoint/identity.ts` (phase 1)
- `apps/client/src/transport/pool.ts`, `pool.test.ts` (phase 3)
- `apps/client/src/transport/connections.ts` (phase 3)
- `apps/client/src/state/keys.ts`, `keys.test.ts` (phase 4)
- `apps/client/src/project/list.ts`, `list.test.ts`, `apps/client/src/project/open.ts` (phase 5)
- `apps/client/src/transport/context.tsx` (phase 6)

Changed, per phase:

- **1**: `packages/contracts/src/auth.ts:7-16`; `apps/server/src/handlers/auth.ts:4-20`;
  `apps/server/src/daemon.ts:65,113-116,190-200`; `apps/server/README.md:39-58`;
  `apps/client/src/state/endpoints.ts:7-15,27-51,53-62,65-93`;
  `apps/client/src/endpoint/index.ts:12-36`; `apps/client/src/transport/server-info.ts:4-13`;
  `apps/client/src/state/endpoints.test.ts`
- **2**: `apps/client/src/project/project-client.ts:6,94-131,158,260-279,297`;
  `apps/client/src/endpoint/index.ts:39-49`; `apps/client/src/state/server.ts:15-27`;
  `apps/client/src/state/providers.ts:11-17`; `apps/client/src/state/usage.ts:94-125`;
  `apps/client/src/transport/ping.ts:11-16`; `apps/client/src/shell/usage/limits.ts:13-36`;
  `apps/client/src/shell/usage/UsagePage.tsx:50-75`;
  `apps/client/src/terminal/session-client.ts:37,88-103,238-253`;
  `apps/client/src/chat/chat-client.ts:238-249`; `apps/client/src/state/git-watch.ts:11,19-44,74-80`
- **3**: `apps/client/src/transport/index.ts` (all of it);
  `apps/client/src/transport/transport.ts:13-23`; `apps/client/src/transport/status.ts:4-19`;
  `apps/client/src/transport/ping.ts`; `apps/client/src/chat/index.ts`,
  `apps/client/src/terminal/index.ts`, `apps/client/src/project/index.ts`;
  `apps/client/src/endpoint/index.ts:39-49,75-80`;
  `apps/client/src/shell/settings/EndpointsSection.tsx:203-245`;
  `apps/client/src/shell/settings/panes/MachinesPane.tsx:7`;
  `apps/client/src/shell/ConnectionDot.tsx:33-73`
- **4**: `apps/client/src/state/{sessions,chats,server,providers,usage}.ts`;
  `apps/client/src/terminal/registry.ts:7-8,22-36,59-68`;
  `apps/client/src/browser/registry.ts:26,120`; `apps/client/src/drawing/mirror.ts:24,33-62`;
  `apps/client/src/context/sync.ts:41-104`; `apps/client/src/terminal/lifecycle-watch.ts:18-30`;
  every reader of the five stores (`canvas/nodes/*`, `nodes/*`, `shell/Sidebar.tsx`,
  `shell/sidebar-rows.ts`)
- **5**: `apps/client/src/state/project.ts:4-29`;
  `apps/client/src/project/project-client.ts:133,281-300`;
  `apps/client/src/shell/ProjectMenu.tsx:22-23,90-127`;
  `apps/client/src/shell/CommandPalette.tsx:296-305,333,345`;
  `apps/client/src/project/icon-url.ts:8-15`
- **6**: `apps/client/src/App.tsx:33-56`; the 31 non-type importers of `@/transport` from the table
  in 1.3; `apps/client/src/project/icon-url.ts`, `apps/client/src/shell/panels/file-url.ts:9-16`,
  `apps/client/src/chat/attachments.ts:83-87`; `apps/client/src/state/ui.ts`;
  `apps/client/src/shell/ViewHost.tsx`; `docs/HANDOFF.md`, `README.md`

## 8. Open questions for Bas

Bas answered questions 3, 4, 5 and 6 on 2026-09-11:

- **Question 3**: a machine that is not connected still lists its projects from a remembered list,
  shown as unavailable until it answers.
- **Question 4**: one usage page with a machine picker.
- **Question 5**: phase 6 turns `useCanvas`, `useDocument` and `useDrawing` into per-workspace
  stores, the larger refactor, so two projects are genuinely editable side by side.
- **Question 6**: no. The Machines pane is not a radiogroup any more. It is there to keep machines:
  pair one, forget one, see what its socket is doing, read the clients paired with it. Which machine
  the work is on is said by opening a project (`openProject(endpointId, projectId)`) and by the
  machine step of the palette's browse mode. The rest of Bas's opinion about that pane is still to
  come and is mostly about its UI.

Questions 1 and 2 stand, and the proposal holds for each until he says otherwise.


1. Does the local row keep the reserved id `local`, or does the client drop the concept and key even
   its own daemon on the id it answers with? The proposal keeps `local`, because in dev the page's
   origin is Vite and not a daemon at all.
2. Connection budget: should a hidden tab drop every socket except the active one, or keep them all?
   The proposal keeps them, with a 30 second idle close for endpoints nothing holds.
3. Should a machine that is not connected still list its projects from a remembered list (the
   proposal), or show nothing until it answers?
4. Usage across machines: one page with a machine picker (the proposal), one page per machine, or a
   summed view with a per-machine breakdown?
5. Phase 6 store factory: turn `useCanvas`, `useDocument` and `useDrawing` into per-workspace stores
   (the proposal, the larger refactor), or keep one editable workspace and render the others
   read-only?
6. After phase 6, is the Machines radiogroup still a radiogroup? "Active machine" only means
   "where a new project opens" once several are connected.
7. Should a paired endpoint that turns out to be the same daemon as `local` (same `daemonId`) be
   merged into one row, or listed twice because the two addresses behave differently (a token, a
   different reachability)?
8. Is an edge between a node on one machine and a node on another ever wanted? The answer decides
   whether `context.set` stays per endpoint or has to become a client-side merge.
