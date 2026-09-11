# Decisions

Why Ruimte is the way it is, for whoever picks this up next (human or agent). Read `CLAUDE.md`
first for the rules and the architecture, and `README.md` for the principles. This file is the
log beside them: the choices that left no trace in the code, the traps that were paid for once,
and what is still open. It grows at the bottom and is never rewritten to match the code.

## Nodeterm parity

What nodeterm (`~/Development/Projects/forks/nodeterm`, read for behavior only) has on its
canvas, against Ruimte, one verdict each.

| Nodeterm | Ruimte | Verdict |
| --- | --- | --- |
| Terminal node, agent CLIs as terminals | Terminal node, chat nodes for Claude and Codex, and every CLI in the catalog as a terminal agent the daemon launches | Done, phase 13 |
| Sticky note (7 colors, markdown, title, agent reads it over a link) | Note node (5 colors, markdown, title, text source over an edge) | Done, phase 12 |
| Context links (agent to agent, sticky to terminal, drag from handles, delete by double-click) | Edges from any node or text to any other; into an agent they are context, "Connect to..." in the menu | Done, phase 12 |
| Group frame with a bound worktree | Group node with collapse, nesting and a worktree | Done |
| Browser node (navigable Chromium) and Web node (one page, fits content) | Browser node in the desktop app | Done; the fit-to-content web node is a browser node with a size, skip |
| Editor node (Monaco, image and PDF preview, Cmd+S) | None | Later: an agent's edits already show as diffs in the chat; a file viewer is worth it once the daemon has an upload and file index (the composer's `@` picker is the start) |
| Diff node (HEAD vs index vs worktree per file) | Changed-files card with the turn's checkpoint diff | Done for a turn; a standalone diff node for a folder is still later |
| Files node (folder listing pinned to one directory) | Folder browsing in the palette | Skip: the palette browses; a directory pane on the canvas invites a file manager, which is not the product |
| Subagent node (live card per Claude subagent from hooks) | Subagent tool calls fold into the chat's work rows | Later, only if hooks carry enough: a card per subagent on the canvas is a status view, and the chat's folded rows already show it |
| Loop node and Trigger node (cron and schedule into a terminal) | None | Skip: scheduling belongs to the agent's own tools or the OS; a canvas is not a scheduler |
| Video node (local or remote file) | None | Skip: a browser node plays a file URL |
| Image and PDF preview (inside the editor node) | None | Later, with the editor node |
| Dino minigame | None | Skip |
| Kanban board (separate view, session cards in columns) | None | Skip, a decision in this file: no kanban, ever |
| Spawn team (agents wired to their opener) | None | Later, phase 18: the chat backends, the edges and the worktrees it needs are there |
| Remote pairing and relay | Endpoints with pairing, tokens and origin checks | Done, relay is a seam |

## Decisions that are not in the code

- No kanban view, ever. Bas dislikes that workflow.
- No bare single-letter shortcuts. Every chord needs a modifier and becomes remappable in a
  later settings phase; until then the Keyboard section only lists them. The one exception is a
  drawing view: it has the keyboard the way a terminal has it, and its tools are the bare letters
  and digits every sketching app uses (V/1 select, H hand, R/2 rect, D/3 diamond, O/4 ellipse,
  A/5 arrow, L/6 line, P/7 freehand, T/8 text, E/0 eraser, Q keeps the tool). They fire only while
  no text is being typed and no dialog is up, and they are listed under "Drawing" in the Keyboard
  pane like every other chord.
- A workspace is a React context, not a global. One open project means one daemon, one project and
  drawing client and one set of the four stores that hold a canvas (`useCanvas`, `useDocument`,
  `useDrawing`, `useProject`); a panel or a node inside it reads its machine from the subtree it is
  in rather than from "the endpoint that is active". Contexts are rare in this app (the tooltip
  provider, the panel header slot, the file actions), and this is the fourth on purpose: threading an
  endpoint id through thirty files would have been worse in every way, and without it two projects
  from two machines can never be edited at the same time. The app draws one workspace today; the
  pane layout that draws two is a feature of its own.
- Never highlight the canvas grid in the accent color. The dots stay neutral in every state.
- A drawing keeps its elements beside `project.json`, in `<folder>/.ruimte/drawings/<viewId>.json`,
  and they go into git with it: a sketch that explains a repository belongs to that repository. The
  file is named after the view id, never the view name, so a rename moves nothing, and every color
  in it is a palette name, never a hex value, so the same file reads in both themes.
- Icon buttons get equal padding on every side. Buttons that belong together sit in a
  `BTN_GROUP` with 1px gaps; groups keep the wider gap of their container.
- The shared components in `src/ui/` are `Icon`, `Brand`, `Tooltip`, `Select`, `Button`
  (primary, secondary, ghost, danger; 28 and 32 pixels), `Pill` (the rounded label in a node
  header) and `EmptyState` (icon, one sentence, one action). A node's own "connecting" or
  "failed" card is `canvas/nodes/NodeNotice.tsx`. Every text input is `.field` in `styles.css`,
  one height and one focus ring; `SECTION_LABEL` (`src/ui/classes.ts`) is the uppercase label
  outside a popup and `MENU_HINT` the trailing hint inside one, with `<kbd>` left for chords only.
