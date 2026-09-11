# A project in its own window: research and design

State of the working tree on 2026-09-11, `4c5d417`, with only `.ruimte/project.json` modified. Every
path is relative to `/Users/bas/Development/Projects/ruimte`. Line numbers are from the working
tree. Nothing here is implemented; this is the document an implementation agent executes.

Phase 6 of `docs/research/multiple-daemons.md` made two workspaces possible: the four stores of an
open project are factories behind a React context (`apps/client/src/state/workspace.ts`,
`apps/client/src/state/workspace-stores.ts`), and `openWorkspace` and `focusWorkspace` are there
(`apps/client/src/transport/connections.ts:224,229`). Section 4.6 of that document left the layout
open and section 6 put the split panes out of scope. Bas chose the other direction on 2026-09-11: a
project opens in a window of its own. A split layout grows too large inside one window, but the
option has to stay open. This design gives several windows without welding the seam a split would
need shut.

`apps/client/src/shell/Sidebar.tsx`, `apps/client/src/shell/usage/`,
`apps/client/src/canvas/Canvas.tsx` and `apps/client/src/state/settings.ts` are being changed in
other work while this is written. Line numbers in those four files may have moved.

## 0. Summary of the recommendation

- A window is a page on the same origin. It gets its own `TransportPool`, its own sockets, its own
  client id on the daemon and its own copy of every zustand store. It shares `localStorage` and
  `IndexedDB` with every other window, which is where the real work is.
- **One project is open in one workspace at a time.** A second window that asks for a project
  somebody already has open does not open it: it raises the window that holds it. The reason is not
  taste. Today a second window on the same project loses canvas edits silently, and section 3.1
  shows exactly where.
- The ownership rule lives on `BroadcastChannel`, keyed on `(endpointId, projectId)` and answered by
  a workspace, not by a window. A split pane therefore holds a project the same way a window does,
  and the rule does not have to change when the split arrives.
- **Closing a window is not closing a project.** `ProjectClient.closeProject` ends the sessions of
  every node the project holds (`apps/client/src/project/project-client.ts:179`). A window that
  closes flushes and lets go, and every terminal and every agent keeps running on the daemon. The
  daemon already does the right thing: a socket that closes detaches sessions and releases nothing
  (`apps/server/src/daemon.ts:343-355`).
- The window is told what to open through its URL (`/?machine=<endpointId>&project=<projectId>`),
  not through IPC, so a reload keeps the window on its project and a browser tab uses the same
  mechanism with no Electron in sight.
- The Electron shell moves from one `mainWindow` to a set. Fourteen places in
  `apps/desktop/src/main.ts` resolve the window globally and have to resolve it from the sender
  instead. That is the largest mechanical part of the work and it is listed line by line in section 6.
- Windows exist in the desktop app. A browser tab gets `window.open` with the same URL, which works,
  minus the OS niceties (no position memory, no raise from a notification).
- Seven phases. Phase 1 is the shell alone and ships without any client change. Phase 7 (the daemon
  holding a project) is optional and blocks nothing.

## 1. How one window is wired today

### 1.1 The Electron shell

`apps/desktop/src/main.ts` is 657 lines and says so in its own header comment at lines 9-12: "one
window, the client inside it, the daemon next to it".

- `let mainWindow: Electron.BrowserWindow | null = null` at line 27. One devtools window per guest
  page in `devtoolsWindows` at line 28.
- `createWindow()` at 186-215 builds the one window: 1440x900, `show: false`,
  `titleBarOptions(true)` (so it is always constructed as if the theme is dark, line 193),
  `backgroundColor: '#131316'` (line 194), the preload at 197, `webviewTag: true` at 199. It shows on
  `ready-to-show` (202), nulls `mainWindow` on `closed` (203-205), forwards fullscreen (207-208) and
  denies every window the page tries to open, sending the URL to the system browser instead
  (210-213).
- The daemon is a child process of the shell: `startDaemon()` at 65-102, `waitForDaemon()` at
  104-121, killed in `before-quit` at 653-656 with the comment "The daemon belongs to the app here;
  sessions end with it until the background service of a later phase."
- Boot at 619-638: the application menu, `sealPreviewSession()`, `startDaemon()`, `waitForDaemon()`,
  then `mainWindow = createWindow()` and `loadURL(devUrl ?? http://127.0.0.1:${port}/)` at 630-631.
- `app.requestSingleInstanceLock()` at 596. `second-instance` (610-617) restores and focuses
  `mainWindow`. `activate` (640-645) rebuilds the window when `mainWindow === null`.
  `window-all-closed` (647-651) quits everywhere but macOS.
- Nothing remembers a window's position. `window.getBounds()` appears once, in `captureTitleBar`
  (548), which is the smoke test measuring the title bar.

### 1.2 What crosses IPC

`apps/desktop/src/preload.ts` (35 lines) exposes `window.ruimteDesktop`, mirrored by the
`DesktopBridge` interface in `apps/client/src/desktop/bridge.ts:43-74`. Everything added since the
first release is optional on the client side, because "a shell that is already running carries the
preload it started with" (bridge.ts:49-51).

Every handler that needs a window reaches for `mainWindow` rather than for the sender:

| main.ts | What | How it resolves the window |
| --- | --- | --- |
| 160-161 | `setTitleBarOverlay` on a theme change | `mainWindow` |
| 164-165 | `setBackgroundColor` on a theme change | `mainWindow` |
| 220 | `guestDevTools` bails out | `if (!guest \|\| !mainWindow) return` |
| 321 | native menu over an editable guest field | `popup({ window: mainWindow ?? undefined, ... })` |
| 336 | the guest context menu event | `mainWindow?.webContents.send('browser:context-menu', ...)` |
| 393-396 | `dialog:pick-folder` | `if (!mainWindow) return null`, then `showOpenDialog(mainWindow, ...)` |
| 407-409 | `dialog:save-file` | `if (!mainWindow) return null`, then `showSaveDialog(mainWindow, ...)` |
| 428 | `window:is-fullscreen` | `mainWindow?.isFullScreen() ?? false` |
| 474 | every updater state change | `mainWindow?.webContents.send('update:state', ...)` |
| 611-616 | `second-instance` | `mainWindow` |
| 641-643 | `activate` | `mainWindow === null` |

### 1.3 The page: a pool, a machine, a workspace

- `apps/client/src/transport/index.ts:15` builds the one `TransportPool` of the page, one socket per
  daemon. `apps/client/src/transport/pool.ts` keeps them in `byId` (line 41) with a 30 second idle
  close (line 6).
- `apps/client/src/transport/connections.ts` holds two module maps: `machines` (59) and `workspaces`
  (60), plus `focusedId` (63). A `Machine` (35-41) is the session and chat clients of one daemon; a
  `Workspace` (48-54) is one open project with its four stores and its `Connection`.
- `workspaceOn(id, endpoint)` at 173-197 builds one on first ask. The first workspace takes the
  module-level default stores (`workspaces.size === 0 ? defaultWorkspaceStores : createWorkspaceStores()`,
  line 179) so that anything rendered outside a provider still reads the project the app started
  with (`apps/client/src/state/workspace.ts:17-27`).
- `emit()` at 241-247 calls `setCurrentWorkspace`, which is the module pointer every non-React caller
  reads (`apps/client/src/state/workspace-stores.ts:34-46`). `useCanvas`, `useDocument`, `useDrawing`
  and `useProject` are `workspaceHook`s (`state/canvas.ts:736`, `state/document.ts:445`,
  `state/project.ts:76`): inside React they read the provider, outside React they read the focused
  workspace.
- `MAIN_WORKSPACE_ID = 'main'` at connections.ts:57, with the comment "A second one is a pane, which
  is a feature of its own". `openWorkspace` at 224 says "Nothing in the app opens one yet".
