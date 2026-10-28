# The canvas

- The one state a person sets is the selection (`apps/client/src/state/canvas.ts`). `bodyFocusId` names the node whose content has the keyboard (`isNodeActive`); a press in a body or on a header hands it over (`frame-press.ts`). A group, or a press that adds to the selection, leaves the keyboard on the canvas. Escape returns it there and keeps the selection. Every node drags, resizes and closes in either state.
- Nodes stack by z-index and are never reordered in the DOM, which would take the keyboard away.
- A connector belongs to the canvas, never a node, and is drawn under the nodes with its ports (`edge-route.ts`, `PortHints.tsx`). A line stops short of its node and routes around nodes, except groups. An end drawn from a port keeps that side (`fromSide`, `toSide`); any other end stays free.
- A node resizes only from handles outside its frame (`resize-handles.ts`), so its content keeps every pixel. A handle shows only near the nearest node, outside every node above it; a selected node's band wins.
- A line's look says its purpose (`edge-look.ts`): a context line is accent with a dot at the reading end, an origin line thin, dashed and underneath, a target line neutral with its point at the worked node. A line between an agent and a page or device is always a target line pointing at the page or device.