- `styles.css` is the tokens, the themes and the rules a utility cannot write: Base UI's `data-*`
  states shared by every menu, picker, dialog and tooltip, the `:not()` chain that keeps a node's
  focus ring behind its focused and selected outlines, the panel shell's `[data-instant]` and
  `[data-resizing]`, `[data-modality]`, `::selection`, the keyframes, and everything that styles
  DOM the JSX never sees (xterm, shiki and its line-number counter, the `@pierre/diffs` and
  `@pierre/trees` variable overrides, the file icon hues, the `<webview>` a preview is drawn in).
  Every rule that was only a bundle of utilities moved to its call site, or to a class string next
  to the component that uses it: `src/ui/classes.ts` (the glass card, the button group, the menu
  and section labels, the chord), `src/shell/panels/classes.ts` (the file toolbar, the git rows,
  the commit box) and `src/chat/ui/chips.ts` (the mention and skill pills). That took the
  components layer from 157 rules to 92.
- What is left in that layer stays in Tailwind's `components` layer. An unlayered rule beats
  every utility of the same specificity, so `icon-btn h-7 w-7` silently stayed 32 pixels and
  `menu-popup min-w-48` kept the wider default; inside the layer a call site's utility wins,
  which is what the heights in the code already claimed.
- Markdown is Tailwind Typography (`@plugin "@tailwindcss/typography"`), not a stylesheet of its
  own: the `Markdown` component carries `prose prose-sm max-w-none text-sm` next to
  `.chat-markdown`, and `.chat-markdown` is only what the app decides instead of the plugin. The
  plugin registers `prose` with `addComponents`, so its rules land in the same `components` layer
  and are written after the app's own, which lose a tie on order. Whatever has to beat them says
  so: the variables through `.prose.chat-markdown`, the rest through a selector of its own (an
  element next to the class outranks the `:where()` prose wraps its own in), and the size through
  the `text-sm` utility, since a utility is a layer later. That is why the size is not in
  `.chat-markdown`.
- The colors are the semantic tokens mapped onto the prose variables (`--tw-prose-body` and
  `--tw-prose-headings` from `--text`, `--tw-prose-links` from `--accent`, `--tw-prose-code` and
  `--tw-prose-pre-code` from `--text` with `--tw-prose-pre-bg` from `--surface-sunken`, counters
  and bullets from `--text-faint`, every border and rule from `--border`, captions from
  `--text-muted`). The tokens flip with the theme themselves, so both themes come free and
  `dark:prose-invert` would only be a second source of truth. The size is `--text-sm` and its line
  height, which a chat node, a chat view and the file preview each set for themselves, so prose
  reads 14/22 on the canvas and 15/24 in a view and in a preview; every margin prose sets is an
  `em`, so the air follows the size. Headings stay on the app's flatter scale (h1 `--text-lg`, h2
  `--text-base`, h3 and h4 `--text-sm`) and code stays on `--text-code`, without the quotes prose
  puts around inline code. What is left in `.chat-markdown` is what prose lacks: task lists
  without a bullet, and a table in a `.chat-table` wrapper that scrolls on its own instead of
  widening the column.
- What floats over what is four numbers in `styles.css`: dialog backdrop 80, dialog 90,
  `--z-popup` 100 (`z-[var(--z-popup)]` on every menu, select and popover positioner, so one
  opened inside a dialog is not swallowed by it), tooltip 110.
- An icon-only button gets its accessible name from its tooltip: `<Tooltip label="Close node"
  name>` puts the same string on `aria-label`, so the two can never drift apart.
- Every icon is a Lucide icon drawn by the `Icon` component in `src/ui/Icon.tsx`
  (`lucide-react`). The pixel box, the 1.75 stroke weight and the optical alignment live there, so
  a call site only picks the icon and its pixel size. An icon inline with 12px text is 12px, next
  to 14px text 14px, and a standalone icon button is 16px in a 28 or 32 pixel square. The agent
  CLIs' brand marks are simple-icons paths in `AgentIcon`; Codex has none, so it takes Lucide's
  `Bot`.
- The brand is the symbol from `assets/logo.svg` plus the word "Ruimte", drawn together by
  `src/ui/Brand.tsx` (`BrandSymbol` is the symbol on its own). The symbol is inline SVG, never
  an `<img>`, so it takes its two fills from `--brand-front` and `--brand-back`. The wordmark is
  always live text in Geist Semibold, never an outlined path.
- The brand gray scale is "iron", eleven steps in `styles.css` as `--color-iron-*`. It sits
  outside `@theme` on purpose, so there is no `bg-iron-*` utility and nothing can reach past the
  semantic tokens; the interface palette is unchanged and only `--brand-front` and `--brand-back`
  read from iron. Light is iron-300 on iron-900, the file's own colors. Dark keeps the front at
  iron-300 and lifts the back to iron-700, because the symbol's iron-900 back is darker than the
  dark surface it sits on and the shape would disappear.
- Icons and tiles (the favicon, `site/icon.svg`, `apps/desktop/build/icon.*`) carry fixed brand
  colors and never follow the theme: the silhouette on an iron-900 tile. The back shape there is
  the tile's own color, so what those tiles center is the visible silhouette, not the bounding
  box of both shapes.
- Geist is in the client for the wordmark only (`@fontsource-variable/geist`, imported once in
  `main.tsx`, family "Geist Variable" behind `--font-brand`). The interface font stays the system
  stack; no other text may use `font-brand`. The second bundled face is Kalam
  (`@fontsource/kalam`, weight 400, OFL 1.1), the hand a drawing writes in. It is imported lazily
  by the first drawing view, never at startup, and only a `text` element in a drawing may use it;
  its other two fonts are `--font-sans` and `--font-mono`. Excalifont was rejected on purpose: it
  is Excalidraw's own face, and a Ruimte drawing should not look like an Excalidraw one.
