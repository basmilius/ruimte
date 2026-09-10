# Drawing view: research and design

State of the working tree on 2026-09-10 (uncommitted refactor on top of `d24a75c`). Every path is
relative to `/Users/bas/Development/Projects/ruimte`. Line numbers are from the working tree, not
HEAD. Nothing here is implemented; this is the document an implementation agent executes.

Resolved versions in `node_modules`: react 19.2.8, zod 4.5.4, lucide-react 1.44.0, zustand 5.0.15,
@base-ui-components/react 1.0.0-rc.0, typescript ~6.0.2, vite ^8.2.2. No drawing library of any
kind is installed (`bun.lock` has no excalidraw, roughjs or perfect-freehand).

## 0. Summary of the recommendation

- A fifth view kind, `drawing`, next to `canvas`, `chat`, `terminal` and `browser`. In
  `project.json` it is only `{ kind: 'drawing', id, name }`; the elements live in
  `<folder>/.ruimte/drawings/<viewId>.json` (a project without a folder keeps them under
  `$RUIMTE_HOME/projects/<projectId>/drawings/`).
- The drawing file is its own versioned document (`version: 1`, `rev`, `elements`) with the same
  rev discipline as `project.json`: `drawing.open`, `drawing.save { baseRev }`, `drawing.changed`
  from a directory watcher, `rev-conflict` when the file moved on. A `DrawingStore` on the daemon
  mirrors `ProjectStore` and removes the file of a drawing view the moment a `project.save` no
  longer lists it.
- The client gets a `useDrawing` zustand store (elements, selection, tool, camera, history) shaped
  after `useCanvas`, a `DrawingClient` shaped after `ProjectClient` (400 ms autosave, flush on
  switch, conflict banner), and a `drawing/` component folder with a `<canvas>` 2D renderer.
- Render it yourself on `<canvas>` 2D with `perfect-freehand` for strokes and `roughjs` (seeded)
  for the optional hand-drawn look. Do not embed `@excalidraw/excalidraw`: it is MIT and supports
  React 19, but it brings 31 dependencies, its own icons, fonts, theme variables, toolbar and
  keyboard handling, none of which can be made to follow the token, Lucide and whole-pixel rules.
- The camera of a drawing goes into the machine-local file under the slot every view already has
  (`ProjectLocal.views[viewId].camera`), through `useDocument.exportLocal()`.

## 1. How views are modeled today

### 1.1 Contracts (`packages/contracts/src/project.ts`)

- `ViewBaseSchema` (L158-165): `id`, `name`, optional `titleSource`.
- `StandaloneNodeSchema` (L171-181): what a chat or terminal view carries (`cwd`, `command`,
  `resume`, `provider`, `providerFixed`, `runtimeMode`, `accent`).
- `ProjectCanvasViewSchema` (L182-191): `kind: 'canvas'` plus `nodes`, `texts`, `edges`, `layouts`.
- `ProjectViewSchema` (L192-198): `z.discriminatedUnion('kind', [...])` with exactly four members:
  canvas, `chat` and `terminal` (each `node: StandaloneNodeSchema`), `browser` (`url`).
  `ProjectViewKind` (L199) is derived from it, so every `Record<ProjectViewKind, ...>` in the client
  fails to typecheck the moment a fifth kind is added, which is the safety net the implementation
  should lean on. `isCanvasView` is L201.
- `ProjectContentSchema` (L205-212): `name`, `color`, optional `icon`, `views` (min 1).
  `ProjectDocumentSchema` (L214-220) adds `version: z.literal(2)` and `rev` (int, nonnegative).
  `ProjectDocumentV1Schema` (L222-233) is read only.
- `ProjectSavePayloadSchema` (L358-364): `projectId`, `baseRev`, `content`; result `{ rev }`
  (L366-370). `ProjectSaveLocalPayloadSchema` (L371-376). `ProjectChangedEventSchema` (L388-393):
  `{ projectId, document }`.
- `packages/contracts/src/project-migrate.ts`: `migrateDocument` (L20-38) parses v2 first, then v1
  and wraps it in one canvas view with the fixed id `main`; `migrateLocal` (L41-56); `EMPTY_LOCAL`
  (L58); `duplicateIdIn` (L65-83) refuses a file where a view id or node id repeats, because the
  ids share the daemon's flat session map; `withoutCrossViewEdges` (L89-97).
- `packages/contracts/src/index.ts`: `REQUEST_SCHEMAS` (L110-172) is the table both sides derive
  `RequestMap` from (`project.save` L138, `project.save-local` L139, `fs.read` L147, `fs.watch`
  L148); `EVENT_SCHEMAS` (L183-195) with `project.changed` L190 and `fs.changed` L192.
- `packages/contracts/src/envelope.ts`: request `{ id, type, payload }` (L9-13), replies (L16-29),
  event `{ type: 'event', event, payload }` (L34-39).

### 1.2 Daemon (`apps/server/src/projects`)

`project-store.ts`:

- `ProjectError` codes (L39): `project-not-found`, `project-missing`, `project-invalid`,
  `rev-conflict`, `folder-not-found`, `bad-icon`.
- `WATCH_SETTLE_MS = 150` (L65); `isIconFile` (L68) is the only other `.ruimte` file the watcher
  reacts to.
- `OpenProject` (L77-86): `entry`, `rev`, `lastText` (the exact text last written or read, so the
  watcher tells its own write from an outside one), `watcher`, `settle`, `iconTouched`.
- `openUnlocked` (L151-227): reads the document (`readDocument`), writes a fresh one when missing
  (L206-207), replaces the registry entry, closes a previous open state, starts the watcher
  (L217), returns `{ summary, document (fromPortable), local }`.
- `saveUnlocked` (L233-249): `baseRev !== state.rev` throws `rev-conflict` (L235-237); writes
  `{ version: 2, rev: state.rev + 1, ...toPortable(content) }` and keeps the written text as
  `lastText` (L239-241).
- `saveLocal` (L251-254): `writeAtomic(<home>/projects/<id>.local.json)`.
- `deleteUnlocked` (L322-341): removes the local file (L330); with `removeFiles` it removes
  `project.json` and then tries a non-recursive `rm` of `.ruimte` that is allowed to fail (L337-338).
  A `drawings/` subdirectory would make that rmdir fail silently and leave `.ruimte` behind, so this
  has to change (section 4.6).
- `locked` (L349-353): a promise chain serializing every registry-touching operation.
- `documentPath` (L355-357): `<folder>/.ruimte/project.json` or
  `<home>/projects/<encodeURIComponent(id)>/project.json`. `localPath` (L359-361):
  `<home>/projects/<encodeURIComponent(id)>.local.json`. `readLocal` (L363-369).
- `startWatching` (L371-392): `node:fs` `watch(dirname(path))`, NOT recursive, on the directory
  rather than the file because `writeAtomic` renames a temp file over the target and a file
  watcher would keep the old inode. It ignores every filename other than `project.json` and
  `icon.*`, and settles 150 ms per burst before `reload`.
- `reload` (L394-429): re-reads the text, returns when it equals `lastText`, parses (a half-written
  file returns `unreadable` and is skipped, the next event reads it whole), updates `rev` and the
  registry entry, emits `project.changed` with the full document and a `project.summary`.
- `emit` (L438-442) fans out to every subscribed client sink; `subscribe` (L106-113) is per client.

`project-files.ts`:

- `PROJECT_DIR = '.ruimte'`, `PROJECT_FILE = 'project.json'` (L15-16).
- `readDocument` (L36-56): a file that is not a document at all is renamed to
  `project.json.corrupt-<timestamp>` and treated as missing; one that breaks an invariant returns
  `invalid` with a message. `parseDocument` (L58-74) runs `migrateDocument`, `duplicateIdIn` and
  `withoutCrossViewEdges`.
- `serializeDocument` (L77): pretty-printed, trailing newline, so git diffs read.
- `writeDocument` (L79-84): `mkdir -p`, `writeAtomic(path, text, 0o644)`.
- `mapViews` (L91-97): for a non-canvas view it does
  `view.kind === 'browser' ? view : { ...view, node: mapCwd(view.node, map) }`. A drawing view has
  no `node`, and `mapCwd(undefined, ...)` throws on `carrier.cwd`. This is the one server file that
  MUST change before a drawing view can be saved at all.
- `toPortable` / `fromPortable` (L103-127): relative cwd inside the folder.

`apps/server/src/handlers/project.ts` (L14-43) registers the seven `project.*` handlers through a
`translate` that maps `ProjectError` to `RequestError` (L4-12). `apps/server/src/daemon.ts` builds
the `ProjectStore` (L91), registers the handlers (L99), subscribes each socket to it (L248), and
calls `projects.closeAll()` on shutdown (L332). HTTP routes sit in the same `fetch` (L199-219);
`GET /fs/file` (L206-208) already serves bytes with the socket's access rules.

`apps/server/src/fs.ts`: `writeAtomic` (L14-28, temp file plus rename with retries) and
`isNotFound` (L30). `apps/server/src/fs/watch.ts` is a second watcher family (`FolderWatcher`,
per client, recursive on darwin and win32 only, 250 ms settle, `fs.changed` with the touched
directories); it is for the Files panel, not for documents, and the project store deliberately does
not use it.

