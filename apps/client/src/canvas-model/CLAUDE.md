# Canvas model

Geometry and camera rules of the canvas that the stores and the canvas both use. Nothing here imports a store or a component, so `state` can build on it.

- `useCanvas` does not hear a change that only moved the camera, since a pan or a zoom moves it every frame and a canvas has hundreds of selectors. A selector that reads `camera`, or a helper that does (`farNodeKey`, `visibleRect`), goes through `useCanvasCamera`. A subscriber that never reads the camera skips such a change with `onlyCameraMoved` (`camera-slice.ts`).
