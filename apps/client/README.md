# @ruimte/client

The React UI. It never touches a Node or Bun API and reaches the daemon only through the `Transport` interface.

## Workspace and tabs

`WorkspaceShell`, `SplitGrid` and `TabStrip` adapt the shared ADE CORE workspace, split view
and document tabs. A cell can show a single view or a tab host; the active view and ordered
tabs are stored in the client's local layout. Opening an already placed view activates it.
A focused tab host takes new views beside its active tab; Open in New Tab also turns a
single-view cell into a host. Moving a tab moves its view without recreating its session.

Files, diffs and database tabs can be loose views without a sidebar row. A database table
or structure can also be a saved view. Sharing a database view requires a shared connection;
a missing connection has its own empty state. Tab attention reflects chat and terminal
attention, and unsaved editor or database work keeps its view mounted. The application
adapters own drag policy, native view bounds and persistence.

## Canvas interaction

Option/Alt exposes gap handles for neighboring nodes and rows or columns. Equal gaps can
move together; one drag is one undo step, and Escape restores the starting positions.
Selection keeps its canvas anchor while scrolling. Connector paths are drawn before their
labels so crossing lines cannot cover a label or its editor.

Alt+Arrow selects a neighboring node while the canvas owns the keyboard; Enter gives that
node input focus. Mod+Shift+2 fits the focused node in view. Explicit Space or middle-button
panning keeps wheel input with the canvas over focused node bodies and browser guests.
Text entry retains its own keys. Geometry and input ownership are covered by the canvas
unit tests and `canvas-interaction.integration.test.ts`.

## Model comparison

The models dialog (`src/shell/models`) shares model, provider, legacy and reasoning filters
across its score/cost comparison, speed chart and grouped or ranked bar charts. Metrics
include Intelligence, Coding and Agentic indices, cost per task, total benchmark cost and
output speed. A selected reference and comparison point keep their model/effort identity
across view changes; filtering either point updates the comparison explicitly.

The Pulsar worker stores partial measurements independently and reports the Intelligence
Index version. Older clients can still read the original score/cost payload. Missing data
is not replaced with zero. The dialog shows source attribution and snapshot age; benchmark
costs describe benchmark tasks rather than a predicted Ruimte session cost. The client
comparison tests and worker benchmark tests cover filtering, point selection and partial data.

## Code editor

The editor lives in ADE CORE: `@adecore/editor-core` owns the document and editing commands,
`@adecore/editor` owns the view and `EditorEngine`, and `@adecore/editor-react` supplies the
React integration and shared language models. Ruimte owns the language adapters in
`src/language`, the AI actions in `src/editor-ai` and the machine's on-device client in
`src/ondevice`. Monaco has been removed.

The client reaches language servers through the daemon's transport. `@adecore/lsp` and
`apps/server/src/language` own their processes and document versions. Installation, custom
commands, server selection and restart behavior are documented in the
[daemon README](../server/README.md#language-servers).

`RUIMTE_EDITOR_KEYMAP` in `src/shell/editor-keymap.ts` supplies editor shortcuts and the keys
printed in menus, the palette and settings. `editor-keymap.test.ts` checks collisions with
application shortcuts. Reformat keeps Option+Cmd+L; selection to chat uses Option+Cmd+K
(Ctrl+Alt+K elsewhere). Code colors live in `src/shell/panels/code-themes.ts`, with contrast
checks in `code-themes.test.ts`. Editor settings hold General, Smart keys, Language servers
and AI; the code font stays under Appearance because terminals share it.

Code vision in `@adecore/editor-react` shows usages from language-server references and
authors from `git.blame`, mapped onto unsaved text. Uncommitted lines have no attributed
author. Clicking a usage count opens references; clicking authors opens their contribution
card. The two features have separate settings.

### Language edits

Workspace edits normally become unsaved drafts. Every edit is checked against its target
text before applying it. An edit that also moves a file saves the affected files and moves
them through the machine in the edit's order. Files-panel moves ask the daemon for
`workspace/willRenameFiles` edits before moving, then send `workspace/didRenameFiles`.
Tabs and remembered editor state follow the new path. Refactor lists group Extract, Inline
and Move actions; a server refusal stays visible in the list.

### AI actions

Selection to chat adds code to a linked chat's draft. Inline edit (Mod+I) starts a hidden
project chat and shows a replacement proposal. Apply checks that the tracked selection
still contains the original text and makes one undo step. Stop cancels the turn; Open as
chat exposes the conversation. The daemon owns the chat, and the client keeps its per-file
record across reloads for seven days.

Agent changes have Off, Gutter and Review modes. The daemon records provenance from tool
edits and turn checkpoints; checkpoint-only attribution is shown as uncertain. The client
maps those runs onto unsaved text. Review offers Keep, Undo and Comment; comments and undo
messages become chat drafts. Two editors of the same file share review state. Provenance
ends when its lines change, are committed, the file is removed or the record reaches thirty
days.

When disk changes overlap an unsaved draft, the editor compares the original, draft and
incoming text. Non-overlapping changes merge as one undo step; overlapping changes offer
Keep yours, Keep theirs and Keep both. Autosave waits until every conflict is answered,
and the next save still checks the disk version.

Explain, rename suggestions and ghost text use Apple Foundation Models on the daemon's
Mac. Requests carry no tools and change no files. Ghost text runs on request rather than
while typing; Tab accepts it, Option+] accepts a word and Escape dismisses it. Settings
show why the model is unavailable. The [daemon's on-device documentation](../server/README.md#on-device-help-for-the-editor)
describes the helper and transport.

Remaining acceptance, formatter choices and feature limits are in
[NEXT.md](../../docs/NEXT.md#14-editor-and-language-servers). Shared editor behavior belongs
in ADE CORE's package documentation.

## Icons

Icons are Lucide, drawn by the `Icon` component of `@adecore/ui`, which is where the pixel box and the stroke weight are decided. Brand marks for the agent CLIs come from simple-icons (`src/agents/AgentIcon.tsx`).