### 1.3 Client: opening, switching, creating, renaming, deleting

`apps/client/src/state/document.ts` (`useDocument`) owns the list of views and which one is up:

- `DocumentState` (L28-65): `views`, `activeViewId`, `lastCanvasViewId`, `viewLocal`
  (per-view machine state), `bodyFocused`, `edits` (counter the project client watches),
  `loading`.
- `StandaloneRequest` (L68-69): the two shapes `addStandaloneView` accepts (chat/terminal with a
  node, browser with a url).
- `localOfCanvas` (L71-74) reads `useCanvas.camera` and `mode` for the active view; this is the
  function to generalize so a drawing's camera comes from the drawing store.
- `load` (L127-143): picks the active view from `local.activeViewId`, hands the canvas store the
  view (or null) and its local camera (L141).
- `setActiveView` (L145-157): writes the canvas back (`exportViews`), remembers the previous view's
  local, sets `bodyFocused: !canvas`, loads the next canvas (or null).
- `addCanvasView` (L163-168), `addStandaloneView` (L170-179), `renameView` (L181-191), `deleteView`
  (L193-209, keeps at least one view, activates the neighbor), `duplicateView` (L211-222, canvas
  only), `moveView` (L224-234), `openAsView` (L283-326), `putOnCanvas` (L328-354),
  `exportViews` (L356-364, merges the live canvas back), `exportLocal` (L366-372).
- `viewOfNode` (L376-377), `activeViewOf` (L379-380).

`apps/client/src/project/views.ts`: `showView` (L9), `freeName` (L21-31, "Canvas", "Canvas 2"),
`newCanvasView` (L33), `viewAtIndex` (L36), `stepView` (L38-45), `nodesOfView` (L48-58: a
non-canvas view is one node `{ id: view.id, kind: view.kind }`, which would be wrong for a drawing),
`projectNodes` (L70-79, same shape), `viewIsBusy` (L82-89), `canOpenAsView` (L92), `askOpenAsView`
(L98-105), `putOnCanvas` (L108-112), `askDeleteView` (L115-125), `askRenameView` (L127).

`apps/client/src/project/project-client.ts` (`ProjectClient`):

- Constructor (L85-111): subscribes to `project.changed`, `project.summary`, the transport status,
  the canvas store, the document store and the `PanelsPort`; `saveDelayMs` 400 (L97),
  `localDelayMs` 1000 (L98).
- `onCanvas` (L284-295): node/text/edge/order changes mark dirty and schedule a save; camera or mode
  changes schedule the local write.
- `onDocument` (L301-312): `edits` changes mark dirty; `activeViewId` changes schedule local.
- `save` (L357-393): one write at a time, `project.save { baseRev: rev }`, on `rev-conflict` it
  keeps `dirty` and waits for the watcher's `project.changed` (L380-383).
- `onChanged` (L395-407): with unsaved edits or a save in flight the document goes to
  `sink.setConflict`, else it is loaded in place with `localOfScreen()`.
- `resolveConflict` (L204-219): `theirs` loads the file, `mine` takes the file's rev and re-saves.
- `flush` (L222-232), `flushLocal` (L335-342), `saveLocal` (L344-350), `localOfScreen` (L353-355).
- Wired in `apps/client/src/project/index.ts` (L12-23) with `useProject` (`apps/client/src/state/project.ts`,
  L4-29: `rev`, `dirty`, `conflict`, `error`, `switching`) as the sink.
- The conflict UI is `apps/client/src/shell/ProjectBanner.tsx` (L9-41): a `FLOAT` card under the
  toolbar with "Take the file" and "Keep mine".

Renaming and deleting go through `apps/client/src/shell/ViewDialogs.tsx` (L13-137; the dialog kinds
are `ViewDialog` in `apps/client/src/state/ui.ts` L96-101: `rename`, `delete`, `promote`,
`new-browser`). The "New view" choice is `NewViewItems` in `apps/client/src/shell/ViewMenu.tsx`
(L23-36): Canvas (Cmd+T), the agent submenus, Browser. It is used by the breadcrumb `ViewMenu`
(L39-88, which also offers "Put on canvas" for any non-canvas view at L72-76) and by the sidebar
footer (`apps/client/src/shell/Sidebar.tsx` L449-461).

### 1.4 Sidebar

`apps/client/src/shell/sidebar-rows.ts` is the pure list: `SidebarView` (L12-20) carries
`kind: ProjectViewKind`, `nodes` and `self` (the node a standalone view is, for its status and draft
dot); `buildSidebar` (L78-116) makes a "Needs you" section and the views in file order; a row is
`expandable` only for a canvas with nodes (L94). `apps/client/src/shell/Sidebar.tsx` builds the
input (L338-360): for a non-canvas view it sets `self: asRow({ id: view.id, kind: view.kind, ... })`
at L356, which types `kind` as a `NodeKind`; `VIEW_ICON` (L55-60) is a `Record<ProjectViewKind, ...>`;
`ViewRow` (L175-317) draws the row, F2 renames, drag reorders, and its context menu (L294-315)
offers Rename, Duplicate (canvas) or Put on canvas (anything else), Delete.

### 1.5 Where a view is rendered

`apps/client/src/shell/ViewHost.tsx` is the switch:

- `ViewHost` (L71-82): the `<Canvas />` stays mounted and goes `invisible` plus `inert` while a
  standalone view is up; `StandaloneView` is drawn on top.
- `StandaloneView` (L36-58): `bg-surface`, a pointer-down capture sets `bodyFocused`, then
  `view.kind === 'chat'` (a 768px column), `'terminal'` (`TerminalBody`), `'browser'`
  (`BrowserViewSurface`, the parked webview host).
- `useLeaveOnEscape` (L19-34): Escape (Cmd+Escape in a terminal) leaves the body to the view's
  sidebar row, unless the target is in a floating layer.

So yes: chat, terminal and browser views are real and complete. Their bodies live in
`apps/client/src/nodes/{ChatBody,TerminalBody,BrowserBody}.tsx` and read a `NodeHost`
(`apps/client/src/nodes/node-host.ts`, `hostOfView` L44-52), which is what lets one body serve a
node in a frame and a view of its own. What a node header carried goes to the toolbar through
`apps/client/src/shell/ViewToolbar.tsx` (`KINDS_WITH_TOOLBAR` L15 = browser and terminal;
`useHasViewToolbar` L18-21; the bar in `apps/client/src/shell/Toolbar.tsx` L67-69 fences it with
separators). The floating `Dock` (`apps/client/src/shell/Dock.tsx` L47-50, L68-70) is canvas only and
returns null on a standalone view.

Other places that branch on the view kind and will need a `drawing` case (from a grep over the tree):

- `apps/client/src/terminal/lifecycle-watch.ts` L23-28: every non-canvas view becomes a live
  session id with `view.kind` as its `NodeKind`; a drawing must be skipped there (it is not a
  session and `'drawing'` is not a `NodeKind`).
- `apps/client/src/context/sync.ts` L22-25: skips non-canvas views, fine as is.
- `apps/client/src/browser/WebviewParking.tsx` L49-51: `filling` only for a browser view, fine.
- `apps/client/src/canvas/Canvas.tsx` L42-45 `onStandaloneView`: the canvas skips its own keys
  (L281-283) while a standalone view is up, but keeps the app-wide chords (L233-278: Cmd+K, Cmd+,,
  Cmd+1..9, Cmd+Shift+[ ], Cmd+T, Cmd+Alt+B, Cmd+B). Undo (L288-294) and the zoom keys (L297-316)
  do NOT fire for a standalone view, so the drawing binds its own.
- `apps/client/src/shell/commands.ts` `appCommands` (L81-156): `view-new` L99, `view-new-browser`
  L106-110, `view-demote` L114-116 (must not appear for a drawing), `fit`/`zoom-selection`/`zoom-reset`
  (L138-140) act on `useCanvas` only.
- `apps/client/src/shell/CommandPalette.tsx` `VIEW_ICON` (L30-35) and `viewSwitches` (L188-197).
- `apps/client/src/shell/settings/shortcuts.ts` `CANVAS_SHORTCUTS` (L16-71): the read-only Keyboard
  pane mirrors the chords `Canvas.tsx` binds by hand; a drawing group goes here.

## 2. The machine-local file

`ProjectLocalSchema` (`packages/contracts/src/project.ts` L307-312):

```
{ activeViewId: string | null, views: Record<viewId, { camera: Camera | null, focusedNodeId: string | null }>, panels?: ProjectPanels }
```

`CameraSchema` (L292) is `{ x, y, zoom }`, the same shape as `apps/client/src/canvas/math.ts` L1-5.
The file is `$RUIMTE_HOME/projects/<encodeURIComponent(projectId)>.local.json`, written by
`ProjectStore.saveLocal` (L251-254) on `project.save-local`, read by `readLocal` (L363-369) and
returned with `project.open`. It is never inside the folder and never shared.