- `currentEndpointId()` (`apps/client/src/state/keys.ts:48`) is `currentWorkspaceEndpointId() ??
  useEndpoints.getState().activeId`. Every row keyed per machine uses
  `endpointKey(endpointId, id)` = `` `${endpointId}:${id}` `` (keys.ts:10).

### 1.4 What `App.tsx` draws

`apps/client/src/App.tsx` is 75 lines.

```tsx
function Workspace() {
    const workspace = useMainWorkspace();
    const connection = useWorkspaceConnection(workspace);
    return (
        <WorkspaceProvider connection={connection} stores={workspace.stores}>
            ...
        </WorkspaceProvider>
    );
}
```

`useMainWorkspace()` (App.tsx:28, `connections.ts:260`) resolves the one workspace named `main`.
Inside the provider: `Sidebar`, `Toolbar`, `ViewHost`, `WebviewParking`, `ProjectBanner`, `Dock`,
`PreviewPanel`, `Panel`, and the three project dialogs (App.tsx:32-52). Outside it, at the app root:
`CommandPalette`, `SettingsDialog`, `Toasts` (App.tsx:70-73). The window title is set from the
project name at App.tsx:59-62, and `startUpdates` runs once per page at App.tsx:65.

`apps/client/src/main.tsx` runs eleven `start*` functions at module scope (lines 23-34) and throws
away every teardown they return. None of them is guarded against running twice, because a page only
ever runs them once.

### 1.5 What the page keeps outside a workspace

These are module singletons of the page, shared by every workspace in it:

- `useUi` (`state/ui.ts:176`): the palette, the settings dialog, the panels, the sidebar, the app page.
- `useToasts` (`state/toasts.ts:43`), with a module `counter` (34) and `timers` (36).
- `useEndpoints` (`state/endpoints.ts:133`), `useSettings` (`state/settings.ts:120`), `useTheme`
  (`state/theme.ts`), `useUpdates` (`state/updates.ts:12`), `usePing` (`transport/ping.ts:12`),
  `useUsageStore` (`state/usage.ts:102`).
- `browserRegistry` and `useBrowser` (`browser/registry.ts:285,37`): the `<webview>` elements.
- `panelsPort` (`project/panels-port.ts:115`), with the comment "The panels are the viewer's, not a
  daemon's, so every connection writes the same port."
- `startAgentNotifications` (`shell/notifications.ts:24`), `watchNodes` (`terminal/lifecycle-watch.ts:37`),
  `startContextSync` (`context/sync.ts:42`) with its `sent` map at line 46.

And these are shared by every page of the origin:

| Key | Where | Written by |
| --- | --- | --- |
| `ruimte.endpoints` | `state/endpoints.ts:5,100-113` | every `add`, `remove`, `setActive`, `setLabel`, `learnDaemonId`, `pinDaemonKey`, `clearToken`, `rekeyEndpoint` |
| `ruimte.settings` | `state/settings.ts:4,162` | `update()` |
| `ruimte.theme` | `state/theme.ts:5,34` | the theme setter |
| `ruimte.sidebar` | `state/ui.ts:14,33` | `setSidebarOpen` |
| `ruimte.lastProject` | `project/last-project.ts:1,48-56` | `rememberProject`, from `ProjectClient.open` (`project-client.ts:342`) |
| `ruimte.projects.<endpointId>` | `project/list.ts:6,31-39` | `writeCachedList` |
| `ruimte.usage` | `state/usage.ts:16,40-46` | the viewer's period and currency |
| chat drafts, stash, preferences, palette recents | `chat/drafts.ts:20`, `chat/stash.ts:88`, `chat/preferences.ts:66`, `shell/palette-recents.ts:13` | as used |
| the ed25519 key pair | `endpoint/client-key.ts:1-3`, IndexedDB `ruimte-auth` | once, on first pairing |

**There is no `storage` event listener anywhere in the client.** Every one of these keys is read once
at module construction and written blind from then on. That is the single most important fact in
this document after section 3.1.

## 2. What a window is

### 2.1 A window is a page

A second `BrowserWindow` loading the same origin is a second page. It gets a renderer process of its
own, so every module singleton in section 1.5 exists twice. Concretely, per window:

- its own `TransportPool` and therefore its own WebSocket per daemon. The daemon mints a fresh
  `client-<n>` per socket (`apps/server/src/daemon.ts:290`) and subscribes it to the session, chat,
  identity, project, drawing, folder, status, usage and limits sinks (daemon.ts:307-315). Two windows
  are two clients, which the daemon already handles: `Session.attach` keys its pending buffer on the
  client id (`apps/server/src/sessions/session.ts:138-147`).
- its own `machines` and `workspaces` maps, its own `focusedId`, its own `setCurrentWorkspace`
  pointer.
- its own four-store set per workspace, its own `useUi`, its own toasts, its own notification
  watcher, its own webview registry, its own WebGL budget.
- its own `document.title`, which Electron already turns into the window title with no code change
  (App.tsx:59-62).

And per origin, shared by both: `localStorage`, `IndexedDB`, the `persist:ruimte` webview partition
(`browser/registry.ts:153`, `apps/desktop/src/main.ts:135`), and the daemon itself.

### 2.2 Per window, per origin, per project

| State | Where it should live | Why |
| --- | --- | --- |
| The open project, its views, its canvas, its selection | per workspace | already true: the four factory stores |
| Camera, active view, focused node | per project, per machine | already true: `<projectId>.local.json` on the daemon, see 3.2 |
| Panels, preview, file tabs, git scope, sidebar folds | per project, per machine | already true: `ProjectPanels` inside the same file |
| The palette, the settings dialog, the app page | per window | a person opens the palette in the window they are looking at |
| Toasts | per window | a toast reports on an action, and the action happened in one window |
| Sidebar open or closed | per window, seeded from the origin | see 2.4 |
| The active machine (`useEndpoints.activeId`) | per window | two windows on two machines is the point |
| The endpoint rows and their pinned daemon keys | per origin | a machine paired in one window is paired in all of them |
| The client key pair | per origin | already right: IndexedDB, one pair per client (`client-key.ts:63-67`) |
| Settings and theme | per origin | one person, one preference |
| The remembered project per machine | per origin | boot seed only, see 2.4 |
| The set of open windows and their bounds | per machine, owned by the shell | see 6.7 |

### 2.3 The three keys that need a rule

Everything in `localStorage` is read once and written blind. With one page that is correct. With two
it means: a change in window A is invisible in window B, and B's next write of that key throws A's
change away. Three keys actually matter.

**`ruimte.endpoints`.** The row list carries the pinned daemon public keys
(`state/endpoints.ts:37-42`), which is trust on first use and must never be lost. Window B pairs a
machine, `add()` persists a list with the new row (endpoints.ts:136-144). Window A still holds the
old list in memory, and its next `setActive` (line 155-161, which fires on every machine switch)
writes the old list back. The new row and its pinned key are gone.

**`ruimte.settings`** and **`ruimte.theme`.** Same mechanism, smaller damage: a preference changed in
one window reverts when the other writes.

**`ruimte.lastProject`.** `rememberProject` writes `last` on every project open
(`last-project.ts:55`). Two windows fight over `last` by design. That is acceptable once `last` is
demoted to what a window with no target boots into, and once the shell restores the window set from
its own file (6.7).

The fix is one small module, `apps/client/src/state/shared-storage.ts`:

```ts
/*
 * Every page of this origin writes these keys, and a page that missed a write would save its own
 * stale copy over it. The `storage` event fires in every page but the one that wrote, which is
 * exactly the shape this needs: the writer keeps what it has, the readers catch up.
 */
const readers = new Map<string, () => void>();

export const onSharedKey = (key: string, reread: () => void): void => {
    readers.set(key, reread);
};

export const startSharedStorage = (): (() => void) => {
    const onStorage = (event: StorageEvent): void => {
        if (event.key === null) {
            // The whole store was cleared; every reader starts over.
            for (const reread of readers.values()) {
                reread();
            }
            return;
        }
        readers.get(event.key)?.();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
};
```

`useEndpoints` gains a `reload()` that re-reads the blob and replaces `endpoints` while keeping this
page's own `activeId`; `useSettings` and `useTheme` gain the same. `startSharedStorage()` joins the
list in `main.tsx`.

While doing that, split the persisted endpoint blob so the row list is only written when rows change:
`ruimte.endpoints` for the rows (version 4) and `ruimte.endpoints.active` for the boot seed.
`setActive` then stops rewriting the rows, which removes the only frequent writer of the key that
holds the pinned keys. `parseStoredEndpoints` (endpoints.ts:85-98) already tolerates an older blob,
so the migration is the `activeId` field moving out.

### 2.4 The small ones

- `ruimte.sidebar` is one boolean for the origin. Leave it. It is a seed, a person who closes the
  sidebar in one window rarely minds the next window opening closed, and the `storage` reread is not
  worth a store change here. Write it down as a deliberate choice, not an oversight.
- `ruimte.projects.<endpointId>` is a cache of what the daemon answered. Both windows write the same
  answer, so the last writer wins with identical content. Leave it.
- `ruimte.usage` is the viewer's period and currency. Reread it with the shared keys if it is cheap;
  it is not worth a phase of its own.

### 2.5 BroadcastChannel as the bus between pages

Pages of one origin talk over `BroadcastChannel`, which Chromium brokers in the browser process, so
it reaches across renderer processes and therefore across Electron windows of the same session. The
first task of phase 3 is a five line spike that proves this in the packaged shell before anything is
built on it. If it turns out not to cross windows, the fallback is a `localStorage` key written as a
message, which the `storage` event definitely delivers, at the cost of an uglier protocol.

## 3. Two windows on one project

### 3.1 What breaks today, exactly

This is not a hypothetical. Follow the code.

**The daemon keeps one open state per project, with no idea who holds it.**
`ProjectStore.open` is a `Map<string, OpenProject>` (`apps/server/src/projects/project-store.ts:113`).
`openProject` calls `this.release(entry.projectId)` before installing the new state
(project-store.ts:257), and `release` closes the file watcher and drops the project's drawings
(370-381). There is no client id anywhere in that path.

**A save by one window is invisible to the other.** `saveUnlocked` writes the file and records the
exact bytes it wrote in `state.lastText` (project-store.ts:291). The directory watcher calls
`reload`, which returns early when `text === state.lastText` (511-513). So no `project.changed` event
is emitted for our own write. That is correct with one client and wrong with two.

**The other window then cannot save, ever, and says nothing.** Window B still holds `rev` N.
`ProjectClient.save` sends `project.save` with `baseRev: rev` (project-client.ts:439). The daemon is
at N+1 and throws `rev-conflict` (project-store.ts:284-286). The client catches it:

```ts
if (e instanceof TransportError && e.code === 'rev-conflict') {
    // The watcher's event carries the newer document; nothing to do until it arrives.
    return;
}
```

`project-client.ts:446-449`. The event never arrives. `setDirty(true)` was already called on line
445, so window B autosaves every 400 ms, gets `rev-conflict` every time, and stays dirty forever. Its
canvas edits exist only in memory and die with the window.

**`project.release` from one window pulls the rug from under the other.** Window B switching to
another project sends `project.release` for the shared one (project-client.ts:331-334 inside
`open`). The daemon releases it globally: the watcher stops and the drawing store closes the project
(project-store.ts:370-381). Window A now has an open project whose outside edits nobody is watching,
and whose drawings are closed on the daemon.

**`project.close` from one window puts it under Recent for the other.** `closeProject` sets
`closedAt` in the registry and publishes the summary to every client (project-store.ts:384-397). The
project is gone out of window A's canvas as far as the list is concerned, while window A is still
drawing it. Worse: `ProjectClient.closeProject` kills every session the project holds first
(project-client.ts:179), so window A's terminals and agents die.

**Browser nodes exist twice.** `browserRegistry` is per page (`browser/registry.ts:285`) and keyed on
`endpointKey(endpointId, nodeId)` (`registry.ts:134`, `nodes/BrowserBody.tsx:47`). Two windows would
each create a `<webview>` for the same node, both in the shared `persist:ruimte` session, both
navigating independently, and both writing the page's last URL back into the same node host
(`BrowserBody.tsx:57-62`).

**Terminal size is shared.** `Session.attach(clientId, cols, rows)` calls `this.resize(cols, rows)`
before serializing (`apps/server/src/sessions/session.ts:139`). Two windows showing the same terminal
at different sizes reflow the PTY against each other.

### 3.2 The machine-local file

`<$RUIMTE_HOME>/projects/<projectId>.local.json` (`project-store.ts:459-461`) holds
`{ activeViewId, views: Record<viewId, { camera, focusedNodeId }>, panels }`
(`packages/contracts/src/project.ts:364-379`). One file per project per machine, not per window.

The client assembles it from the whole page: `localOfScreen()` is
`documents.exportLocal()` plus `panels.export()` (`project-client.ts:417-420`), and `panelsPort.read()`
gathers `useUi`, `useFiles`, `useGit` and `useBrowser` (`project/panels-port.ts:21-38`), all module
singletons of the page. It is written on a 1000 ms debounce (`project-client.ts:121,389-397`) and
flushed on close and on every project switch (`project-client.ts:178,330`).

Two windows on one project would therefore write each other's camera, active view, panel widths and
open file tabs over the top, every second. Making that work means splitting the file per window,
which means inventing a window identity that outlives a window, which is exactly the kind of thing
that should not be invented for a case nobody asked for.

### 3.3 The rule

**A project is open in one workspace at a time. Asking for a project that a workspace already holds
raises that workspace instead of opening a second one.**

Three reasons, in order of weight:

1. The alternative loses work silently (3.1). A warning banner does not fix a save path that is
   permanently dirty and never recovers.
2. Making it work is a real feature, not a guard: a per-client hold on the daemon, a
   `project.changed` broadcast on every save including our own, per-window machine-local state, a
   rule for which window owns a browser node's page, and a rule for terminal size. Each of those is
   defensible on its own and none of them is asked for here.
3. "Two views of the same project" already has an answer inside one workspace: a second view
   (`ProjectView`), the standalone views, and the panel column. Someone who wants their terminal
   next to their canvas does not need a second window on the same project.

The rule is about a **workspace**, not about a window, on purpose. When the split arrives, a pane
holds a project the same way a window does and the rule is unchanged (section 7).

What the person sees: the row in the project switcher and the entry in the palette both say the
project is open in another window, and picking it raises that window. Not an error, not a toast, just
the window coming forward.

Three corollaries worth writing down:

- The same folder on two machines is two projects with two ids (`project-store.ts:79`, and
  `docs/research/multiple-daemons.md` section 0). The rule never fires across machines.
- Two windows on two projects of one machine is the normal case and needs nothing: they are two
  clients of one daemon, which the daemon already supports.
- A window whose boot target is held elsewhere lands on an empty canvas and says why. It does not
  fall through to the remembered project, which would open something the person did not ask for.

### 3.4 How the rule is enforced

`apps/client/src/state/presence.ts`, new:

```ts
/* Every page of this origin on one bus. A message is small and idempotent; nothing here is state. */
const CHANNEL = 'ruimte.pages';

/* What identifies a page for the life of the page. Not persisted: a reload is a new page. */
const pageId = crypto.randomUUID();

/* A project as the rule sees it: the machine that minted the id and the id. */
export const projectKey = (endpointId: string, projectId: string): string => `${endpointId}/${projectId}`;

type Message =
    | { kind: 'asks'; pageId: string; key: string }
    | { kind: 'holds'; pageId: string; key: string }
    | { kind: 'raise'; pageId: string };

/*
 * Which project every workspace in this page holds. A page, not a window: a split pane registers
 * here the same way, so the rule outlives the layout it was written for.
 */
const held = new Map<string, string>();

export const holdProject = (workspaceId: string, key: string): void => { ... };
export const releaseProject = (workspaceId: string): void => { ... };

/*
 * Who has this project. Answers a page id, or null when the bus stayed quiet. The wait is short on
 * purpose: a page that does not answer within it is a page that is wedged, and refusing to open a
 * project because of a wedged page would be worse than opening it.
 */
export const holderOf = (key: string, waitMs = 150): Promise<string | null> => { ... };

/* Brings a page's window to the front. Only the shell can actually raise an OS window. */
export const raise = (targetPageId: string): void => { ... };
```

On the receiving side, a page that hears `raise` for itself calls `desktop()?.focusWindow?.()` and,
in a browser tab, falls back to `window.focus()`, which browsers may ignore.

The call site is `openProject` (`apps/client/src/project/open.ts:54`), which grows a guard before
anything else it does:

```ts
export const openProject = async (endpointId: string, projectId: string): Promise<void> => {
    const key = projectKey(endpointId, projectId);
    const holder = await holderOf(key);
    if (holder !== null) {
        raise(holder);
        return;
    }
    ...
};
```

Two windows asking at the same instant both hear silence. The tiebreak rides the same exchange: a
page that is itself asking answers `asks` with its own page id, and the lower page id wins, the other
backs off and raises it. The window that loses the race is a window that was about to draw this
project and now draws nothing, which is the right outcome.

### 3.5 What the daemon would need instead

The BroadcastChannel rule covers every page of one browser profile, which is every Electron window
and every tab of the desktop machine. It does not cover a paired laptop opening the same project
over the network. That case is real but not what this design is about, and the honest fix is on the
daemon:

- `OpenProject` grows `holders: Set<string>` of client ids.
- `project.open` answers `{ summary, document, local, heldBy: string | null }` where `heldBy` is a
  label of the client that already holds it (the `SessionRecord.label` from pairing).
- `project.release` and the socket-close path remove one holder and only release when the set empties.
- The client refuses on a non-null `heldBy` and says which machine holds it.

That is phase 7, it changes the wire protocol (which phases 1 to 6 do not), and it blocks nothing.

## 4. Sessions when a window closes

### 4.1 What ends a session today

Two paths, and only two.

**`startSessionLifecycle()`** (`apps/client/src/terminal/lifecycle.ts:24`) is `watchNodes(end)`
(`terminal/lifecycle-watch.ts:37-82`). It ends a node's session when its id leaves the document, and
it deliberately does not fire while a document is loading or settling (lifecycle-watch.ts:44-52),
because a project swapping in is not a person deleting nodes. It reads `projectNodes()` and
`useDocument`, which are focused-workspace reads.

**`endProjectSessions(endpointId, views)`** (`terminal/lifecycle.ts:31-35`) walks every session node
of every view and ends it. It is wired into `ProjectClient` as the `endSessions` option
(`transport/connections.ts:145`) and called from exactly one place:

```ts
async closeProject(): Promise<void> {
    const current = this.sink.getState().current;
    await this.flush();
    this.flushLocal();
    this.endSessions(this.endpointId(), this.documents.getState().exportViews());
    ...
}
```

`project-client.ts:175-188`. That is commit `0300f54`, "closing a project stops what it has
running", and the warning a person reads first is `closeWarning` in
`apps/client/src/project/project-sessions.ts:38-44`.

### 4.2 The rule

**Closing a window puts a project down. Closing a project ends what it runs. They are different
actions and the code has to say so.**

A window that closes must not call `closeProject`, must not send `project.close`, and must not send
`project.release`. It flushes, it lets its sockets go, and that is all. Justification from the
daemon's own behavior:

- On socket close the daemon runs `manager.detachAll`, `chats.detachAll`, `folders.detachAll`,
  `statuses.detachAll` and unsubscribes the sinks (`apps/server/src/daemon.ts:343-355`). It releases
  no project and kills no session.
- A terminal keeps running under `@xterm/headless` in the daemon; `session.attach` answers with the
  serialized screen (`apps/server/src/sessions/session.ts:138-147`), so reopening the project in a
  new window reattaches with the screen intact.
- The project stays out of Recent, because `closedAt` is only set by `closeProject`
  (`project-store.ts:390`). Reopening the app finds it open, which is what a person who closed a
  window expects.

`project.release` is deliberately not sent either. It would stop the daemon's file watcher and drop
the drawings for a project that is about to be opened again, and it buys nothing: the next
`project.open` calls `release` itself (`project-store.ts:257`).

### 4.3 The close sequence

The autosave clocks are 400 ms for the document (`project-client.ts:120`) and 1000 ms for the local
file (line 121), so a window that vanishes without warning loses at most a second of camera movement
and under half a second of canvas edits. That is small but not nothing, and a close is a moment where
a flush is easy to get right.

New in `apps/client/src/transport/connections.ts`:

```ts
/*
 * A window putting a project down. Everything on screen reaches disk, the clients let go, and not a
 * single session is ended: the shell on the daemon outlives the page that was looking at it.
 * `closeProject` is the other action and stays where it is.
 */
export const detachWorkspace = async (id: string): Promise<void> => {
    const workspace = workspaces.get(id);
    if (!workspace) {
        return;
    }
    await workspace.connection.drawings.flush();
    await workspace.connection.projects.flush();
    workspace.connection.projects.flushLocal();
    releaseProject(id);
    workspace.dispose();
};
```

`flushLocal` is private today (`project-client.ts:399-407`) and becomes public, or `detachWorkspace`
gets a small `flushAll()` on `ProjectClient` that does both in order. Prefer the second: the order
matters (the document before the local file, the drawing before the document) and the class is where
that order belongs.

The shell asks for it before it lets a window go:

- `main.ts` adds `window.on('close', ...)`: on the first call it prevents the default, sends
  `window:will-close`, and closes for real when the renderer answers `window:closed` or when a 1500 ms
  timer runs out, whichever comes first.
- The renderer listens through `desktop()?.onWillClose?.(...)`, runs `detachWorkspace` for every
  workspace in the page, and answers.
- `before-quit` sets a flag so the same handler does not block a quit forever, and so the daemon is
  killed only after every window has answered or timed out.

In a browser tab there is no such handshake. `beforeunload` is synchronous and a WebSocket send from
it is not reliable. The tab relies on the autosave clocks, which is why they stay short. A
`visibilitychange` to `hidden` is a good moment to force a flush and costs nothing; add it in the
same phase.

### 4.4 What a window takes with it

A `<webview>` lives in the page that made it (`browser/registry.ts:127-132`), so a browser node's
page is destroyed when its window closes and rebuilt from the node's saved URL when the project
opens again (`nodes/BrowserBody.tsx:57-62` keeps that URL current). Cookies and logins survive: they
are in the shared `persist:ruimte` session, not in the element.

An xterm instance and its WebGL context are the page's too (`terminal/registry.ts:10-11`,
`terminal/webgl-budget.ts`). The daemon holds the real screen, so nothing is lost, and the budget is
per renderer process, which means two windows each get their own ten contexts. That doubles the GPU
cost of a person with two busy windows. It is correct behavior and worth a line in `docs/DECISIONS.md`.

