# Browser nodes

The page in the desktop app: `apps/client/src/browser/CLAUDE.md`. The verb: `apps/server/src/canvas/browser-verb.ts`.

- A browser node's page lives where it is shown: a `<webview>` in the desktop client, or a page on the daemon for a client without a browser. The daemon reaches the first kind only while that client holds it (`browser.hold`, `browser.drive`) and drives both through one door (`drive.ts`). Nobody holding the page is an answer, never an error.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A browser node is driven only over a line to the agent, and only by address: where the page goes, its history and a picture of it (`ruimte-context browser`), never a click, keystroke or scroll. The one exception to the line is a chat view, which drives any browser node of the canvas it names with `--view` (`src/canvas/chat-view.ts`).