On the client, `ProjectClient.scheduleLocal` (L324-332) fires 1000 ms after a camera, mode,
active-view or panel change and sends `localOfScreen()` (L353-355), which is
`useDocument.exportLocal()` plus `panelsPort.export()`. `exportLocal` (`state/document.ts`
L366-372) merges `viewLocal` with the active view's `localOfCanvas()` (L71-74), so the drawing
view needs exactly two changes:

1. `localOfCanvas` becomes `localOfActive()`: when the active view is a drawing, read
   `useDrawing.getState().camera` and answer `{ camera, focusedNodeId: null }`.
2. `ProjectClient` subscribes to the drawing store's camera (a new `DrawingAccess` constructor
   parameter next to `CanvasAccess`, L9-20) and calls `scheduleLocal()` when it changes.

`useDocument.load` (L141) and `setActiveView` (L156) pass `viewLocal[id]` to `useCanvas.loadView`;
the same value goes to `useDrawing.load(document, local)` for a drawing, which sets the camera or
fits the elements when there is none (the way `loadView` in `state/canvas.ts` L651-676 does at
L670-675).

## 3. The existing infinite canvas (`apps/client/src/canvas`)

### 3.1 Camera and transforms (`math.ts`)

- `Camera { x, y, zoom }` (L1-5), `Rect`, `Point`; `ZOOM_MIN 0.1`, `ZOOM_MAX 4` (L19-20);
  `GRID = 8` (L21); `clampZoom` (L23); `snapToGrid` (L25); `snapZoom` (whole percent, L28);
  `toWorld(camera, screen)` (L30-33); `zoomAround(camera, nextZoom, anchor)` (L36-44);
  `unionRect` (L46-61); `intersects` (L63); `cameraToFit(bounds, viewport, padding = 96, maxZoom = 1)`
  (L65-72); `cameraCenteredOn` (L74-78); `ZOOM_PRESETS` (L80); `activeZoomPreset` (L83).
- Screen = world * zoom + camera. The world layer is one `div` with
  `transform: translate(camera.x, camera.y) scale(zoom)` (`Canvas.tsx` L625-631). The dot grid is a
  `radial-gradient` background whose size is `GRID * 3 * zoom` and whose position is the camera
  (L597, L604-608), using `--canvas-bg` and `--canvas-dot`.

All of `math.ts` is reusable as is for the drawing view. `useCanvas` (`state/canvas.ts`) is not: it
is the editor of the active canvas view (nodes, order, edges), and the lifecycle watcher reads its
nodes as sessions. The drawing gets a store of its own that copies the camera actions
(`panBy` L315-318, `zoomAt` L319-322, `settleZoom` L323-329, `zoomTo` L330-334, `fitAll` L335-342,
`zoomToSelection` L343-356) and the history pattern (below).

### 3.2 Gestures and keys (`Canvas.tsx`)

- `Gesture` union (L22-33): pan, box, move, link, resize; kept in a ref, `setPointerCapture` on the
  root (L338-343), `screenPoint` helper (L332-335).
- Wheel (L142-201): a native non-passive listener because React's is passive; Ctrl/Cmd+wheel zooms
  with `Math.exp(-deltaY * 0.01)` around the pointer (L167) and settles to a whole percent 160 ms
  after the last tick (`ZOOM_SETTLE_MS` L35, L172-178); plain wheel pans (L180-182). A
  document-level `swallowPinch` (L186-190) and `gesturestart` guard keep a pinch anywhere from zooming
  the page. Those document-level guards are registered once by the mounted canvas and keep working
  while it is `invisible`, so the drawing only needs its own element-level wheel listener.
- Space+drag or middle button pans (L357-363); `data-node-id`, `data-text-id`, `data-port`,
  `data-resize` attributes route the pointer (L354-403); the box marquee is drawn in screen space
  (L653-663) as `border border-accent bg-accent/10` and resolved with `intersects` on pointer up
  (L548-572); `Shift` adds to the selection.
- Keys (L203-329): Escape clears in a fixed order (link draft, text edit, node mode, selection;
  L211-232); Cmd+Z / Cmd+Shift+Z (L288-294); Cmd+G; Cmd+0; Shift+1 fit; Shift+2 zoom to selection;
  Cmd+A; Delete/Backspace; `=`/`-` zoom (L297-316). `isTypingTarget` (L47-52) keeps keys out of
  inputs and contenteditables.

### 3.3 History

`state/canvas.ts`: `Snapshot` (L86-93) holds the placement (`nodes`, `order`, `texts`, `edges`,
`layouts`), never camera or selection; `HISTORY_LIMIT = 100` (L94); `remember(s)` (L286) pushes a
snapshot and clears `future`; a drag remembers only on its first step (`moveSelected(dx, dy, first)`
L393-408, `setResizing` L430-433); `undo` (L686-700) and `redo` (L702-708) swap snapshots and clear
the selection; `loadView` resets `past` and `future` (L668-669). Snapshots are references to the
immutable records, so they are cheap.

### 3.4 Texts and edges

- A text element is a `contenteditable="plaintext-only"` div (`TextElementView.tsx` L38-73),
  positioned with `left`/`top` in world units inside the transformed layer, `fontSize: text.size`;
  editing starts on double-click (L50-53), commits on blur (L27-35), Enter or Escape blur it
  (L55-63); an empty text deletes itself. Its placeholder and caret rules are `.text-element` in
  `styles.css` (L441-442). The port for drawing an edge is a span with `data-port` (L66-71).
- Edges are one `<svg width="1" height="1">` with `overflow: visible` inside the transformed layer
  (`EdgeLayer.tsx` L119); a wide transparent path takes the hover and click (L137-151); labels are
  `<foreignObject>` with HTML so they scale with the font (L74-81); colors are `var(--accent)`,
  `var(--text-muted)`, `var(--border-strong)` (L133).

### 3.5 What the drawing view reuses

- `canvas/math.ts` entirely (camera, fit, zoom, intersects, union).
- The wheel and Space+drag patterns and the screen-space marquee from `Canvas.tsx`.
- The history shape from `state/canvas.ts` (snapshot of the elements array, `first` flag on drags).
- The text editing pattern: a DOM `textarea` (the way `NoteNode.tsx` L21-31 does it) placed in
  world coordinates over the canvas while a text element is edited, committed on blur.
- UI primitives: `Tooltip` (`ui/Tooltip.tsx` L28, `name` puts the label on `aria-label`),
  `BTN_GROUP` and `FLOAT` (`ui/classes.ts` L9-12; `FLOAT` is the glass card of the dock and the
  banner), `.icon-btn` with `data-active` (`styles.css` L285-299), `Icon` (`ui/Icon.tsx`, stroke
  1.75, sizes 12/14/16), `Button` (`ui/Button.tsx`), `Separator`, the Base UI `Menu`/`Popover` with
  `.menu-popup` and `.menu-item` (`styles.css` L330-370), `EmptyState`.
- Semantic tokens: `--canvas-bg` and `--canvas-dot` (L50-51 light, L130-131 dark), `--selection`
  (L52, L132), `--accent`, `--text`, `--text-muted`, `--border-strong`, `--surface-raised`; the
  `@theme` block (L208-244) exposes them as `bg-canvas-bg`, `text-text` and so on. A drawing needs a
  small stroke palette that both themes define; that palette is the only new thing `styles.css`
  gets (section 5.4). Decisions to respect from `docs/HANDOFF.md`: the grid is never highlighted in
  the accent (L682), no bare single-letter shortcuts (L680-681), whole pixels only (L734-736), the
  four-step type scale (L737-742), Lucide only through `Icon` (L744-749).

## 4. Persistence design

### 4.1 File layout

```
<folder>/.ruimte/project.json                  version 2, lists { kind: 'drawing', id, name }
<folder>/.ruimte/drawings/<viewId>.json        one drawing document per drawing view
$RUIMTE_HOME/projects/<projectId>/drawings/<viewId>.json   for a project without a folder
```

Why a `drawings/` subdirectory and not `.ruimte/<viewId>.drawing.json`:

- The project watcher (`startWatching` L371-392) is a non-recursive `fs.watch` on `.ruimte` that
  filters by filename. A flat layout would work with one more predicate, but every drawing then
  shows up next to `project.json` and `icon.*` in a folder that is committed to git and read by
  people. A directory keeps the top level to the two files the daemon already documents.
- The name is the view id (`view-xxxxxxxx` from `nextId('view')`, `state/canvas.ts` L274), passed
  through `encodeURIComponent` the way session snapshots are (CLAUDE.md), and never the view name,
  so a rename never moves a file and two machines never disagree.
- `docs/PLAN.md` phase 20 already reserves `<folder>/.ruimte/images` for pasted images; `drawings/`
  sits next to it.

The daemon watches `.ruimte/drawings` with a second non-recursive `fs.watch` (created lazily the
first time a drawing of that project is opened, closed with the project). On macOS FSEvents a
non-recursive watch on `.ruimte` does not reliably report a write inside `drawings/`, so the
drawing store owns its own watcher rather than piggybacking on the project one.

### 4.2 The drawing document (new `packages/contracts/src/drawing.ts`)