## 5. How you open a window

### 5.1 What is in the first version

**In.**

- A row in the project switcher opens in a new window on `Cmd`-click (`Ctrl` elsewhere), the web
  convention. The call site is `apps/client/src/shell/ProjectMenu.tsx:45`,
  `onClick={() => void openProject(row.endpointId, summary.projectId)...}`, and `row`
  (`project/list.ts:84-91`) already carries the endpoint id.
- An explicit command in the palette: "Open <name> in a new window", a second entry next to the
  existing project entry built at `apps/client/src/shell/CommandPalette.tsx:493-507` (the `run` is
  line 505). An explicit entry and not only a modifier, because a modifier nobody can see is not
  discoverable.
- A row in the project actions menu for the project that is open: "Move to a new window", next to
  "Open in {fileManagerName}" at `apps/client/src/shell/ProjectActionsMenu.tsx:79-82`. It opens a
  window on this project and detaches this one, which is what a person who wants their agent on a
  second screen actually means.

**Out of the first version.**

- A keyboard chord. `Cmd+N` is unbound today but every chord in the app has to fit the table in
  `apps/client/src/canvas/Canvas.tsx:232-322`, and "new window of which project" has no obvious
  answer before the switcher gesture exists. Add it once the gesture has a shape.
- Dragging a project out of the window. Electron has no tear-off primitive; it would mean a drag
  ghost, tracking the pointer past the window bounds, and a drop target that is the desktop. It is a
  good gesture and it is a feature of its own.

### 5.2 The URL is the argument

A window is told what to open through its URL:

```
http://127.0.0.1:4210/?machine=<endpointId>&project=<projectId>
```

Not through IPC, for three reasons: a reload (`Cmd+R`, and the smoke script does one) keeps the
window on its project; a browser tab uses the same mechanism with no bridge; and the shell's window
session file (6.7) stores exactly what it needs to replay.

The daemon already serves `index.html` for anything that is not a file
(`apps/server/src/daemon.ts:367-374`), and Vite does the same in dev, so a path would work too. A
query string is used anyway, because the client has no router and adding one for this would be more
machinery than the feature needs.

The endpoint id in the URL is the client's own id for the row, which for the daemon that served the
page is the literal `local` (`state/endpoints.ts:8`). That is safe here: both windows are the same
origin and read the same endpoint list, so `local` means the same machine in both.

New `apps/client/src/state/window-target.ts`:

```ts
/* What this page was asked to open, from its own URL. Null for a window that opens on what was left. */
export interface WindowTarget {
    endpointId: string;
    projectId: string;
}

export const readWindowTarget = (search = location.search): WindowTarget | null => {
    const query = new URLSearchParams(search);
    const endpointId = query.get('machine');
    const projectId = query.get('project');
    return endpointId && projectId ? { endpointId, projectId } : null;
};
```

Two boot changes use it:

- `restoreLastEndpoint` (`project/open.ts:121-130`) reads the target first and calls
  `setActive(target.endpointId)` with it, falling back to `readLastProject(...).last` as today.
  Rename it `restoreBootEndpoint` and let its doc comment say both cases.
- `ProjectClient.runBoot` (`project-client.ts:307-323`) opens the target instead of
  `readLastProject(...).byEndpoint[this.endpointId()]` when there is one, and opens nothing when the
  target is held by another window. Today's line 310 becomes a small helper `bootProjectId()` that
  answers the target's id for the endpoint it names, and the remembered id otherwise.

### 5.3 A browser tab

In a browser, "open in a new window" is `window.open(url, '_blank')` with the same query string.
Everything in sections 2, 3 and 4 holds: same origin, same `localStorage`, same BroadcastChannel,
same sockets, same rule. What a tab does not get:

- No position or size memory. The browser owns that.
- No raise. A page that hears `raise` calls `window.focus()`, which Chrome honors for a window it
  opened itself and ignores otherwise. When it is ignored, the asking page says "already open in
  another tab" and does nothing else, which is a worse experience than the desktop one and still
  better than two tabs silently corrupting one canvas.
- No native dialogs, no guest devtools, no updater. That is already true of a tab today.

So: windows are a desktop feature and tabs get the same thing with fewer manners. Do not build a
second mechanism for the browser.

## 6. The Electron side

### 6.1 From one window to a set

`apps/desktop/src/main.ts`, replacing `let mainWindow` at line 27:

```ts
/* Every window this shell has open, and what each one was asked to show. One process, one daemon. */
interface WindowState {
    window: Electron.BrowserWindow;
    target: WindowTarget | null;
}

const windows = new Map<number, WindowState>();

/* The window a message came from. Every dialog, every menu and every push resolves it this way. */
const senderWindow = (event: { sender: Electron.WebContents }): Electron.BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender);

/* The window that was last in front, for the things that have no sender: `second-instance`, a
   notification, an update that has nothing to do with any one project. */
let lastFocusedId: number | null = null;
```

`createWindow()` (186-215) takes the target and the theme:

```ts
const createWindow = (target: WindowTarget | null, bounds?: Electron.Rectangle): Electron.BrowserWindow => { ... }
```

and stops hardcoding the dark theme at lines 193-194. The shell keeps the last `AppTheme` a renderer
reported and builds every new window with it, so a window opened while the app is in light mode does
not flash `#131316`.

The URL a window loads:

```ts
const urlFor = (target: WindowTarget | null): string => {
    const base = devUrl ?? `http://127.0.0.1:${port}/`;
    if (!target) {
        return base;
    }
    const url = new URL(base);
    url.searchParams.set('machine', target.endpointId);
    url.searchParams.set('project', target.projectId);
    return url.toString();
};
```

### 6.2 Every handler takes its sender

The eleven rows of the table in 1.2, one by one:

- `applyTheme` (155-167): `nativeTheme.themeSource` stays global (it is a process-wide setting and
  every window agrees, because the theme is one `localStorage` key). The overlay color and the
  background color loop over `windows`. The reported theme is also stored, for 6.1.
- `guestDevTools` (218-254): drop the `!mainWindow` guard at 220. The devtools window is its own
  `BrowserWindow` and needs no parent.
- `editableGuestMenu` (282-322): `popup({ window: ownerOf(contents) ?? undefined, ... })`, see 6.3.
- `guestContextMenu` (331-354): send to `ownerOf(contents)?.webContents`, not to `mainWindow`.
- `dialog:pick-folder` (392-401) and `dialog:save-file` (404-418): `senderWindow(event)`. Both become
  window-modal sheets on the window that asked, which is a visible improvement on macOS even with one
  window.
- `window:is-fullscreen` (428): `senderWindow(event)?.isFullScreen() ?? false`.
- `setUpdateState` (472-475): loop over `windows`, see 6.5.
- `second-instance` (610-617): restore and focus `lastFocusedId`, or the first window in the map.
- `activate` (640-645): when `windows.size === 0`, restore the window session (6.7), or open one
  untargeted window.
- `window-all-closed` (647-651): unchanged. On macOS the app stays up with the daemon next to it,
  which is what the background-service work will eventually formalize anyway.

New IPC, mirrored into `apps/desktop/src/preload.ts` and `apps/client/src/desktop/bridge.ts`, every
method optional on the client side the way the existing ones are (bridge.ts:49-51):

```ts
/* Opens a window on a project, or raises the one that already has it. The shell answers the id of
   the window that ended up showing it, so the caller knows whether it opened anything. */