- No fractional pixels. Type sizes, paddings and stroke widths are whole numbers; a `rem` value
  has to land on a whole pixel at the 16px root, and an `em` at the size it inherits. Ratios
  (line height, opacity, letter spacing) are not lengths and stay as they are.
- One type scale, declared once in `@theme` in `apps/client/src/styles.css`, never a bracket
  size at a call site: `text-xs` is 12/16 for meta (hints, pills, kbd, tooltips, badges,
  counters, section labels), `text-sm` 14/20 for body (rows, inputs, menus, chat text, the
  composer, node titles), `text-base` 16/24 for dialog titles and markdown h2, `text-lg` 18/24
  for markdown h1. Nothing sits below 12px. The four are `rem`, so a change of the root font
  size moves text and the rem-based layout together, the way T3 Code does.
- Code keeps a size of its own, `--text-code` (13px mono on a 20px line), for code blocks,
  inline code, diffs, tool output and the mono inputs. It is absolute, so it never scales twice
  with the root, and the terminal has its own `fontSize` setting (default 13) next to it.
- The interface font size (Settings > Appearance, 12 to 20, whole numbers, default 16) is the
  root `font-size` on `<html>`, written by `state/settings.ts`. Sizes fixed in world
  coordinates do not follow it: the node header stays `39px` (`GROUP_HEADER_PX`,
  `WebviewLayer`), because a header that moved would move every node's contents on the canvas.
- Tooltips are the `Tooltip` component in `src/ui/Tooltip.tsx`, never a `title` attribute.
  One `TooltipProvider` at the app root gives the shared 150 ms delay.
- Escape in a terminal node goes to the program (Claude Code interrupts on it, vim lives on it).
  Leaving the node is Cmd+Escape on macOS and Ctrl+Shift+Escape elsewhere, plus the dock's mode
  chip and a click on the canvas; the chord is `isLeaveNodeChord` in
  `apps/client/src/terminal/keymap.ts`, and the terminal's key handler swallows every other
  Escape before the canvas listener sees it. Chat, browser and note nodes still leave on plain
  Escape. Ctrl+Escape is the Windows Start menu and Ctrl+Shift+Escape is its Task Manager, so a
  Windows build still has no chord the OS leaves alone: the mode chip is the way out there.
- On macOS a terminal node has the line and word motions a native terminal has and xterm does
  not: Cmd+Left and Cmd+Right send Home and End in the form the application cursor keys mode
  asks for (`\x1b[H` / `\x1b[F`, `\x1bOH` / `\x1bOF` under DECCKM), Option+Left and
  Option+Right send `\x1bb` / `\x1bf`, and Cmd+Backspace sends Ctrl+U. `macMotionSequence`
  (`apps/client/src/terminal/keymap.ts`) is the whole mapping; the key handler writes the bytes
  itself and returns false, so xterm adds nothing and the chord never reaches the canvas. Other
  platforms keep their own conventions.
- An image icon is a file in the folder, never a blob in `project.json`: every save rewrites
  that file and every `project.changed` ships it, so 256 KB of base64 would ride along each time.
  A derived name or icon is never written back either, so the folder stays the one place that
  decides and a person can change it from outside the app.
- Formatting is prettier (`.prettierrc`: single quotes, width 160, 4 spaces). Run
  `bun run format` before a commit.
- A line between two non-agent nodes means nothing to the daemon; it is a drawing. Only the
  client's `context/sources.ts` decides what an edge means, from the target's kind, so the
  daemon never learns about plain lines and `ContextSource` needs no new kinds: a note travels
  as `text` with its title and body. Notes are not in the sidebar; that list is about what
  runs.
- "Connect to..." is a click mode, not a drag: the draft follows the pointer without a button
  held, because a menu item cannot hand over a pointer capture. Escape and empty canvas cancel.
- Status hooks are `command` hooks with curl, not Claude Code's `http` hooks: the http kind
  cannot read the daemon's port from the environment and reports an error whenever Ruimte is
  not running. The command hook is a no-op without `RUIMTE_HOOK_URL`.
- A chat process is not started when the node mounts, only on the first message, so a canvas
  full of chat nodes costs nothing until used.
- A turn's checkpoint diff compares two trees of ours, not the tree against the working tree:
  `git diff <tree>` only sees what git already tracks, so a file the agent created would be
  missing. The prompt waits for the checkpoint (a few milliseconds on a warm index), because a
  tree taken after the first edit is not a checkpoint. Nothing restores a checkpoint; going back
  would undo the person's own edits of that turn as much as the agent's.
- The demo canvas is gone. A fresh install boots into an empty "Untitled canvas" project; the
  last opened project id lives in localStorage.
- Terminal and chat nodes without their own directory start in the project folder.
- Switching or closing a project swaps the canvas with `loading` set, which the session
  lifecycle reads as "not a delete": nothing is killed. Deleting a node still kills its session.
- New chats start in full access, as in T3 Code; the composer remembers a model per provider
  (`selectionByProvider` in `chat/preferences.ts`) and the modes in localStorage, with the
  provider picked last as the default for a chat that names none. A slug only means something
  inside its own catalog, which is why the older global `selection` is dropped on read instead
  of mapped. A supervised chat is one click away in the mode picker.