```ts
export const DrawingIdSchema = z.string().min(1);

// A color is a name from the drawing palette, never a hex value: the file is theme independent,
// and `styles.css` maps each name to a token in both themes.
export const DrawingColorSchema = z.enum(['ink', 'muted', 'accent', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']);
export const DrawingFillSchema = z.enum(['none', 'solid', 'hachure']);
export const DrawingStrokeWidthSchema = z.union([z.literal(1), z.literal(2), z.literal(4)]);

const ElementBaseSchema = z.object({
    id: z.string().min(1),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    // Radians around the center; absent means 0.
    angle: z.number().optional(),
    stroke: DrawingColorSchema,
    strokeWidth: DrawingStrokeWidthSchema,
    fill: DrawingFillSchema.optional(),
    fillColor: DrawingColorSchema.optional(),
    // 0 is a clean line, 1 the hand-drawn look; the seed keeps the wobble the same on every render.
    roughness: z.number().min(0).max(2).optional(),
    seed: z.number().int().nonnegative(),
    locked: z.boolean().optional()
});

export const DrawingElementSchema = z.discriminatedUnion('kind', [
    ElementBaseSchema.extend({ kind: z.literal('rect'), radius: z.number().nonnegative().optional() }),
    ElementBaseSchema.extend({ kind: z.literal('ellipse') }),
    // Points relative to (x, y); the box is the points' bounds. `arrow` is a line with a head at the end.
    ElementBaseSchema.extend({ kind: z.literal('line'), points: z.array(z.tuple([z.number(), z.number()])).min(2), arrowStart: z.boolean().optional(), arrowEnd: z.boolean().optional() }),
    // A freehand stroke: relative points with optional pressure, drawn through perfect-freehand.
    ElementBaseSchema.extend({ kind: z.literal('freehand'), points: z.array(z.tuple([z.number(), z.number(), z.number().optional()])).min(1) }),
    ElementBaseSchema.extend({ kind: z.literal('text'), text: z.string(), size: z.number().int().min(12).max(96), align: z.enum(['left', 'center', 'right']).optional() })
]);
export type DrawingElement = z.infer<typeof DrawingElementSchema>;

// What the person edits; the daemon wraps it with the version and the rev, as it does for a project.
export const DrawingContentSchema = z.object({
    // Back to front.
    elements: z.array(DrawingElementSchema)
});
export const DrawingDocumentSchema = DrawingContentSchema.extend({
    version: z.literal(1),
    rev: z.number().int().nonnegative()
});
export type DrawingDocument = z.infer<typeof DrawingDocumentSchema>;

export const EMPTY_DRAWING: DrawingDocument = { version: 1, rev: 0, elements: [] };

export const migrateDrawing = (value: unknown): DrawingDocument | null => {
    const parsed = DrawingDocumentSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
};
```

Notes on the shape:

- Elements carry the z-order by array position, as `nodes` do in a canvas view (project.ts L184).
- Ids are `nextId('el')`; they never leave the drawing file, so they do not enter the project's
  flat id namespace. `duplicateIdIn` stays untouched. A `duplicateElementIdIn` check in
  `migrateDrawing` refuses a file with a repeated element id (same message style as
  `parseDocument` L71).
- Geometry is world units, the same units the canvas view uses, so a later "drawing node on a
  canvas" could show the file at 1:1.
- Freehand points are rounded to one decimal on commit (a stroke of 300 points is then about 3 KB).
- `text.size` is a whole pixel, on the same rule as everything else. The font is the interface
  stack (`--font-sans`); adding a handwriting font would break the "Geist for the wordmark only,
  system stack otherwise" decision (HANDOFF L764-766) and is an open question.

Add `'drawing'` to the project view union (`project.ts` L192-198):

```ts
ViewBaseSchema.extend({ kind: z.literal('drawing') })
```

Nothing else in `project.json` changes; `migrateDocument` (v1 has no views) is untouched. A file
written by this build parses in an older build only until it meets the new kind, which is the same
rule a new node kind already has.

Serialization (`serializeDrawing` on the daemon): the top level pretty-printed, every element on
one line, trailing newline. `JSON.stringify(doc, null, 2)` would put every point of every stroke on
its own line, and a git diff of that is useless; one element per line diffs the way a person reads
a drawing.

### 4.3 Wire contracts (additions to `packages/contracts/src/index.ts`)

```ts
'drawing.open':  { payload: DrawingTargetPayloadSchema, result: DrawingOpenResultSchema },   // { projectId, viewId } -> { document }
'drawing.save':  { payload: DrawingSavePayloadSchema, result: ProjectSaveResultSchema },     // { projectId, viewId, baseRev, content } -> { rev }
'drawing.close': { payload: DrawingTargetPayloadSchema, result: EmptySchema }
```

Event: `'drawing.changed': DrawingChangedEventSchema` = `{ projectId, viewId, document }`.

Errors (a `DrawingError` translated by the handler like `ProjectError`): `project-not-found`
(the project is not open), `drawing-not-found` (the view id is not a drawing view of that
project), `drawing-invalid` (a file that parses as JSON but not as a drawing; the client shows it
in a banner and the file is left alone, the way `project-invalid` works), `rev-conflict`.

Why not the generic `fs.read` plus a new `fs.write`: `fs.read` (`packages/contracts/src/fs.ts`
L106-137) is bounded, sniffs binaries and has no rev; a generic write would put the conflict rule,
the atomic rename and the "our own write versus an outside edit" test in the client. Everything
`project.json` earned (rev, `lastText`, settle, set-aside of a corrupt file) applies one for one to a
drawing, so the daemon owns it.

### 4.4 Server module: `apps/server/src/projects/drawing-store.ts`

```ts
export class DrawingStore {
    constructor(private readonly projects: ProjectStore) {}
    subscribe(clientId, sink)                          // same as ProjectStore.subscribe (L106-113)
    open(projectId, viewId): Promise<DrawingDocument>  // reads the file, EMPTY_DRAWING when missing (nothing is written until the first save)
    save(projectId, viewId, baseRev, content): Promise<number>
    close(projectId, viewId): void
    removeOrphans(projectId, keepViewIds: Set<string>): Promise<void>  // called by ProjectStore after a save
    closeProject(projectId): void                      // stops the watcher; called from ProjectStore.close
}
```

- State per open project: `{ dir, watcher, settle, open: Map<viewId, { rev, lastText }> }`.
  `dir` = `join(dirname(projects.documentPathOf(entry)), 'drawings')`; `ProjectStore` exposes
  `documentPathOf(projectId)` (today `documentPath(entry)` is private, L355) and a
  `isDrawingView(projectId, viewId)` check against the last parsed document, which means
  `OpenProject` (L77-86) also keeps `views: ProjectView[]` (or just the set of drawing ids) from the
  last read or written document.
- `open`: verifies the view is a drawing view of an open project, reads
  `<dir>/<encodeURIComponent(viewId)>.json`, `migrateDrawing`, a corrupt file is set aside as
  `<name>.corrupt-<timestamp>` the way `readDocument` does (L53-55), remembers `{ rev, lastText }`,
  starts the directory watcher if not running (`mkdir -p` first so the watch has a directory).
- `save`: `baseRev !== rev` throws `rev-conflict`; writes `{ version: 1, rev: rev + 1, elements }`
  through `writeAtomic` with mode `0o644` (the mode `writeDocument` uses, L82); keeps `lastText`.
- Watcher: `watch(dir)` non-recursive, 150 ms settle per file name, then `reload(viewId)`:
  same `lastText` short circuit, skip an unreadable (half-written) file, emit
  `drawing.changed { projectId, viewId, document }` on a real change. A file that disappears
  (someone deleted it) emits `drawing.changed` with `EMPTY_DRAWING` at rev 0? No: a deleted file
  under an open drawing is left alone and the next save recreates it at `rev + 1`; only the project
  file says whether a drawing exists.
- `removeOrphans`: `ProjectStore.saveUnlocked` (L233-249) computes the drawing ids of the previous
  document and of `content.views`; every id that left is `rm`-ed with `force: true` and closed. The
  same runs in `reload` (L394-429) when an outside edit of `project.json` drops a drawing view? No.
  An outside edit (a git pull) may drop a view because the file was not pulled yet; deleting on that
  path would destroy data someone else has. Orphan removal runs only on `project.save`, which is a
  person deleting the view in this app.
- `project.delete` with `removeFiles` (`deleteUnlocked` L332-341): also `rm -rf <folder>/.ruimte/drawings`
  before the non-recursive rmdir of `.ruimte` (L338). A project without a folder already removes its
  whole directory (L340).
- `closeAll` on shutdown (`daemon.ts` L332) closes the drawing watchers too.

Handler: `apps/server/src/handlers/drawing.ts`, registered in `daemon.ts` next to
`registerProjectHandlers` (L99), the store subscribed per socket next to `projects.subscribe`
(L248) and unsubscribed on close.

### 4.5 Conflicts, the way project.json does it