openWindow?(target: { endpointId: string; projectId: string }): Promise<number>;
/* Brings this window to the front. A renderer cannot raise its own OS window. */
focusWindow?(): void;
/* The window is closing: flush, then answer. The shell waits 1500 ms and then closes anyway. */
onWillClose?(listener: () => Promise<void> | void): () => void;
```

Note that `openWindow` in the shell is only a window factory. The ownership rule stays in the
client (3.4), because it is about workspaces and the shell does not know what a workspace is.

### 6.3 A guest and its window

A `<webview>` guest is not a child of a `BrowserWindow` in Electron's API, and
`BrowserWindow.fromWebContents` answers null for one. `webContents.hostWebContents` exists
(`apps/desktop/node_modules/electron/electron.d.ts:18794`) and would work, but it is documented as
"a WebContents instance that **might** own this WebContents", which is not a promise worth building a
context menu on.

The reliable route is the host telling the shell at attach time. `did-attach-webview` is on
`WebContents` (electron.d.ts:16589):

```ts
/*
 * Which window a browser node's page belongs to. Electron gives a guest no parent window of its own,
 * so the host says so the moment it attaches one, and the map is what a context menu is routed by.
 */
const guestOwners = new Map<number, number>();

window.webContents.on('did-attach-webview', (_event, guest) => {
    guestOwners.set(guest.id, window.id);
    guest.once('destroyed', () => guestOwners.delete(guest.id));
});

const ownerOf = (contents: Electron.WebContents): Electron.BrowserWindow | null => {
    const id = guestOwners.get(contents.id);
    return id === undefined ? null : (windows.get(id)?.window ?? null);
};
```

The client half of the same seam already exists: `browserRegistry.keyOfContents(webContentsId)`
(`browser/registry.ts:170-181`) answers null for a guest of another page, and
`BrowserContextMenu` bails out on a null key (`browser/BrowserContextMenu.tsx:39-43`). So even
without the owner map the menu fails closed rather than opening in the wrong window. With the map it
opens in the right one.

`browser:context-action` (362-390) needs no change: it looks the guest up by id and checks
`isBrowserGuest` (364), and the guest id is unique across the process.

### 6.4 Title, theme, background

**Title.** The client already writes `document.title` from the project name
(`App.tsx:59-62`) and Electron uses a page's title as the window title when the window has none of
its own. Nothing to build. Worth a sentence in the design because it is the kind of thing that gets
built twice.

**Theme.** One `localStorage` key means every window resolves the same theme, and every window
reports it on boot through `setTheme` (`main.tsx:37-45`). `applyTheme` applies the process-wide
`nativeTheme.themeSource` once and the per-window bits to all of them (6.2). With the
shared-storage reread of 2.3, a theme change in one window reaches the other immediately; without it,
on next load. Either way the shell is told by whichever window changed, so the native chrome never
lags.

**Background.** `createWindow` takes the current background instead of `#131316`, and
`titleBarOptions(dark)` takes the current resolved theme instead of `true` (main.ts:193-194). Without
this a window opened in light mode paints dark for a frame.

### 6.5 Updates

`updateState` and the `AppUpdater` are process state (main.ts:465-467), which is right: one app, one
update. Two things change:

- `setUpdateState` (472-475) pushes to every window, not to `mainWindow`.
- `update:configure` (516-524) is sent by every window on mount (`App.tsx:65`,
  `state/updates.ts:68-83`) with that window's copy of the setting. They agree, since the setting is
  one `localStorage` key, and the last writer setting the same value is harmless. The hourly timer is
  already created with `??=` (line 523), so several calls do not stack it.
- `update:install` quits the app, which closes every window. That is correct and does not change.

### 6.6 Quit

`before-quit` kills the daemon (653-656). The close handshake of 4.3 has to not deadlock a quit:

```ts
let quitting = false;
app.on('before-quit', () => {
    quitting = true;
    daemon?.kill('SIGTERM');
});
```

and the per-window `close` handler skips its flush handshake when `quitting` is already true, because
the daemon is going down with the app and the flush would race it. The alternative (flushing every
window before killing the daemon) is better and is not free: `before-quit` would have to prevent the
default, wait for every renderer, and re-issue the quit. Recommendation: do the simple version in
phase 4 and note the gap. What a quit loses is at most one autosave interval of camera position; the
canvas itself is written every 400 ms.

### 6.7 Positions and the window session

The shell remembers its windows in `join(app.getPath('userData'), 'windows.json')`. Not in
`$RUIMTE_HOME`, because this is about this machine's app and not about any daemon or project.

```ts
interface WindowRecord {
    /* What the window showed, so a restored window lands where it was. Null for an untargeted one. */
    target: WindowTarget | null;
    bounds: Electron.Rectangle;
    maximized: boolean;
    fullscreen: boolean;
}
```

Written debounced on `move`, `resize` and `close`, read once at boot. At boot: restore every record,
clamping each rectangle onto a display that still exists with `screen.getDisplayMatching(bounds)`
(the same call `captureTitleBar` already makes at main.ts:548). An empty or unreadable file gives one
untargeted window, which is exactly today's behavior.

This file, and not `ruimte.lastProject`, is what decides what a cold boot of the desktop app shows.
`ruimte.lastProject` stays what it is: the seed for a window that was opened with no target, and the
per-machine memory `ProjectClient.runBoot` reads (project-client.ts:310).

## 7. The split stays possible

The split layout is not built here. What is built here must not make it harder. Concretely:

**What stays exactly as it is.** `openWorkspace(id, endpoint)` and `focusWorkspace(id)`
(`connections.ts:224,229`), the `workspaces` map, `setCurrentWorkspace`, the `WorkspaceProvider`
(`transport/context.tsx:13`) and the four store factories. A window does not replace them; it calls
them.

**What changes in `App.tsx`.** The `Workspace` component (App.tsx:27-54) becomes a
`WorkspaceHost({ workspaceId })` that resolves its own workspace, and the page decides which ids to
render. In this design the page renders exactly one:

```tsx
export function App() {
    const ids = useWindowWorkspaces();
    return (
        <TooltipProvider>
            {ids.map((id) => (
                <WorkspaceHost key={id} workspaceId={id} />
            ))}
            <CommandPalette />
            <SettingsDialog />
            <Toasts />
        </TooltipProvider>
    );
}
```

`useWindowWorkspaces()` answers one id today. A split is that hook answering two and a layout
component around the map. Nothing else in the tree learns about it.

**Four things deliberately not done, because each would rule the split out.**

1. The ownership rule is keyed on a **workspace id**, not on a page or a window
   (`holdProject(workspaceId, key)` in 3.4). A rule keyed on a window would have to be rewritten the
   day a window holds two projects.
2. The URL query is a **boot seed**, not the source of truth for what is open. A window that opens a
   second workspace later does not have to rewrite its own URL, and a split window does not need a
   query string that can express two projects.
3. `detachWorkspace(id)` (4.3) takes a workspace id. There is no `closeWindow()` in the client that
   assumes the window and the project are the same thing.
4. No module-level "the window's project" global is added. `currentEndpointId()`
   (`state/keys.ts:48`) keeps meaning "the machine of the focused workspace", and every new call site
   reads the workspace, never the window.

**What the split will still have to solve, unchanged by this work.** The app chords bound on `window`
in `apps/client/src/canvas/Canvas.tsx:330` reach whichever workspace `setCurrentWorkspace` last
named. With one workspace per page that is always right. With two panes it is a real question, and it
is already noted as open in `docs/research/multiple-daemons.md` section 4.6 point 3. Windows do not
make it worse: each page has its own listener and its own focused workspace.

## 8. What can break

Everything below is a thing that quietly assumes one page. The rule of thumb: state that belongs to
an action stays in the window that took it, state that belongs to the person is shared.

**OS notifications.** `startAgentNotifications` (`shell/notifications.ts:24-93`) is per page, reads
`projectNodes()` of the focused workspace (line 52), and only fires when `!document.hasFocus()` (line
39). Two windows on two projects each watch their own nodes, so no duplicates. Two effects to fix:

- `document.hasFocus()` is per page, so window A fires notifications for its own project while the
  person works in window B. That is correct and is the whole point.
- `notification.onclick` calls `window.focus()` (line 44). In Electron that does not reliably raise
  the OS window. Change it to `desktop()?.focusWindow?.() ?? window.focus()` and then `revealNode`.
- The notification `tag` is `ruimte-${nodeId}` (line 81) and tags are per origin, so if two windows
  ever showed one node the OS would collapse the two into one. The ownership rule means they never do.

**The dock.** `apps/client/src/shell/Dock.tsx:47-258` is mounted inside the workspace
(`App.tsx:41`) and reads `useCanvas` and `useDocument` as workspace hooks. It positions itself
`absolute inset-x-0 bottom-4` inside the workspace column, not `fixed`
(`apps/client/src/ui/DockShell.tsx:51`). It is already per workspace. Nothing to do.

**Browser nodes.** Covered in 3.1 and 4.4. The `persist:ruimte` session is shared, which is what a
person wants (one login, every window). The elements are per page, which is what Chromium requires.
The ownership rule keeps two pages from ever making two elements for one node. The one thing to fix
is the context menu routing of 6.3.

**The usage page.** `useSummary` (`shell/usage/UsagePage.tsx:51-101`) subscribes per socket and the
daemon refcounts followers per client id (`apps/server/src/usage/usage-service.ts:36,60-73`), so two
windows on the usage page are two followers and one scan. `usage.changed` is broadcast to every sink
regardless of follow state (usage-service.ts:139-143), so both windows refetch, which is what they
should do. `useUsageStore` is per page and keyed `byEndpoint` (`state/usage.ts:90,102`), so the two
do not collide. The only shared thing is the viewer's period and currency in `ruimte.usage`
(state/usage.ts:16), which reads like a setting and should be rereadable (2.4). **The usage page is
already correct across windows.** It is also a surface that belongs to no project and would be a good
candidate for a window of its own later, which is out of scope here.

**Settings.** `useSettings` is per page, `ruimte.settings` is per origin, read once at construction
(`state/settings.ts:80-96,121`) and written on every change (line 162). Two windows diverge until the
shared reread of 2.3. The dialog itself is per window, which is right. `apply()` (settings.ts:99-118)
writes DOM tokens on the page's own root, so the reread makes the second window follow with no extra
work.

**Toasts.** Per page (`state/toasts.ts:43`), mounted at the app root (`App.tsx:72`). A git push
started in window A reports in window A, which is right. The five machine-level toasts are the
exception and they all report on something the page itself just did: a handshake that was refused
(`endpoint/handshake.ts:83,92`), a daemon that answered as another machine
(`endpoint/identity.ts:67`), two rows merged (`identity.ts:84`), a pairing with a machine already
listed (`endpoint/index.ts:74`). Both windows run their own handshakes, so both will see the first
two, each about its own socket. That is acceptable: the message is true in both windows. Do not build
a cross-window toast bus.

**App chords.** One `keydown` listener on `window` per page, inside `Canvas`
(`canvas/Canvas.tsx:330`, mounted from `shell/ViewHost.tsx:128` and kept mounted under every page and
every standalone view, per the comment at ViewHost.tsx:122-123). The chord table is at Canvas.tsx
232-322. Per page, the OS delivers the key to the focused window only, so two windows are two
independent chord tables and `Cmd+K` opens the palette of the window in front. That is correct with
no change. The open question from `multiple-daemons.md` 4.6 point 3 is about panes, not windows, and
stays open.

**`startContextSync`.** `context/sync.ts:42-112` keeps `sent` per page (line 46) and pushes
`context.set` for the nodes of the focused workspace to `transportFor(currentEndpointId())`
(50-51). Two windows on two projects of one machine both write context for their own node ids. The
clearing loop (67-71) only clears targets that page knows about, so they do not erase each other's.
Verify this in phase 3 with two projects on one daemon, each with a context edge, and read
`GET /context` for both.

**The project list cache.** `writeCachedList` (`project/list.ts:31-39`) writes
`ruimte.projects.<endpointId>` from whatever the daemon just answered. Both windows write the same
content. Leave it.

**`restoreLastEndpoint` at boot.** `main.tsx:29` runs it in every page before anything opens a
socket (`project/open.ts:121-130`). A second window would otherwise boot onto the machine the first
window last recorded, whatever it was asked to open. That is the change in 5.2.

**Updates.** Covered in 6.5. Today a second window's `useUpdates` store would stay at
`{ status: 'unsupported' }` after its first `update:state` reply, because `setUpdateState` only
pushes to `mainWindow`.

**The WebGL budget.** `DEFAULT_WEBGL_CONTEXTS` is per page and each window is its own renderer
process, so two windows get ten contexts each. Correct, and twice the GPU cost. A line in
`docs/DECISIONS.md` under the existing note about the fixed budget.

**The smoke test.** `runSmoke` (main.ts:554-594) drives `mainWindow` through `window.ruimte` test
hooks. It keeps working if it is handed the first window of the set. Update the one reference.

## 9. Phases

Sizes: S is an hour or two, M half a day to a day, L one to two days. Every phase ends with
`bun run format`, `bun run check` and `bun test` green, and a conventional commit.

### Phase 1: the shell handles a set of windows (M)

No client change, no visible feature. Everything in section 6.1, 6.2, 6.3, 6.4 and 6.5 except the new
IPC surface. Verify by adding a temporary second `createWindow(null)` at boot, checking that both
windows get dialogs, context menus over a browser node, theme changes and update state, then removing
it.

- `apps/desktop/src/main.ts`: `windows` map and `senderWindow` (replacing line 27), `createWindow`
  (186-215), `applyTheme` (155-167), `guestDevTools` (218-254 at line 220), `editableGuestMenu`
  (321), `guestContextMenu` (336), `dialog:pick-folder` (392-401), `dialog:save-file` (404-418),
  `window:is-fullscreen` (428), `setUpdateState` (472-475), `second-instance` (610-617), `activate`
  (640-645), `runSmoke` (554-594, one reference), boot (619-638).
- `guestOwners` and `ownerOf`, with the `did-attach-webview` listener inside `createWindow`.

### Phase 2: a window can be told what to open (M)

- New `apps/client/src/state/window-target.ts` (5.2) with `window-target.test.ts`.
- `apps/desktop/src/main.ts`: `urlFor(target)`, `window:open`, `window:focus`.
- `apps/desktop/src/preload.ts`: `openWindow`, `focusWindow`.
- `apps/client/src/desktop/bridge.ts:43-74`: the same three, optional.
- `apps/client/src/project/open.ts:121-130`: `restoreLastEndpoint` reads the target first.
- `apps/client/src/project/project-client.ts:307-323`: `runBoot` opens the target.
- `apps/client/src/shell/ProjectMenu.tsx:45`: modifier click.
- `apps/client/src/shell/CommandPalette.tsx:493-507`: the second entry.
- `apps/client/src/shell/ProjectActionsMenu.tsx:79-82`: "Move to a new window".

At the end of this phase two windows can be open on two projects, and one project in two windows is
possible and broken. Phase 3 is not optional.

### Phase 3: one project, one workspace (M)

- The BroadcastChannel spike first: prove a message crosses two packaged Electron windows.
- New `apps/client/src/state/presence.ts` with `presence.test.ts` (the tiebreak and the timeout are
  the parts worth a test; the channel itself gets a fake).
- `apps/client/src/project/open.ts:54`: the guard.
- `apps/client/src/transport/connections.ts`: `holdProject` on `workspaceOn` (173-197),
  `releaseProject` in `Workspace.dispose` (184-191).