- A model or mode change restarts the CLI process with `--resume` on the next send instead of
  using the control protocol's `set_model`; one path, and the resumed session keeps everything.
- `interactionMode` and `ProviderCapabilities.planMode` are off the wire (phase 15). A stored
  chat written before that keeps parsing: zod strips what the schema no longer knows.
- Fast mode is offered on the models that have it. `--settings '{"fastMode":true}'` is both the
  switch and the opt-in the CLI asks for: without it the init frame answers `fast_mode_state: off`
  with `fast_mode_disabled_reason: sdk_opt_in_required`, with it the reason is gone, and on
  2.1.267 only Claude Opus 5 answers `fast_mode_state: on` (Sonnet 5, Fable 5.1, Haiku 4.5 and
  Opus 4.6 all stay off). So the boolean descriptor sits on Opus 5 alone, in a profile of its own;
  move it as soon as another model answers on. Codex's counterpart is the priority service tier,
  which `model/list` reports per model as `serviceTiers: [{ id: 'priority', name: 'Fast' }]` for
  everything except Codex Spark; it goes out as `serviceTier` on `thread/start` and `turn/start`.
  Both are ordinary option descriptors, so they are remembered per provider with the model.
- Claude Code 2.1.266 emits `tool_progress` (`tool_use_id`, `tool_name`, `parent_tool_use_id`,
  `elapsed_time_seconds`, `task_id`, `heartbeat`) for a local Bash only when
  `CLAUDE_CODE_REMOTE` or `CLAUDE_CODE_CONTAINER_ID` is set, throttled to one per 30 s, and
  it never streams partial Bash output. Neither variable is set on purpose: both change other
  behavior (headers to Anthropic, temp dir checks). The live timer therefore counts on the
  client, and partial output is plumbing for a provider that has it (Codex streams command
  output).
- `@file` mentions are plain `@path` text in the prompt, because that is what the Claude CLI
  expands itself (checked with `claude -p` 2.1.266); the chosen paths travel next to the text
  as `mentions` only so the timeline can draw them as chips. In the composer a chip is painted on
  a layer behind the textarea, so it may only add a tint, an inset ring and a radius
  (`CHIP_BEHIND_TEXT` in `src/chat/ui/chips.ts`): the caret is placed by the textarea from its own
  raw text, so a weight, a font size or a horizontal padding on the chip moved the drawn text off
  its characters and left the caret sitting in the wrong word. Padding cannot be handed back as a
  negative margin, since a wrapped chip takes it again on every line, and `chipText` is what the
  layer draws so a test can hold it against the textarea's value. The pill with the file icon in
  front of the path is the sent message's (`CHIP_IN_MESSAGE`). The picker searches through
  `fs.search`: `git ls-files` (tracked plus untracked, minus .gitignore) inside a repo, a
  bounded walk elsewhere, ranked by a small fuzzy score on the daemon.
- An attachment goes over the wire as base64 in `chat.send` once (25 MB and 8 per message) and
  never again: the daemon writes it under `$RUIMTE_HOME/attachments` and the thread keeps its
  name, mime, size and path. The prompt names the file by path instead of carrying an `image`
  block, because both CLIs read a file with their own tools and a path costs no tokens until
  the agent looks. A remote client uploads over the socket like a loopback one; a signed HTTP
  upload is only worth it once someone attaches a video over a slow link.
- A thinking row shows what the model weighed before it answered: "Thinking..." with the text
  under it while it streams, "Thought for 8s" with the text behind a fold once the answer
  starts. Claude's thinking deltas and Codex's reasoning summaries both become one `thinking`
  item per stretch, and `ProviderCapabilities.reportsThinking` says which CLI hands it over.
  Codex is otherwise silent for long stretches, which is where this earns its place.
- Any file can be attached now, up to 25 MB and 8 per message. The bytes go to
  `$RUIMTE_HOME/attachments/<chatId>/<id>.<ext>` and the thread keeps name, mime, size and path,
  which also ends the growth the old inline images caused: a thread written before this is
  migrated on the read that opens it. The prompt names the files by path, since both CLIs open a
  file with their own tools, and `GET /attachments/<chatId>/<id>` serves thumbnails and downloads
  behind the project icon's access rules.
- Enter while a turn runs queues the message instead of refusing it. The queue lives on the
  daemon (`ChatInfo.queue`, written with the thread, so a reload keeps it) and drains when the
  turn settles; the composer draws the waiting messages above itself with remove and "Send now",
  which interrupts the turn and puts that message first. One explicit queue for both CLIs
  instead of Claude's silent steer and Codex's own turn queue. A chat's record is written one
  write at a time now: two in flight together renamed in either order, so an older snapshot
  could land last and take the queue back.
- `$` in the composer opens the skill picker, the same shape as `@`: search, arrow keys, the
  description on a second line. A picked skill becomes a `$name` chip in the text and a name in
  `skills` on `chat.send`, and the slash menu labels the entries that are skills, inserting
  `$name` so both spellings end on one path. Claude Code expands a skill only from the last text
  block of a message when that block starts with `/name` (measured against 2.1.267 with a skill
  that writes a marker file), so the daemon splits the prompt and puts the invocation last;
  Codex reads `$name` in the text itself. Discovery is the daemon's (`apps/server/src/skills`),
  narrowed after the first message to the `skills` array the CLI's own init frame carries.