Identical state machine, in a `DrawingClient` (section 6): a save names the rev it loaded; the
daemon answers `rev-conflict` when the file moved on; the client keeps `dirty` and waits for
`drawing.changed`; with unsaved edits the incoming document goes to `conflict` and a banner offers
"Take the file" and "Keep mine"; without edits it is loaded in place. Two windows of the same
machine on the same drawing behave like two machines: the second save conflicts and the banner
appears, which is what `project.json` does today.

### 4.6 Deleting a view

The client path is unchanged: `askDeleteView` (`views.ts` L115-125) then `useDocument.deleteView`
(L193-209), which bumps `edits` and so triggers `project.save` 400 ms later; the daemon's orphan
removal (4.4) deletes the file. `viewIsBusy` answers false for a drawing (no sessions), so no
question is asked, which matches the "Delete view" dialog text for a view without sessions
(`ViewDialogs.tsx` L86-88). The `DrawingClient` flushes and drops its in-memory state when the
active view is deleted; a drawing that is deleted while open is unloaded before the save goes out,
so no save can race the removal.

## 5. Rendering approach

### 5.1 Option a: embed `@excalidraw/excalidraw`

Facts from the npm registry (queried 2026-09-10): latest `0.18.1`, published 2026-04-20, license
MIT, unpacked size 46.8 MB (`dist/prod`, `dist/dev`, types and source maps), 31 runtime
dependencies including `@radix-ui/react-popover`, `@radix-ui/react-tabs`, `jotai`, `jotai-scope`,
`sass`, `roughjs`, `perfect-freehand`, `@excalidraw/mermaid-to-excalidraw`, `pica`,
`image-blob-reduce`, `browser-fs-access`. Peer dependencies `react` and `react-dom`
`^17.0.2 || ^18.2.0 || ^19.0.0`, so React 19.2 is supported; reported friction is only peer
warnings from the Radix packages (excalidraw issues #9186, #9253, #9435).

- Vite and Electron: it works (Obsidian's excalidraw plugin and several Electron wrappers use it);
  it is browser code, no Node APIs. It needs `process.env.IS_PREACT` defined for Vite, its
  stylesheet imported (`@excalidraw/excalidraw/index.css`), and it loads its fonts (Virgil,
  Excalifont, Cascadia, Assistant and others) from a CDN unless `window.EXCALIDRAW_ASSET_PATH`
  points at a copy served by the app. The client's CSP (`daemon.ts` L50-52 and
  `apps/client/index.html`) has `font-src 'self' data:`, so the fonts have to be copied into the
  build; `style-src 'unsafe-inline'` is already there.
- Theming: a `theme: 'light' | 'dark'` prop and a set of its own CSS variables
  (`--color-primary`, `--island-bg-color`, ...) which can be overridden per selector, but its toolbar,
  icons (its own SVG set), menus, fonts, sizes and shadows are its own. The rules in CLAUDE.md
  (semantic tokens only, Lucide through `Icon`, whole pixels, `Tooltip` component, `BTN_GROUP`) cannot
  be applied to it; it would be a foreign island in the window, with its own Cmd+Z, its own Escape,
  its own Cmd+K-like menu and its own clipboard format.
- Bundle: the production build is in the low megabytes of JavaScript before gzip; the client today
  ships nothing of that size besides shiki, which is lazy loaded.
- Principle: "Written from scratch. Sharing ideas and npm packages is fine." Embedding is allowed
  by the letter, but the product would then be Excalidraw inside Ruimte rather than a Ruimte
  drawing. Verdict: no.

### 5.2 Option b: `<canvas>` 2D with `perfect-freehand` and `roughjs`

- `perfect-freehand` 1.2.3 (2026-02-01, MIT, 112 KB unpacked, zero dependencies): `getStroke(points, options)`
  turns `[x, y, pressure]` points into an outline polygon; the polygon becomes a `Path2D` filled
  with the stroke color. Options worth exposing: `size` (the stroke width times a factor),
  `thinning`, `smoothing`, `streamline`, `simulatePressure` (true for a mouse, false for a pen).
- `roughjs` 4.6.6 (2023-11-20, MIT, 170 KB unpacked, 4 small dependencies): `rough.canvas(ctx)` and
  `rough.generator()`; every shape takes `{ roughness, seed, stroke, strokeWidth, fill, fillStyle:
  'hachure' | 'solid', ... }`. A `seed` makes the wobble deterministic, so an element renders the
  same after a reload and on another machine, which is why `seed` is in the schema. With
  `roughness: 0` and `disableMultiStroke` the output is a clean shape, so one code path draws both
  looks. It is stable and unchanged since 2023; that is fine for a geometry library, and the
  generator API can be replaced by hand-written jitter later without touching the file format.
- Rendering: one `<canvas>` for the committed elements (redrawn on any element or camera change,
  `requestAnimationFrame` coalesced, `devicePixelRatio` aware, `ctx.setTransform(zoom * dpr, 0, 0,
  zoom * dpr, camera.x * dpr, camera.y * dpr)` so element code draws in world units), a second
  `<canvas>` for the stroke in progress and the hover outline (cheap to clear per frame), and a DOM
  overlay in screen space for what needs hit targets and text: the selection box with its eight
  resize handles and rotation handle, the marquee, and the `textarea` while a text element is
  edited. The DOM overlay keeps handles at whole pixels regardless of zoom, which a transformed div
  cannot.
- Hit testing is pure geometry (`drawing/geometry.ts`, tested): bounds for rect, ellipse and text
  (with the angle applied to the point instead of the box), distance to segment for lines and
  arrows with a tolerance of `max(6, strokeWidth * 2) / zoom`, and for freehand the same over the
  outline polygon's segments. Top-most element wins (iterate the array from the end).
- Text metrics: `ctx.measureText` per line with the interface font, cached per `(text, size)`;
  the element's `w`/`h` follow the text unless the person resized it (an `autoWidth` flag is an
  implementation detail; a resized text wraps at `w`).
- Export later: `canvas.toBlob` gives a PNG for free; an SVG export is a second painter over the
  same element list (roughjs has `rough.svg`), which is a phase of its own.

### 5.3 Option c: SVG

SVG gives free hit testing, DOM events per element, native text and easy export, and roughjs
draws to SVG too. It loses on the one thing a sketch does a lot: freehand strokes. Every stroke is
a `<path>` with hundreds of points in the DOM, the browser re-tessellates them on every pan and
zoom of the transformed group, and a hundred strokes plus live drawing at 120 Hz is where SVG
starts to drop frames. The canvas view already pays for DOM nodes per element because a node is a
terminal or a page; a drawing has no such reason. Text editing in SVG is `foreignObject` anyway,
which is what the DOM overlay in option b is.

### 5.4 Recommendation: option b, with these rules

- Two new dependencies in `apps/client/package.json`: `perfect-freehand` and `roughjs`. No
  Excalidraw code is read or copied; the element schema above is Ruimte's own.
- Colors: the stroke palette is ten names (`DrawingColorSchema`) mapped in `styles.css` to new
  tokens in both theme blocks: `--draw-ink: var(--text)`, `--draw-muted: var(--text-muted)`,
  `--draw-accent: var(--accent)`, and seven hues (`--draw-red` ... `--draw-pink`) with a light and
  a dark value each, the way `--note-*` (L83-87 and L163-167) and `--status-*` (L55-58, L135-138)
  already do. The painter reads them once per render through `getComputedStyle(root)` and again
  when `useTheme.resolved` changes, so a drawing follows the theme like everything else and the file
  never holds a hex value. The dot grid stays `--canvas-bg` and `--canvas-dot`; the selection
  outline and handles are `--selection` and `--accent`, the marquee is the canvas's own
  `border-accent bg-accent/10`.
- Sizes: stroke widths 1, 2, 4 world units; handle squares 8px; text sizes whole pixels; the dock
  and the popovers are the existing 28 and 32 pixel controls.
- Icons (all Lucide, existing in lucide-react 1.44): `MousePointer2` select, `Hand` pan,
  `Pencil` freehand, `Square` rect, `Circle` ellipse, `Minus` line, `MoveUpRight` arrow, `Type`
  text, `Eraser` (if the eraser tool is wanted), `Undo2`, `Redo2`, `Palette` or a color swatch,
  `PenLine` for the sketch toggle, `Maximize` fit, `Plus`/`Minus` zoom, `Trash` delete,
  `Lock`/`LockOpen`, `BringToFront`/`SendToBack` for z-order, `Frame` stays the canvas view icon and
  `PenTool` becomes the drawing view icon in every `VIEW_ICON` record.
- Hand-drawn look: `roughness` per element with a default that comes from a per-drawing setting
  stored in the file? No, keep it per element (the dock toggle sets the style of new elements and
  of the selection); a drawing-wide default would be a second source of truth. The dock remembers
  the last used style per session in the store, nothing stored.

## 6. Undo, redo, autosave and external edits

### 6.1 Client stores and client class

`apps/client/src/state/drawing.ts` (`useDrawing`), shaped after `useCanvas`:

```
viewId: string | null
camera: Camera; viewport: { w, h }
elements: DrawingElement[]          // back to front, immutable updates
byId: Record<string, DrawingElement> (derived on set, for hit tests and selection)
selection: string[]
tool: 'select' | 'hand' | 'freehand' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text'
style: { stroke, strokeWidth, fill, fillColor, roughness }   // for the next element
editingTextId: string | null
draft: DraftElement | null          // the element being drawn, not yet in `elements`
conflict: DrawingDocument | null; error: string | null
rev: number; dirty: boolean; edits: number; loading: boolean
past: DrawingElement[][]; future: DrawingElement[][]   // HISTORY_LIMIT 100

load(document, local); exportContent(): DrawingContent
setCamera / panBy / zoomAt / settleZoom / zoomTo / fitAll / zoomToSelection   (copies of state/canvas.ts L312-356)
select / clearSelection / selectInRect
setTool / setStyle / applyStyleToSelection
beginDraft / updateDraft / commitDraft      // one history entry per committed element
moveSelected(dx, dy, first) / settleMove    // `first` remembers, like state/canvas.ts L393-408
resizeSelected(rect, first) / rotateSelected(angle, first)
updateText(id, text) / setEditingText(id)
deleteSelected / duplicateSelected / bringToFront / sendToBack
undo / redo
```

`apps/client/src/drawing/drawing-client.ts` (`DrawingClient`), shaped after `ProjectClient`:

- Constructor takes `transport`, `useDrawing` access, `useDocument` access, `useProject` access
  (for `current.projectId`), options `{ saveDelayMs = 400 }`.
- Subscribes to `useDocument` for `activeViewId`: when the active view becomes a drawing it
  flushes the previous one, calls `drawing.open`, then `useDrawing.load(document, viewLocal[id])`;
  when it stops being one it flushes and unloads. When the project switches (`useProject.current`
  changes) it unloads without saving through the old project (the `ProjectClient.open` L262-282
  already flushed the document; the drawing flush has to happen before that, so the drawing client
  subscribes to `useProject.switching` going true and flushes there, or `ProjectClient.open` calls
  an injected `beforeSwitch` hook; the second is cleaner and testable).
- `edits` changes mark dirty and schedule a save 400 ms later; a save while one is in flight waits
  and runs again (the `saving` promise pattern L357-361).
- `drawing.changed` for the open view: dirty or saving sets `conflict`, else load in place with the
  current camera (never move the camera on a reload) and keep the selection for ids that still
  exist.
- `resolveConflict('theirs' | 'mine')` as in `ProjectClient` L204-219.
- Flush points: view switch, project switch or close, window `beforeunload` and `visibilitychange`
  to hidden (the project client does not do the last two today; a drawing is more likely to be
  closed mid-stroke, and a synchronous flush on `beforeunload` cannot await the socket, so it is a
  best-effort send), and `useDrawing.setEditingText(null)` (a text edit commits on blur, which is an
  edit like any other).
- The daemon also gets `drawing.close` on unload so the watcher entry goes; the directory watcher
  itself stays with the project.

Wire it in `apps/client/src/project/index.ts` next to `projectClient`, and give `ProjectClient` a
`DrawingAccess` (camera and loading) so `scheduleLocal` fires on a drawing camera change
(section 2).

### 6.2 History rules

- A history entry per gesture, not per pointer move: `beginDraft` remembers nothing, `commitDraft`
  remembers once; `moveSelected(first = true)` remembers once per drag; `resizeSelected` and
  `rotateSelected` the same; a text edit remembers once on commit (blur), with the old text; style
  changes on a selection remember once; `deleteSelected`, `duplicateSelected` and z-order changes
  remember once.
- Undo and redo restore `elements` only, clear the selection, never touch the camera or the tool
  (the rule `state/canvas.ts` L86 states).
- `load` resets `past` and `future`, as `loadView` does (L668-669). A conflict resolution that takes
  the file is a load.
- Cmd+Z / Cmd+Shift+Z are bound by the drawing view's own key handler (`Canvas.tsx` skips them for
  a standalone view at L281-283). The handler ignores keys while a text is being edited
  (`isTypingTarget`, the textarea has its own undo) and while a dialog is up.

### 6.3 Autosave details

- Debounce 400 ms after the last edit (the project's `saveDelayMs`, L97), never during a stroke:
  the draft is not in `elements`, so nothing is dirty until `commitDraft`.
- The dirty dot in the toolbar (`Toolbar.tsx` L60-63) reads `useProject.dirty`; make it
  `useProject.dirty || useDrawing.dirty` so a drawing with unsaved changes shows the same dot.
- A save failure that is not a conflict and not a connection error goes to `useDrawing.error`;
  the banner shows it with Dismiss, as `ProjectBanner` does (L30-36). Reuse `ProjectBanner` by
  reading both stores, or add a `DrawingBanner` under it with the same `FLOAT` card; one banner
  reading two stores is less code.
- The daemon writes only on save; an empty drawing that was never touched leaves no file. Deleting
  such a view removes nothing (rm with `force: true`).

### 6.4 External edits

`drawing.changed` arrives from the daemon's watcher 150 ms after an outside write (a git pull, a
text editor, another machine on a shared folder). Handling is in 6.1. One difference from
`project.json`: the incoming document replaces `elements` but keeps `selection` filtered to
surviving ids, `tool`, `style`, `camera` and `editingTextId` when that id survives with the same
text (otherwise the edit is dropped, like a node that disappears under a rename). A
`project.changed` that removes the active drawing view from the project is handled by
`useDocument.load` (L127-143), which picks another active view; the drawing client sees the switch
and unloads without saving (the file is gone with the view on the other side; saving would resurrect
it as an orphan).

## 7. Implementation plan

Sizes: S is an hour or two, M half a day to a day, L one to two days. Every step ends with
`bun run format`, `bun run check` and `bun test` green, and a conventional commit.

### Step 1: contracts (S)

- New `packages/contracts/src/drawing.ts` (schemas from 4.2, `EMPTY_DRAWING`, `migrateDrawing`,
  `duplicateElementIdIn`, the request and event payload schemas from 4.3).
- `packages/contracts/src/project.ts` L192-198: add the `drawing` member to `ProjectViewSchema`.
- `packages/contracts/src/index.ts`: export `./drawing.ts`; add `drawing.open`, `drawing.save`,
  `drawing.close` to `REQUEST_SCHEMAS`; `drawing.changed` to `EVENT_SCHEMAS`.
- Tests: `packages/contracts/src/drawing.test.ts` (a document round-trips; an unknown element kind
  and a repeated id are refused; `EMPTY_DRAWING` parses; a drawing view parses inside a project
  document; `duplicateIdIn` still ignores element ids because they are not in the project file).
  Pattern: `packages/contracts/src/project-migrate.test.ts` L1-30.

### Step 2: daemon (M)

- `apps/server/src/projects/project-files.ts` L91-97: `mapViews` returns a view without a `node`
  untouched (`if (view.kind === 'browser' || view.kind === 'drawing') return view;`). Add
  `drawingsDirOf(documentPath)`, `drawingPathIn(dir, viewId)` (with `encodeURIComponent`),
  `serializeDrawing`, `parseDrawing` (JSON, `migrateDrawing`, the corrupt set-aside), `readDrawing`.
- `apps/server/src/projects/drawing-store.ts` per 4.4, including the watcher.
- `apps/server/src/projects/project-store.ts`: keep the drawing view ids of the last document on
  `OpenProject` (L77-86); after a successful `saveUnlocked` (L239-241) call
  `drawings.removeOrphans(projectId, idsIn(content.views))`; on `close` (L307-316) close the
  drawing watcher; in `deleteUnlocked` (L335-338) `rm -rf` the `drawings` directory before the
  `.ruimte` rmdir; expose `documentPathOf(projectId)` and `hasDrawingView(projectId, viewId)`.
  Constructor injection: `new DrawingStore(projects)` after `new ProjectStore(home)` in
  `daemon.ts` L91, and `projects.drawings = drawings` (or pass a callback) for orphan removal.
- `apps/server/src/handlers/drawing.ts` (three handlers, `translate` for `DrawingError`);
  register in `daemon.ts` after L99; subscribe and unsubscribe per socket at L248-261.
- Tests: `apps/server/src/projects/drawing-store.test.ts` following
  `project-store.test.ts` L1-35 (mkdtemp home and folder, subscribe a sink, `waitFor` from
  `apps/server/src/sessions/test-helpers.ts` L23): open a missing drawing gives `EMPTY_DRAWING` and
  writes nothing; the first save writes `drawings/<id>.json` with rev 1 and one element per line;
  a save on an older rev is `rev-conflict`; an outside write emits `drawing.changed` with the new
  rev and the daemon's own write does not; a corrupt file is set aside; `project.save` without the
  view removes the file; `project.delete` with `removeFiles` removes the directory; a drawing view
  survives `toPortable`/`fromPortable`; `drawing.open` on a non-drawing view is `drawing-not-found`.
  Add a drawing view case to `project-store.test.ts` and `project-files` coverage for `mapViews`.

### Step 3: client plumbing for the new kind (M)

Typecheck drives most of this: every `Record<ProjectViewKind, ...>` and every `view.kind` narrowing
fails until the case is added.

