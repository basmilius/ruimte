# @ruimte/client

The React UI. It never touches a Node or Bun API and reaches the daemon only through the `Transport` interface. How it hosts the ADE CORE packages (`UIProvider`, `TerminalView`, the chat host, the database panel, the editor adapters) is in the root `CLAUDE.md`.

## Workspace and tabs

`WorkspaceShell`, `SplitGrid` and `TabStrip` adapt ADE CORE's workspace, split view and document tabs. A cell shows one view or a tab host, and the client's local layout stores the active view and tab order. Opening a view that is already placed activates it. A focused tab host takes new views beside its active tab, and Open in New Tab turns a single-view cell into a host. Moving a tab keeps its session.

File, diff and database tabs can be loose views without a sidebar row. A database table or structure can also be a saved view. Sharing a database view requires a shared connection. A tab shows the attention of its chat or terminal, and unsaved editor or database work keeps its view mounted.

## Canvas interaction

- Option/Alt shows gap handles between neighboring nodes, rows and columns. Equal gaps move together, one drag is one undo step, and Escape restores the start.
- Alt+Arrow selects a neighboring node while the canvas owns the keyboard. Enter gives it input focus.
- Mod+Shift+2 fits the focused node in view.
- Space or middle-button panning keeps the wheel with the canvas over node bodies and browser guests. Text entry keeps its own keys.

Selection keeps its canvas anchor while scrolling. Connector paths draw before their labels, so a line never covers a label.

## Terminal links

Hovering an HTTP/HTTPS link shows its target in a tooltip. Cmd+click opens it on macOS, Ctrl+click elsewhere. A plain click focuses the terminal and a drag selects text. Wrapped URLs and OSC 8 hyperlinks keep their full target.

Settings > Terminal picks the external browser (the default) or Ruimte. Inside Ruimte, a canvas terminal opens a browser node beside itself, and a standalone terminal opens a browser view. Without a project on the terminal's machine, links open externally.

A localhost, loopback or bind address belongs to the terminal's machine. Only a terminal on the desktop's local machine opens one. Any other terminal explains that Ruimte does not forward remote ports, and never opens the link on the client computer. File paths and file-scheme links do not take this route.

On macOS, a live terminal shows a `:port` badge in its toolbar for each TCP listener its process tree owns. A click checks the listener again, within five seconds, and opens a linked browser node beside the terminal (a browser view for a standalone terminal). It opens HTTP on verified loopback listeners only and never guesses HTTPS. A late reply is ignored. A failed scan reads as unknown, and a closed session, a hidden window or an older daemon stops polling. Remote and web clients say why the port cannot open.

A session browser saves its owning machine with the URL. Reopening, navigating and creating one require that owner to be the proven local daemon, so another desktop never opens its own localhost, even for a copied project.

## Model comparison

The models dialog (`src/shell/models`) shares one set of model, provider, legacy and reasoning filters across its score/cost comparison, speed chart and bar charts. Metrics are the Intelligence, Coding and Agentic indices, cost per task, total benchmark cost and output speed. A selected reference and comparison point keep their model and effort across views.

Missing data stays missing and never becomes zero. The dialog shows the source and age of the snapshot. Benchmark costs describe benchmark tasks, not a Ruimte session.

## Code editor

The editor lives in ADE CORE (`@adecore/editor-core`, `@adecore/editor`, `@adecore/editor-react`). Ruimte owns the language adapters in `src/language`, the AI actions in `src/editor-ai` and the on-device client in `src/ondevice`. Language servers run behind the daemon; see the [daemon README](../server/README.md#language-servers).

`RUIMTE_EDITOR_KEYMAP` in `src/shell/editor-keymap.ts` holds editor shortcuts and the keys shown in menus, the palette and settings. `editor-keymap.test.ts` checks collisions with application shortcuts. Reformat is Option+Cmd+L; selection to chat is Option+Cmd+K (Ctrl+Alt+K elsewhere). Code colors live in `src/shell/panels/code-themes.ts`, with contrast checks in `code-themes.test.ts`. The code font sits under Appearance because terminals share it.

Code vision shows usages from language-server references and authors from `git.blame`, mapped onto unsaved text. Uncommitted lines have no author. Each has its own setting.

### Language edits

A workspace edit becomes an unsaved draft, checked against its target text before it applies. An edit that moves a file saves the affected files and moves them through the machine in order. A move in the Files panel asks the daemon for `workspace/willRenameFiles` edits first, then sends `workspace/didRenameFiles`. Tabs and editor state follow the new path. A server refusal stays visible in the refactor list.

### AI actions

Selection to chat adds code to a linked chat's draft. Inline edit (Mod+I) starts a hidden project chat and shows a proposal. Apply checks that the tracked selection still holds the original text, as one undo step. The daemon owns the chat. The client keeps its per-file record for seven days.

Agent changes have Off, Gutter and Review modes. The daemon records provenance from tool edits and turn checkpoints, and checkpoint-only attribution shows as uncertain. Review offers Keep, Undo and Comment; comments and undo messages become chat drafts. Provenance ends when its lines change or are committed, the file is removed, or after thirty days.

When disk changes overlap an unsaved draft, the editor compares original, draft and incoming text. Non-overlapping changes merge as one undo step. Overlapping ones offer Keep yours, Keep theirs and Keep both, and autosave waits until each is answered.

Explain, rename suggestions and ghost text use Apple Foundation Models on the daemon's Mac, with no tools and no file changes. Ghost text runs on request: Tab accepts, Option+] accepts a word, Escape dismisses. Settings say why the model is unavailable. See the [daemon's on-device documentation](../server/README.md#on-device-help-for-the-editor).

Open acceptance and limits are in [NEXT.md](../../docs/NEXT.md#15-language-servers).

## Icons

Icons are Lucide through the `Icon` component of `@adecore/ui`, which sets the pixel box and stroke. Brand marks for the agent CLIs come from simple-icons (`src/chat/host.ts`).

## Crash reports

A release build of the desktop app and the station always reports the page's errors, and nothing else (`src/telemetry`). `vite.config.ts` stamps the version in only when CI builds a release or deploys the station (`RUIMTE_TELEMETRY=1`), so dev, tests and local builds send nothing. A release build on any other page stays silent too. A report goes out for:

- an error or rejection nothing caught
- an error an `ErrorBoundary` caught (React's `onCaughtError`), except the fallbacks inside a chat
- a machine link that drops while open, with its close code, local or remote, socket or direct
- a request without an answer within 60 seconds, by type
- a machine refused at the protocol check, with how the versions differ

The SDK loads with the first report. Every report goes through the scrubber of `@ruimte/telemetry`, which also removes the names and folders of listed projects. The same error goes out once a day (`ruimte.telemetry.sent` in local storage). No breadcrumbs, tracing, sessions, replays, or the page's address.