- A chat item id is the backend's own key for the item with the process generation in front
  (`1:toolu_x`), so a resumed CLI that numbers its messages from the start cannot overwrite an
  older item. An approval keeps `approval-<requestId>` as it was, since that id round-trips to
  the client; Codex's request ids carry the generation themselves, because its JSON-RPC ids
  start at 0 in every process.
- A model or mode change restarts the CLI for both providers, even though Codex takes the model
  per turn. One rule is easier to reason about than a per-provider one, and a restart with
  `thread/resume` keeps everything.
- Codex chats hear about linked context too: the app-server has no system prompt, so the
  `ruimte-context` sentence goes in front of the first prompt instead of on a flag.
- The composer guards a long prompt: past 100k characters a counter appears, past 120k the send
  is refused, which is the size where a turn gets slower than the answer is worth. Commands only
  the CLI's own terminal can run (`/clear`, `/login`, `/theme`, `/doctor`, ...) are filtered out of
  the slash menu even though the init frame lists them (`chat/guards.ts`); `/clear` is in that list
  for a reason of its own, since it would empty the CLI's context while the thread still shows
  every item. PageUp and PageDown page the thread from the composer, through a scroller the
  timeline registers per chat (`chat/timeline-scroll.ts`), and a chat node with an unsent draft
  gets a dot on its sidebar row (`useHasDraft` in `chat/drafts.ts`, the store next to the
  localStorage the composer already wrote).
- Cmd+S in the composer stashes the draft and clears the box; on an empty box the same key takes
  the newest one back. The shelf is one list for the whole app in localStorage, twenty entries
  deep, because a stashed prompt usually moves to another node on the canvas. A stashed entry
  keeps the text, the mentions, the skills and what the files were called; the bytes are not kept,
  so the row says so and the files are not restored.
- Prompt recall is the other half of that shelf and keeps no storage of its own: Arrow Up in an
  empty composer walks back through the last fifty user items of that chat's own thread, Arrow
  Down walks forward, and Escape puts the empty box back instead of leaving the node (a plain
  Escape still leaves when nothing was recalled).
- An image attachment and an image an agent read open large in a dialog with zoom and pan
  (`chat/ui/ImageView.tsx`): the wheel zooms around the pointer, dragging pans, Escape closes. A
  `Read` of a path with an image suffix asks `fs.read` what the file is and draws it under the row;
  the bytes come from `GET /fs/file` like every other image the client draws.
- Codex has a `@` picker too. It has no mention part in its protocol, so the path travels as text
  in the prompt, which is all the model needs to open the file with its own tools. A bare `@` lists
  what is in the folder instead of waiting for a query.
- An async Codex question carries `async` on its item, which is what lets the dock offer Dismiss:
  `chat.dismiss { chatId, itemId }` settles it as `dismissed` and tells the CLI nothing, because it
  asked beside its turn and goes on either way. A blocking question and an approval refuse the call.
  The dock also says how many other approvals and questions wait ("2 more"), and a decline can
  carry a note for the agent where the CLI takes one (`ProviderCapabilities.denyReason`, Claude
  only); the note travels as the `message` the approval contract always had.
- Codex runtime modes: `supervised` = `untrusted` + `read-only`, `auto-accept-edits` =
  `untrusted` + `workspace-write`, `auto` = `on-request` + `workspace-write`, `full-access` =
  `never` + `danger-full-access`. Not mapped: cost (Codex reports none), the deny reason, slash commands, permission-profile
  requests and MCP elicitations (refused with a JSON-RPC error). Gemini and Copilot open as
  terminals only; the daemon builds their launch line like every other CLI's.
- The title of a node follows the session until someone sets it. `titleSource` on the node says
  who named it: absent means nobody has, `'auto'` means the session did, `'user'` means a person
  did and nothing overwrites it again. A chat takes its name from the prompt that opens it
  (`deriveNodeTitle` in `apps/client/src/chat/title.ts`: the first line, cut around 48 characters
  on a word boundary, without the punctuation that ended the sentence), once, so a later prompt
  never renames a node you are looking at. Every rename goes through `renameNode`, which writes
  `'user'` unless a caller says otherwise. A terminal agent cannot follow this rule yet: the hooks
  of Claude Code and Codex carry `session_id`, `hook_event_name`, `transcript_path`, a tool name
  and a notification type, and no name the CLI gave the session, so the name would have to come
  out of the transcript file. That is a reader per CLI and is not built.
- A CLI that goes down with its shell is `exited`, not `error`. The daemon sees the PTY child end
  while its agent record is still live and writes `status: 'exited', live: false`
  (`SessionManager.handleExit`), the record outlives the shell, and the node shows `[session ended]`
  with a Resume button next to Restart. Resume puts the CLI's own session id on the node
  (`resume`) and starts a fresh shell, which the daemon launches with the CLI's resume line; the
  status is no longer `running`, so the sidebar and the dock's summary stop counting it. This is the
  daemon's own reading, the one thing the hooks structurally cannot report.
- A note starts an agent: "Start agent from note" in a note's context menu makes a chat node beside
  it, fixed to the CLI you picked, seeds the note's body as the composer's draft (never sent, the
  person presses Enter) and draws the edge from the note into the chat, so the note stays readable
  through `ruimte-context` after it is edited.
