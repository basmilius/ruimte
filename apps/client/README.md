# @ruimte/client

The React UI. It never touches a Node or Bun API and reaches the daemon only through the `Transport` interface.

## Workspace and tabs

`WorkspaceShell`, `SplitGrid` and `TabStrip` adapt the shared ADE CORE workspace, split view
and document tabs. A cell shows a single view or a tab host; the client's local layout stores the
active view and the tab order. Opening a view that is already placed activates it.
A focused tab host takes new views beside its active tab; Open in New Tab also turns a
single-view cell into a host. Moving a tab moves its view without recreating its session.

File, diff and database tabs can be loose views without a sidebar row. A database table
or structure can also be a saved view. Sharing a database view requires a shared connection,
and a missing connection has its own empty state. A tab shows the attention of its chat or
terminal, and unsaved editor or database work keeps its view mounted. The application
adapters own drag policy, native view bounds and persistence.

## Canvas interaction

Holding Option/Alt shows gap handles between neighboring nodes and between rows or columns.
Equal gaps can move together; one drag is one undo step, and Escape restores the starting positions.
Selection keeps its canvas anchor while scrolling. Connector paths are drawn before their
labels so crossing lines cannot cover a label or its editor.

Alt+Arrow selects a neighboring node while the canvas owns the keyboard; Enter gives that
node input focus. Mod+Shift+2 fits the focused node in view. Explicit Space or middle-button
panning keeps wheel input with the canvas over focused node bodies and browser guests.
Text entry keeps its own keys. The canvas unit tests and
`canvas-interaction.browser.integration.test.ts` in the manual browser suite cover geometry and
input ownership.

## Terminal links

Hovering an HTTP/HTTPS link shows its target and how to open it in a tooltip, centered above or
below the hovered line of the link. Cmd+click opens it on macOS, Ctrl+click on other platforms. A
plain click focuses the terminal, and dragging selects text. Wrapped URLs and OSC 8 web hyperlinks
keep their complete target.

Settings → Terminal chooses between the external browser (the default) and Ruimte. Externally, the
desktop uses the system browser through its bridge and the web client opens a new tab. Inside
Ruimte, a canvas terminal opens a browser node beside itself on the same canvas, and a standalone
terminal opens a new browser view. Without a project on the terminal's machine, links open
externally.

A localhost, loopback or bind address belongs to the terminal's machine. Only a terminal on the
desktop's local machine opens these addresses. Any other terminal explains that Ruimte does not
forward remote ports, and never opens the link against the client computer. Plain file paths and
file-scheme links do not take this route.

On macOS, a live terminal shows a compact `:port` badge in its toolbar for each TCP listener its
process tree owns, in a canvas node and in a standalone terminal view alike. A click checks the
listener again and creates a linked browser node beside that terminal on its own canvas; a
standalone terminal opens a browser view. A failed scan reads as unknown, a closed session stops
polling, and a late reply cannot open a browser. A hidden window pauses discovery. Remote and web
clients say why these ports cannot open in their local browser.

This route does not forward ports or guess HTTPS; it opens HTTP on verified loopback listeners.
The check has a five-second deadline from the click. A later reply is ignored, and a new click
checks the port again. An older daemon that does not know the request counts as unavailable and
stops polling. A session browser saves the machine that owns it with the URL, also when it moves
between a canvas node and a standalone view. Reopening, navigating and creating one require that
owner to be the proven local daemon. Another desktop shows an unavailable message instead of
opening its own localhost, even when the project was copied there.

## Model comparison

The models dialog (`src/shell/models`) shares one set of model, provider, legacy and reasoning
filters across its score/cost comparison, speed chart and grouped or ranked bar charts. The
metrics are the Intelligence, Coding and Agentic indices, cost per task, total benchmark cost and
output speed. A selected reference and comparison point keep their model and effort across view
changes; filtering either point updates the comparison explicitly.