- `apps/client/src/state/document.ts`: `addDrawingView(name): string` (like `addCanvasView`
  L163-168, view `{ kind: 'drawing', id: nextId('view'), name }`); `putOnCanvas` (L328-354) returns
  false for a drawing; `duplicateView` stays canvas only (open question 7); `localOfCanvas` (L71-74)
  becomes `localOfActive()` reading `useDrawing` for a drawing view; `load` and `setActiveView` pass
  the local to whichever store is active.
- `apps/client/src/project/views.ts`: `newDrawingView()` with `freeName(views, 'Drawing')`;
  `nodesOfView` (L48-58) and `projectNodes` (L70-79) return `[]` for a drawing; `viewIsBusy` then
  answers false on its own.
- `apps/client/src/terminal/lifecycle-watch.ts` L23-28: skip drawing views.
- `apps/client/src/nodes/node-host.ts` `hostOfView` L44-52: return null for a drawing.
- `apps/client/src/shell/ViewMenu.tsx`: `VIEW_ICON` (L12-17) gets `drawing: PenTool`;
  `NewViewItems` (L23-36) gets a "Drawing" row after Canvas calling `newDrawingView()`; "Put on
  canvas" (L72-76) is hidden for a drawing.
- `apps/client/src/shell/Sidebar.tsx`: `VIEW_ICON` (L55-60); `self` is null for a drawing
  (L356); the context menu (L300-308) offers neither Duplicate nor Put on canvas for a drawing until
  duplicate exists. `sidebar-rows.ts` needs no change; add a test that a drawing row is not
  expandable and has no status.
- `apps/client/src/shell/CommandPalette.tsx` `VIEW_ICON` (L30-35).
- `apps/client/src/shell/commands.ts`: `{ id: 'view-new-drawing', label: 'New drawing view', run: () => void newDrawingView() }`
  after `view-new` (L99); `view-demote` (L114-116) only when the active view is chat, terminal or
  browser; `fit`, `zoom-selection`, `zoom-reset` (L138-140) dispatch to `useDrawing` when the
  active view is a drawing (same labels and chords, so the palette does not grow a second set).
- `apps/client/src/shell/ViewHost.tsx` `StandaloneView` (L50-56): `view.kind === 'drawing' && <DrawingView id={view.id} />`.
  `useLeaveOnEscape` (L19-34): let the drawing view stop propagation of Escape while it has
  something to clear (a draft, a text edit, a selection, a tool other than select), in the order
  `Canvas.tsx` L220-228 uses; the host's listener is on `window`, so a `stopPropagation` from the
  drawing's own `window` listener registered earlier will not do; instead the host asks
  `useDrawing.getState().canClearOnEscape()` before leaving.
- `apps/client/src/shell/ViewToolbar.tsx`: nothing for now (the drawing's tools float in its own
  dock, section 7 step 6); or add `'drawing'` to `KINDS_WITH_TOOLBAR` if Bas prefers the tools in
  the top bar (open question 3).
- `apps/client/src/shell/settings/shortcuts.ts`: a "Drawing" group.
- `apps/client/src/state/ui.ts` `ViewDialog` (L96-101): no new dialog; a drawing is created
  without a question, like a canvas.
- Tests: `state/document.test.ts` (add, delete, exportLocal camera from the drawing store,
  `putOnCanvas` refuses), `sidebar-rows.test.ts`, `project-client.test.ts` (a document with a
  drawing view loads and saves unchanged).

At the end of this step a drawing view exists, lists, renames, deletes and shows an `EmptyState`
placeholder. Commit.

### Step 4: drawing store and client (M)

- `apps/client/src/state/drawing.ts` (`useDrawing`, 6.1) with the camera actions copied from
  `state/canvas.ts` L312-356 and the history from L277-286 and L686-708.
- `apps/client/src/drawing/drawing-client.ts` (`DrawingClient`, 6.1) and its wiring in
  `apps/client/src/project/index.ts`; the `DrawingAccess` parameter on `ProjectClient` for the
  local camera; `Toolbar.tsx` dirty dot reads both stores; `ProjectBanner.tsx` reads both conflicts.
- Tests: `state/drawing.test.ts` (undo coalescing per gesture, redo cleared by an edit, load resets
  history, selection survives a reload for surviving ids, camera untouched by undo);
  `drawing/drawing-client.test.ts` with a `FakeTransport` like `project-client.test.ts` L48-70
  (opens on switch, saves 400 ms after an edit with the loaded rev, one save in flight, conflict on
  `rev-conflict` plus `drawing.changed` while dirty, silent reload when clean, flush before a view
  switch, no save after the view is deleted).

### Step 5: renderer and camera (M)

- `apps/client/src/drawing/geometry.ts`: bounds, rotation, hit tests, resize math, arrow head
  points, `freehandOutline(points, strokeWidth)` through `getStroke`. Pure and tested
  (`geometry.test.ts`).
- `apps/client/src/drawing/paint.ts`: `paintElements(ctx, elements, palette, options)` and
  `paintElement`, with a roughjs generator cache keyed by element id and a version hash (the
  generator output is deterministic per seed, so caching it is what keeps a 500-element drawing
  cheap on pan). Pure enough to be unit-tested against a fake `CanvasRenderingContext2D` that
  records calls (a small recorder in the test file; no DOM library needed).
- `apps/client/src/drawing/DrawingView.tsx`: the surface (`bg-canvas-bg` with the dot grid rule
  from `Canvas.tsx` L604-608), the two canvases, the overlay, the `ResizeObserver` for the viewport
  (`Canvas.tsx` L111-125), the native wheel listener (L142-201), Space and middle-button pan
  (L357-363), `fitAll` on first viewport when no camera is stored.
- `apps/client/src/drawing/palette.ts`: reads the `--draw-*` tokens from the root once per theme.
- `styles.css`: the `--draw-*` tokens in both theme blocks (after `--note-*`, L87 and L167) and
  their `@theme` aliases (after L242) so a swatch button can use `bg-draw-red`.

### Step 6: tools (L)

