# Browser pages

Where a page lives and how an agent drives it: `apps/server/src/browser/CLAUDE.md`.

- A page is an Electron `<webview>`. Electron destroys the guest when the element or any ancestor changes parent, a state-preserving `moveBefore` included. So every page is parked in one layer over the canvas (`WebviewParking.tsx`). What a cell draws over a page is portaled into the layer above it (`apps/client/src/shell/CellOverlay.tsx`). A page cuts a hole for every node on top of it, so the canvas shows through and the page keeps running (`page-clip.ts`).
- Render distance only hides a page. Past it the parking layer sets the host to `visibility: hidden`, as for a folded node, and the node draws the page's last picture (`page-distance.ts`, `page-snapshots.ts`, `BrowserPlate.tsx`). Never `suspend`, `destroy`, `remove`, reparent, `ensure()` or set a new `src` for distance. Only the layer writes `far`; the plate reads it.
- Chromium never answers `capturePage` for a hidden guest, `stayHidden` or not, so `browserRegistry.capture` gives up after a few seconds. A far page is photographed by drawing it again, transparent, while the shell takes the picture (`revealing`). A picture of anything else hidden (a folded node, a background tab) fails rather than hangs.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A page on a canvas has a render distance (Settings, Views, Canvas). Past it the page keeps running out of sight and its node shows its last picture. The page with the keyboard stays live, so zooming out while filling in a form loses nothing. **Unlimited** draws every page live at every zoom.
- A page in a `<webview>` does not pinch-zoom, since Chromium scales only the top-most widget. A `WebContentsView` per page and `setZoomFactor` were weighed and rejected.