The Pulsar worker stores each partial measurement on its own and reports the Intelligence
Index version. Older clients can still read the original score/cost payload. Missing data
stays missing and never becomes zero. The dialog shows the source and the age of the snapshot;
benchmark costs describe benchmark tasks, not a predicted cost for a Ruimte session. The client
comparison tests and worker benchmark tests cover filtering, point selection and partial data.

## Code editor

The editor lives in ADE CORE: `@adecore/editor-core` owns the document and editing commands,
`@adecore/editor` owns the view and `EditorEngine`, and `@adecore/editor-react` supplies the
React integration and shared language models. Ruimte owns the language adapters in
`src/language`, the AI actions in `src/editor-ai` and the machine's on-device client in
`src/ondevice`. Monaco has been removed.

The client reaches language servers through the daemon's transport. `@adecore/lsp` and
`apps/server/src/language` own their processes and document versions. The
[daemon README](../server/README.md#language-servers) covers installation, custom commands,
server selection and restarts.

`RUIMTE_EDITOR_KEYMAP` in `src/shell/editor-keymap.ts` supplies editor shortcuts and the keys
printed in menus, the palette and settings. `editor-keymap.test.ts` checks collisions with
application shortcuts. Reformat keeps Option+Cmd+L; selection to chat uses Option+Cmd+K
(Ctrl+Alt+K elsewhere). Code colors live in `src/shell/panels/code-themes.ts`, with contrast
checks in `code-themes.test.ts`. Editor settings hold General, Smart keys, Language servers
and AI; the code font stays under Appearance because terminals share it.

Code vision in `@adecore/editor-react` shows usages from language-server references and
authors from `git.blame`, mapped onto unsaved text. Uncommitted lines have no author. Clicking a
usage count opens the references; clicking the authors opens their contribution card. Each of
the two has its own setting.

### Language edits

A workspace edit normally becomes an unsaved draft. The editor checks every edit against its
target text before applying it. An edit that also moves a file saves the affected files and moves
them through the machine in the edit's order. A move in the Files panel asks the daemon for
`workspace/willRenameFiles` edits first, then sends `workspace/didRenameFiles`.
Tabs and remembered editor state follow the new path. Refactor lists group Extract, Inline
and Move actions; a server refusal stays visible in the list.

### AI actions

Selection to chat adds code to a linked chat's draft. Inline edit (Mod+I) starts a hidden
project chat and shows a replacement proposal. Apply checks that the tracked selection
still contains the original text and makes one undo step. Stop cancels the turn; Open as
chat shows the conversation. The daemon owns the chat, and the client keeps its per-file
record across reloads for seven days.

Agent changes have Off, Gutter and Review modes. The daemon records provenance from tool
edits and turn checkpoints; attribution from a checkpoint alone shows as uncertain. The client
maps those runs onto unsaved text. Review offers Keep, Undo and Comment, and comments and undo
messages become chat drafts. Two editors of the same file share review state. Provenance ends
when its lines change or are committed, when the file is removed, or after thirty days.

When disk changes overlap an unsaved draft, the editor compares the original, draft and
incoming text. Non-overlapping changes merge as one undo step; overlapping changes offer
Keep yours, Keep theirs and Keep both. Autosave waits until every conflict is answered,
and the next save still checks the disk version.

Explain, rename suggestions and ghost text use Apple Foundation Models on the daemon's
Mac. A request carries no tools and changes no files. Ghost text runs on request, not while
typing; Tab accepts it, Option+] accepts a word and Escape dismisses it. Settings say why the
model is unavailable when it is. The [daemon's on-device documentation](../server/README.md#on-device-help-for-the-editor)
describes the helper and transport.

Remaining acceptance, formatter choices and feature limits are in
[NEXT.md](../../docs/NEXT.md#14-editor-and-language-servers). Shared editor behavior belongs
in ADE CORE's package documentation.

## Icons

Icons are Lucide, drawn by the `Icon` component of `@adecore/ui`, which is where the pixel box and the stroke weight are decided. Brand marks for the agent CLIs come from simple-icons (`src/agents/AgentIcon.tsx`).