- Usage is a page, not a view. A view lives in `project.json`, a shared file that goes into git, and
  what both CLIs cost on this machine has nothing to do with a project. It would also add a literal
  to a zod union the daemon and the migration both read, and give every project a sidebar row for
  it. So it is `page: 'usage' | null` in the ui store, beside `paletteOpen` and the settings flag,
  drawn by `ViewHost` over the canvas the way a standalone view is. The settings dialog was the
  other candidate and is too small for a chart and two tables; what does belong there later is the
  price override editor. Nothing about the page is persisted: a reload lands on the project's own
  view. It closes at the top of `showView` (`project/views.ts`) rather than in the store, because
  every route to a view runs through there and the ui store may not import the document store.
- The usage index is JSON, not SQLite. It is derived data: 1,400 transcripts cold-scan in 2.2 s and
  a warm pass is 50 ms, so losing the file costs seconds and nothing else. Records of a transcript
  Claude Code has since cleaned up do stay in it, which is the one thing a rescan cannot rebuild.
  `bun:sqlite` is the way out if the file ever grows past a few megabytes (4.9 MB here).
- Nothing in usage reads a credential. The plan windows come from the CLIs themselves: a probe
  process is started, asked and ended, and the events of a running turn fill the gaps. Reading the
  keychain or `~/.codex/auth.json` and calling the vendors' usage endpoints was tried in ai-usage
  and removed there: a keychain prompt on every token refresh, 429s, and no way to refresh. The
  LiteLLM fetch is the daemon's first outgoing HTTP request; a snapshot ships with the app so it is
  optional, and `--no-price-fetch` turns it off entirely.
- Provider colors are tokens of their own, `--chart-claude` and `--chart-codex` (Apple's system
  orange and teal, the pair ai-usage uses), with `--chart-gemini` and `--chart-copilot` reserved.
  They are not the status colors: a bar segment names which CLI did the work, and red, amber and
  green already mean something else everywhere in this app.
- The limits look like ai-usage's: the used percentage as a whole number, a bar capped at 100, red
  from 90% and amber from 70%, and the reset as a clock time ("resets 16:18" today, "resets Tue
  09:00" otherwise). No countdown that ticks, no hairline for the elapsed share, and no amount on
  the sidebar button.
- The chart is 150 lines of SVG rather than a library. Recharts is 7.4 MB unpacked, chart.js 6.2 MB,
  and the only arithmetic a library would bring is a nice scale of ten lines. It draws in real
  pixels from a `ResizeObserver` instead of a stretched view box, so a bar lands on whole pixels.

### Updating

- The shell no longer interrupts. `setupUpdates` used to check once at startup and pop a native
  dialog when a build had come down; it is now a state machine (`unsupported`, `idle`, `checking`,
  `current`, `available`, `downloading`, `ready`, `error`) pushed to the window on every change. The
  client draws it: a green button in the toolbar next to the palette when there is something to do,
  and the Updates pane in settings for the detail.
- The check runs when the client starts and every hour after that, from the shell, so it survives a
  reload of the window. The timer starts with the first preference the client sends and never
  before: until then the shell does not know whether it may download what a check turns up. A check
  is skipped while one is running, while a download is running, and once a build is waiting to be
  installed.
- The auto-download preference belongs to the client, which keeps it in `localStorage` with the rest
  of the settings. So `autoDownload` starts `false` in the shell, and the client sends the
  preference and only then asks for the first check. Otherwise someone who turned it off would still
  get a download on every launch, in the window before the client boots.
- `--positive` is a new token, and the only green in `styles.css` that is not a domain color: the
  others belong to the terminal's ANSI palette, to notes, to drawings and to file icons.
  `--status-idle` is the same green but reads wrong on an update button.
- The bridge methods are optional, like the ones before them: a shell that is already running
  carries the preload it started with, so the client has to work when they are missing. Without
  them the state stays `unsupported`, no button appears, and the pane says where updates come from.


### Skipped on purpose

From nodeterm: kanban, loop and trigger nodes, minimap, dictation, notch HUD, agent-to-agent
messages through the PTY, mobile app, managed accounts, terminal color schemes, most of its
settings panes. From T3 Code: the PR client, Clerk cloud and relay, SSH and WSL environments, MCP
browser automation, cookie and theme import, usage scanning, the mobile app. Neither has fork,
retry or edit-and-resend worth copying; T3 Code has no OS notifications or dock badge at all.
Also decided against for now: a scheduler, checkpoint restore and telemetry.

## Gotchas already paid for

- React registers `wheel` listeners as passive. Pinch zoom needs the native, non-passive
  listener in `Canvas.tsx`, and the document-level guard keeps a pinch over the sidebar from
  zooming the page.
- A `mousedown` after `pointerdown` moves focus to `body` after the node's focus effect ran.
  The body-click branch in `Canvas.tsx` calls `preventDefault` for that reason.
- A zustand selector that builds a new array or object each call (`Object.keys(...)`) loops
  forever under `useShallow`. Select the object and derive with `useMemo`.
- Tailwind's `dark:` variant follows `data-theme`, not the OS (`@custom-variant` in
  `styles.css`).
- `bun test` would pick up the Playwright spec; `bunfig.toml` excludes `e2e/`.
- `WebglAddon.dispose()` puts the DOM renderer back but leaves its canvas to the garbage
  collector, so the browser keeps counting that context. The budget loses it by hand
  (`WEBGL_lose_context`) after the dispose, when the addon's own listeners are already gone.
