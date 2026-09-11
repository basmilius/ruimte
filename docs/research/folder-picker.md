# Folder picker: research and design

State of the working tree on 2026-09-11, on top of `1bf8ce7`. Every path is relative to
`/Users/bas/Development/Projects/ruimte`. Line numbers are from the working tree, which has phase 5
of `docs/research/multiple-daemons.md` half landed: `apps/client/src/state/project.ts` has already
been rewritten around a `ProjectRow` while the store below it still has the old bodies, and another
agent is in that file right now. Nothing in this document is implemented; this is the document an
implementation agent executes.

One warning about the numbers: `CommandPalette.tsx`, `ProjectMenu.tsx` and `state/project.ts` are
being edited while this was written, and they drifted by up to thirty lines during the writing of
it. Every reference below was re-checked against the tree at the end, but grep for the symbol rather
than trusting the number.

## 0. Summary of the recommendation

- A `FolderPicker` dialog of its own (`apps/client/src/shell/FolderPicker.tsx`), opened from the
  project menu, the `open-folder` command, Cmd+O, and a single row in the palette when what was
  typed looks like a path. It is not a mode of anything.
- Its layout: an editable path field plus a clickable breadcrumb in the header, a shortcut rail on
  the left (Home, the open project's folder, recent projects on this machine), one scrolling list of
  directories on the right, a hint and the Open button in the footer. One list, not Miller columns
  and not a tree, because `fs.browse` answers one directory per request.
- The header carries a chip naming the machine being browsed, from `describeMachine`. The picker
  always browses the active endpoint, so the chip cannot lie.
- The native Electron dialog stays, offered only when there is a desktop bridge **and** the active
  endpoint is the daemon that served this page. Elsewhere it is absent without comment: it cannot
  see a remote file system.
- A path that does not exist is offered for creation inline, the way T3 Code does it: the button
  reads "Create and open", it creates the whole missing chain, and there is no separate "New folder"
  action. Git repositories get no list, no scan and no mark, also the way T3 Code does it.
- Two optional fields on `fs.browse` (`packages/contracts/src/fs.ts:3-25`), `hidden` on the payload
  and `exists` on the result, plus one optional `createFolder` on `project.open`. Optional because a
  client can now be newer than the daemon it is talking to, and a required field an older daemon
  does not send would fail the whole parse.
- The palette loses its browse mode: roughly 90 lines out of `CommandPalette.tsx`, leaving one row
  that hands a typed path to the picker.
- T3 Code, for the record, does the thing this proposal moves away from: their picker is a wizard
  inside the command palette. Where they are ahead is the missing-folder case (1.4), which this
  copies as behavior. Section 5 lists every decision and who made it.

## 1. What T3 Code does

Read in the fork at `/Users/bas/Development/Projects/forks/t3code`, branch `main`, at `211618fd9`
(2026-09-10); `.repos/` is vendored third party code and was left alone. Behavior and layout only;
no code from it is in this document or belongs in Ruimte.

### 1.1 There is no folder picker

T3 Code has no picker component. Folder picking is a **mode of the command palette**, a centered
modal, reached through an "Add project" row. Their palette is around 2760 lines and carries the
whole flow. So the thing Bas wants to get away from is the thing T3 Code has, which is worth saying
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

T3 Code is multi-environment: a local backend, desktop-local secondaries (WSL today), and remotes
over HTTP, Tailscale, SSH and their own tunnel. Their browse call is a per-environment RPC, so the
list is always the chosen machine's file system and local is not special-cased.

**How they say which machine: weakly.** You pick the machine in step 1, and after that there is no
chip, no title and no badge while browsing. Two machines browsing `~/projects/` look identical. The
agent that read this calls it a real gap, and I agree; section 3.5 is the opposite choice.

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

There is no recent-folders store anywhere in T3 Code, on disk, in localStorage or in a database.
Nothing records which directories you browsed. What exists:

- A server-scoped setting for the directory the browser opens in, described in their settings as
  "Leave empty to use `~/`". It seeds the field and browsing never updates it.
- A one-time scan during onboarding that walks the agent CLIs' own session histories (Claude Code,
  Codex) and offers the directories those agents have run in, each with which CLI it came from, a
  thread count, a last-active time, whether it is already imported, and the git remote read straight
  out of `.git/config` without spawning git. The wizard groups repositories first by recency,
  collapses clones of one repository, and puts non-repository folders under "Other folders".

