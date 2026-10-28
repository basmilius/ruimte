# Browser pages

Where a page lives and how an agent drives it: `apps/server/src/browser/CLAUDE.md`.

- Electron destroys a `<webview>` guest when the element or an ancestor changes parent, so every page is parked in one layer over the canvas (`WebviewParking.tsx`), cells draw over it through `apps/client/src/shell/CellOverlay.tsx`, and a page cuts holes for the nodes on top of it (`page-clip.ts`).
- Render distance only hides a page (`visibility: hidden`) while its node shows the last picture (`page-distance.ts`, `BrowserPlate.tsx`). Never `suspend`, `destroy`, `remove`, reparent, `ensure()` or set a new `src` for distance. Only the layer writes `far`.
- Chromium never captures a hidden guest, so a far page is redrawn transparently for its picture (`revealing`); anything else hidden fails rather than hangs.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A page on a canvas has a render distance (Settings, Views, Canvas). Past it the page keeps running out of sight and its node shows its last picture. The page with the keyboard stays live. **Unlimited** draws every page live at every zoom.
- A page in a `<webview>` does not pinch-zoom, since Chromium scales only the top-most widget. A `WebContentsView` per page and `setZoomFactor` were weighed and rejected.
