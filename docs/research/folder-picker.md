# Folder picker: research and design

State of `main` on 2026-09-11, at `fe7427b`. Every path is relative to
`/Users/bas/Development/Projects/ruimte`.

This document has been rewritten twice. The first version proposed a folder picker of its own, a
dialog with a shortcut rail, and that shipped in three commits. Bas saw it and said it looks nothing
like the rest of the app: picking already happens in the palette, so the folder picker goes there, and it should work the
same way. The rail and its recent folders are gone. What follows is a mirror of their browse mode
inside our palette, deviating only where their design collides with something that is genuinely
different here, and saying so each time it does.

The second rewrite is smaller and is about one sentence that was wrong. The version built from it
kept browse mode as a pure function of the query, which meant the only way to open it was to put a
path in the field, so the command had to type `~/` for you. Bas: "Ik wil niet eerst ~/ invullen of
iets." Nor should anyone have to, and the reason is 1.1: the browser is a **pushed step**
with a view stack behind it, and the query only decides whether that step lists folders. So browse
mode is a step of ours too (3.0), and everything that hung on the query being the mode follows from
it: the command opens browsing with nothing typed, Backspace on an empty field has something to step
back from, and the machine step can be the thing browsing opens on.

Three commits stay and three come out; section 4.1 names them. Sections 1 and 2 are description and
were only extended. Sections 3 and 4 are new.

One warning about line numbers: `CommandPalette.tsx`, `ProjectMenu.tsx` and `state/project.ts` moved
a lot while this was written, and the three commits that come out move them again. Grep for the
symbol rather than trusting the number.

## 0. Summary of the recommendation

- **No dialog of its own.** Folder browsing is a mode of the command palette, the way every other pick in the app is,
  and the way it was here before `58021c5`. The rail, the recent folders and the breadcrumb are
  gone.
- Browse mode is a **step the palette is on**, not something the query says. "Open a folder as a
  project" and "Open folder" in the project menu put it on that step with nothing typed, and a path
  typed into the ordinary palette is the second way in. The project menu stops opening a native
  dialog of its own.
- The list is one group of folders, `..` first inside it, each row an icon and a name. The submit
  button moves out of the footer and into the right end of the input field, carrying its label and
  one key chip, and the footer becomes key hints plus one slot on the right.
- A path that is not there flips that button to "Create and open" and creates the whole missing
  chain, which is reachable here: in a browser that only lists entries that message is dead code,
  because they cannot tell a missing folder from an empty one and we can.
- **Machines.** With one machine known, browsing opens on that machine's folders and the machines
  are never asked about, since there is nothing to choose. With more than one it
  opens on a Machines step, and picking one lands in its folders. The input's leading slot is the
  way one step back and, on the folders of a machine, carries that machine's dot and label. Switching
  machines resets the path to that machine's start folder. A machine that is not connected is still
  selectable and gets dialed, because our sockets are lazy where theirs are long-lived.
- Every list opens with a row highlighted, the folders included, so the keyboard walks down without
  a keystroke to start it. Enter steps into the highlight and Cmd+Enter opens what is in the field,
  which is the one deliberate choice here (3.5).
- **Where it starts.** In a folder set under Files in settings, one for every machine, and otherwise
  in the home of the machine being browsed. Never in the folder of the open project: that one is on
  one machine and is already open. A folder that is not on the machine being browsed falls back to
  its home, which `fs.browse` answering `exists` is what makes possible.
- The native Electron dialog is a button in the footer's right slot, shown only in the desktop build
  and only when the machine being browsed is the daemon that served the page.
- Three commits come out (`58021c5`, `fc9ef57`, `fe7427b`) and three stay (`91d3fa1`, `f549b05`,
  `53205f3`). The daemon and the contracts are already done and need nothing. Section 4 is the plan.

## 1. Browsing inside a command palette

Studied
(2026-09-10). Behavior and layout only;
no code from it is in this document or belongs in Ruimte.

### 1.1 There is no folder picker

A folder picker needs no component of its own. Folder picking is a **mode of the command palette**, a centered
modal, reached through an "Add project" row. Their palette is around 2760 lines and carries the
whole flow. So the thing Bas wants to get away from is a palette that carries everything, which is worth saying
plainly: this proposal is not catching up with them.

The flow after "Add project" is a small wizard inside the palette:

1. **Which machine**, shown only when more than one environment exists. One row per machine with a
   machine icon and a label ("This device", or the environment id, or a connection status).
   A machine that is not connected renders grayed and unclickable.
2. **Which source** (`CommandPalette.tsx:1385-1450`). First row: "Local folder", described as
   "Browse a folder on disk", which goes to step 3. Then "Git URL", described as "Clone from a
   remote URL". Then one row per git provider, reading "GitHub repository" and "Clone GitHub
   owner/repo". A provider that is not configured stays in the list as a disabled row carrying a
   "Setup Required" button that opens the source control settings. **Every git row here is about
   cloning a remote repository. None of them is about finding a repository already on disk.**
3. **Browse**, where the palette's input becomes the path field.

A provider row leads to a "repository" step where the input becomes a plain text field: you type
`owner/repo` or paste a clone URL and press Enter, which looks that up against the provider's API
(`CommandPalette.tsx:2113-2135`). It is not a browsable list of your repositories and there is no
request that lists them; a name that does not resolve is a toast, "Repository lookup failed". After
the lookup comes a destination step, which is the same folder browser again with its group header
changed to "Select where to clone" (L2283) and the repository's folder name pinned onto whatever
folder you browse to, so the target reads `<chosen folder>/<repo>` (L935-945).

Both the browser and the clone destination start in the directory named by the environment's
`addProjectBaseDirectory` server setting, or `~/` when that is empty (L952-965).

Other ways in, all landing in the same dialog: the sidebar, an empty state ("What should we work on
?"), a pull request empty state, a chat headline, a shortcut row that jumps straight to a connected
WSL machine, and typing an absolute-looking path into the palette root, which skips the wizard. No
Electron application menu item. Mobile is a separate screen with a path field and a browse list
under it.

**Step 1 in detail** (`CommandPalette.tsx:855-882`, `1515-1574`). It is shown when the catalog holds
more than one environment, or when no connected one can be picked by default, and **skipped when
exactly one environment exists and it is connected**, which is the ordinary case. The group is
labeled "Environments". A row is the two-line shape: a machine-kind icon (a server, a cloud, a
laptop, a Linux mark, a Mac mini glyph), the environment's label as the title, and a subtitle that
is the words "This device" for the primary one, the environment id for a connected remote, or the
connection's own status for anything else ("Available", "Offline", "Connecting...",
"Reconnecting...", "Connection failed"). A machine that is not connected is **disabled**: dimmed to
64 per cent and unclickable. The order is the primary machine first, then alphabetical by label.

**Step 2 in detail** (`CommandPalette.tsx:1385-1477`). Group label "Sources", order: "Local folder",
then "Git URL", then the providers with the ready ones first and alphabetical within that. Each is
the two-line shape. The "Setup Required" affordance is a trailing pill on a disabled row, 20 px
high, in the warning color, with a tooltip carrying the reason and a click that closes the palette
and goes to the source control settings.

**Going back** (`CommandPalette.tsx:1315-1332`, `2433-2436`, `2689-2703`). Three ways into the same
pop: the back arrow that takes over the input's leading slot in any pushed step, Backspace on an
empty field, and simply deleting the path until the field is empty, which pops on its own. Popping
clears the query and the clone flow, and popping the last step forgets the chosen machine. There is
no title anywhere in the palette, so the only thing that says which step you are in is the
placeholder and the leading icon. **While browsing, nothing says which machine you chose.**

### 1.2 Navigating

The input is the path field; there is no second box and no breadcrumb bar.