That onboarding list is the only place in the product that shows folder recency, repository identity
or an already-imported state, and the everyday folder browser shows none of it. Ruimte gets the same
information for free from `project.list`, which is section 3.4.

## 2. What Ruimte has today

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

`apps/client/src/shell/CommandPalette.tsx` is 567 lines and carries three modes. The folder one:

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

### 2.5 The project list, mid phase 5

Before phase 5, `useProject.projects` was a flat `ProjectSummary[]` from `project.list` on the
active daemon only. In the working tree the interface has already moved to
`ProjectRow { endpointId, summary }` (`apps/client/src/state/project.ts:9-12`), with
`setProjects(endpointId, summaries)`, `patchProject`, `forgetProjects` and a `currentEndpointId`
next to `current`. The store bodies under it are still the old ones, and `apps/client/src/project/`
has no `list.ts` or `open.ts` yet, so the union is designed and not finished. Section 4.5 of
`docs/research/multiple-daemons.md` is the plan; this document assumes it lands first.

`ProjectSummary` itself (`packages/contracts/src/project.ts:368-381`) carries `projectId`, `name`,
`color`, `folder` (nullable), `lastOpenedAt`, `available`, `icon` and `nameSource`. That is a recent
folder list for free, per machine, already sorted by nothing in particular but sortable by
`lastOpenedAt`.

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

## 3. The proposal

### 3.1 One dialog, opened from four places

A new `FolderPicker`, a Base UI `Dialog` like `WorktreeDialog` and `ProjectIconDialog`, mounted next
to the others in `apps/client/src/App.tsx:50-54`. It opens from:

1. "Open folder" in the project menu (`ProjectMenu.tsx:150-152`), on desktop and in a browser tab alike.
   The native dialog stops being the desktop branch and becomes a button inside the picker (3.6).
2. The `open-folder` command (`commands.ts:110`), whose hint changes from "Type a path" to the
   folder it would start in.
3. Cmd+O. The app-wide chord block is `apps/client/src/canvas/Canvas.tsx:232-262`; `o` is free
   there and free in `commands.ts`.
4. A path typed into the palette, which hands the text over as a seed (3.7).

State goes next to the palette's in `apps/client/src/state/ui.ts` (fields at L112-121, actions at
L208-218): `folderPickerOpen`, `folderPickerSeed`, `openFolderPicker(seed?)`,
`setFolderPickerOpen(open)`.

### 3.2 Layout: a path field, a shortcut rail, one list

Roughly 720 by 480, a fixed height so the list does not resize under the cursor. Three bands:

**Header.** The path as an editable monospace field, the same `field` class the other dialogs use,
autofocused, holding the full path being browsed. To its right, the machine chip (3.5). Under the
field, a breadcrumb of the path's segments, each clickable, which is what replaces the `..` row for
the mouse. The `..` row stays in the list for the keyboard.

