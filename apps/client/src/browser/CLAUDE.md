# Browser pages

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere; `apps/server/src/browser/CLAUDE.md` has where a page lives and how an agent drives it.

- A browser page is an Electron `<webview>`, and Electron destroys the guest whenever the element or anything above it changes parent, a state-preserving `moveBefore` included. So every page is parked in one layer over the canvas (`WebviewParking.tsx`), whatever a cell draws over a page is portaled into the layer above it (`apps/client/src/shell/CellOverlay.tsx`), and a page cuts a hole out of itself for every node standing on top of it, so the canvas under the layer shows through and the page keeps running (`page-clip.ts`).
- The render distance only hides a page: past it the parking layer sets its host to `visibility: hidden`, the way it hides a folded node, and the node draws the last picture of the page (`page-distance.ts`, `page-snapshots.ts`, `BrowserPlate.tsx`). Never `suspend`, `destroy`, `remove`, a change of parent, `ensure()` or a new `src` for distance. Only the layer writes `far`; the plate reads it.
- Chromium never answers `capturePage` for a hidden guest, with or without `stayHidden`, so `browserRegistry.capture` gives up after a few seconds. A far page is photographed by drawing it again, transparent, for the moment the shell takes the picture (`revealing`); a picture of anything else hidden (a folded node, a background tab) fails rather than hangs.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A page on a canvas has a render distance (Settings, Views, Canvas): past it the page keeps running out of sight and its node shows the last picture of it. The page that has the keyboard stays live, so zooming out while filling in a form loses nothing. **Unlimited** draws every page live at every zoom, as before.
- A page in a `<webview>` does not pinch-zoom, since Chromium scales only the top-most widget. A `WebContentsView` per page and `setZoomFactor` were weighed and rejected.