- Browse mode turns on when the query starts with `/`, `~/`, `./` or `../`, plus `.\`, `..\`, a
  drive letter and a UNC share when the **target machine** reports Windows. The test uses the target
  machine's platform, not the browser's.
- Typing filters live: the text after the last separator is a prefix filter over the current
  directory. A trailing separator means "list this directory", no trailing separator means "list the
  parent and filter it".
- Clicking a row appends the name and a separator and re-lists; rows are marked so a click never
  closes the dialog.
- Up and Down move the highlight, but auto-highlight is **off** while browsing, so nothing is
  preselected and Enter means "use what I typed". Enter on a highlighted row descends into it.
  Cmd+Enter commits while a row is highlighted, and the submit button's key hint flips between the
  two.
- Up a level is a synthetic `..` first row with a corner-up-left icon, shown only when the current
  path has a parent. There is no separate up button.
- Backspace on an empty query pops one wizard level; a back arrow sits in the input's start slot.
  Escape closes.
- No Tab completion anywhere in their code.
- A generation counter holds the query text back until the new directory's listing has arrived, so
  the list never flashes stale contents. The visible cost is a pause between the click and the path
  changing.
- One flat list. No Miller columns, no tree.
- Escape closes the whole dialog from browse mode; it does not step back a level. The footer says
  "Esc Close" in every state.
- Entering browse mode is a pure function of the text: no mode flag, no explicit switch. The instant
  the field starts with a path, the leading icon and the placeholder swap, the submit button appears,
  auto-highlight turns off so no row is preselected, and the content remounts and re-focuses the
  field.
- Every navigation prefetches before it commits: choosing "Local folder", stepping into a folder and
  stepping up all fetch the target directory first and only then change the text in the field, with
  a generation counter dropping a stale answer. The list and the path therefore change together and
  there is never an empty flash.

### 1.3 What a row shows

A folder icon and the bare name. That is the whole row.

Absent: recents, favorites, a Home row, drive enumeration, a git badge, an "already a project" mark,
counts, dates. Files are never listed, because the server returns directories only. Hidden folders
have no toggle: the server sends dot-directories when the path ends in a separator and the client
hides them again unless the typed filter starts with a dot. Sorting is a plain name compare on the
server. The group header reads "Directories".

Projects that already exist do appear in the palette, but in a different group, as fuzzy search over
known projects with a machine icon, a machine label and the workspace root underneath. That group is
not part of the folder browser.

**Git repositories specifically.** A folder that is a git repository looks like every other folder.
There is no badge, no separate group, no sorting that favors them. The contract settles it: a browse
entry is `{ name, fullPath }` and nothing else (`packages/contracts/src/filesystem.ts:12-15`), so
the backend never stats a `.git` while listing, and nothing anywhere walks a tree looking for
repositories. The backend lists exactly one directory per request. The only place in the product
that knows about repositories on disk is the onboarding scan (1.8), and it reads the agent CLIs'
histories rather than the file system.

### 1.4 A path that does not exist

This is the part worth borrowing, so here it is in full, checked rather than remembered.

**When the offer appears** (`CommandPalette.tsx:2318-2332`). Five conditions, all at once: the
palette is browsing, the machine can create a project and a relative path has a project to resolve
against, the browse request has settled, the query is not empty, and no row is highlighted. Then one
of two tests, depending on the query:

- the query ends in a separator: no listing came back at all for it;
- the query does not end in a separator: no entry in the listing has a name **exactly** equal to the
  typed last segment (a case-sensitive compare, `filterFilesystemBrowseEntries` in
  `packages/client-runtime/src/state/filesystem.ts:32-46`).

The second test has a sharp edge worth naming: typing `~/pro` while `~/projects` exists satisfies it,
because `pro` is a prefix and not an exact name. So the button offers to create `~/pro`, next to a
list showing `projects`. They accept that; anyone copying the rule inherits it.

**What it looks like.** The submit button's label flips from "Add" to "Create & Add" (and in the
clone flow from "Clone" to "Create & Clone"), and the empty list area reads "Press Enter to create
this folder and add it as a project" (L2752). The button is never disabled because a path does not
exist. It is disabled only for a machine that is not connected, for a relative path with no active
project, and while a clone is running.

**What gets created.** There is no separate create request. The existing "create a project" command
carries an optional flag (`packages/contracts/src/orchestration.ts:984`) which the palette sets to
true on this path (`CommandPalette.tsx:2003`), and the server's root normalization
(`apps/server/src/workspace/WorkspacePaths.ts:152-190`) does the work: expand `~`, resolve, stat,
and if nothing is there and the flag is set, `makeDirectory` with `recursive: true`, then stat again
to verify. Recursive means **the whole missing chain**, not only the last segment: typing
`~/a/b/c` where `~/a` does not exist creates all three. The two other callers of the same command
(the desktop activation coordinator and the onboarding wizard) pass the flag as false, so the
creating behavior belongs to this one path.

**When it fails.** Two distinct server errors, both surfacing the same way:

- The path exists but is not a directory, which is the "a file is already sitting there" case. The
  first stat succeeds, so no mkdir is even attempted, and it fails with "Workspace root is not a
  directory: `<path>`".
- The mkdir itself fails, which is where a permission problem lands: "Failed to create workspace
  root: `<path>`".

Both come back through the create call, which raises a toast titled "Failed to add project" with the
server's message as the body, and leaves the dialog open (`CommandPalette.tsx:2010-2019`). Neither
is shown inline under the field.

**There is no separate "New folder" action.** I looked for one and it is not there: no button, no
row, no command, no keyboard shortcut anywhere in the browse UI, and no filesystem-level create in
their web or client-runtime code. The only two ways to make a folder are this inline flow and the
OS dialog, which is opened with `openDirectory` plus `createDirectory`
(`apps/desktop/src/electron/ElectronDialog.ts:115,118`) and so carries the operating system's own
New Folder button.

Two other states show as the empty-results message: "Relative paths require an active project", and
a Windows-shaped path on a non-Windows machine, which is a toast rather than an inline message. A
directory that cannot be read comes back as an empty listing, so an unreadable folder looks like an
empty one, the same hole Ruimte has.

### 1.5 After choosing

Resolve the text to an absolute path, then: a project that already exists at that path on that
machine is opened rather than duplicated, going to its most recent thread or starting one; otherwise
a project is created, named after the last path segment, and a fresh thread starts in it and the
dialog closes. Picking a folder therefore lands you in a chat, not on a project screen. No worktree
is made at this point.

### 1.6 Remote machines and the native dialog

The design is multi-environment: a local backend, desktop-local secondaries (WSL today), and remotes
over HTTP, Tailscale, SSH and their own tunnel. Their browse call is a per-environment RPC, so the
list is always the chosen machine's file system and local is not special-cased.

**How they say which machine: weakly.** You pick the machine in step 1, and after that there is no
chip, no title and no badge while browsing. Two machines browsing `~/projects/` look identical. The
agent that read this calls it a real gap, and I agree; section 3.6 is the opposite choice.

Their native dialog button is the interesting part, because they arrived at the same rule this
document proposes. A trailing footer button, labeled after the file manager, appears only when
browse mode is active, a desktop bridge exists, and the machine being browsed is either the primary
local one or a WSL machine whose desktop-side instance is known. For SSH and the other remotes the
button is simply absent. Their own comment explains the WSL guard: without the instance id the
Windows picker would open and the chosen Windows path would be registered against the Linux machine.
For WSL they seed the dialog with a UNC path into the distro and convert what comes back into a
Linux path.

One thing they get wrong and Ruimte should not copy: the button's wording ("Finder", "Explorer",
"Files") comes from the viewing machine's platform even when the dialog opens on a WSL file system.

### 1.7 Their browse API

Request: `partialPath` (trimmed, max 512 chars, a trailing separator decides list-versus-filter, `~`
expanded on the server) and an optional `cwd` used only to resolve a relative path. Response:
`parentPath`, the absolute directory actually listed, and `entries`, each of which is exactly a
`name` and a `fullPath`. No kind, no git flag, no project flag, no size, no mtime, no hidden flag.
Failures are tagged: a Windows path on a non-Windows machine (carrying the platform), a relative
path with no current project, and a directory that could not be read (carrying the parent path).

That is almost exactly `fs.browse` in Ruimte (`packages/contracts/src/fs.ts:3-25`), down to the two
error cases, and Ruimte's entry carries one field more (`hasCanvas`). The two were arrived at
separately; the shape is just what the problem wants.

### 1.8 Recents: they have none, except once

There is no recent-folders store in the palette flow, on disk, in localStorage or in a database.
Nothing records which directories you browsed. What exists:

- A server-scoped setting for the directory the browser opens in, described in their settings as
  "Leave empty to use `~/`". It seeds the field and browsing never updates it.
- A one-time scan during onboarding that walks the agent CLIs' own session histories (Claude Code,
  Codex) and offers the directories those agents have run in, each with which CLI it came from, a
  thread count, a last-active time, whether it is already imported, and the git remote read straight
  out of `.git/config` without spawning git. The wizard groups repositories first by recency,
  collapses clones of one repository, and puts non-repository folders under "Other folders".

That onboarding list is the only place in the product that shows folder recency, repository identity
or an already-imported state, and the everyday folder browser shows none of it. Ruimte could build
the same list for less, because `project.list` already answers a folder and a `lastOpenedAt` per
project, and deliberately does not: the browser shows folders and nothing else, on both sides.

### 1.9 The chrome, the row and the footer

Measured rather than guessed, because section 3 mirrors it.

**The popup.** One size for every mode: 576 px wide, capped at 420 px tall, top-anchored about a
tenth of the way down, 16 px corners, a hairline border and a blurred glass background over a dimmed
backdrop. Browse mode changes nothing about it. Inside, top to bottom: the input row, the scrolling
list, the footer bar. No title, no header, no breadcrumb, anywhere.

**The input row.** About 46 px tall, the field itself borderless and transparent so it reads as text
on glass rather than a box, in the normal sans font and **not** monospace. A leading slot holds a
search icon at the root, a folder-plus icon when a path is typed at the root, and a clickable back
arrow in any pushed step, which is what browsing after "Add project" actually shows. A trailing slot
holds the submit button, floating over the field, small and outlined, carrying its label and one key
chip: "Add" or "Create & Add", with "Enter" or "Cmd Enter" depending on whether a row is highlighted.
The field reserves trailing padding sized to the label so the text never runs under the button. The
placeholder changes with the mode: at the root it is about searching commands and projects, while
browsing it reads "Enter project path (e.g. ~/projects/my-app)".

**A row.** 28 px minimum height, 8 px side padding, 6 px top and bottom, 8 px between slots, small
corner radius, 14 px text. Left is a 16 px muted icon. Middle is the title, truncated; when an item
has a description it becomes a two-line stack with the description under the title in 12 px muted
text. Right holds, in order, a trailing pill, a timestamp, a key chip, and a chevron for a row that
opens a step. **A folder row uses none of the right slots and has no description**: it is an icon and
a name, nothing else. The highlighted row is a solid accent background with accent-colored text, and
they deliberately switch off the underlying widget's own hover and selected styling so exactly one
row is ever painted. Rows have no dividers.

**Groups.** A label in 12 px medium muted text, aligned one pixel right of the row text, 6 px above
the group that follows another, scrolling with the list rather than sticking. The folder list is one
group labeled "Directories", and the `..` row is the first item **inside** it, titled exactly `..`
with a corner-left-up icon in the same slot as the folder icons.

**The footer.** Always present, a tinted bar with 16 px side padding and 10 px above and below, 14 px
medium muted text. On the left, key hints in this order: up and down arrows with "Navigate"; then
"Enter" with a word, which reads "Select" when a row is highlighted or the path cannot be submitted
and **is left out entirely** when the typed path is submittable, because the button in the field is
saying it already; then "Backspace" with "Back" in any pushed step; then "Esc" with "Close". On the
right, one slot, which in browse mode on the desktop build holds the "Open in Finder" button.

**States.** No spinner, no skeleton, no loading text anywhere in the browse path. While a request is
in flight the previous listing stays on screen, and because every navigation prefetches before it
commits, the path and the list change in the same frame. An empty directory shows the "Directories"
label with nothing under it and no message. A directory that cannot be read is indistinguishable
from an empty one, because the server swallows the permission error and answers with an empty list.
The palette never reads the browse error at all: there is no banner and no toast for a listing that
failed. One consequence worth recording, because it changes what is worth copying: their
"Press Enter to create this folder and add it as a project" message is effectively **unreachable**,
since the browse list always returns one group and the empty state only renders when there are no
groups. What a person actually sees when a path does not exist is the button label changing to
"Create & Add".

## 2. What Ruimte has today

The state described here is the one the revert of section 4.1 returns to, which is why it is worth
reading: it is the floor the rebuild starts from. Every line number below is from `fc9ef57^`, the
commit the three UI commits sit on top of.

### 2.1 Two entry points, neither of them a picker

`apps/client/src/shell/ProjectMenu.tsx:60-70`, `openFolder`:

- In the desktop app it asks the Electron bridge for a native dialog
  (`bridge.pickFolder(current?.folder)`, L66), then opens whatever comes back as a project (L68).
- In a browser tab there is no bridge, so it opens the command palette seeded with `~/` (L63) and
  the person types a path.

`apps/client/src/shell/commands.ts:110` is the same fallback under a command: `open-folder`, labeled
"Open a folder as a project", hint "Type a path", which calls `useUi.getState().openPalette('~/')`.

The Electron side is one IPC call, `dialog:pick-folder` (`apps/desktop/src/preload.ts:7`), mirrored
in `apps/client/src/desktop/bridge.ts:45` as `pickFolder(initialPath?): Promise<string | null>`.

### 2.2 The palette's browse mode

`apps/client/src/shell/CommandPalette.tsx` is 598 lines at `fc9ef57^` and carries three modes. The
folder one, which is most of what section 3 keeps and grows:

- `isPathQuery` (L61): a query starting with `/`, `~`, `./` or `../` is a path. `browsing` (L166)
  is that test plus "not in find-in-files mode".
- The request (L168-190): `fs.browse { partialPath: query, cwd: folder ?? undefined }` after a 60 ms
  debounce (`BROWSE_DEBOUNCE_MS`, L63), with a generation counter so a stale answer is dropped. A
  failure clears the list and puts the message in `failure` (L183-187).
- The rows (L244-268): a `..` row built by `parentOf` (L83-90) unless the query is `/` or `~/`, then
  one row per directory, each with a `FolderCheck` icon and the hint "Has a canvas" when the daemon
  says the folder already holds one. Clicking or Enter on a row sets the query to
  `${entry.fullPath}/`, which triggers the next browse. The list is the palette's own list, drawn in
  a monospace font while browsing (L536).
- The keys (L449-472): Down and Up move the highlight, Enter steps into the highlighted folder,
  Enter with nothing highlighted or with Cmd or Ctrl held calls `submitPath(query)` (L460-461), Tab
  completes to the highlighted folder (L465).
- `submitPath` (L226-238) calls `projectClient.openFolder(path)`, closes the palette on success and
  paints the error in the footer otherwise.
- The footer (L564-595): the hint "Enter steps into a folder, Cmd+Enter opens the typed path as a
  project", a `Browse…` button that only exists inside Electron and goes to the native dialog
  (L577-589), and a primary "Open as project" button.

`parentOf` (L83-90) splits on `/` only, so on a Windows daemon the `..` row is wrong. Nothing else
in the browse path assumes a separator: the daemon does the resolving.

### 2.3 `fs.browse` on the wire and on the daemon

Contract, `packages/contracts/src/fs.ts:3-25`:

- `FsBrowsePayload`: `partialPath` (1 to 512 chars) and an optional `cwd` "usually the open
  project's folder".
- `FsBrowseEntry`: `name`, `fullPath`, `hasCanvas`.
- `FsBrowseResult`: `parentPath` (absolute) and `entries`.

Registered at `packages/contracts/src/index.ts:161`; handler at `apps/server/src/handlers/fs.ts:21`,
which translates a `BrowseError` into a `RequestError` with the same code (L10-18).

`apps/server/src/fs/browse.ts`:

- `resolveBrowsePath` (L29-46): `~` becomes the daemon's home, `./` and `../` resolve against `cwd`
  and throw `cwd-required` without one (L40-42), a Windows-shaped path on a non-Windows daemon
  throws `windows-path` (L33-35), anything else resolves against `cwd` or home.
- `browseDirectories` (L53-76): a path ending in a separator (or `~`, `.`, `..`) lists that whole
  directory; otherwise the last segment is a case-insensitive prefix filter on its parent. Only
  directories come back, sorted by name. Dot folders are hidden unless the typed prefix itself
  starts with a dot (L65-67). `hasCanvas` is a `stat` on `<folder>/.ruimte/project.json` per entry
  (L72).
- A directory that cannot be read returns `{ parentPath, entries: [] }` (L60-64). **A folder that
  does not exist and an empty folder are the same answer.** That is the single biggest gap for a
  picker: it cannot tell the person the path is wrong.

### 2.4 The other listing that already exists

`fs.list` (`packages/contracts/src/fs.ts:112-133`, handler `apps/server/src/handlers/fs.ts:36`,
implementation `apps/server/src/fs/list.ts:72`) reads one directory, or up to three levels at once,
and returns per entry `name`, absolute `path`, `kind`, `size`, `mtime`, `hidden` and `ignored`. It
distinguishes `not-found` from `not-a-directory` (`list.ts:6,78,81`), which `fs.browse` does not,
but it returns files as well as directories and says nothing about `.ruimte` or git. It is what the
files panel tree is built on.

### 2.5 The project list, and opening across machines

Phase 5 landed while the first version of this document was being written (`b73eb95`, `ac5d055`).
`useProject.projects` is now a union: `ProjectRow { endpointId, summary }`
(`apps/client/src/state/project.ts:9-12`), filled per machine by `setProjects(endpointId, ...)`, with
`currentEndpointId` next to `current`.

Three things from it that section 3 leans on:

- `groupProjects(rows, endpoints, activeId, connected)` (`apps/client/src/project/list.ts:96-106`)
  folds the union into one group per machine, active machine first, each group carrying a
  `connected` flag. The project menu draws a group as a 6 px dot, filled `bg-status-idle` when the
  machine answers and `bg-text-faint` when it does not, plus the endpoint's label, and it collapses
  the label to the plain word "Projects" when there is only one machine
  (`apps/client/src/shell/ProjectMenu.tsx:95-99`). That is the house style for "which machine", and
  the palette's machine step in 3.2 reuses it rather than inventing a second one.
- `openProject(endpointId, projectId)` (`apps/client/src/project/open.ts:42-68`) opens a project on
  the machine that owns it: remember the choice, activate the endpoint, wait up to five seconds for
  that socket (`CONNECT_TIMEOUT_MS`, L13), then open. A machine that does not answer fails with
  "That machine is not answering" rather than hanging. **There is no `openFolder` counterpart**, and
  3.6 adds one.
- `useOpenEndpoints()` and `useEndpointConnection(endpointId)`
  (`apps/client/src/transport/status.ts:25-46`) say which machines are answering right now.

`ProjectSummary` (`packages/contracts/src/project.ts:368-381`) carries `projectId`, `name`, `color`,
`folder` (nullable), `lastOpenedAt`, `available`, `icon` and `nameSource`.

### 2.6 What the client knows about the machine it is browsing

- `useServers` (`apps/client/src/state/server.ts:18-47`) keeps `platform`, `home`, `version`,
  `label` and `reachability` per endpoint. `home` arrives in the daemon's hello
  (`apps/client/src/transport/server-info.ts:23`), so the picker can offer Home without asking.
- `describeMachine` (`apps/client/src/shell/connection-info.ts:38-49`) turns that into "This Mac" or
  an endpoint label, which is the phrase the connection dot already uses.
- `transport` (`apps/client/src/transport/index.ts:14-23`) is the active endpoint's socket, so
  anything sent through it browses the active daemon's file system. `transportFor(endpointId)`
  (L29-32) reaches one specific machine, which is how a picker could later browse a machine that is
  not the active one.
- `fileManagerName(platform)` (`apps/client/src/state/server.ts:53-61`) names Finder, Explorer or
  Files. Note it takes the **daemon's** platform; the native dialog belongs to the machine Electron
  runs on, whose platform is `desktop().platform` (`apps/client/src/desktop/bridge.ts:44`).
- Whether the active endpoint is the daemon that served this page is
  `useEndpoints.getState().activeId === LOCAL_ENDPOINT_ID` (`apps/client/src/state/endpoints.ts:7`).
  The local row is the only one with `reachability: 'loopback'` (L50).

## 3. The proposal: their browse mode, in our palette

The rule for everything below: keep the palette browser's behavior and layout, and deviate only where their
design collides with something genuinely different here. Three things collide, and only three. We
have several daemons at once where they have one environment chosen up front (3.2, 3.6). We have an
`exists` answer where they have none, which is the whole of `91d3fa1`, so our states can be honest
where theirs cannot (3.7). And our components follow `CLAUDE.md`: semantic tokens, Lucide through
`Icon`, `Tooltip` instead of `title`, whole pixels. Every other difference below is marked and
argued where it appears.

Gone from the first version, on Bas's word: the dialog of its own, the shortcut rail, the recent
folders, the breadcrumb. None of it belongs in a palette step.

### 3.0 Browse mode is a step, not a query

This is the correction the second rewrite is for, and everything after it leans on it.

The palette holds a stack of views (`viewStack`). A view is an icon,
a list of groups and an optional text to seed the field with. "Add project" pushes one, the sources
step pushes another, and the folder browser is a third. Their `isBrowsing` flag really is derived
from the query, but it only decides whether the **pushed** step lists folders instead of its own
rows; the step itself is state, and that is why their field can be empty, why Backspace pops, and
why picking a machine can be the first thing you see.

The version built from the first rewrite of this document kept only the derived half. Browse mode
was `isPathQuery(query)`, so the command had to seed the field with a path to open it, an empty
field could not be browse mode, and Backspace on an empty field had nothing to step back from.

So: the palette carries `browse: { endpointId, machines, path } | null`. Null is the ordinary
palette. A step says which machine is being browsed, whether the machines themselves are up in place
of the folders, and the folders path the machines step was opened from. The rules that come out of
it are pure and live next to the rest in `palette-browse.ts`: `openBrowse(endpointId, machineCount,
start)` for the step browsing opens on, `browseBack(step, machineCount)` for the step behind it.

The query goes back to being what it always was: the text in the field. On the folders step it is
the path, on the machines step it narrows the list of machines, and in the ordinary palette a path
typed into it opens browse mode, which is the second way in and the one that has always worked.

### 3.1 Entering and leaving browse mode

Three things get you there:

- "Open a folder as a project" in the palette's own action list, which opens browse mode with
  **nothing typed**.
- "Open folder" in the project menu, which does the same. Its desktop branch is deleted: the native
  dialog moves into the palette footer (3.8). This mirrors their sidebar and their empty states,
  which all fire the palette open on the add-project step rather than opening something of their own.
- Cmd+K and typing a path, which is how it has always worked and still does.

**Which step it opens on.** With more than one machine known it opens on the Machines step (3.6),
with the field empty and the first row highlighted. With one machine there is nothing to choose, so
it opens straight on that machine's folders. An environment step is skipped in exactly that
case.

**Where the folders open.** In the folder set in settings, and otherwise in the home of the machine
being browsed. Not in the folder of the open project, which is what the first two builds did: that
folder is on one machine and is already open, and browsing is for finding another one. This is Bas's
call and it lands on a configured base directory: a browser that opens in a folder from a
setting described in their own UI as "Leave empty to use `~/`" (1.8), and we now have the same thing
under Files in the settings dialog.

It is **one setting for every machine**, not one per machine, because the folder people keep their
work in tends to have the same name everywhere and a setting per machine would be a list to keep.
The price is that it can name a folder that is not on the machine being browsed, and the answer to
that is the field `91d3fa1` added: the first listing is asked for at the configured folder, and when
`fs.browse` says `exists: false` the palette lists home instead. That is `browseStart` in 4.2 and
`startBrowsing` in 4.4.

**The field opens empty, and fills with the listing.** Browsing a machine is the one navigation with
no path behind it, so the palette asks for the start folder itself rather than typing it into the
field a frame before the folders arrive. The step carries no path, the effect sees that and asks,
and the path and the first listing land together, which is the same rule every other navigation
follows (3.7).

**Every step fetches before it commits.** They fetch the starting directory and only then push the
step and set the text, so the first paint already has folders in it. Stepping into a folder, going
up and picking a machine all do the same here.

Leaving:

- Backspace on an empty field steps back one step, which our palette already does for find-in-files
  (with a comment saying the mode leaves the way it was entered). `browseBack` decides: the machines
  step returns to the folders it was opened from, or leaves browsing when browsing began on it; a
  folders step goes to the machines when there is more than one, and otherwise leaves. The leading
  slot of the field is the same control and the footer says `⌫ Back` in every step, as theirs does.
- Emptying the field does **not** leave browse mode any more. It cannot: an empty field is what the
  machines step has, and it is what Backspace needs something to step back from. The other option pops the
  step the moment the field would go empty, which comes to the same thing one keystroke earlier.
- Escape closes the whole palette. It does not step back. Their footer says "Esc Close" in every
  state and so does ours.

### 3.2 The steps before browsing, and which of them we need

They have two. We need a version of one and none of the other.

**Their machine step: yes, and as a step.** They show it when more than one environment exists and
skip it when there is exactly one that is connected. Ours does the same, with one difference that
follows from our sockets being lazy: the test is only how many machines are known, because "not
connected" here means "nothing has asked yet" rather than "something is wrong" (3.6). One machine
goes straight to its folders; more than one asks first. It is also the step browsing can come back
to, which is 3.6, and the leading slot of the field is how you get there and back.

The measured shape of theirs, which ours mirrors: the group is labeled "Environments" (ours reads
**Machines**), the rows are the primary machine first and then the rest, each with a machine icon, a
title and a subtitle that is either the machine's own name or its connection status, and a row that
is not connected is dimmed and unclickable. Auto-highlight is on, so the first selectable row is
already highlighted when the step opens, and typing narrows the rows the way typing narrows every
other list in their palette. Ours keeps all of that except the dimming: our rows stay clickable and
dial (3.6), and our order is the active machine first and then the endpoint list's own order, which
is what `groupProjects` already does for the project menu.

**Their source step: no.** Its three kinds of row are a local folder, a git URL and one row per git
provider, and every one but the first is about cloning a remote repository (1.1). Ruimte has no
provider settings, no repository lookup and no clone, so a step whose only enabled row says "Local
folder" would be a question with one answer. "Open a folder" goes straight to browsing. If cloning
is ever built, this step is where it goes and the shape is already described in 1.1.

### 3.3 The list

One group, one row per folder, nothing else, exactly as 1.9 describes it:

- The group label reads **Folders**, which is the word our palette already uses for this section
  (`CommandPalette.tsx:70`). Theirs says "Directories". Same thing, our word.
- The `..` row is the **first item inside that group**, not above the label, and it is the row a
  fresh list opens highlighted like any other (3.5). Titled exactly `..`
  with a corner-left-up icon in the same slot as the folder icons. Today it carries a trailing hint
  reading "Up one folder"; that hint goes, because their row has nothing in its right slots and this
  is one of the places where ours looks different for no reason.
- A folder row is an icon and a name. No description line, no right slots.
- One exception, argued: a folder that already holds a canvas keeps its mark, because `fs.browse`
  has answered `hasCanvas` since long before any of this and it says what the Enter key will do.
  Opening a folder that already has a project opens that project rather than making a second one, so
  the mark is the difference between "make a project here" and "go back to this project". A picker without it
  does the same thing and simply does not tell you. Keep the `FolderCheck` icon in the left slot and
  drop the "Has a canvas" text from the right slot, so the row shape stays theirs.
- Sorting is the daemon's: directories only, name compare, ascending
  (`apps/server/src/fs/browse.ts:66-68`). The client does not re-sort. This already matches them.
- Files are never listed, on either side.
- Hidden folders follow the daemon's existing rule, which is theirs too: a dot folder appears once
  the typed segment starts with a dot (`browse.ts:68`). **No toggle**, reversing what the first
  version of this document decided. A toggle adds nothing, and the rule is the same rule on both sides.
  The `hidden` flag that would have driven a toggle was shipped in `91d3fa1` and stays on the daemon
  without a caller (4.3).

While browsing, the folder rows are the only rows: the commands, the views and the projects step
aside, which is what the palette does today and what theirs does. On the machines step the machine
rows take the same place.

### 3.4 Above and below the list

**The input row** keeps its shape and gains their two ideas.

The leading slot already swaps per mode (`CommandPalette.tsx:344-346`): a search icon normally, a
folder icon while browsing. While browsing it becomes the back control, which is where they put
theirs, and on the folders of a machine it carries that machine's dot and label as well (3.6). The
field stays in the normal sans font: today it switches to monospace
while browsing (`CommandPalette.tsx:439`), theirs does not, and a proportional font is what makes a
path look like something you type rather than something you read. Drop the monospace on the field
and on the rows.

The placeholder changes per step, as theirs does: it names the path on the folders step and the
machines on the machines step, rather than naming the three modes of the palette at once.

**The submit button moves into the field.** This is the most visible difference between what we
built and what they have. Theirs is a small outlined button floating over the right end of the input,
carrying its label and one key chip, with the field reserving trailing padding sized to that label.
Ours lives in the footer with a second button beside it. Move it: one button in the field, labeled
"Open folder" or "Create and open" (3.7), with a key chip reading Enter or Cmd+Enter depending on
whether a row is highlighted, and a `Tooltip` repeating the label and the chord, since `CLAUDE.md`
forbids a `title` attribute.

**The footer becomes hints plus one slot.** Today it is a sentence and two buttons
(`CommandPalette.tsx:564-595`). Mirror theirs: key chips on the left in their order, up and down
with "Navigate"; Enter with "Select", **left out entirely** when the typed path is submittable and
nothing is highlighted, because the button in the field already says it; Backspace with "Back" when
there is a step to go back to; Esc with "Close". On the right, one slot, holding the native dialog
button when it applies (3.8) and, unlike theirs, the error line when a browse or an open fails
(3.7). Use the existing `TOOLTIP_KBD` class for the chips; it is the same 12 px chip the palette
already draws.

### 3.5 Keyboard

Their semantics, with one deliberate difference under the table:

| Key | What it does |
| --- | --- |
| Any character | Goes into the field. On the folders step it re-browses after the 60 ms debounce, on the machines step it narrows the machines |
| Down / Up | Move the highlight, which every list already has on a row |
| Enter | Steps into the highlighted folder, or picks the highlighted machine, and keeps the palette open |
| Enter, nothing highlighted | Opens the typed path, creating it when it is not there. Only an empty list has nothing highlighted, which is exactly the folder that is not there |
| Cmd+Enter | Opens the typed path whatever is highlighted |
| Backspace, empty field | One step back, per `browseBack` (3.0): the machines, the folders they came from, or out of browsing |
| Escape | Closes the palette |
| Tab | Completes the field to the highlighted folder without stepping in |

**Every list opens with its first row highlighted, the folders included.** This is a deliberate
choice and it is Bas's: switching auto-highlight off while browsing means nothing is
preselected and Enter means "use what I typed". Here the highlight is what makes the keyboard fast,
so a fresh folder list always has its first row on, `..` included, and the first Enter steps rather
than opens. What that costs is the meaning of Enter, and Cmd+Enter takes it over: the chip on the
button in the field says which of the two it is, and it now reads Cmd+Enter whenever there is a
folder to step into. The one list with nothing highlighted is an empty one, which is precisely the
path that is not there, and there Enter creates it.

The machines step opens on the machine the client is pointed at rather than on its first row, which
is where the work is and usually where the folder being looked for is too.

Tab is the one key they leave unused and we already use; it stays, because it is in the tree, it
costs nothing, and removing a working completion to match an absence is not mirroring, it is
copying.

### 3.6 Machines: where browsing starts, and how you switch

**Browsing opens on the machines when there are several, and on the folders when there is one.**
That is their rule, and the first rewrite of this document got it wrong by arguing that our active
endpoint makes the question redundant. It does not: the active machine is where the app is pointed,
but "open a folder" is exactly the moment a person may mean the other one, and asking costs one
keypress because the first row is already highlighted. With one machine the question has one answer
and is never asked, which is their skip and ours.

The machine the step starts on is still the active one: its row is first and highlighted, so Enter
alone goes where the first rewrite would have gone directly.

**The machine is in view the whole time.** On the folders of a machine, the leading slot of the
input carries a 6 px dot in the connection color plus the machine's label, the same pair the project
menu draws over a group of projects (`ProjectMenu.tsx:95-99`), and clicking it opens the machines.
With one machine known there is nothing to name and it is the plain back arrow instead, which is
what a back arrow usually is. This is a deliberate choice: showing no machine at all while browsing
(1.1), which is the half of their design worth avoiding rather than copying, because two machines
browsing `~/projects/` look identical and we have two machines routinely.

**The machines are a step you can come back to.** Clicking that slot, or pressing Backspace on an
empty field, replaces the folder rows with a **Machines** group: one row per known endpoint, the
daemon that served this page first and then the order of `useEndpoints.endpoints`, each with the
connection dot, the endpoint label as the title and the machine's own label or its status beside it.
This machine keeps its place whichever machine is active, because it is the one that is always there
and the one the list is read against; which machine is active is carried on the row instead, as the
one the step opens highlighted (3.5). The field empties and
narrows the rows rather than holding a path, as theirs does. Picking a row goes to that machine's
folders; stepping back returns to the folders the step was opened from, or leaves browsing when it
was opened on nothing (`browseBack`, 3.0).

**The typed path resets on a switch.** It becomes that machine's start folder (3.1), with the same
fallback to home when the configured one is not there. This is what they do: each environment
carries its own initial query and browsing starts there. The reason is stronger for us than for
them: a path from machine A usually does not exist on machine B, and carrying it over would drop you
into the "create this folder" state (3.7) on a machine you have just arrived at, which is the one
state nobody wants by accident.

**A machine that is not connected stays clickable.** They disable such a row and this is the second
deliberate deviation. Their environments hold long-lived connections, so "not connected" means
something is wrong. Ours are dialed lazily: `pool.require` opens a socket when something asks for
one, so a known machine is usually not broken, only not yet asked. The row therefore shows its dot
in the disconnected color, and choosing it dials with the same five second budget `openProject`
already uses (`CONNECT_TIMEOUT_MS`, `open.ts:13`). While it dials, the row reads "Connecting". If it
does not come up, the list stays on the machine step and the footer's right slot carries "That
machine is not answering", which is the sentence `waitForOpen` already produces (`open.ts:24`).

**What the browse request does with all this.** Two consequences, both small and both easy to get
wrong:

- `fs.browse` goes through `transportFor(browseEndpointId)`
  (`apps/client/src/transport/index.ts:29-32`), not the `transport` facade, or it would list the
  active machine no matter which one the palette says it is browsing.
- `cwd` rides along only when the browsed machine is the active one. It exists so `./` and `../`
  resolve against the open project's folder (`apps/server/src/fs/browse.ts:39-44`), and that folder
  is on one machine. Sending it to another daemon would resolve a relative path against a directory
  that is not there.

**Opening.** `projectClient.openFolder` talks to the active machine, so opening a folder found on
another one needs the same move `openProject` makes: activate the endpoint, wait for its socket,
then open. That is `openFolderOn(endpointId, folder, createFolder)` in 4.4, the folder twin of the
project one. Their flow ends by dropping you into a fresh thread; ours ends where opening a project
has always ended, on its canvas.

### 3.7 Loading, empty, unreadable, missing

Three of these are theirs unchanged. The fourth is where `exists` lets us be honest and they cannot.

**Loading: nothing.** No spinner, no skeleton, no text. The previous listing stays on screen until
the new one lands, and every navigation prefetches before it commits the new text, so the field and
the list change together (1.9). Our browse effect already keeps the old list and already drops stale
answers with a generation counter (`CommandPalette.tsx:168-190`); what it does not do is prefetch
before committing, and stepping into a folder should start doing that.

**An empty folder: the label and nothing under it.** The group header stays, the list under it is
empty, and there is no message. Same as theirs, and the button stays enabled: an empty folder is a
perfectly good project folder.

**A folder that cannot be read: the same picture.** The daemon answers an empty list for a directory
it cannot read (`browse.ts:60-64`), so this looks like an empty folder, as it does for them. We
could tell the two apart now that `exists` is there, and deliberately do not: an extra state for a
case that almost never happens is more to build, more to explain and more to get wrong.

**A folder that is not there: the button says so.** This is the honest version of the case they
cannot reach (1.9). `folderPresence` (4.2) answers `there`, `missing` or `unknown` from `exists` and
the entries, and:

- `missing`: the button reads "Create and open" and stays enabled, and the empty area under the
  group carries one line, "Press Enter to create this folder and open it as a project". Theirs says
  almost exactly that and nobody ever sees it; ours is reachable because we know the difference
  between a folder with no subfolders and a folder that is not there.
- `there`: the button reads "Open folder".
- `unknown`, which is what a daemon older than `exists` leaves behind: the button reads "Open
  folder" and a path that is not there fails on Enter the way it always did.

The rule for `missing` is theirs, because it falls out of what `fs.browse` answers anyway: when the
field ends in a separator, `exists` decides; otherwise the last segment is there only if some entry
matches it exactly, case-sensitively. It carries the edge they live with, that `~/pro` reads as
missing while `~/projects` sits in the list, and the guard is the same: the button label changed
under the cursor before the key was pressed.

**Errors.** They put every failure in a toast and never read the browse error at all. We have a
place for a sentence and should use it: the footer's right slot carries the daemon's own message for
a browse that threw (`windows-path`, `cwd-required`) and for an open that failed
(`folder-not-found`, `folder-create-failed`), in the error color. That is where the browse footer
already puts a failure today (`CommandPalette.tsx:564-575`), so it is not a new idea, only a
surviving one.

### 3.8 The native dialog

Theirs is a footer button on the right, labeled after the file manager, shown only while browsing,
only in the desktop build, and only when the machine being browsed is one the desktop process can
actually open a picker on. Ours is the same button in the same place with the same rule, which the
first version of this document already argued and which their code independently arrives at (1.6):

- there is a bridge (`desktop() !== null`), and
- the machine being browsed is the daemon that served this page
  (`browseEndpointId === LOCAL_ENDPOINT_ID`).

Anywhere else the button is absent, with no explanation and no disabled state, because a native
dialog cannot see a remote file system. The label uses `fileManagerName(desktop()!.platform)`, the
Electron machine's platform rather than the daemon's; under the rule above they agree, and reading
the right one keeps it true if the rule ever loosens. A folder that comes back opens straight away.
One thing theirs gets wrong and we should not: they derive the word "Finder" from the viewing
machine even when the dialog opens on a WSL file system (1.6).

## 4. Implementation

### 4.1 Three commits stay, three come out

Checked against `main` at `fe7427b`. Oldest first, the six commits of the first version:

| Commit | What it did | Verdict |
| --- | --- | --- |
| `91d3fa1` | `exists` on `fs.browse`, `createFolder` on `project.open`, the `folder-create-failed` code, daemon plus contracts plus their tests | **Stays.** Section 3 needs every bit of it. |
| `58021c5` | `FolderPicker.tsx`, `folder-picker.ts` and its test, the `ui.ts` state, the `App.tsx` mount, `openFolder(folder, createFolder)` on `ProjectClient` | **Out**, except the last item, see 4.2. |
| `fc9ef57` | Every entry point rerouted to the picker, the palette's browse mode deleted, Cmd+O added | **Out.** This is the one that gutted the browse mode; reverting it is what gives section 3 its floor back. |
| `f549b05` | The two new answers exercised over a real socket in the Docker test | **Stays.** |
| `53205f3` | `apps/server/README.md` on `fs.browse` and `createFolder` | **Stays.** |
| `fe7427b` | A width fix inside `FolderPicker.tsx` | **Out**, it only touches a file that is going away. |

Revert them newest first, which is also the order that avoids conflicts, since the two that stay in
between touch neither file: `fe7427b`, then `fc9ef57`, then `58021c5`. One commit, message in the
usual form, saying the picker moves into the palette rather than that it was wrong.

After the revert the tree is `fc9ef57^` plus the daemon work: the palette has its browse mode back
(2.2), `ProjectMenu.openFolder` calls the native dialog on desktop again (2.1), `commands.ts:110`
seeds the palette with `~/`, Cmd+O is gone, and `fs.browse` answers `exists` that nobody reads yet.

### 4.2 What to keep out of the reverted code

The revert deletes `folder-picker.ts` and its test. Most of it was about the rail and the breadcrumb
and is gone for good, but seven pure functions are exactly what the palette's browse mode needs and
they already have tests. Write them again in a new `apps/client/src/shell/palette-browse.ts` with
`palette-browse.test.ts` next to it, taking them from the reverted commit rather than from memory:

- `separatorFor(platform)`, because a Windows daemon answers in backslashes and the client has no
  `node:path`. The old `parentOf` in the palette (`CommandPalette.tsx:83-90` at `fc9ef57^`) splits on
  `/` only and is wrong on such a daemon; it gets replaced by this pair.
- `endsWithSeparator(path)`, `parentOf(path, sep)`, `joinPath(parent, name, sep)`,
  `lastSegment(path, sep)`.
- `folderPresence(path, result, sep)` and its `FolderPresence` type, the three-state answer
  (`there`, `missing`, `unknown`) that drives the button label in 3.7. `unknown` is what a daemon
  older than `exists` leaves behind.
- `browseStart(configured, home, sep)`, which is where browsing a machine opens: the folder set in
  settings, else that machine's home. It answers both, because the caller needs home to fall back to
  when the daemon says the configured one is not there (3.1). This replaces `startFolder`, which
  answered the open project's folder first.

The second rewrite adds two more to the same file, the rules of 3.0, because they are the part with
the actual decisions in them and a component is the one place this project cannot test:

- `openBrowse(endpointId, machineCount, start)`, the step browsing opens on and the text the field
  opens with.
- `browseBack(step, machineCount)`, the step behind the one browsing is on: `machines`, `folders`
  with the path to go back to, or `palette` for out of browsing altogether.
- `paletteStart(now, seen)`, what a render has to do about the store: start the palette over, and
  whether that start is a browse. It is the rule the command not firing turned out to be (4.6).

Do not bring back `breadcrumbOf`, `shortcutsFor`, `Crumb`, `Shortcut` or the recents limit. The
breadcrumb and the rail are the two things Bas asked to remove.

One hunk of `58021c5` has to come back by hand after the revert, because the browse mode needs it as
much as the picker did: `ProjectClient.openFolder(folder, createFolder = false)` and the
`createFolder` field on its private `open` payload
(`apps/client/src/project/project-client.ts:155` and `:312`). Without it nothing can send the flag the
daemon already understands. Its comment stays true word for word: creating is the browse mode's
business, and everywhere else a folder that is gone stays gone.

### 4.3 Contracts and daemon: nothing left to do

`91d3fa1` already did all of it and it stays as it is:

- `FsBrowseResult.exists` (optional) in `packages/contracts/src/fs.ts`, set by
  `apps/server/src/fs/browse.ts` in both the success path and the catch.
- `ProjectOpenPayload.createFolder` (optional) in `packages/contracts/src/project.ts`, honored by
  `apps/server/src/projects/project-store.ts`: stat first, recursive `mkdir` only when nothing is
  there, never over something that exists, `folder-create-failed` when the `mkdir` fails and the
  existing `folder-not-found` when a file is in the way.
- `FsBrowsePayload.hidden` (optional) was built too, honored by `browseDirectories` and covered by
  a test of its own (`apps/server/src/fs/browse.test.ts:72`). The palette does not send it and 3.3
  says why, so it keeps no caller for now. Leave it: `fs.list` carries the same flag and the Files
  panel uses it, so `fs.browse` having one is consistency rather than clutter, and pulling a shipped
  and documented field back out of the contract, the daemon, its test and the README is more churn
  than leaving it where it is.

The one addition this rewrite needs is on the client only. No new request, no new field.

### 4.4 Client

New:

- `apps/client/src/shell/palette-browse.ts` plus its test: the seven functions of 4.2, plus
  `browseMachines(endpoints, activeId, connected)` for the machine step's rows, shaped after
  `groupProjects` (`apps/client/src/project/list.ts:96-106`) so both lists sort and dim a machine
  the same way.
- `apps/client/src/project/open.ts`: `openFolderOn(endpointId, folder, createFolder)`, the folder
  twin of `openProject` (3.6). Same body: return early when the endpoint is already active, else
  `activateEndpoint`, `transportFor`, `waitForOpen` with the same `CONNECT_TIMEOUT_MS`, then
  `projectClient.openFolder(folder, createFolder)`. Reuse `waitForOpen` rather than copying it.

Changed, all in `apps/client/src/shell/CommandPalette.tsx` unless noted:

- The browse effect sends `fs.browse` through `transportFor(browseEndpointId)` instead of the
  `transport` facade, and keeps `cwd` only when the browsed machine is the active one, since a
  relative path counts from the open project's folder and that folder lives on one machine (3.6).
- `browse: BrowseStep | null` as the palette's own state (3.0), with the listing beside it under the
  machine and path it was asked for. `browseEndpointId` and the machine step both read off it, and
  `browsing` is `browse !== null` rather than a test on the query.
- `apps/client/src/state/ui.ts`: `paletteBrowseAt` next to `paletteSeed`, and `openFolderBrowser()`,
  which counts it up. A count and not a flag, for the reason in 4.6. Which step browsing is on after
  the palette has started is the palette's own business.
- `startBrowsing(endpointId)` in the palette: the one navigation with no path behind it. It asks the
  machine for `browseStart`'s `start`, and lists `home` instead when the answer says the start is
  not there. `pickMachine` and the effect that opens a folders step both go through it.
- `apps/client/src/state/settings.ts`: `browseStartFolder`, with a field under Files in the settings
  dialog (3.1). Empty is home.
- The machine step: a `Machines` section that replaces the folder rows while it is up, narrowed by
  what is typed (3.2).
- The input row's start slot: the back control, carrying the machine dot and label on the folders of
  a machine (3.4).
- The footer: the hints of 3.5, the native dialog button gated as in 3.8, and the primary button
  whose label follows `folderPresence` (3.7).
- `submitPath` calls `openFolderOn(browseEndpointId, path, presence === 'missing')` instead of
  `projectClient.openFolder(path)`.
- The keys of 3.5: Backspace on an empty field, and the machine step's own Enter.
- `apps/client/src/shell/ProjectMenu.tsx`: `openFolder` drops the `desktop()` branch entirely and
  always opens the palette in browse mode. The native dialog lives in the palette's footer now, and
  only there.
- `apps/client/src/shell/commands.ts`: the open-folder command calls `openFolderBrowser()` and drops
  its "Type a path" hint, because nothing has to be typed any more.

Not changed: the `folderPickerOpen` and `folderPickerSeed` members go with the revert and nothing
replaces them. `apps/client/src/App.tsx` mounts nothing new. No Cmd+O: this needs no chord of its own and the palette is one
keystroke away already.

### 4.5 Order of work

1. The revert of 4.1, on its own, so the diff that follows is readable.
2. `palette-browse.ts` and its test (4.2), and swap the palette's `parentOf` for it. No visible
   change yet; this is the step that makes a Windows daemon stop being wrong.
3. `openFolderOn` in `project/open.ts`, with its cases added to the existing
   `apps/client/src/project/open.test.ts`.
4. The browse mode's own work, in one pass, because the states are entangled: the presence rule and
   the button label, the footer hints, the loading and empty and unreadable states, the `..` row
   wording (3.3, 3.5, 3.7).
5. The machine step (3.2, 3.6): the `Machines` section, the start slot, Backspace and the switch
   that resets the path. Last, because everything before it works with one machine and this is the
   part that only shows itself with two.
6. `ProjectMenu` and the command hint (4.4), and delete what the picker left behind.

### 4.6 What can break

- **The Docker test.** `apps/server/src/docker/remote-daemon.test.ts` browses a second daemon over a
  real socket and is the only automated proof that any of this works across machines. Do not let the
  revert touch it; it came in `f549b05`, which stays.
- **`transportFor` returning null.** It answers null for an endpoint this client no longer knows,
  which is what a forgotten machine leaves behind mid-browse. The browse effect has to treat that as
  "fall back to the active machine" rather than throwing.
- **A relative path on another machine.** `./` and `../` resolve against the open project's folder,
  which the daemon reads from `cwd`. Send `cwd` only for the active machine (4.4) or a browse on
  machine B silently resolves against a folder on machine A.
- **The five second connect timeout.** A machine that is asleep makes the browse hang until it
  fires. Show the machine step's row as connecting rather than leaving the list blank (3.6).
- **A daemon older than `exists`.** `folderPresence` answers `unknown`, the button keeps saying
  "Open folder" and a missing folder fails the way it always did. Keep that path; it is the only
  behavior a mixed pair of versions can have.
- **A command chosen while the palette is already open.** This is the one that got through twice.
  The palette derives its fresh start from the store while rendering, and the first build read the
  browse command as a flag on that store. Choosing the command from the palette's own list changes
  nothing else about the store, because the palette is already open and already in its default mode,
  so the flag went up and no render ever looked at it again. A count fixes it, and `paletteStart`
  (4.2) is the rule written down where a test can reach it: opening, a mode changing under an open
  palette, and the count moving are three ways to start over, and the count moving is the one that
  also browses.
- **A start folder that is not on the machine being browsed.** One setting, several machines, so it
  happens. The fallback to home hangs on `exists`, which a daemon older than `91d3fa1` does not
  answer; there the start folder is simply listed and an empty one looks like an empty folder.
- **Muscle memory.** Typing `~/` into Cmd+K has worked since before all of this. It keeps working,
  and now it browses in place instead of opening a second dialog.

### 4.7 Tests

- `apps/client/src/shell/palette-browse.test.ts`: parent of a POSIX path, parent of a Windows path,
  parent of a root, `joinPath` against a directory with and without a trailing separator, the three
  `folderPresence` answers over both branches of the rule (trailing separator, and an exact name
  match that is case-sensitive), `startFolder` with and without a folder in hand, and
  `browseMachines` putting this machine first whichever one is active, marking the active one and
  marking one that is not connected,
  `openBrowse` on one machine and on several, every branch of `browseBack` (3.0), `browseStart` with
  and without a folder set and without a home to fall back on, and every case of `paletteStart`,
  the command chosen under an open palette and chosen twice in a row included (4.6).
- `apps/client/src/project/open.test.ts`: `openFolderOn` on the machine that is already active takes
  the short path, on another machine it activates first and waits for the socket, and on a machine
  that never answers it fails with the timeout's message rather than hanging.
- `apps/server`: nothing new. `browse.test.ts`, `project-store.test.ts` and the Docker test already
  cover the daemon side and they stay.
- No component test; the client has none of those today.

## 5. Decisions

Nothing here is open. The first three, the fifth and the sixth are Bas's; the rest follow from them
or were settled earlier and still hold. Each one is a small edit if he wants it the other way.

1. **It lives in the command palette.** Bas, after seeing the built version: if it is in the palette
   for every other choice, it is in the palette here, and it should work the same. That reverses the first
   version of this document and takes three commits out with it (4.1).
2. **No recents panel and no rail.** Bas. Nothing in the palette's browser shows recency or favorites
   (1.3), and their one place that does is an onboarding scan we are not building (1.8).
3. **A path that does not exist is offered for creation inline.** Bas. Already
   built on the daemon in `91d3fa1` and kept. What changes from the first version is only where it
   shows: the button in the field rather than a footer button, plus a line in the empty area that
   they have and never reach (3.7).
4. **Git repositories: none.** No group, no badge, no scan, no `hasGit` field
   (3.3). Their git rows are about cloning a remote repository, which is a separate feature and not
   this one (1.1).
5. **Browse mode is a step, not a query.** Bas, after seeing the version the first rewrite built:
   opening it should not mean typing `~/` first. The browser is a pushed step and the query
   only decides what that step lists, which is 3.0 and what makes the rest of this work.
6. **Browsing starts in a folder from settings, else in the home of the machine being browsed.**
   Bas, after seeing it open in the folder of the project he already had open. One setting for every
   machine, empty meaning home, and a folder that is not on the machine being browsed falling back
   to home on the strength of `exists` (3.1). It could live per environment and
   server-side; ours is one for the client, which is the smaller thing that does the same job.
7. **Browsing opens on the machines when there are several, on the folders when there is one.** As
   decided with Bas, reversing the first rewrite, which argued that the active machine makes the question
   redundant. The active machine is the first row and is highlighted, so the ordinary case is still
   one keypress. The machine stays in view as the leading slot of the field, the path resets on a
   switch, and a machine that is not connected is still clickable and gets dialed (3.6).
8. **No source step.** Every row of theirs but one is about cloning, which Ruimte cannot do (3.2).
9. **No hidden-folders toggle**, reversing the first version. None is needed, and the daemon's rule
   is already theirs. The `hidden` flag stays on the daemon without a caller (4.3).
10. **No Cmd+O**, reversing the first version. This needs no chord of its own, the palette
   is one keystroke away, and the chord goes back to the browser.
11. **The mark on a folder that already holds a canvas stays.** The one row-level thing we show that
   they do not, kept because it predates all of this and because it says what Enter will do (3.3).
12. **Tab keeps completing.** The one key they leave unused and our palette already uses.