**Body.** A rail on the left, around 180 px, with the shortcuts of 3.4. A single scrolling list on
the right: the `..` row, then one row per directory, each with a folder icon, the name, and a
trailing mark when the folder already holds a canvas (`hasCanvas`, today's `FolderCheck` plus "Has a
canvas") or is a git repository (3.4). Rows are directories only; files are not shown, because the
thing being picked is a folder and a list with files in it invites clicking one.

**Footer.** The keyboard hint on the left, then the hidden-folders toggle, then, when it applies,
the native dialog button, then the primary button, which reads "Open folder" or "Create and open"
depending on whether the folder is there. No separate "New folder" button. Under the field sits one
line that says why a path cannot be opened, or that it will be created (3.8).

**Rejected: Miller columns.** Three or four columns is the prettier picker, and it costs one
`fs.browse` per column plus horizontal scrolling and a scroll position per column. `fs.browse`
answers one directory per request, so a five-level path is five round trips on every keystroke that
changes a middle segment. Not worth it for a dialog that is open for four seconds.

**Rejected: a tree.** `apps/client/src/shell/panels/files-tree.ts` already builds one, on `fs.list`.
Expanding in place is nice for a folder you are exploring and bad for a folder you are aiming at:
the target scrolls as parents expand, and the tree's source has neither `hasCanvas` nor a
directories-only mode. A single list plus a breadcrumb navigates a known path faster.

### 3.3 Keyboard

The field keeps focus the whole time and the list is driven through `aria-activedescendant`, exactly
the arrangement `CommandPalette.tsx:449-472` uses today.

| Key | What it does |
| --- | --- |
| Any character | Goes into the path field; the list re-browses after the same 60 ms debounce |
| Down / Up | Move the highlight; from nothing highlighted, Down takes the first row |
| Enter | Steps into the highlighted folder (the field becomes its path plus a separator) |
| Enter, nothing highlighted | Opens what the field says |
| Cmd+Enter | Opens what the field says, whatever is highlighted |
| Tab | Completes the field to the highlighted name without stepping in |
| Cmd+Up | Up one level, the Finder chord; the `..` row does the same |
| Escape | Closes the dialog |

The one rule that differs from the palette: because the field always holds a full path rather than a
query, Enter on a highlighted row is unambiguous and Cmd+Enter is the only way to open a folder you
are standing next to. That is the same pair of keys as today, with the ambiguity at L460 removed.

### 3.4 The shortcut rail

Three groups, all derived from state the client already holds, all of them a path the click writes
into the field:

1. **Home.** `useServer((s) => s.home)` for the endpoint being browsed
   (`apps/client/src/state/server.ts:8`). One row.
2. **Recent projects.** The rows of `useProject.projects` that belong to this endpoint and have a
   `folder`, newest `lastOpenedAt` first, capped at eight. After phase 5 that means filtering the
   union on `endpointId`; before it, the list is the active daemon's anyway. A row shows the project
   name with its folder underneath, the shape `ProjectMenu.tsx:127-134` already draws. Clicking one
   points the field at the folder rather than opening the project, so the picker stays a picker.
3. **The open project's folder**, when there is one and it is on this machine. One row, at the top.

**Git repositories: nothing, which is what T3 Code does.** Decided with Bas. Their folder browser
has no repository group, no repository badge and no repository sorting, and their browse entry
carries only a name and a path, so the backend never even stats a `.git` while listing (1.3). The
git rows in their second step are about cloning a remote repository, not about finding a local one
(1.1). So "like T3 Code" means: no repository list, no repository scan, and **no `hasGit` mark
either**. That drops one of the three contract fields this document first proposed.

The reasons hold up on Ruimte's side independently. There is no request that finds repositories:
`git.worktree-list` (`apps/server/src/handlers/git.ts:30`) needs a repo path to start from, and
nothing walks a home directory looking for `.git`. Such a walk over a real home directory takes
seconds and needs its own ignore rules and its own cache, which is a feature of its own size. What
Ruimte keeps that T3 Code does not have is the `hasCanvas` mark that `fs.browse` already returns
(`apps/server/src/fs/browse.ts:72`), which answers the more useful question anyway: not "is this a
repository" but "is this already a Ruimte project".

If a repository list is ever wanted, there is a better source than a walk, and T3 Code found it: the
agent CLIs' own session histories, which they scan once during onboarding (1.8). Ruimte already
reads them, in the usage scanner: `apps/server/src/usage/roots.ts:15` reads `~/.claude/projects`,
and `aggregate` folds a directory onto a known project or leaves its `projectId` null when nothing
claims it (`apps/server/src/usage/aggregate.test.ts:70-82`). So "the folders you have worked in,
including the ones that are not projects yet" is a query away whenever someone wants it. Not here.

Cloning a remote repository, which is the other half of their second step, is out of scope for a
folder picker and for Ruimte today: it needs provider settings, a repository lookup and a clone,
none of which exist. Worth knowing it is where their design goes; not worth starting here.

### 3.5 Saying which machine

The header carries a chip: the connection dot (`apps/client/src/shell/ConnectionDot.tsx`) plus
`describeMachine` (`connection-info.ts:38-49`), so the dialog reads "This Mac" or "work-laptop"
above the path. It is a label, not a switcher. The picker browses through the `transport` facade
(`apps/client/src/transport/index.ts:14-23`), which is the active endpoint by construction, so the
chip cannot lie as long as nothing lets you change it.

Browsing another machine from inside the picker is possible today (`transportFor(endpointId)`,
`transport/index.ts:29-32`) and opening a project there is not: that is phase 5's
`openProject(endpointId, projectId)`. Leaving the chip inert keeps this step independent of that
one. When phase 5 is done, turning the chip into a menu is a small follow-up and the rest of the
picker does not change.

### 3.6 The native dialog

Keep it, narrow it. The button appears only when both hold:

- `desktop() !== null`, so there is a bridge at all.
- `useEndpoints.getState().activeId === LOCAL_ENDPOINT_ID`, so the daemon whose file system is being
  browsed is the one on this machine.

Anywhere else it is absent, with no explanation and no disabled button: a native dialog cannot see a
remote file system, so there is nothing to offer and nothing to apologize for.

One known false negative: if someone pairs their own machine as a second endpoint row and makes that
row active, the picker is browsing the local file system through a non-local endpoint id and the
button is hidden. They lose a convenience, not correctness. Comparing `daemonId` against the local
row's would close that hole (`apps/client/src/state/endpoints.ts:19-23`), but the local row learns
its `daemonId` only after the first hello, so the button would flicker on a cold start. The id
comparison is the simpler rule; take it.

The label uses `fileManagerName(desktop()!.platform)` (`apps/client/src/state/server.ts:53-61`,
`apps/client/src/desktop/bridge.ts:44`), which is the Electron machine's platform and not the
daemon's. Under the rule above the two always agree, but reading the right one keeps it true if the
rule ever loosens. A folder that comes back opens straight away and closes the picker, which is what
a native dialog implies.

### 3.7 What stays in the palette and what goes

Goes, all in `apps/client/src/shell/CommandPalette.tsx`:

- `BROWSE_DEBOUNCE_MS` (L63), `parentOf` (L83-90), the `browse` state (L127), `browsing` (L166), the
  `fs.browse` effect (L168-190), `submitPath` (L226-238), the `Folders` branch of `entries`
  (L244-268), the `Folders` member of the section union (L70), the browse footer with both buttons
  (L564-595), the Cmd+Enter branch (L460-461) and the Tab branch (L465). The monospace class on the
  input and the rows (L439, L536) loses its browse half and keeps its grep half.

Stays:

- `isPathQuery` (L61), reduced to one job. A query that looks like a path produces a single row,
  "Open a folder", which calls `openFolderPicker(query)` and closes the palette. Typing `~/pro` in
  the palette still ends in the right place; it just ends there in one keystroke instead of ten.
- Everything else: jump to a node, the views, the projects (a union after phase 5), the actions,
  find in files.

That is roughly 90 lines out of `CommandPalette.tsx` and one mode fewer to reason about. It also
removes the `Folders` section's claim on the arrow keys, which is what made the palette read as two
different dialogs wearing one input.

### 3.8 A path that does not exist

Today: nothing. `browseDirectories` returns an empty list for a path that is missing, unreadable or
genuinely empty (`apps/server/src/fs/browse.ts:60-64`), so the palette shows an empty list and the
person finds out by pressing Enter and reading `folder-not-found` from
`apps/server/src/projects/project-store.ts:190-194`.

The picker should say it before Enter, and then offer to create it, the way T3 Code does (1.4).
Decided with Bas. Add `exists` to `FsBrowseResult` (4.1) and read it together with the entries:

- **The folder is there.** "Open folder", enabled. An empty folder is a perfectly good project
  folder, so an empty list is not an error; the list says "No folders in here".
- **The folder is not there.** The button becomes "Create and open" and stays enabled. Under the
  field, in the muted color rather than the error color, "This folder does not exist yet. Opening it
  creates it." The list shows nothing.
- A thrown `windows-path` or `cwd-required` (`browse.ts:33-42`) keeps showing the daemon's message
  in the error color, which is already written for a person, and the button is disabled.

**How the picker decides a folder is not there.** Two cases, following T3 Code's two tests (1.4)
because they fall out of what `fs.browse` answers anyway:

- The field ends in a separator, so `parentPath` is the folder itself: `exists` decides.
- The field does not end in a separator, so `parentPath` is its parent: the last segment exists when
  some entry's `name` equals it exactly, and does not when none does.

Their exact-match test is case-sensitive and I would keep it that way even on a case-insensitive
file system, because the folder that gets created should be the one that was typed. It carries the
edge T3 Code lives with: typing `~/pro` while `~/projects` exists reads as "not there", so the
button says "Create and open" while `projects` sits in the list. The breadcrumb and the list make
that visible, and pressing Down once takes the real folder, so it stays recoverable.

**What creating does.** No new request, the same shape T3 Code uses: `ProjectOpenPayload`
(`packages/contracts/src/project.ts:389-395`) grows an optional `createFolder`, and `openUnlocked`
does a recursive `mkdir` when the folder is absent, before the `isDirectory` check at
`project-store.ts:190-194`. Recursive, so `~/a/b/c` with no `~/a` creates all three, which is what
they do and what the field invites once you can type a whole path into it. Only the picker sends the
flag; every other caller of `project.open` keeps today's behavior, which is the split T3 Code has
too (their other two callers pass it as false).

**When creating fails.** Two cases, and Ruimte already separates them:

- Something is there and it is not a directory. The `mkdir` must not run: `isDirectory` already
  returns false and `folder-not-found` already says "`<path>` is not a folder", which is the right
  sentence for a file in the way. Keep it, and show it in the error color under the field rather
  than in a toast. T3 Code puts the same case in a toast; inline is better and costs nothing here.
- The `mkdir` itself fails, which is where a permission problem lands. A new `ProjectError` code,
  `folder-create-failed`, with the path in the message, shown the same way.

**No separate "New folder" button.** T3 Code has none and neither should this (1.4). The native
dialog still carries the operating system's own New Folder button, because
`apps/desktop/src/main.ts:396-398` asks for `['openDirectory', 'createDirectory']`, and with the
inline create that difference between the two paths disappears.

## 4. Implementation

### 4.1 Contracts

Two fields on `fs.browse`, both in `packages/contracts/src/fs.ts:3-25`, and both **optional**. The
reason is new since the multi-daemon work: a client can be newer than the daemon it is talking to.
Both sides validate with zod, so a required field an older daemon does not send makes the whole
result fail to parse and the picker shows an error instead of a folder list. An optional field
degrades into a missing mark instead.

- `FsBrowsePayload.hidden: z.boolean().optional()`. Today dot folders are only visible when the
  typed prefix starts with a dot (`browse.ts:65-67`), which the picker's field never does once it
  ends in a separator. `FsListPayload` already has exactly this flag
  (`packages/contracts/src/fs.ts:115-120`); mirror it, default false.
- `FsBrowseResult.exists: z.boolean().optional()`. Whether `parentPath` stats as a directory. An
  older daemon leaves it `undefined`, which the picker reads as "do not know": the button keeps its
  plain "Open folder" label and a missing folder fails the way it does today.

`hasGit` on an entry was in an earlier draft of this document and is **out**, per 3.4: T3 Code does
not mark repositories and neither will Ruimte. `hasCanvas` stays as it is.

One field on `project.open`, in `packages/contracts/src/project.ts:389-395`:

- `ProjectOpenPayload.createFolder: z.boolean().optional()`. Only the picker sends it, and only when
  the folder is not there (3.8). This is the same shape T3 Code uses: a flag on the command that
  creates the project, not a filesystem request of its own. No `fs.mkdir` is added.

`ProjectError` (`apps/server/src/projects/project-store.ts:40`) grows one code,
`folder-create-failed`. `fs.list` is untouched.

### 4.2 Daemon

- `apps/server/src/fs/browse.ts`: `BrowseOptions` grows `hidden`; `browseDirectories` takes it into
  the filter at L65-67, and sets `exists` in both the success path and the catch at L60-64 (one
  `stat` on `parentPath` when the `readdir` fails is enough to tell missing from unreadable). No
  `.git` stat: the per-entry work stays exactly the one `hasCanvas` stat it is today.
- `apps/server/src/handlers/fs.ts:21`: pass `payload.hidden` through.
- `apps/server/src/projects/project-store.ts:190-194`: with `createFolder` and nothing at the path,
  `mkdir` recursive, then fall through to the existing `isDirectory` check so a file in the way
  still raises `folder-not-found` with its current message. A failing `mkdir` raises the new
  `folder-create-failed`. Order matters: stat first, create only when absent, never create over
  something that exists.
- `apps/server/src/handlers/project.ts:17` needs no change: it hands the whole payload to
  `store.openProject(payload)` already.

### 4.3 Client

New:

- `apps/client/src/shell/FolderPicker.tsx`: the dialog.
- `apps/client/src/shell/folder-picker.ts` plus `folder-picker.test.ts`: the pure parts, which are
  the parts worth testing. Path joining, the parent of a path, the breadcrumb segments, and which
  shortcut rows to build from `useProject.projects` and `ServerInfo`. **These take the separator as
  an argument**, derived from the daemon's `platform` (`state/server.ts:7`), because the client has
  no `node:path` and a Windows daemon answers with backslashes. The palette's `parentOf` (L83-90)
  gets this wrong today and the picker should not inherit that.

Changed:

- `apps/client/src/state/ui.ts`: the four members of 3.1.
- `apps/client/src/App.tsx:50-54`: mount `<FolderPicker />`.
- `apps/client/src/shell/ProjectMenu.tsx:60-70`: `openFolder` becomes
  `useUi.getState().openFolderPicker(current?.folder ?? undefined)`; the `desktop()` branch and the
  `bridge.pickFolder` call move into the picker; the `desktop` import goes.
- `apps/client/src/shell/commands.ts:110`: the command opens the picker.
- `apps/client/src/canvas/Canvas.tsx:232-262`: a Cmd+O branch next to Cmd+K.
- `apps/client/src/shell/CommandPalette.tsx`: the deletions of 3.7.

### 4.4 Order of work

1. Contracts plus daemon plus tests (4.1, 4.2): `hidden` and `exists` on `fs.browse`, `createFolder`
   on `project.open`, the `folder-create-failed` code. Shippable on its own, because the palette
   ignores what it does not read and nobody sends the new flag yet.
2. `folder-picker.ts` and its test, then `FolderPicker.tsx` with the path field, the breadcrumb, the
   rail, the list, the keys, the exists-and-create button states and the error line. Wire
   `openFolderPicker` and mount it. At the end of this step both paths exist and the palette still
   browses.
3. Point the three entry points at the picker (project menu, command, Cmd+O), move the native dialog
   button in, and add the palette's single "Open a folder" row.
4. Delete the palette's browse mode.

Step 4 is the only one that touches `CommandPalette.tsx` heavily, and another agent is in that file
for phase 5. Do step 4 last, and rebase rather than resolve.

### 4.5 What can break

- **The palette's tests.** `apps/client/src/shell/palette-recents.test.ts` is about commands, not
  folders, so it should survive. Check for any test that types a path into the palette before
  deleting the mode.
- **Muscle memory.** Typing `~/` into Cmd+K is how this works today and how `commands.ts:110`
  advertises it. Keeping `isPathQuery` as a one-row shortcut is what keeps that working; dropping it
  entirely would be the actual regression.
- **A daemon older than the client.** Covered by making both browse fields optional (4.1). Worth an
  explicit test: a `FsBrowseResult` without `exists` must still parse. `createFolder` is optional on
  the payload side, so an older daemon ignores it and answers `folder-not-found`, which the picker
  must still render rather than treat as impossible.
- **Creating a folder nobody meant to create.** The rule of 3.8 says `~/pro` does not exist while
  `~/projects` sits in the list, so a fast Enter makes `~/pro`. T3 Code lives with this. The guard
  is that the button says "Create and open" rather than "Open folder", so the label changed under
  the cursor before the key was pressed. Do not shorten that label.
- **A new error code.** `folder-create-failed` is the first `ProjectError` the client has to render
  that it has never seen; make sure the picker shows the message rather than a generic failure.
- **Windows daemons.** The picker must never split a path on `/` in the client. See 4.3.
- **Phase 5's moving floor.** `useProject.projects` changes shape underneath the shortcut rail. If
  the picker lands before phase 5, the rail reads a flat `ProjectSummary[]`; after it, a
  `ProjectRow[]` filtered on `endpointId`. Write the rail's selector in `folder-picker.ts` so the
  change is one function, not a component edit.
- **Two places that open a project.** After this, `projectClient.openFolder` is called from the
  picker only, which is a simplification; make sure nothing else grew a call site while this was
  being written.

### 4.6 Tests

- `apps/server/src/fs/browse.test.ts`: a missing directory (`exists` false), an unreadable one
  (`exists` true, no entries), and a hidden folder with and without the flag.
- `apps/server/src/projects/project-store.test.ts`: `createFolder` on a path that does not exist
  creates the whole chain and opens; `createFolder` on a path that is a file still raises
  `folder-not-found`; without the flag a missing folder still raises `folder-not-found`.
- `apps/client/src/shell/folder-picker.test.ts`: parent of a POSIX path, parent of a Windows path,
  parent of a root, breadcrumb segments for both, the shortcut rows built from a fake project list
  with one folderless project and one project on another endpoint, and the "does this folder exist"
  rule of 3.8 over both branches (trailing separator, and an exact name match that is
  case-sensitive).
- No component test; the client has none of those today.

## 5. Decisions

Nothing here is open. Two of these are Bas's, answered as "the way T3 Code does it"; the rest are
settled by this document and each one is a small edit if he wants it the other way.

1. **Git repositories in the picker: none.** Bas, as T3 Code does. Their folder browser has no
   repository group, no badge and no sorting for them, and their browse entry carries only a name
   and a path, so nothing stats a `.git` and nothing walks a tree (1.3). Ruimte does the same: no
   list, no scan, and no `hasGit` field, which is one field out of 4.1. `hasCanvas` stays, because
   it already exists and answers the better question. The clone half of their second step (git URL,
   provider lookup, clone destination) is a separate feature and not part of this one (3.4).
2. **A path that does not exist: offer to create it, inline.** Bas, as T3 Code does. The button
   flips to "Create and open" and stays enabled, creating the whole missing chain on confirm, with
   no separate "New folder" action anywhere, which is exactly their shape (1.4). Ruimte carries it
   on a `createFolder` flag on `project.open` rather than a new filesystem request, and shows the
   two failure cases inline rather than in a toast (3.8, 4.1, 4.2).
3. **The picker opens a project.** It does not hand a path back to a caller. That is the only thing
   a folder is asked for today, and T3 Code goes further still by dropping you into a fresh thread
   (1.5). If a second purpose ever appears (a cwd for a terminal node, a worktree root), the dialog
   takes a `purpose` prop and the footer button takes its label from the caller. Cheap then, so
   there is no reason to carry it now.
4. **The machine chip is a label, not a switcher.** T3 Code picks the machine as an explicit first
   step and then shows nothing at all while you browse (1.6), which is the half of their design
   worth avoiding rather than copying. A switcher needs phase 5's
   `openProject(endpointId, projectId)` to be worth anything, so it waits for that and changes
   nothing else in the picker (3.5).
5. **Hidden folders get a toggle**, which is the one place this deliberately does not follow T3
   Code. They have none: a dot folder appears only once the typed segment starts with a dot, a rule
   that is invisible in a one-line palette and would be stranger still in a dialog with a footer.
   The flag mirrors one `fs.list` already has and the toggle is one button (4.1).
6. **Cmd+O opens the picker.** Free in the chord block and free in `commands.ts`. It is also the
   chord a browser tab would give to its own open dialog if the page did not take it; taking it is
   right here, and it is one line to give back.