- Select: click selects (top-most), Shift toggles, marquee on empty space (`selectInRect` with
  `intersects` on bounds), drag moves, handles resize (keep aspect with Shift), rotation handle,
  Delete/Backspace, Cmd+A, Cmd+D duplicate (offset 16 world units), arrow keys nudge by 1 (Shift 8,
  the `GRID`), Cmd+] / Cmd+[ z-order. Double-click a text edits it; double-click empty space makes a
  text there (the canvas rule, `Canvas.tsx` L588-595).
- Hand: pan by drag; also Space on any tool.
- Freehand: pointer down starts a draft with `[x, y, pressure]` in world units, pointer move appends
  (coalesced with `getCoalescedEvents` where available), pointer up commits with rounded points,
  bounds computed, `simulatePressure` for `pointerType === 'mouse'`.
- Rect and ellipse: drag from corner, Shift constrains to a square or circle, Alt draws from the
  center. A click without a drag makes a default 160 by 96 shape at the click.
- Line and arrow: drag makes a two-point element; Shift snaps the angle to 15 degrees; a later step
  can add points by double-clicking a segment. Arrow heads are drawn by `paint.ts` from the last
  segment's direction.
- Text: click places a text element and opens the textarea in the overlay at the world position,
  scaled by zoom through `font-size` (the way `TextElementView` sets `fontSize`, L47); Escape or
  blur commits; an empty text deletes itself (L31-34 of `TextElementView`). The textarea gets
  `onKeyDown` `e.stopPropagation()` so the tool chords do not fire.
- After every drawing gesture the tool stays as chosen; a setting or a double-tap to lock is not
  needed for the first version (Excalidraw's lock icon is an open question).
- Cursors: `crosshair` for drawing tools, `grab`/`grabbing` for hand and Space, `text` for text,
  `move` over a selected element, resize cursors on handles.

### Step 7: dock, style popovers, keys (M)

- `apps/client/src/drawing/DrawingDock.tsx`: the same `FLOAT` glass card as `shell/Dock.tsx`
  (L72-73), bottom center, groups separated by `Separator`: tools (icon buttons with
  `data-active`), style (a stroke color swatch button opening a `.menu-popup` with the ten
  swatches as `bg-draw-*` circles, a width menu with three rows, a fill menu, a "Sketchy" toggle),
  zoom (`-`, the percent menu with `ZOOM_PRESETS`, `+`, fit; copied from `Dock.tsx` L113-169), undo
  and redo. `Dock.tsx` L47-50 keeps returning null for a drawing, so the two never overlap.
- Keys (a `useDrawingKeys` hook, bound on `window` while the drawing is on screen and
  `bodyFocused`): Cmd+Z, Cmd+Shift+Z, Cmd+A, Cmd+D, Delete, Escape, arrows, Cmd+0, Shift+1, Shift+2,
  `+`/`-`, Cmd+] and Cmd+[. Tool chords: see open question 2; default to Option plus a letter
  (⌥V select, ⌥H hand, ⌥P pen, ⌥R rect, ⌥O ellipse, ⌥L line, ⌥A arrow, ⌥X text), which
  `Canvas.tsx` L285-287 does not consume while a standalone view is up. Every chord is listed in
  `shortcuts.ts` under "Drawing".
- `apps/client/src/shell/settings/panes/KeyboardPane.tsx` shows it automatically through
  `CANVAS_SHORTCUTS`.

### Step 8: hand-drawn look and polish (S each)

- roughjs with `seed` and `roughness` from the element; `fillStyle: 'hachure'` for `fill: 'hachure'`;
  `disableMultiStroke` and `roughness: 0` for the clean look. Freehand strokes ignore roughness.
- Copy and paste of elements inside the app as `application/x-ruimte-drawing` JSON on the clipboard,
  with new ids and seeds on paste.
- PNG export ("Copy as image" and "Save image" through the desktop bridge) as a later phase.
- `duplicateView` for a drawing: a `drawing.copy { projectId, from, to }` request, or the client
  opens the source, and saves it under the new id with rev 0; decide with open question 7.
- `docs/HANDOFF.md`: a "Drawing view" paragraph under Views and a line in the decisions; `README.md`
  principles line ("A view is also a chat, a terminal, a browser or a drawing on its own");
  `apps/server/README.md` on-disk layout gets `drawings/`.

### Order and checkpoints

1 (contracts) and 2 (daemon) first, together they are testable without a UI. 3 makes the view
exist in the shell. 4 gives it persistence with an empty surface. 5 draws stored elements (a test
file written by hand shows up). 6 is the bulk of the work and can be split per tool with a commit
each. 7 and 8 finish it. Bas tests in the browser (`bun dev`, no Electron needed for any of this).

## 8. Open questions for Bas

1. File layout: `.ruimte/drawings/<viewId>.json` next to `project.json`, committed to git along
   with it? (The design assumes yes; a `.gitignore` inside `.ruimte` is not something the daemon
   writes today.)
2. Tool shortcuts: the decision in HANDOFF (L680-681) says every chord needs a modifier. Excalidraw
   users expect bare letters (V, P, R, O, L, A, T) and digits 1 to 9. Proposal: Option plus a letter,
   listed in the Keyboard pane. Alternative: bare letters only while the drawing has the keyboard
   (no text edit open), as an exception written into the decisions.
3. Where the tools live: a floating dock at the bottom (like the canvas dock, the proposal) or the
   toolbar slot a browser view uses (`ViewToolbar`).
4. Colors: a fixed palette of ten theme-following names (the proposal, no hex in the file) or a
   free color picker with hex values that look the same in both themes.
5. Hand-drawn look: on by default for new elements, or off? Per element (the proposal) with a dock
   toggle, or one switch per drawing?
6. Text font: the interface font (the proposal) or a handwriting face, which would be the first
   non-system font besides the wordmark.
7. Duplicate view for drawings: needed in the first version?
8. Should a drawing also be able to live as a node on a canvas (a `drawing` node kind showing the
   same file), and should an agent be able to read a drawing through `ruimte-context` (as an SVG or
   a list of texts)? Both are out of scope here; the schema does not preclude either.
9. Grid snapping: none (the proposal, sketches do not snap) or the canvas's 8 unit `GRID` behind
   a modifier.
10. Eraser tool and element locking in the first version, or later.
11. Images pasted into a drawing (PLAN phase 20 has `.ruimte/images` for the canvas): later, but
    the element union should get an `image` kind with a path relative to `.ruimte` when it comes.
12. Export: PNG to clipboard and file, SVG, or nothing yet.

## 9. File index for the implementation agent

New:

- `packages/contracts/src/drawing.ts`, `packages/contracts/src/drawing.test.ts`
- `apps/server/src/projects/drawing-store.ts`, `apps/server/src/projects/drawing-store.test.ts`,
  `apps/server/src/handlers/drawing.ts`
- `apps/client/src/state/drawing.ts`, `apps/client/src/state/drawing.test.ts`
- `apps/client/src/drawing/drawing-client.ts`, `drawing-client.test.ts`, `geometry.ts`,
  `geometry.test.ts`, `paint.ts`, `paint.test.ts`, `palette.ts`, `DrawingView.tsx`,
  `DrawingDock.tsx`, `DrawingOverlay.tsx` (selection, handles, marquee, text editor),
  `use-drawing-keys.ts`, `tools/*.ts` (one pure module per tool if the gesture code grows)

Changed:

- `packages/contracts/src/project.ts` (L192-198), `packages/contracts/src/index.ts` (L92-104 exports,
  L110-172 requests, L183-195 events)
- `apps/server/src/projects/project-files.ts` (L91-97 and new helpers),
  `apps/server/src/projects/project-store.ts` (L77-86, L233-249, L307-316, L322-341, L355-357),
  `apps/server/src/daemon.ts` (L91-99, L248-261, L332), `apps/server/README.md`
- `apps/client/package.json` (perfect-freehand, roughjs), `apps/client/src/styles.css` (tokens)
- `apps/client/src/state/document.ts` (L28-65, L71-74, L127-157, L163-179, L328-354, L366-372),
  `apps/client/src/project/views.ts` (L33, L48-58, L70-79), `apps/client/src/project/index.ts`,
  `apps/client/src/project/project-client.ts` (L9-20 and L85-111 for the drawing access)
- `apps/client/src/shell/ViewHost.tsx` (L19-34, L50-56), `ViewMenu.tsx` (L12-17, L23-36, L72-76),
  `Sidebar.tsx` (L55-60, L300-308, L356), `CommandPalette.tsx` (L30-35), `commands.ts` (L99,
  L114-116, L138-140), `Toolbar.tsx` (L60-63), `ProjectBanner.tsx`, `settings/shortcuts.ts`
- `apps/client/src/nodes/node-host.ts` (L44-52), `apps/client/src/terminal/lifecycle-watch.ts`
  (L23-28)
- `docs/HANDOFF.md`, `README.md`, `docs/PLAN.md`

## 10. Decisions by Bas (2026-09-10)

These answers to the open questions in section 8 override the assumptions above. The report in
`docs/reports/2026-09-10-tekenview.html` is the updated design; this section is the delta.

1. Drawings are committed to git with `project.json`. No `.gitignore`.
2. Shortcuts like Excalidraw: bare letters and digits while the drawing has the keyboard and no
   text edit is open (V/1 select, H hand, R/2 rect, D/3 diamond, O/4 ellipse, A/5 arrow, L/6 line,
   P/7 freehand, T/8 text, E/0 eraser, Q tool lock, Cmd+Shift+L element lock). Written into the
   HANDOFF decisions as the exception to "every chord has a modifier".
3. Floating dock at the bottom, in the app's own style.
4. Theme-following palette names, no hex values.
5. Sloppiness like Excalidraw: three levels (0 Architect, 1 Artist, 2 Cartoonist), default 1, per
   element; a style change applies to the selection and becomes the default for new elements. A
   shape, line or text returns the tool to select unless the tool is locked (Q); freehand stays.
6. Text has `font: 'hand' | 'sans' | 'mono'` (default `hand`, may be absent). `sans` is
   `--font-sans`, `mono` is `--font-mono`. A hand-drawn font is bundled through a `@fontsource`
   package (CSP `font-src 'self'`), lazily loaded on the first drawing view. Decided: Kalam
   (Indian Type Foundry, OFL 1.1) through `@fontsource/kalam` 5.3.0, weight 400 only, loaded with
   a dynamic import of `@fontsource/kalam/400.css` plus `document.fonts.load` on the first drawing
   view. Excalifont was considered and rejected: it is Excalidraw's own font (their copyright and
   trademark) and a Ruimte drawing should not look like an Excalidraw one.
7. Duplicate a drawing view: `drawing.copy { projectId, from, to }`, a byte-equal copy at rev 0;
   the client adds the view, flushes the project save, then requests the copy.
8. Both: a `drawing` node kind on the canvas (carries `viewId`, read-only mirror that follows
   `drawing.changed`, opens the view on double-click, "Show on canvas" in the view menus, empty
   state when the view is gone) and a `drawing` context source kind read live by the daemon from
   the `DrawingStore`, served by `GET /context` as a reading-order text list (texts plus arrows as
   "A -> B" lines) and the full SVG.
9. Grid snapping is a setting: `drawingSnap: boolean` in `Settings`, default false, group
   "Drawing" in the settings nav; Cmd while dragging inverts it; freehand never snaps.
10. Eraser and element locking are in the first version (step 6).
11. No images, and no reserved `image` kind.
12. Export PNG and SVG, both to the clipboard and as a download ("Copy as PNG", "Save PNG",
    "Copy as SVG", "Save SVG"); selection if any, else everything; 32 world units margin;
    background toggle. Download through an anchor (works in the browser and in Electron); the
    desktop bridge gets `saveFile(suggestedName, bytes, filters)` for a native save dialog.

Structural consequences: a new workspace package `packages/drawing` holds the pure geometry, the
SVG painter and the reading-order extraction, used by the client (hit tests, export) and the daemon
(context). `strokeStyle` (solid, dashed, dotted) and a `diamond` kind are added to the schema. The
plan grows to ten steps: 8 export and clipboard, 9 the drawing node, 10 agent context.