- The stream-json `assistant` frames arrive one content block at a time under the same
  message id, and their block index does not match the streaming index. Text items are keyed
  by message id and the ordinal of the text block (`claude-protocol.ts`), and the projector puts
  the process generation in front, because a resumed process numbers its messages from the start
  again.
- `AskUserQuestion` arrives as a `can_use_tool` request; the answer is an allow with
  `updatedInput.answers` keyed by the question text, not by an id.
- A background sub-agent settles twice over: the Agent call is answered at once with "Async agent
  launched successfully", and what it came to only arrives much later as `task_notification`. Its
  report is not in that frame (`summary` is a line, the real report goes to the CLI's own internal
  message), so the projector keeps the last text the sub-agent wrote as the result. A foreground one
  answers its own call with the report plus an `agentId ... <usage>` footer, which is stripped with a
  tolerant regex: when the CLI rewords it the row shows a stray line and nothing breaks. Because a
  background agent outlives the turn that launched it, the end of a turn may not settle its row;
  only a process that is gone marks it failed.
- `@pierre/diffs` marks itself side-effect free, so `import '@pierre/diffs/worker/worker.js'`
  in a worker entry is tree-shaken to nothing. The pool uses Vite's `?worker` import instead.
- `bun --watch` restarts the daemon on every file change and the daemon installs hooks at
  startup, so editing the server while `bun dev` runs also rewrites the hook settings (idempotent).
- A `bun --watch` reload does run the SIGTERM handler in the same pid, but the module restarts
  before anything the handler awaits comes back (measured: a 500 ms timer never fired, a real
  `kill` lets it through). So `shutdown` writes the chats synchronously before its first await
  (`ChatManager.persistAllSync`), and a chat is written when a turn opens and after every tool
  call, not only when the turn settles. Without that, editing the server during a turn lost the
  whole turn and left the CLI process orphaned, still writing files nobody would see.
- A terminal inside another Electron app (an IDE, an agent shell) exports
  `ELECTRON_RUN_AS_NODE`, which turns `electron .` into plain Node where `require('electron')`
  is a path string. `apps/desktop/scripts/launch.ts` clears it before spawning Electron.
- Bun's CommonJS interop copies enumerable keys, and electron's exports are getters; the main
  process uses a plain `require('electron')` for that reason.
- Bun does not run Electron's install script unless it is in `trustedDependencies` (root
  `package.json`); without it `node_modules/electron/dist` is missing and nothing starts.
- `ruimte-context` is a shell script: next to a compiled `ruimte` it runs `ruimte context`,
  in a checkout it runs the source through bun, so a checkout still needs bun on the PATH.
- Bun 1.4 leaves a `bun build --compile` executable with an invalid code signature on macOS; the
  kernel kills it at launch (exit 137, even for hello world). The compile script re-signs it
  ad hoc, and electron-builder signs it again with the real identity.
- electron-builder copies `extraResources` from a folder that does not exist without a word;
  `build/after-pack.cjs` fails the build when the daemon or the client is missing. The arch
  is a command-line flag for the same reason: a daemon is compiled per arch on purpose.
- Electron names its log and user-data folders after `package.json`'s `name` unless
  `productName` is set, which gave `~/Library/Logs/@ruimte/desktop`.
- The update feed is the GitHub release of a private repository, which electron-updater cannot
  read without a token; the repository goes public with the first release, or the feed moves to
  ruimte.app (`publish.provider: generic`).
- How an agent learns that `ruimte-context` exists (`apps/server/src/context/context-note.ts`):
  a chat gets a sentence in its system prompt when it has links at process start and a note in
  front of the next prompt when the set changed between turns (also shown as an info note in
  the thread); a shell that has links when it is created gets one dimmed line above its first
  prompt (on the screen only, never typed into the PTY); a Claude Code agent inside a shell
  gets the hint as `additionalContext` from its `SessionStart` and `UserPromptSubmit` hooks,
  which is why the hook command prints curl's reply now. A link made while a shell is already
  running is only visible as the "context" chip in the node header and to the hooks. The
  shell's line depends on `context.set` reaching the daemon before `session.create`; on a
  fresh project load the client's sync (300 ms settle) can lose that race, so the chip and the
  hooks are the ones to rely on.
- The app-server frames have no `jsonrpc` field: `{ id, method, params }` out, `{ id, result }`
  or `{ id, error }` back, `{ method, params }` for notifications, and the server's own requests
  (approvals, questions) arrive with an `id` that starts at 0 for every process. Approval item
  ids therefore carry the process generation (`<generation>-<rpcId>`); Codex item ids are
  globally unique and are used as they are.
- Codex asks questions two ways. The blocking one is a server request
  (`item/tool/requestUserInput`); the async one is an `agentMessage` with `questions` and
  `delivery: "async"`, after which Codex polls with `sleep` items until a `turn/steer` arrives.
  Both are question items; the session answers the first by id and steers for the second.
- The decisions the real binary takes differ from its `availableDecisions` hint: `decline` is
  accepted even when the hint lists only `accept`, the amendment and `cancel`.


## Next

The three open issues first, then the rest in the order that makes sense. Sizes are rough: hours,
a day, several days. Each of the larger ones becomes a GitHub issue when it starts.