- `apps/client/src/shell/ProjectMenu.tsx` and `CommandPalette.tsx`: the row says a project is open in
  another window.
- `apps/client/src/shell/notifications.ts:44`: `focusWindow` before `revealNode`.

### Phase 4: closing a window leaves the work alone (S)

- `apps/client/src/transport/connections.ts`: `detachWorkspace` (4.3).
- `apps/client/src/project/project-client.ts`: a public `flushAll()`, the ordered flush.
- `apps/desktop/src/main.ts`: the `close` handler, `window:will-close`, the `quitting` flag
  (653-656).
- `apps/desktop/src/preload.ts` and `apps/client/src/desktop/bridge.ts`: `onWillClose`.
- `apps/client/src/main.tsx`: wire `onWillClose`, plus a `visibilitychange` flush for the browser.
- A test that a window close does not call `endProjectSessions`: the cheap version is a unit test on
  `detachWorkspace` with a fake `ProjectClient` asserting `closeProject` is never called.

### Phase 5: shared state stays shared (S)

- New `apps/client/src/state/shared-storage.ts` with a test.
- `apps/client/src/state/endpoints.ts`: `reload()`, the split of `activeId` out of the blob
  (`STORAGE_VERSION` 4, lines 5-7, `persist` 100-113, `read` 115-130, `parseStoredEndpoints` 85-98).
- `apps/client/src/state/settings.ts:80-96,120-165` and `apps/client/src/state/theme.ts:22,34`:
  `reload()`.
- `apps/client/src/main.tsx`: `startSharedStorage()`.

### Phase 6: windows remember where they were (S)

- `apps/desktop/src/main.ts`: `windows.json` in `app.getPath('userData')`, debounced writes on
  `move`, `resize` and `close`, restore at boot with a display clamp, `activate` restoring the
  session.

### Phase 7 (optional): the daemon holds a project (M)

Only needed to cover a second machine opening the same project. Section 3.5 has the shape. It changes
the wire protocol, which nothing before it does.

- `packages/contracts/src/project.ts`: `heldBy` on the `project.open` result.
- `apps/server/src/projects/project-store.ts`: `holders` on `OpenProject` (89-99), `openProject`
  (257), `release` (370-381), and a release on socket close in `apps/server/src/daemon.ts:343-355`.
- `apps/client/src/project/project-client.ts`: refuse on `heldBy`.

## 10. Out of scope

- **The split layout.** Section 7 says what stays possible and what is deliberately not done. The
  panes, the divider, what the sidebar and the breadcrumb become, and which pane a chord goes to are
  a design of their own, still open from `docs/research/multiple-daemons.md` section 4.6.
- **Dragging a project out of a window to make one.** A good gesture, a feature of its own (5.1).
- **A window that is not a project.** A usage window, a settings window, a standalone terminal window.
  The plumbing here would carry them (`?page=usage` is one line), but each needs its own chrome
  decision and none is asked for.
- **Moving a project from one window to another without closing it.** "Move to a new window" in 5.1
  is an open plus a detach, which is not the same thing: the sessions survive, the camera survives
  through the local file, and nothing else does.
- **Tabs inside a window.** A window shows one project. If several projects in one window are ever
  wanted, that is the split, not tabs.
- **Two windows on one project.** Section 3 is the argument. Phase 7 is the honest version of "make
  it work" and it is still only about refusing across machines.
- **The daemon as a background service.** `before-quit` still kills the daemon
  (`apps/desktop/src/main.ts:653-656`). Windows do not change that, and the service is already on the
  list in `docs/DECISIONS.md` under Next.
- **A second daemon per window.** A window is a page on one origin, and the origin's daemon is the
  one that served it. Which machine a window works on is the endpoint it opened a project from,
  exactly as today.
- **Cross-window drag and drop of a node.** Same answer as cross-machine drag and drop in
  `multiple-daemons.md` section 6: interesting, not designed.

## 11. File index for the implementation agent

New:

- `apps/client/src/state/window-target.ts`, `window-target.test.ts` (phase 2)
- `apps/client/src/state/presence.ts`, `presence.test.ts` (phase 3)
- `apps/client/src/state/shared-storage.ts`, `shared-storage.test.ts` (phase 5)

Changed, per phase:

- **1**: `apps/desktop/src/main.ts` (27, 155-167, 186-215, 218-254, 282-322, 331-354, 392-401,
  404-418, 428, 465-475, 554-594, 610-617, 619-638, 640-645)
- **2**: `apps/desktop/src/main.ts` (new `urlFor`, `window:open`, `window:focus`);
  `apps/desktop/src/preload.ts` (5-34); `apps/client/src/desktop/bridge.ts` (43-74);
  `apps/client/src/project/open.ts` (54-80, 121-130);
  `apps/client/src/project/project-client.ts` (307-323);
  `apps/client/src/shell/ProjectMenu.tsx` (29-58, 45);
  `apps/client/src/shell/CommandPalette.tsx` (493-507);
  `apps/client/src/shell/ProjectActionsMenu.tsx` (78-96)
- **3**: `apps/client/src/project/open.ts` (54); `apps/client/src/transport/connections.ts`
  (173-197, 184-191); `apps/client/src/shell/ProjectMenu.tsx`;
  `apps/client/src/shell/CommandPalette.tsx`; `apps/client/src/shell/notifications.ts` (41-49)
- **4**: `apps/client/src/transport/connections.ts`; `apps/client/src/project/project-client.ts`
  (175-188, 389-407, 417-420); `apps/desktop/src/main.ts` (186-215, 653-656);
  `apps/desktop/src/preload.ts`; `apps/client/src/desktop/bridge.ts`;
  `apps/client/src/main.tsx` (23-34)
- **5**: `apps/client/src/state/endpoints.ts` (5-7, 85-130, 155-161);
  `apps/client/src/state/settings.ts` (80-96, 120-165); `apps/client/src/state/theme.ts` (22, 34);
  `apps/client/src/main.tsx`
- **6**: `apps/desktop/src/main.ts` (619-638, 640-645, and the new window session file)
- **7**: `packages/contracts/src/project.ts`; `apps/server/src/projects/project-store.ts` (89-99,
  257, 370-381); `apps/server/src/daemon.ts` (343-355);
  `apps/client/src/project/project-client.ts`

Docs to update at the end: `docs/DECISIONS.md` (the decisions section: a window is a page, one project
one workspace, closing a window is not closing a project, the WebGL budget per window),
`README.md` and `apps/desktop`'s part of the root `CLAUDE.md` ("One window" is no longer true).

## 12. Open questions for Bas

1. **"Move to a new window" on the open project (5.1): open and detach, or open and leave this
   window on the project until the new one is up?** The proposal is open, wait for the new window to
   claim the project, then detach, so there is no moment where nobody holds it.
2. **What does a window with no project show?** Today an untargeted window boots into the remembered
   project of the active machine (`project-client.ts:307-323`). With windows that means "open a
   second window" gives you a second copy of what you already have, which the rule then refuses. The
   proposal: a window opened with no target and no free remembered project lands on `NoProject`
   (`shell/ViewHost.tsx:131`) with the project switcher open.
3. **Does a window's project belong in `windows.json` only, or also in `ruimte.lastProject`?** The
   proposal keeps both: `windows.json` decides what the desktop app reopens, `ruimte.lastProject`
   stays the per-machine memory a browser tab and an untargeted window read.
4. **Is the usage page a window of its own later?** It is the one surface that belongs to no project
   and it already works across windows (section 8). Not in scope here, cheap afterwards.
5. **A chord for a new window.** `Cmd+N` is free. Worth binding once the switcher gesture exists, or
   leave the app chord table alone?