1. **#12**: the Codex hook contract in a terminal (the other four boxes are done). On the
   checkpoints: no way back to one (a restore reads as a revert of the person's own work as
   much as the agent's), and the diff is of the whole folder, so an edit the person made
   during a turn lands in the card too.
2. **#13**: a webview keeps the canvas's z-order only by being above everything, so a node
   dragged over a browser node slides under its page; the traffic-light inset is fixed, not
   measured; no Windows or Linux run yet.
3. **#11**: Pages with source "GitHub Actions" so ruimte.app deploys; the landing video; Windows
   (the daemon on Bun's Windows PTY or Node with node-pty, `docs/research/windows.md` is the
   design for a project in its own window, not for the platform); the daemon as a background
   service so closing the app keeps sessions alive. The signed and notarized build, the icon and
   the update path are done: `docs/RELEASE.md`.
4. **A third chat provider** (Gemini, Copilot or opencode) as the proof that the backend seam
   holds: a provider value, a backend and a protocol mapper, plus one literal in `AgentKind`.
   Hooks for Gemini and Copilot are a day per CLI on top.
5. **The rest of the git panel**: commit, push and a PR through `gh` as one stacked action with
   its progress as a toast, the branch chip with a ref picker, pull when behind, and a commit
   message written by the chat CLI when the field is left empty.
6. **Agents on the canvas**, several days. This is where Ruimte earns its name against nodeterm.
   Verbs on `ruimte-context` (`list`, `open`, `note`, `link`, `group`, `spawn-team`) that the
   daemon applies to `project.json` so the watcher carries them to the client; every verb takes a
   view and defaults to the one its own session sits in, and there are no write or close verbs.
   Spawn team on top: up to eight roles, opened in a group and linked back. Then hook-reply
   approvals for terminal agents (hold Claude's `PermissionRequest` on the daemon, answer it from
   the node header or the notification), and attention: an unseen dot on a node whose turn settled
   while it was not focused, a "Finished" count in the status summary, a turn-done notification
   with a sound toggle, a dock badge, keep awake while an agent runs, confirm before quitting.
7. **Terminal basics**, about two days. Search on Cmd+F, clickable file paths and URLs across
   wrapped rows, OSC 52 clipboard, a dropped file types its quoted path, Unicode 11 widths on both
   xterms, "Clear" in the node menu. Then "Send to linked chat" (a terminal selection lands as a
   fenced block in the composer of the chat the node has an edge to) and port discovery: an `lsof`
   poll tied to the owning session, an "Open :5173" chip that adds a browser node with an edge.
8. **Canvas ergonomics**, about two days, all machine state. Directional focus on Cmd+Arrow,
   maximize on Cmd+Shift+Enter, camera history on Cmd+[ and Cmd+] (Cmd+1..9 belongs to the views).
   Arrange, align and tidy as pure functions with palette entries; palette ranking (exact, prefix,
   substring), `>` for actions, recent nodes on an empty query, settings rows as entries. Images on
   the canvas from paste or drop, stored under `<folder>/.ruimte/images`.
9. **Chat depth**, several days. A proposed plan card with "Implement" and "Implement in a new
   node" (a chat node beside it with a context edge, so the new agent reads the plan through
   `ruimte-context`), subagent rows that stay anchored, "Copy code" per block, citations from
   selected assistant text, review comments from a diff into the prompt, approval choices with the
   provider's warning text, branch a conversation into a new node.
10. **Settings and keyboard**: one binding table with `when` contexts, read by the handlers and the
    Keyboard pane (which lists them read-only today), then overrides with press-to-record, conflict
    labels and reset. A "restore defaults" action, a canvas font size for chat and text elements,
    and settings search that the palette reads.
11. **Per-project settings** in `.ruimte/settings.json` (the terminal agent mode first), worktree
    merge and removal from the group menu, shared paths (`node_modules`, `.env`) linked into a new
    worktree, clone a repository as a project.
12. **Editor, image and diff nodes**, several days. An editor node with save, markdown preview,
    image and PDF preview; an image node; a diff node that reuses the git panel's scopes. Plus
    "open in editor": an editor probe and preference, `fs.open` with `path:line`, used from menus,
    diff rows and paths in terminal output.
13. **A test floor**: a 30-node harness (a dev-only palette command or a Playwright spec, out of
    CI) and whatever it finds; a DOM setup for `bun test` with first specs for the composer and the
    canvas wiring; a daemon-backed e2e job in CI for the terminal spec.
14. **Usage v2**: a Days table, price and plan overrides, a currency setting, and an export.
15. **Two projects side by side**: `openWorkspace` and the four stores per workspace are there, the
    layout is not. `docs/research/windows.md` is the design: a project opens in a window of its own
    rather than in a split pane.
16. **Smaller ones**: a link made while a shell already runs is only visible in the header and
    to the hooks (a `precmd` probe was judged too invasive); a color or an arrowhead per plain
    line; a note's title as the first heading of its body.

Known gaps to keep in mind: the WebGL budget is a fixed 10 contexts, not a setting and not
measured against what a given machine really keeps alive; the 30-node performance target is
unmeasured. Backpressure is handled per socket (output dropped over the high-water mark,
repaired with `session.resync` on drain); what is not there is a per-session cap, so one very
loud shell can still be the reason a client is dropped.

Research that is written but not built: `docs/research/browser-streaming.md` (a headless Chromium
on the daemon, streamed over the socket; it and a relay wait until a remote daemon is in daily
use), `docs/research/windows.md`, and the reports under `docs/reports` for accounts, remote access
and the swipe gestures.
