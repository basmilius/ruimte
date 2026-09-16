# Decisions

Why Ruimte is the way it is, for whoever picks this up next (human or agent). Read `CLAUDE.md`
first for the rules and the architecture, and `README.md` for the principles. This file is the
log beside them: the choices that left no trace in the code, the traps that were paid for once,
and what is still open. It grows at the bottom and is never rewritten to match the code.

## Feature decisions

Features worth weighing for the
canvas, against Ruimte, one verdict each.

| Feature | Ruimte | Verdict |
| --- | --- | --- |
| Terminal node, agent CLIs as terminals | Terminal node, chat nodes for Claude and Codex, and every CLI in the catalog as a terminal agent the daemon launches | Done, phase 13 |
| Sticky note (7 colors, markdown, title, agent reads it over a link) | Note node (5 colors, markdown, title, text source over an edge) | Done, phase 12 |
| Context links (agent to agent, sticky to terminal, drag from handles, delete by double-click) | Edges from any node or text to any other; into an agent they are context, "Connect to..." in the menu | Done, phase 12 |
| Group frame with a bound worktree | Group node with collapse, nesting and a worktree | Done |
| Browser node (navigable Chromium) and Web node (one page, fits content) | Browser node in the desktop app | Done; the fit-to-content web node is a browser node with a size, skip |
| Editor node (Monaco, image and PDF preview, Cmd+S) | File node and file view, read-only | Done as the viewer; the editor (Cmd+S) is still later, since there is no `fs.write` on the wire |
| Diff node (HEAD vs index vs worktree per file) | Changed-files card with the turn's checkpoint diff | Done for a turn; a standalone diff node for a folder is still later |
| Files node (folder listing pinned to one directory) | Folder browsing in the palette, one file at a time on the canvas | Skip: the palette browses; a directory pane on the canvas invites a file manager, which is not the product. A folder dropped on the canvas is left alone for the same reason |
| Subagent node (live card per Claude subagent from hooks) | Subagent tool calls fold into the chat's work rows | Later, only if hooks carry enough: a card per subagent on the canvas is a status view, and the chat's folded rows already show it |
| Loop node and Trigger node (cron and schedule into a terminal) | None | Skip: scheduling belongs to the agent's own tools or the OS; a canvas is not a scheduler |
| Video node (local or remote file) | None | Skip: a browser node plays a file URL |
| Image and PDF preview (inside the editor node) | A file node draws what the preview draws: images and video today, PDF not yet | Partly done |
| Dino minigame | None | Skip |
| Kanban board (separate view, session cards in columns) | None | Skip, a decision in this file: no kanban, ever |
| Spawn team (agents wired to their opener) | `ruimte-context team`: up to eight roles in one write, in a group, each linked back to the caller | Done |
| Remote pairing and relay | Endpoints with pairing, tokens, a local secret and origin checks | Done, relay is a seam |

## Decisions that are not in the code

- No kanban view, ever. Bas dislikes that workflow.
- No bare single-letter shortcuts. Every shortcut needs a modifier and becomes remappable in a
  later settings phase; until then the Keyboard section only lists them. The one exception is a
  drawing view: it has the keyboard the way a terminal has it, and its tools are the bare letters
  and digits every sketching app uses (V/1 select, H hand, R/2 rect, D/3 diamond, O/4 ellipse,
  A/5 arrow, L/6 line, P/7 freehand, T/8 text, E/0 eraser, Q keeps the tool). They fire only while
  no text is being typed and no dialog is up, and they are listed under "Drawing" in the Keyboard
  pane like every other shortcut.
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
  outside a popup and `MENU_HINT` the trailing hint inside one, with `<kbd>` left for shortcuts only.
- `styles.css` is the tokens, the themes and the rules a utility cannot write: Base UI's `data-*`
  states shared by every menu, picker, dialog and tooltip, the `:not()` chain that keeps a node's
  focus ring behind its focused and selected outlines, the panel shell's `[data-instant]` and
  `[data-resizing]`, `[data-modality]`, `::selection`, the keyframes, and everything that styles
  DOM the JSX never sees (xterm, shiki and its line-number counter, the `@pierre/diffs` and
  `@pierre/trees` variable overrides, the file icon hues, the `<webview>` a preview is drawn in).
  Every rule that was only a bundle of utilities moved to its call site, or to a class string next
  to the component that uses it: `src/ui/classes.ts` (the glass card, the button group, the menu
  and section labels, the shortcut), `src/shell/panels/classes.ts` (the file toolbar, the git rows,
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
- A note breaks on a single newline, a thread does not (`remark-breaks` behind the `breaks` prop of
  `Markdown`, passed only by `NoteNode`). A person typing a note means a line break by Enter, and
  an agent writing one with `--text` means the same; a CLI writing into a thread writes proper
  markdown, where folding the lines it wrote would change the layout it chose.
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
  size moves text and the rem-based layout together.
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
  chip and a click on the canvas; the shortcut is `isLeaveNodeShortcut` in
  `apps/client/src/terminal/keymap.ts`, and the terminal's key handler swallows every other
  Escape before the canvas listener sees it. Chat, browser and note nodes still leave on plain
  Escape. Ctrl+Escape is the Windows Start menu and Ctrl+Shift+Escape is its Task Manager, so a
  Windows build still has no shortcut the OS leaves alone: the mode chip is the way out there.
- On macOS a terminal node has the line and word motions a native terminal has and xterm does
  not: Cmd+Left and Cmd+Right send Home and End in the form the application cursor keys mode
  asks for (`\x1b[H` / `\x1b[F`, `\x1bOH` / `\x1bOF` under DECCKM), Option+Left and
  Option+Right send `\x1bb` / `\x1bf`, and Cmd+Backspace sends Ctrl+U. `macMotionSequence`
  (`apps/client/src/terminal/keymap.ts`) is the whole mapping; the key handler writes the bytes
  itself and returns false, so xterm adds nothing and the shortcut never reaches the canvas. Other
  platforms keep their own conventions.
- An image icon is a file in the folder, never a blob in `project.json`: every save rewrites
  that file and every `project.changed` ships it, so 256 KB of base64 would ride along each time.
  A derived name or icon is never written back either, so the folder stays the one place that
  decides and a person can change it from outside the app.
- Formatting is prettier (`.prettierrc`: single quotes, width 160, 4 spaces). Run
  `bun run format` before a commit.
- A line between two non-agent nodes means nothing; it is a drawing. What an edge means is
  decided from the target's kind, and `ContextSource` needs no new kinds: a note travels as
  `text` with its title and body. Notes are not in the sidebar; that list is about what
  runs.
- "Connect to..." is a click mode, not a drag: the draft follows the pointer without a button
  held, because a menu item cannot hand over a pointer capture. Escape and empty canvas cancel.
- Status hooks are `command` hooks with curl, not Claude Code's `http` hooks: the http kind
  cannot read the daemon's port from the environment and reports an error whenever Ruimte is
  not running. The command hook is a no-op without `RUIMTE_HOOK_URL`.
- A terminal agent's permission is answered over the wire, and the CLI's own prompt keeps asking
  beside it. Claude Code fires `PermissionRequest` and puts its prompt on the screen in the same
  breath, so holding that hook open is a second way to answer one question rather than the only
  way: whoever is first wins and the loser's answer is refused. That is what makes this safe to
  build at all. The daemon holds the request for 110 seconds (`APPROVAL_HOLD_MS` in
  `apps/server/src/agents/approvals.ts`), under curl's 120 and the CLI's own 125 in the settings
  file, so the daemon is always the first of the three to give up and the CLI never has to cut
  anything off. Letting go prints nothing at all, which leaves the TUI prompt exactly where it
  was: nobody watching, the feature off (`--no-approvals`), the session gone and the hold running
  out all end the same way, and an agent in bypass mode is never asked in the first place. The
  request travels as `session.approvals` (the whole pending list of one session, so a client that
  arrives late and one that missed a settle agree) and comes back as `agent.answerApproval`, which
  answers whether it was in time. The choices are the CLI's own `permission_suggestions`, held on
  the daemon and handed back verbatim, so a client never learns a CLI's permission vocabulary.
- **Who wants to be asked is a question about the clients, and only then about the daemon.** The
  switch a person sees is a client setting (`agentsApprovals`, on), and the client tells every
  machine it holds a socket to with `agent.setApprovals`. The daemon already asked "is anybody
  there" before it held anything; the preference makes that question honest instead of assuming
  every attached client will offer the request to somebody. Nothing is held while every attached
  client has said no, so a client with the switch off costs a turn nothing rather than parking a
  hook for 110 seconds nobody can answer, and a second client that does want them is asked exactly
  as before. Silence means yes, so a client written before the switch keeps working; the
  preference lives with the socket, so a reconnect says it again. The strip also checks the
  setting itself, which is what makes the switch act at once on a request that is already open.
  `--no-approvals` stays what it was, one level up: the machine's own answer, for every client,
  which is what an operator reaches for and not what a person clicks.
- **A permission notifies on the approvals switch, not on the turn switch.** A turn that ended is
  news; a permission is the agent standing still with a clock running, and a notification is the
  only thing that reaches somebody who walked away before the hold runs out. So it fires while
  `agentsApprovals` is on, the switch that says this person wants to answer permissions away from
  the terminal, and "Tell me when a turn ends" does not govern it: that switch says "do not tell me
  when work ends", not "do not tell me when work stops for me". Nor is it always on the way the
  needs-you notification is, since a person who turned the strip off asked for the CLI's own prompt
  to be the only place, and announcing a request that cannot be answered here would send them to a
  node with nothing on it. No toggle of its own, which would be asking the same question a third
  time. The sound stays `agentsTurnSound`, and its row is no longer hidden when the turn switch is
  off: two of the three notifications never obeyed that switch, so the one answer to "may this make
  noise" has to be reachable whatever it says.
- **One notification per node that waits, whatever it waits for.** The `PermissionRequest` hook
  sets the node to `needs-you` and opens the request in the same breath, so both watchers see the
  same node. The permission carries the node's own tag (`ruimte-<nodeId>`), the plain "Needs you"
  is not raised beside a node with a request open, and one that got there first is withdrawn, so
  nobody collects two cards about one wait. Only the front request of a node becomes one, which is
  the request the strip offers; the ones behind it are one question at a time and get their own
  notification when they reach the front. It says the node, the machine when the workspace is not
  on this one, the tool with the line the strip shows, and when it expires. When a hold runs out
  with the node still waiting, the card goes and no plain one takes its place: "Needs you" fired
  110 seconds after the fact is noise, and the mark on the node and the sidebar row still say it.
- **A notification with a clock has to be taken back by a clock.** `session.approvals` withdraws it
  the moment the request settles anywhere, this client, another client or the CLI's own prompt,
  which is the same event the strip goes away on. Nothing arrives when the hold simply runs out on
  a daemon this client is no longer hearing from, so the watcher also sets a timer on `expiresAt`
  and looks again. A card that sends a person to a node where there is nothing left to answer is
  worse than no card. `shell/approval-notices.ts` holds the pure half of it (what stands, what it
  says, what is raised and what is withdrawn), which is what can be tested without a DOM.
- **The daemon says what a permission answer means for the status, because the CLI will not.** A
  CLI has no reason to report anything when its own prompt is settled from the outside: the next
  hook is the PostToolUse of the tool that just started, which for a command running for minutes
  is minutes away. Measured on Claude Code 2.1.270, an approved `sleep 20` left a node saying
  "Needs you" for the whole twenty seconds. So `answerApproval` sets the status itself: working
  again, an allow and a deny alike (the agent reads the refusal and carries on), unless another
  request is still open for that session, which is a person's turn all the same. Only a session
  still on `needs-you` is touched, so a hook that spoke after the request opened keeps the last
  word, and every later hook overwrites the inference as it would any other status. The other way
  round is the same daemon knowing the same thing: a hook that reports `idle`, `error` or an
  agent that is gone proves no permission prompt is on the screen, so anything still held for
  that session was answered in the TUI and is withdrawn from every client. A `running` hook is no
  such proof, since a CLI runs tools beside each other and may be asking about one while it
  reports another. Both matter beyond the header: `needs-you` is what the notification, the
  "Needs you" section, the attention marks and the `busy-after-turn` rule in
  `apps/server/src/processes/stuck.ts` all read, and a stale one of those is a warning nobody
  earned.
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
- New chats start in full access; the composer remembers a model per provider
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
  as `mentions` only so the timeline can draw them as chips. The composer is a CodeMirror 6 editor
  (`src/chat/ui/ComposerInput.tsx`, its extensions in `src/chat/ui/composer`) controlled by the
  draft's plain string, and a chip is a mark decoration on it (`CHIP_IN_EDITOR`). It used to be a
  transparent textarea over a layer that painted the same string with the chips in it. That only
  held while both layers put every glyph on the same pixel: the caret was the textarea's, placed
  from its own raw text, so a chip could add a tint and a ring but no padding, and a weight or a
  monospace font walked the drawn text off its characters. An editor that draws the text itself
  places the caret from what it drew, which is what lets a chip have padding and markdown have its
  fonts. CodeMirror only turns on EditContext on Android, so in Electron it edits through
  `contenteditable`; anything that asks "is this a text field" has to count `isContentEditable`.
  The pill with the file icon in front of the path is the sent message's (`CHIP_IN_MESSAGE`). The
  picker searches through
  `fs.search`: `git ls-files` (tracked plus untracked, minus .gitignore) inside a repo, a
  bounded walk elsewhere, ranked by a small fuzzy score on the daemon.
- Markdown in the composer is source with formatting: the backticks, asterisks and hashes stay
  where they were typed and dim, inline code and a fence take the monospace font on a tint, and
  bold is bold. `chat.send` carries the same string it always did. The grammar is
  `@lezer/markdown` with strikethrough and tables, in a `Language` of our own (`markdownLanguage`
  in `src/chat/ui/composer/editor.ts`). `@codemirror/lang-markdown` builds the HTML language and
  autocomplete at module level, where tree shaking cannot reach them, and the one thing it adds
  that the composer wants, list continuation on Enter, is a rule of a few lines of our own. Code is decorated from the
  syntax tree rather than through the highlighter, and a token inside a code span or a fence stays
  text instead of becoming a chip. In code `@` and `$` open no picker either (`inCode` in
  `src/chat/ui/composer/keys.ts`): a fence, open or closed, a code span, and a backtick nobody has
  closed yet earlier in the same paragraph, since the parser only calls a span code once it is
  closed and a `$variable` typed right after the backtick is code all the same. A fence gets no
  syntax colors: Shiki is not a CodeMirror grammar, and CodeMirror's own languages would be a
  second set of grammars in the bundle.
  Spellcheck stays on, as it was on the textarea, and a paste stays plain text. The editor loads
  with the main bundle rather than as a lazy chunk; measured with `vite build`, the main chunk
  went from 1,697.70 kB (496.32 kB gzip) to 1,996.03 kB (593.92 kB gzip).
- Enter in the composer sends, except where whoever types is still writing. Inside a fence nobody
  has closed yet it adds a line. On a list item (`-`, `*`, `+`, `1.`, `1)`, a task's `[ ]`
  included) it starts the next item with the same indentation and marker, the next number for an
  ordered list and an unchecked box for a task; on an item with nothing after its marker it
  removes that marker and leaves the list, so a second Enter breaks out. With the caret in front
  of the marker it adds a plain line, and a line inside code is never an item. Shift+Enter adds a
  plain line anywhere, a list included, which is how an item gets a second line without a new
  marker. Cmd+Enter (Ctrl+Enter elsewhere) sends from anywhere, which is why the send button's
  tooltip shows that key rather than Enter (`enterAction`, `listItemAt` and `inOpenFence` in
  `src/chat/ui/composer/keys.ts`). An item is read off its line with a pattern rather than off the
  syntax tree, so the number is not renumbered below the caret and a nested item that is left
  loses its indentation with its marker. Once a fence is closed and outside a list Enter sends
  again, so a prompt with a finished block in it goes out the way it always did.
- Tab in the body of a fence, open or closed, indents with spaces up to the next stop of four, a
  selection indents its lines by four and Shift+Tab takes four away. Everywhere else, the opening
  line of a fence and inline code included, Tab still moves the focus, so a prompt box never traps
  the keyboard (`inFenceBody` and `tabSpaces` in `src/chat/ui/composer/keys.ts`).
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
- An image the composer holds is drawn from a thumbnail rather than its own data URL, which a
  browser decodes again on every paint of the 56 px box, so a tall screenshot could make typing
  stutter. `chat/thumbnails.ts` decodes it once with `createImageBitmap`, draws the square in its
  middle at 256 px at most on an `OffscreenCanvas` and keeps the PNG in a `WeakMap` keyed by the
  upload, so nothing new lands in the draft in localStorage and the bytes sent are the file's own.
  An animated image gets its first frame; anything that does not decode this way, an SVG among them,
  falls back to the image itself.
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
  is refused, which is the size where a turn gets slower than the answer is worth. A paste of text
  from 32 KiB (UTF-8 bytes, `PASTE_ATTACHMENT_FROM_BYTES`) never reaches that far: it becomes a
  `paste-<n>.txt` attachment, so the prompt names a file the agent reads with its own tools instead
  of carrying a log in every turn. A selection the paste lands on is still replaced, by nothing.
  Cmd+Shift+V (Ctrl+Shift+V elsewhere) pastes it inline after all; a paste event carries no keys, so
  the composer remembers that the last key down was that one. A provider that takes no attachments
  gets the text inline, since there is nowhere else for it to go. Commands only
  the CLI's own terminal can run (`/login`, `/theme`, `/doctor`, ...) are filtered out of the slash
  menu even though the init frame lists them (`chat/guards.ts`). PageUp and PageDown page the thread from the composer, through a scroller the
  timeline registers per chat (`chat/timeline-scroll.ts`), and a chat node with an unsent draft
  gets a dot on its sidebar row (`useHasDraft` in `chat/drafts.ts`, the store next to the
  localStorage the composer already wrote).
- `/clear` in a chat is a command of the daemon, never text for the CLI (`chat.clear`): sent
  through, it would only empty the model's memory while the thread kept every item. The daemon
  kills the CLI, drops its session id, empties the items, the queue and the attachments, writes
  the empty thread and sends a `reset` event, so the next prompt starts Claude without `--resume`
  and Codex with `thread/start`, the same for both whatever the CLI itself does with `/clear` in
  stream-json mode. The thread is emptied rather than kept above a divider, so what a person reads
  is what the model knows. Whether a turn is in the way is the daemon's call (`busy`, so a turn the
  CLI opened itself is not): the composer only asks after a `chat-busy` refusal and then sends
  `force`, which disposes the process without an interrupt or a wait for the turn to end, since
  that turn goes with the thread anyway. Cost and the turn count keep counting; the context tokens
  and the slash commands start over, and the drafts and the notices other nodes left stay.
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
  `'user'` unless a caller says otherwise.
- A Claude Code session then takes the name the CLI gave it. Claude Code writes an `ai-title`
  record into its own transcript about six seconds after the first prompt, in the stream-json mode
  of a chat as well, anywhere in the file and more than once, and a `custom-title` after `/rename`
  in the CLI, which wins. Neither protocol carries it, so the daemon reads the file
  (`ClaudeTitleReader` in `apps/server/src/agents/claude-title.ts`), from the byte where its
  previous read of that path stopped, since a transcript only grows and may be many megabytes. A
  chat finds the file by its session id under the Claude projects folder and looks when the init
  frame names the session, once more ten seconds later and at the end of every turn; the name rides
  on `ChatInfo.suggestedTitle`. A terminal takes the `transcript_path` of its hooks and looks on a
  hook that ends or blocks a turn, and at most every five seconds on the hooks of a turn in flight
  while it has no name yet; the name rides on `AgentInfo.suggestedTitle` and stays with its
  `agentSessionId`, so a new conversation in the same shell starts without one. The client applies
  both with one rule (`suggestedTitleFor` and `useSuggestedTitle`): never over a `'user'` name, and
  over a derived one, both `'auto'`, so the latest automatic name wins. A suggestion equal to the
  title writes nothing. The text is a model's: capped at `SUGGESTED_TITLE_LIMIT`, flattened to one
  line and drawn as plain text. About a quarter of sessions never get one, and then the derived
  name stays.
- A Codex terminal takes the name the TUI gave its thread. Codex appends
  `{"id", "thread_name", "updated_at"}` to `session_index.jsonl` in its home whenever it names a
  thread, 2 to 90 seconds after the session started (codex-cli 0.154.0), and the last line for an id
  is its name (`CodexTitleReader` in `apps/server/src/agents/codex-title.ts`, read on from where the
  previous read stopped like the transcript, with the thread id the hooks carry as `session_id`).
  Since the name often lands after the last hook of a short turn, a terminal whose look found
  nothing looks again every 15 seconds, six times, and every hook starts that window over. The same
  SQLite database also has the name, but the file is enough; its `title` column is the first prompt,
  not a name.
- A Codex chat gets its name from Ruimte, since `codex app-server` names no thread on its own. After
  the first turn that ends well, and only when the chat has no name yet, the daemon asks the one-shot
  CLI `git.suggestMessage` uses for a title of a few words in the language of the conversation, from
  the first prompt and the start of the answer, both capped (`suggestChatTitle` in
  `apps/server/src/chat/chat-title.ts`). That costs one one-shot call per Codex chat, on Codex when it
  is installed and otherwise on the first CLI that answers a single prompt; with none there is no
  call. The answer is untrusted text: only a `{"title": ...}` object counts, cleaned and capped like
  the others, and a failure, a timeout or a stray line leaves the derived name without a word to the
  person. The name rides on `ChatInfo.suggestedTitle` and goes to the app-server with
  `thread/name/set`, so Codex's own thread list and a resume carry it; a resumed thread that already
  has a name brings it along on `thread/start` and `thread/resume` (and `thread/name/updated` on a
  rename), and nothing is asked. It happens in the daemon, once per chat however many clients are
  attached, and a later turn never asks again because only the first completed turn does. The Codex
  one-shot runs with `--skip-git-repo-check`, since a chat's folder need not be a repository, and
  `--ephemeral`, so the call does not become a thread in Codex's list; its tokens are therefore not on
  the usage page. Gemini and Copilot write no name down and get none.
- A CLI that goes down with its shell is `exited`, not `error`. The daemon sees the PTY child end
  while its agent record is still live and writes `status: 'exited', live: false`
  (`SessionManager.handleExit`), the record outlives the shell, and the node shows `[session ended]`
  with a Resume button next to Restart. Resume puts the CLI's own session id on the node
  (`resume`) and starts a fresh shell, which the daemon launches with the CLI's resume line; the
  status is no longer `running`, so the sidebar and the dock's summary stop counting it. This is the
  daemon's own reading, the one thing the hooks structurally cannot report.
- One resume per session, counted by the daemon. `session.create` with an `agent` skips the launch
  line when it restored an agent record for that id, because the client answers a non-live agent
  on attach with `agent.resume`: the two together typed `claude` and, a moment later,
  `claude --resume <id>` into the CLI that first line had just started, which is where the second
  line ended up, in its input box. Every fresh page onto a daemon that had restarted did this. On
  top of that `resumeAgent` refuses a second resume (`agent-resuming`) while one was typed and no
  hook has reported the agent live, for 15 seconds; after that a retry is allowed again, because a
  CLI that is not installed reports nothing at all and its session must stay retryable. The client
  swallows that refusal.
- A resume is typed only for a conversation the daemon can still see. The recorded `agentSessionId`
  is no proof there is one: Claude Code persists a conversation once it has had a prompt, so a CLI
  that was started and never used leaves an id that answers `No conversation found`, and a deleted
  or moved transcript ends the same way. With the launch line gone from `session.create` that left
  the node on a bare shell with no agent at all. The evidence is `transcriptPath` from the hooks:
  the file is there and `resumeAgent` types the resume line, the file is gone and it types the fresh
  launch line of the session's own `AgentLaunch`, which `Session` keeps from the create that started
  it. A hook that names no transcript (only Claude Code's is known to carry one) leaves no evidence
  either way, so there the shell decides: `<resume> || <launch>` is one line that ends with the CLI
  running, whichever way the resume went. That composed line is also what a node's own `resume` gets at
  `session.create`, where the record the daemon could have looked at went with the previous shell.
- A resume carries the mode and the model the node was started with, rather than trusting the CLI to
  remember them. The line used to be the bare `claude --resume <id>`, so a node started in accept
  edits came back on whatever the CLI defaults to. Measured against the CLIs themselves: Claude Code
  2.1.270 does read both back out of the transcript it resumes (a session started with
  `--permission-mode acceptEdits --model haiku` resumes as accept edits on Haiku, while a fresh
  `claude` in the same folder opens on the machine's own default), but Codex 0.154 does not (a
  rollout recorded with `danger-full-access` and approval `never` opens under the default policy on
  `codex resume <id>`, and under YOLO again once the flags are back on the line). So the rule is the
  daemon's, not the CLI's: `{flags}` is part of every provider's resume template, beside `{id}`,
  which is also where each CLI wants them (`claude {flags} --resume {id}`, `codex resume {flags}
  {id}`). A launch that names no mode still adds no mode flag, because that is a CLI a person
  started by hand and `DEFAULT_RUNTIME_MODE` would hand it full access it was never given.
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
- The daemon parses a verb's arguments, not `ruimte-context`. The CLI posts the raw words after
  the verb (`{ argv }`), so a `ruimte-context` from an older build, a copy left on a remote
  machine or a script that calls the route itself can never disagree with the daemon about which
  verbs and flags exist; `help` comes from the same registry for the same reason. `help <verb>`
  renders the same entry the parse runs from, with the kind and flag columns derived from the
  tables the verb refuses against, so the detail cannot promise a pairing the daemon says no to.
- The daemon reads `\n`, `\t` and `\\` in `--text`, not the CLI: a shell hands the backslash
  through untouched, and a note of two lines has to be one argument. Nothing else is an escape, so
  a regex in a note stays a regex. Bytes that must arrive exactly go through `--text -`, which is
  the CLI's own step: it reads stdin, escapes the backslashes back and sends one finished string,
  so the daemon keeps parsing words and never learns about a pipe.
- A relative `--path` or `--cwd` is resolved against the project folder, never against the
  directory the agent is standing in. The daemon cannot know that directory, and a CLI that sent
  it would make one command mean two things in two sessions of the same project. An absolute path
  still works; `--cwd` must still land inside the folder or a worktree of it.
- A refusal exits 3, apart from 1 for a daemon that failed or could not be reached and 2 for
  running outside a session. An agent has to tell "you asked for something this project does not
  allow" (fix the arguments, pick one of the canvases listed) from "try again later", and an
  unknown verb counts as a refusal, since to the agent it is the same mistake as a bad flag.
- `ProjectStore.mutate` sends `project.changed` to every socket, also when no client has the
  project open in the daemon. `project.release` only means one client switched away; another
  workspace, or the same client a moment later, may still have the canvas on screen, and the
  daemon has no other way to tell it the file moved on.
- A verb reads the project file itself rather than through `readDocument`: that one sets a file
  that will not parse aside, which is right when a person opens a project and wrong when an agent
  in the background happens to find a broken merge. The verb refuses and leaves the file alone.
- A document that arrives while the client has edits of its own is merged when the difference is
  nothing but additions (`apps/client/src/project/merge.ts`), and only then. Everything the verbs
  make is an addition, so the dialog stays for what it was written for: a node that moved, a
  deletion, a rename, another arrangement, another order. The alternative in the design was to put
  the applied operations on the wire beside the document, which costs a message format and a second
  way client state can change; a merge costs one pure function and no protocol.
- The merge is three-way, so the client keeps the document the daemon's file held at the rev it is
  on (`base` in `ProjectClient`, set on open, on a change it took in and on every save that landed).
  Without it a view the person just made and a view another client just deleted look the same from
  here, and one of the two would come back from the dead on the next save.
- An addition lands in the editor of the view it belongs to, not only in the document
  (`applyAdditions`, `CanvasState.addExternal`). It is marked as a load, like a project swapping in,
  so it takes no step on the undo stack, moves no camera and changes no selection: the person's drag
  runs on. A view an agent made is put in the list and opens itself nowhere. Which view a person
  looks at is client state, and `open` (phase 5) is the verb that asks for it.
- A group that only gained members merges, anything else about a node the client already has does
  not. While a group is open its membership is read off the positions and the file says nothing, so
  the field only moves for a collapsed group, and there the node the agent just made would be
  invisible without it. An added edge needs both of its ends: one running to a node this client
  deleted would be written away by the next save, and dropping a line an agent drew is worse than
  asking.
- A save that was already on the wire when the verb landed is refused with `rev-conflict`, and is
  made again against the rev the merge took in rather than dropping into the dialog. The daemon
  emits `project.changed` from inside the same lock it refuses the save under, so the document is
  always at the client before the refusal is.
- A save sends `project.changed` to every client but the one that made it (`ProjectStore.save`
  with the sender's client id), over a socket and a direct channel alike, since both are a
  connection of the same opener. Until 2026-09-15 it sent nothing: the watcher reads a write the
  daemon made itself as its own (`lastText`) and stays quiet, so a view renamed, moved or added in
  one client reached a second one only when it opened the project again. The sender is left out
  because its screen is already ahead of what it wrote, and taking the echo in would undo a drag
  that went on while the save was out.
- With a second client writing, the merge takes more than additions. The name (with its
  `titleSource`) and the icon of a view merge three-way per label: a side that left one as `base`
  had it takes the other side's. The order of the list merges the same way over the views both
  sides have, and a view only one side has goes right behind the view it followed there. The dialog
  stays for the same label changed differently on both sides, and for both sides moving views into
  different orders. Nodes, deletions, the project's own name, color and icon, and arrangements are
  as before.
- A document that arrives on a clean client goes through the merge first too, and is only loaded
  whole when the merge refuses. A load swaps every editor out and blanks the canvas until it is
  measured, which a rename in another window should not cost.
- Since 2026-09-15 nodes, texts and edges merge per field as well, so a node moved, resized,
  retitled or deleted in another client lands live instead of taking the load or the dialog. The
  rule is the one the view labels already had: by id, then per field, a side that left a field as
  `base` had it takes the other side's. Some keys are one field because they only mean something
  together (`x y w h` as the frame, the title with its source, `collapsed memberIds expandedHeight`
  as the folding, a text's position, an edge's ends): taking `x` from one side and `y` from the other
  would put a node where nobody put it. A group that gained a member merges through the folding
  field, which replaces the special case for it. What still goes to the person is the same field
  changed to different values, a deletion against a change, an edge left without an end, and the
  project's own name, color and icon.
- Two things are deliberately no conflict. The stacking order: a click into a node brings it to the
  front and is saved, so two people clicking would be a dialog on every other save; when both sides
  moved it this client's order stands. And a node under a gesture here (`heldNodeIds`, the selection
  and what it carries while the canvas is gesturing, or the node being resized) keeps its local
  frame when the other side moved it too: a dialog in the middle of a drag is worse than either
  answer, and the save after the drag is made against the merged rev, so the file ends where the
  person let go.
- The merge hands the editor a patch (`CanvasPatch`: the entries to put in whole, the ids removed,
  the stacking order, the arrangements) rather than the merged canvas. An entry is spread over the
  one the editor holds, so what lives only in the editor (a browser node's status) survives and
  every node the patch does not name keeps its object, which is what keeps a canvas of a few thousand
  nodes from rendering all of them again. A field the other side dropped travels as `undefined` so
  that spread clears it.
- The first prompt of an agent node is held by the daemon against the node id, not written into
  `project.json` (`apps/server/src/agents/pending-prompts.ts`). It is not part of the canvas two
  people share, and a project open in two windows would deliver it twice; the daemon is the only
  place where "exactly once" can be promised, and it already owns both moments a node comes alive
  (`SessionManager.create`, `ChatManager.create`). On disk under `$RUIMTE_HOME/prompts`, because
  the node is made whether or not a client is looking and the daemon may well restart first. The
  in-memory map is emptied before the first await of `take`, so two clients mounting the same node
  cannot both get it, and the file is gone before the caller is answered. Since orchestration phase
  2 the daemon starts the node itself right after the write (see "Orchestration"), and the prompt
  store stays the seam that makes the delivery exactly once: the daemon's start and a client's
  mount both go through the same create.
- A terminal agent gets its prompt on the line the daemon types into the shell, as the CLI's own
  prompt argument, rather than typed in after the CLI is up. Nothing can tell when a CLI is ready
  for input, and the line is built at `session.create` anyway, so a node made before a restart
  still starts on its prompt. The person also sees the prompt in the shell as a line they could
  have typed. It costs a cap of 2000 characters: that line waits in the tty's canonical buffer
  until the shell reads its first byte, and a longer line is cut off there without a word. A chat
  agent gets the prompt as the first message of its thread, which is both how it reads to the
  person and what spawns the process.
- The edge `agent` draws runs from the caller into the new node, which is what makes the caller
  readable to the agent it just opened (`deriveContextSources` keys on `edge.to`). `link` adds the
  way back when both ends are agents, so the two directions are two edges and each one means what
  an edge already meant. An edge that is already there is a no-op reported as `existing`, never a
  refusal: a link that ran twice has the state the caller asked for.
- `--dry-run` is only on the verbs that make something, and every other verb refuses it by name
  with the list of the ones that do. A flag an agent writes out of habit must not turn a real call
  into a silent nothing. A dry run runs under the same lock a write takes and returns a mutation
  with no content, so `ProjectStore.mutate` writes nothing and the rev stays where it was.
- The verb set leaves out `write` and `close`, a `--cmd` that starts a command, and browser control.
  Typing into another node's session or closing it has to ask a person first, and a single pending
  confirmation holds every other sensitive verb for two minutes; without those two no verb needs a
  dialog, since `view delete` and `node delete` decide by lineage and the machine setting before
  they run. A command started by a verb nobody confirms is how a bug in a canvas turns
  into code execution, so `agent` is the only verb that starts anything. A browser node is a webview
  in the client, which the daemon cannot drive. The context an agent reads is untrusted input (a
  neighbor's transcript can carry a web page), and for a chat agent with limited tools the
  boundary that holds is that `--cwd` stays inside the project folder or a worktree of it.
- Two questions the design left open, answered by what the build does (checked against a real
  daemon on 2026-09-14). A maker is a node id, not a session: a new session on the same node id may
  delete what the old one made, and a view whose maker is gone is left to a person or the machine
  setting. A verb from a session that outlives `project.close` still writes into that project,
  since `ProjectStore.mutate` works on the file and leaves `closedAt` alone, so the project stays
  under Recent with the addition in it; `team` is one write, so nothing is left half made.
- `--group G` takes a group by id, and the node lands inside the frame: geometry is what membership
  is for an open group, so nothing else would make it a member. A collapsed group keeps its members
  in the file, so the id joins `memberIds` there as well, and the frame grows when it has no room,
  since a refusal over pixels is a puzzle nobody can solve from a terminal.
- `team` is one call and one write: up to eight roles validated against a zod schema in the registry
  entry, and then the group, the agents, the edges and the prompts in a single `ProjectStore.mutate`.
  A role that is wrong is named by its place in the array (`role 1 (prompt): ...`), because the
  caller wrote that array and needs the index back to find the object it typed. A `--roles` that is
  not JSON is a refusal of its own, and both print the shape of a role under them.
- The agents of a team stand in rows of at most four inside their group, laid out by the same
  `placeInGroup` a single `--group` uses: the frame starts as wide as one row and every role is put
  in it, so the two ways a node can land in a group put it in the same kind of spot. The group is not
  collapsed, so what it holds is read off the positions, the rule the client's `membersOf` applies,
  and there is no `memberIds` to write. The whole frame then goes to the first free spot right of the
  caller, which is where `agent` puts a single node.
- Who opened an agent node, and how deep it sits, is daemon state under `$RUIMTE_HOME/lineage`, not a
  field on the node in `project.json`. A node field would be a number the limited party can edit: an
  agent in a terminal has a shell in the project folder and could rewrite `.ruimte/project.json` to
  call itself depth 0. It would also have to be added to `ProjectNodeSchema` first, since every hop
  strips what the schema does not name, and the next save from a client would drop it again. On disk
  rather than in memory, because a restart is exactly the moment a loop would start counting over. A
  view carries `createdBy` in the shared file (phase 5) for the opposite reason: that one is a fact
  two people share, and nothing has to be enforced with it.
- `agent` opens up to depth 2 and `team` up to depth 1, with a node a person opened as depth 0. So a
  person's agent may open a team and the agents in that team may not open another one, which is the
  case the design names: eight agents becoming sixty-four becoming five hundred and twelve. A chain
  of single agents still gets two links, since that is one thread a person can follow, not a fan-out.
  Both refusals name the depth the caller sits at and the depth each verb reaches, so the way out is
  in the answer.
- The cap per caller is 16 agent nodes at a time, next to the canvas's own 500. The canvas number is
  the ceiling of the drawing and says nothing about who filled it; this one is about a single caller
  in a loop, and it needs no notion of a turn or a session: the record is per node and goes when the
  node does (`ProjectIndex.onPlaces`, the hook that already prunes a pending prompt). Per caller
  rather than per project, so a person opening agents of their own is never the one who runs out.
- What a person does to the list of views is pure functions in `packages/contracts/src/project-views.ts`,
  which the client's document store and the daemon's `view` verb both run. The rules that were only in
  the client (a view id is unique across the project, a separator is a line and never opens, an edge
  that would point outside its canvas falls away, a project always has a view to open) are exactly the
  ones both sides need, and a second copy of them would have drifted the first time one side changed.
  What stays in the client is what only it knows: the camera, the focus, the split layout and the
  editors holding a canvas on screen, so a function that needs a place takes it as an argument
  (`withViewAsNode` is given the point, it does not go looking for a viewport).
- A view carries `createdBy` in `project.json`, a separator included, where a node's depth is daemon
  state. The two look alike and are opposites: the depth is a number the limited party could rewrite
  from a shell in the project folder, so it has to live outside the file, while a maker is a fact both
  sides read and nothing is defended with it. A person deleting a view of their own is not what the
  rule is about, so nothing has to stop them, and having it in the shared file is what lets a sidebar
  say who made a row without asking the daemon.
- `view delete` only removes a view whose `createdBy` is the caller. The setting that frees the rest is
  `agentsDeleteAnyView` in `endpoint.json`, next to the machine's name and icon, because the daemon is
  what enforces it: in the client it would be a checkbox that holds nothing back. It rides in
  `endpoint.info`, in the answer to `endpoint.setIdentity` and in `endpoint.changed`, optional rather
  than nullable on the payload, since naming a machine is a different control and must leave it alone.
  The refusal names who made the view, who is asking and what the setting does, so the agent can say it
  in words to the person who can change it.
- The verb never removes the view the caller is standing in, which is also why it can never empty the
  sidebar: the caller always holds one row, so the "deleting the last view leaves an empty canvas"
  rule is reachable from the client and not from here. Deleting a canvas ends the sessions of its nodes
  first, inside the same `ProjectStore.mutate` that writes, so the checks have already passed and a
  refusal never costs anybody a shell. The daemon does it itself (`SessionManager.kill`,
  `ChatManager.kill`), which is what makes the verb work with nothing connected, where the client's
  `endProjectSessions` is the same rule run from the other side; an id neither manager knows counts as
  already ended. The prompts and lineage records go with it through `ProjectIndex.onPlaces`, the hook
  the write already fires.
- `view` is one verb with words of its own rather than five verbs. The list `help` prints stays the
  size of what an agent picks from, and the words are a table in the registry entry that the dispatch,
  the synopsis and `help view` all read, so a subcommand is documented by being defined. `--dry-run`
  stays off it: the design's argument holds, since `createdBy` and the machine setting decide before
  anything is asked, and a delete that named what it would end and then did not do it would be a second
  round trip for an answer `views` already gives in its last column.
- `views` gained that column (`yes` or `no`) rather than a `createdBy` column. Who made a row is not
  the question; whether this caller may remove it is, and answering it needs the machine setting too,
  which is not in the project at all. A `--kind` on `view new` comes from the union in contracts, so a
  kind added there is one the verb makes without a line of its own.
- A `view icon` value made of letters, digits and dashes that is not one of the 60 Lucide names is a
  typo, not an emoji, so it is refused with all of them rather than written into the file as a mark
  nothing can draw. The names print in rows of ten: sixty lines under a refusal would bury it.
- `open` is the one verb that writes nothing. Making a view is shared and belongs in `project.json`;
  looking at one is a person at a screen and belongs in `<projectId>.local.json`, which no agent may
  reach. So it is an event, `project.showView { projectId, viewId, by }`, and the daemon's part ends
  there. `by` is the caller's id like every other id in these verbs, never a title: what the person
  reads is the node's own title, looked up by the client in the document it already holds, which also
  means a client that has not merged that node yet says "An agent" instead of showing a raw id.
- It is the only event the daemon aims rather than broadcasts. `project.changed` goes to every socket
  because a client that released a project may still hold its document, but being shown a view happens
  to a person, and a client with the project nowhere on screen has nothing to do with it. The store
  keeps who is watching per socket (`addViewer` on `project.open`, `removeViewer` on `project.release`
  and `project.close`, the lot dropped when the socket goes). Nobody watching is not a failure: the
  answer says `sent no`, nothing is held for later, and the same call a minute later reaches whoever
  is there then. Holding it would be a message queue, and a view shown ten minutes after the agent
  meant it is worse than one never shown.
- The client asks before it follows, and a client setting (`agentsShowViews`) turns the asking into
  following, because this is the one verb a person can refuse. Everywhere else the daemon executes and
  asks nobody; here what would be asked is not permission to change the project but permission to move
  someone's eyes, and that answer is the same every time, so it is a setting rather than a dialog. Off,
  which is where everyone starts, nothing moves and the request waits in the banner. On, the view takes
  the cell that has the focus and the same banner offers the way back. A default of on would have been the app moving
  a person the first time an agent asked, before that person knew the verb existed; the way to find out
  the feature is there is to be asked once, not to be moved once. Which is also why `agentsShowViews`
  sits in the client's settings while `agentsDeleteAnyView` sits on the machine: the daemon enforces one
  and cannot enforce the other.
- Showing reuses what `setActiveView` always did, lifted into `showViewIn` in `shell/split.ts`: the
  view takes the focused cell, and one already standing somewhere takes the focus instead of appearing
  twice. The way back is `undoShowView`, and it runs against the grid as it stands when the button is
  pressed rather than against a copy from the moment of the banner. Between the two a person may have
  split a cell or closed one, and handing them a layout from before that would take away work they did
  themselves; a cell that is gone leaves everything where it is.
- What an agent's `open` has to say is a banner, never a toast, in both settings: the same strip over
  the views that the save conflict and the save failure use (`shell/Banner.tsx`, lifted out of
  `ProjectBanner` so all of them draw the same card). A toast is read after the fact and a decision has
  to be where the eyes already are, and a card in the corner that never goes away is a card that gets
  ignored. Following puts its line there too, because the message is the same agent speaking about the
  same thing either way, and a message that changes place with a setting is two features to learn
  instead of one. The two can never be up at once, since one is the setting on and the other off. One
  slot, and the file comes first: work that may be lost outranks a view that can be shown again.
- Three lines, one per case. "Refactor asked you to look at Board" with "Go there", "Refactor showed
  Board in the cell you were working in" with "Back", and "Refactor pointed at Board, which you were
  already looking at" with nothing but a dismiss, which is also what a grid that was empty gets: there
  the view had nothing to take the place of, so there is nothing to go back to.
- A second `open` replaces whatever is standing, in both settings, since the last thing an agent asked
  for is the one worth acting on and a queue would be a list nobody works through. With following on
  that also means the way back is out of the second view: the grid moves before the banner is written,
  so what it records is the grid as it stands after the move.
- Both buttons clear it, which is what the first version got wrong: pressing "Go there" showed the view
  and left the card standing, because dismissing lived in the component's callback rather than in the
  one place that owns the state. The banner lives in the document store (`viewNotice`, `showNotice`,
  `runNotice`, `dismissNotice`), which is per workspace and already knows when the view is deleted or
  the project swapped out, both of which take the banner with them.
- Beyond that, a banner goes when what it offers stops meaning anything, and that is the whole of when
  it goes by itself. A way back describes the grid as it was, so any move a person makes themselves
  (`commit`, which is every move of the grid) answers the question and drops it. A request to look
  somewhere survives such a move, since it still stands, unless the move is the person arriving at the
  view it names, which is the request answered by doing it. No timer on either: four seconds after a
  view you did not ask for is exactly when you would reach for the way back.
- Every workspace with that project acts, on its own focused cell, and the machine has to match as
  well as the project id: the same folder may be open on two machines at once, and the event is about
  one of them. One banner per workspace, so an agent showing three views in a row leaves the last one
  on screen instead of a stack.
- The toast's fourth kind, `notice`, went out with the toast it was added for: a kind nothing sends is
  a kind the next person has to read to find out nothing sends it.
- `agentsDeleteAnyView` is written over the same `endpoint.setIdentity` the name and the icon go
  through, sending both back unchanged, since the wire takes the three together. A machine nobody named
  sends `null` for the name rather than the name it answers to, or reading a setting would quietly make
  its default name a chosen one. The switch sits under Agents rather than in the Machines pane: that
  pane is about pairing a machine and whether it answers, and this is about what an agent may do. One
  row per machine there, each with the machine's name and icon, because a bare "Agents may delete any
  view" says nothing about which machine it is about, and a machine that is not answering shows the
  switch dead rather than guessing at its value.
- The frame a group takes around what it holds is one function in `packages/contracts`
  (`groupFrame`), which the client's `groupSelection` and the daemon's `group` verb both run. It is
  four lines of arithmetic, which is exactly the size of thing that gets copied and then drifts, and
  the padding, the title band and the snap to the grid are what tell a frame a person drew from one
  an agent drew. `GROUP_PADDING` and `GROUP_HEADER` were already shared for the same reason; the
  grid (8 px) followed them, so the client's `GRID` now comes from contracts as well.
- `group` refuses what the client silently drops. A person's selection with a group in it is grouped
  without that group, because there is no way to say so in a click; an agent named it in `--nodes`
  and has to hear that a frame goes around nodes (`not-groupable`). For the same reason the nodes
  have to stand in the same place already (`different-groups`, naming both nodes and where each one
  stands): a frame drawn half inside another frame would belong to neither, and membership on this
  canvas is geometry, so nothing would be wrong in the file and everything would be wrong on screen.
  Inside a group that is folded shut the new frame joins its `memberIds`, the rule `--group` on
  `agent` already follows, since nothing reads geometry while a group is collapsed.
- What lands inside a frame is not only what was named: a node standing between two of them goes in
  too, because that is what a group means once it is drawn. So `group` counts the members in its
  first line and prints an `also` row per node it caught, rather than refusing or moving anything.
- `arrange` starts at the top left of the box the nodes already occupy. The alternatives are the
  caller (which drags a tidy-up across the canvas towards one node) and the origin (which throws the
  work of somebody who put it where it is); this one only ever shrinks the space between the nodes,
  so a person looking at that corner still sees them. A column is as wide as the widest node in it
  and a row as tall as the tallest, which is what keeps nodes of different sizes apart without
  resizing anything, and one node therefore never moves at all. A group is not something to arrange
  (`not-arrangeable`): it carries whatever stands inside it, and a verb that moved a frame without
  its members would empty it.
- None of the three takes `--dry-run`, which keeps the flag on the verbs whose cost is not the write:
  `agent` and `team` start CLIs that spend somebody's money, and `node` may open a shell. A frame, a
  layout and a title cost a rev, and the answer already says what they did; a dry run there would be
  a second round trip for what the next `nodes` prints anyway.
- The node accents are a closed set in contracts (`NODE_ACCENT_NAMES`), and the hex per name stays in
  the client. The daemon has to refuse a `--color` that is not one and has no business knowing what
  red looks like; the client is the only side that paints, and the swatches it draws now come out of
  the same list in the same order.

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


### A file on the canvas

- A file node and a file view hold a path and nothing else. The bytes are the file system's, so
  there is no format, no store, no rev and no request on the wire that a drawing needed: two nodes
  on one file are two independent readers with nothing between them. Read-only on purpose; saving
  is a decision about what a client may change on a machine, with a conflict question under it.
- The path is relative to the project folder, POSIX, because `.ruimte/project.json` goes into git
  and an absolute path is wrong in every other checkout. A file outside the folder keeps its
  absolute path, which is what `relativeTo` hands back for a path it cannot shorten
  (`storedPathOf` and `resolveStoredPath` in `packages/contracts/src/stored-path.ts`).
- **Open:** `relativeTo` decides "inside the folder" with a bare `startsWith`, so a sibling whose
  name begins with the folder's name passes. A project at `/Users/bas/repo` stores a file from
  `/Users/bas/repo-old/src/a.ts` as `old/src/a.ts`, and `resolveStoredPath` turns that back into
  `/Users/bas/repo/old/src/a.ts`: a node quietly pointing at the wrong file, or at none. The
  daemon's verbs do not hit it, since they check with `isInside` (`node:path`'s `relative`) before
  they call `storedPathOf`; the client calls it bare (`storedFilePath` in `project/views.ts`, and
  every `relativeTo` in `shell/panels`). The fix is a separator check inside `relativeTo`, which
  is the one place that has the root and the path together.
- All three surfaces (a preview tab, a node, a view) are the preview's own reading layer:
  `useFileRead` for the read and the re-read, `renderFile` for the renderer, `FileBody` for the one
  loading state and the one error state. A path that is gone shows that error and stays where it
  is: nothing follows a rename, because following one needs an index of inodes that does not exist.
- `fs.watch` is counted in the client (`state/fs-watch.ts`). The files panel used to be the only
  caller, so a node on a canvas with that panel closed never heard that its file changed. The
  daemon skips a folder a recursive watch above it already covers, so releasing the folder above
  makes the ones still held under it ask again.
- A drag inside the app writes two types: the mention type the composer already reads, and
  `application/x-ruimte-paths` with the trailing slash of a directory still on it. The canvas is
  the side that has to tell a folder from a file, and it leaves the folder alone: a folder on a
  canvas would be a file manager, which the parity table already says this is not.
- `NodeKindSchema` is an enum, so a daemon older than this refuses a whole document that has a file
  node in it, not just that node. That is the trade every new kind makes, and it only bites a
  remote daemon that lags behind its client.

### A diagram

Built on 2026-09-14 after a design report of 2026-09-12, all five phases of it (the `diagram` kind
of `node`, which the report put in phase 4, came with the node itself in phase 5). What the report
left open and what the build decided:

- **The idea is archify's, the code is not.** A diagram is a typed document an agent writes, with
  refusals it can repair against, not a picture it tries to draw. What stayed out: archify's five
  diagram types (one directed graph with groups covers architecture, data flow and a workflow; a
  sequence diagram is another renderer and waits until someone misses it), coordinates chosen by
  the agent, semantic node types like `backend` that only fit web architecture, hex colors, its
  viewer and a standalone HTML artifact (the file in the project is the artifact). Mermaid is not
  an input, because its parser and edge cases would come along and the file would no longer be
  what the agent wrote; as an export it could come later. A node that points at a path and a line,
  opened in the preview on a click, is the one later addition the report named.
- **Two view kinds, not a second sort inside a drawing.** The report's advice, kept: a diagram
  inheriting the bare letter keys, the dock and the undo of a drawing would have been a question in
  every drawing branch of the client, and the file of one is nothing like the file of the other.
- **A group wraps nodes and nothing else.** No group in a group, no node in two groups, and an
  edge joins two nodes, never a group. Nodes and groups share one id namespace anyway, so a later
  nesting or an edge to a group reads an existing file the same way. Every one of these rules is a
  refusal by id (`diagramProblemIn`), because an agent that wrote the file has to be able to repair it.
- **`meta` is required, `title` may be empty.** A missing direction would have needed a default
  written down in two places; a file is either a diagram or it is refused.
- **On disk the order is meta, nodes, groups, edges**, the order of the schema. The report's
  example put the groups first; nothing reads the order but a person.
- **A cycle is broken by a walk in file order.** A depth-first walk starts from every node without
  incoming edges, in file order, then from every node still unvisited, also in file order; an edge
  that points back at a node still on the walk is left out of the layering and still drawn, routed
  underneath both boxes. A loop on one node never counts for a layer. The same file breaks the same
  edges on every machine, and a different order of the same graph may break a different one.
- **Eighty lines were not enough.** The report expected a longest-path layering with file order
  inside a layer to be readable. A demo of ten nodes, two groups and a cycle proved it was not:
  edges that skipped layers ran through boxes and groups, labels lay on boxes and on other lines,
  long labels ran out of their boxes and lines crossed that did not have to. The layout is now a
  small Sugiyama in `packages/diagram`, still without a layout library and still deterministic:
  - An edge that skips layers gets a point per layer it passes (`layout.ts`), so it runs through
    the gaps between boxes. The points of one edge pull towards each other rather than towards
    their neighbors (`across.ts`), since pulling towards neighbors made every long edge a staircase.
  - An edge that closes a cycle is laid out from its target like any other and drawn with its head
    the other way: it leaves its source against the flow and never goes around underneath, which
    was what put the old detour under other boxes.
  - The order inside a layer comes from twelve barycenter sweeps, up and down, keeping the order
    with the fewest crossings; a tie keeps the order the layer had, file order to begin with
    (`order.ts`). A group is one block in every layer it spans, at one place across the flow, the
    blocks keep one order in every layer, and a node outside a group stays on the same side of it
    from one layer to the next, so no edge crosses a group it has no end in. Where two neighbors
    disagree about the side, the first in the file wins and that edge may still cross.
  - Across the flow every node starts in the middle of its tightest packing and moves eight rounds
    towards the median of its neighbors, clamped to its neighbors in the layer (`across.ts`). That
    is simpler than Brandes and Köpf and good enough for straight chains.
  - Every stretch of an edge between two layers has its own port on the box, spread in the order of
    the other ends, and a vertical track of its own in the channel where its range meets another's,
    in the order that crosses the fewest lines and never runs on top of another (`route.ts`). A
    port within 6 units of the other end moves to it, so nearly straight edges are straight.
  - A label sits in its channel: in a lane before the tracks beside the line it leaves on, beside
    its own vertical stretch, or in a lane after the tracks. It prefers a place on no line; one on
    no box, no group label and no other label is required, and the channel grows a column of lanes
    until there is one. A loop in the last layer and an edge with a pinned end have no channel, so
    their label moves down until it is clear.
  - A channel keeps 20 units free on each side, plus a group's padding where a group ends or begins,
    so no line runs along a border; a group keeps 16 units plus the node's own 16 from a node
    outside it.
- **A node with `pos` gives up its place in its layer**, and the rest close up. Keeping the slot
  empty would leave a hole where a person dragged a node away from. Its edges take the shortest
  elbow and none of the promises above hold for them: no port, no track, and a label that moves
  down until it is clear. The elbow follows the flow, so in a diagram that runs down it leaves a box
  downwards whenever the two boxes are stacked, instead of out of a side against the flow; that is
  the one change the drag asked of the layout, and a crossing is still allowed there.
- **Text is estimated, never measured.** `packages/diagram` has no DOM and the daemon draws the same
  picture, so a glyph is a share of its size per class of character (narrow, lowercase, uppercase,
  wide, digits, CJK), measured in Chromium on the system face and on Helvetica as a stand-in for
  Inter and Segoe UI, taking the wider of the two (`text.ts`). A box grows with its label from 120 to
  280 wide and then wraps on words, with the height that goes with the lines; a word wider than a
  line is cut. The layout hands out the wrapped lines (`NodeBox.label`, `sub`, `EdgeRoute.label`),
  so the view and `toSvg` draw the same lines through `textLinesOf` and `edgeLabelLinesOf`. A
  group's label does not widen a group that runs right, and may run past a narrow one. The palette
  defaults and the sans stack come from `packages/drawing`.
- **`DiagramStore.write` finds its project on disk, not among the open ones.** `ProjectStore.place`
  reads the project file under the project store's lock, and the diagram store writes under a lock of
  its own that `open`, `save` and `copy` also take, so a client's save and an agent's write never
  build on the same rev. It keeps no watcher for a project nobody opened and sends `diagram.changed`
  itself; a client that has the diagram open has its rev moved along, so its own watcher stays
  quiet. A file under the name that is not a diagram is refused and left alone, as a drawing's is.
- **A save is checked as well as a read.** A drawing's save trusts the client; a diagram's refuses
  an edge or a group that names a node that is not there, since phase 5 lets a person delete one.
- **The client is the drawing's, save path included.** `DiagramClient` follows `DrawingClient`
  line for line (open what the grid shows, flush and close what leaves it, a conflict to the banner,
  a reopen after a reconnect), with a registry of editors of its own beside the drawings'. The
  handles of phase 5 are the edits that go through it. Taking theirs from the banner cancels the
  save the conflicting edit had waiting, which would otherwise write their document straight back
  under a new rev.
- **SVG in the DOM, colors through the tokens.** `DiagramView` draws `layoutOf` and the shape paths
  of `packages/diagram` as elements, with every tone as `var(--draw-<name>)` in a style, so a theme
  switch needs no repaint. The export goes through `toSvg` with the palette read from the theme, and
  a PNG is that SVG drawn onto a canvas, so the two formats cannot differ.
- **The zoom and the exports live in a dock, the JSON in the bar.** First all of it was portaled
  into the bar, reasoning that a floating dock is for tools and a diagram has none. In use the zoom
  and the exports stood somewhere else than on a drawing, so they moved to `DiagramDock` on
  `DockShell`, with the classes and the export menu of the drawing's dock, drawn in every diagram
  cell as a drawing draws its own. "Open the JSON file" and "Copy as JSON" stay in the window's or
  the cell's toolbar (`file-toolbar-slot.ts`, `diagram` in `KINDS_WITH_TOOLBAR`): they are about the
  file, not the picture. Opening the JSON file waits until there is one (rev above 0) and needs a project folder.
- **What a diagram view is offered:** a new view from the view menu and the palette, a duplicate
  (the daemon copies the file), the zoom and export rows in the palette, and "Show on the canvas"
  from the view menu, the sidebar row and the palette, which puts a mirroring node on the canvas
  that was up last. "Put on canvas" stays what it was, the way back for a session view that was a
  node; a diagram view never was one, so it is not offered there, as it is not for a drawing.
- **An agent writes the whole diagram, never a piece of it.** `ruimte-context diagram <viewId>`
  replaces the file, with no patch form and no `--dry-run`: a wrong diagram is undone by writing
  the right one. A small change is an edit of the file with the agent's own tools, which the
  watcher reports and nothing checks. The project is the caller's (`ProjectIndex.locate`), and a
  view id of another project is refused as not a diagram of this one, the same answer as a drawing.
- **Stdin travels as `--document`.** The canvas route stays `{ argv }`: the CLI reads stdin for this
  one verb and puts it in the flag unescaped, because the daemon parses JSON there and reads no
  escapes the way it does in `--text`. Given `--document` itself, stdin is not read. A person who
  runs the verb in a terminal without a redirect waits on stdin the way `cat` does.
- **Strict where a save is not.** The verb checks a strict copy of the schema at every level, so a
  misspelled field is refused by its path instead of being stripped and the diagram written
  without it; a client's save still strips, as "Kinds a newer Ruimte wrote" describes. `version`
  and `rev` pass and are ignored, since a rewrite most naturally starts from the file on disk. A
  refusal carries a `problem` line per zod issue (at most 20) in words of its own, with the id of
  the node or group or the two ends of the edge it is about, and the first one as its message.
- **A diagram source is the drawing's branch.** `deriveContextSources` makes a source of kind
  `diagram` for an edge from a diagram node into an agent, with the view id as the source id, so two
  nodes on one diagram are one source. A diagram node without a `viewId` is only a line. A diagram
  view without a node is never a source, like a drawing view without one; an agent that wants it
  reads `.ruimte/diagrams/<viewId>.json` itself. Unlike the drawing reader, which only looks among
  open projects, `DiagramStore.read` finds the project of the agent asking on disk, and it never sets
  a broken file aside, since a read should leave the folder as it found it.
- **`node diagram --source` takes a diagram and nothing else.** The flag is the drawing's, checked
  against the kind of the node: a drawing view given to a diagram node is refused as `not-a-diagram`
  with the diagram views listed, and the other way round as before. Where a project has no diagram
  view the refusal names `view new --kind diagram`, since an agent can make one, where a drawing's
  still says a person makes one.
- **The node is the drawing node's, in SVG.** `DiagramNode` lays the mirrored content out with the
  same `layoutOf` and draws `DiagramScene`, the view's own elements, in an `svg` whose `viewBox` is
  the bounds with 24 units of air and which takes no pointer, so the canvas drags the node and a
  double-click opens the view. It is read-only, like a drawing node. Unlike a drawing node it draws a
  plate (its mark and its title) out of view and under `READABLE_ZOOM`, as a file node does: a
  diagram costs a read and a layout, where a drawing node only paints what it already holds.
- **An empty diagram node says what fills it, and nothing says it is being written.** The report
  left open whether a node an agent places before it writes the diagram should say "being written".
  It does not: the daemon cannot know a write is coming, so such a state would be a guess that
  stays up forever when the agent never writes. The node shows the drawing node's empty state with a
  sentence of its own ("An agent fills it with ruimte-context diagram"), for a file that is not there
  yet and for one without nodes alike, and the mirror shows the diagram the moment the write lands.
- **What a person does to a diagram is four handles.** Dragging a node writes `pos` in whole numbers
  after 3 screen pixels, so a click or a double-click never pins a node. A double-click or "Rename"
  in the node's context menu types the label over the box; the label is trimmed and an empty one
  keeps the old label, since a box without a name cannot be found again. "Tone" is the drawing
  dock's `Swatches` in the paper colors a node is filled with, and "Reset position" removes `pos`. A
  right-click on the paper opens nothing. Groups and edges have no handles: a diagram is written, and
  anything more is a change of the file.
- **Undo is whole contents.** A diagram is a few dozen entries, so the store keeps up to 100
  earlier contents rather than inverse steps, a drag is one step however many moves it took (the
  drawing's `first`), and a document from disk starts the history over, as a drawing's does. The
  dock carries undo and redo beside the export, and Mod+Z and Mod+Shift+Z are bound once per
  workspace in `canvas-shortcuts.ts` for the focused cell when it holds a diagram, not per cell.
- **`diagram` is the first node kind after the unknown-kinds fix, and it did not wait a release.**
  "Kinds a newer Ruimte wrote" advises a release in between. That was weighed and accepted: a
  project with a diagram node, opened by a release without that fix, is set aside as `.corrupt-`
  until that app is updated and the file renamed back.
- **The hint names no verb.** `VERBS_NOTE` says what `ruimte-context` is for rather than listing
  its verbs, so it stays as it was; `help` lists `diagram`, and `help diagram` is the schema.

- **Open: an agent's `view delete` leaves the file behind.** Orphans are only removed when a person
  saves the project, which is the drawing's rule too (`ProjectStore.mutate` updates the ids without
  asking the stores). For a drawing that is a sketch left in `.ruimte/drawings`; for a diagram an
  agent made and deleted in one turn it is a file nobody will ever see again.

### Views side by side

The grid landed on 2026-09-12; what follows is what the design left open and what the build
decided differently.

- **Columns of cells, not a tree.** A layout is at most three columns of at most three cells, so
  "3x3" is a property of the model rather than a counter laid over one. Both limits live in
  `apps/client/src/shell/split.ts` and nowhere else; the zod schema keeps no maximum, so a file
  edited by hand past them opens and is trimmed on the way in rather than refused.
- **One view, one cell.** A view already on screen moves instead of appearing twice, and a drop on
  the middle of a cell swaps the two views rather than pushing one off the grid. Two cameras on the
  same nodes is a feature nobody asked for and a bug everybody runs into.
- **The layout is client state, with the machine as the starting point.** It is kept per client
  beside the camera and the panel widths and still sent to `<projectId>.local.json` (see "Local
  state per client"), never in `project.json`: a grid built on a 32 inch screen has no business
  appearing on a laptop. `activeViewId` is still written beside it, so an older client reads such a file as
  the project with that one view open.
- **The shortcuts hang on the workspace, not on a canvas.** `canvas/canvas-shortcuts.ts` binds once per
  workspace. Nine cells would otherwise be nine window listeners that all resolve to the focused
  cell, and one undo would land nine times. The same reasoning moved the Escape listener of a
  standalone view and the tool keys of a drawing behind "is this the focused cell".
- **A cell carries its own toolbar as soon as there are two.** With one cell the window's toolbar
  speaks for the view, as it always did; split, it goes back to being the application's and every
  cell says for itself which view it holds. The bar has the size of the toolbar under a panel's header (`FILE_TOOLBAR`, `h-10`), and
  its name is the drag handle, which is where a tab bar would be in an app that had tabs.
- **The drag payload is unreadable until the drop.** A browser keeps `getData` from the page during
  `dragover`, so a cell cannot ask which view is coming and cannot judge the limit. There is one
  pointer and so one drag: `shell/view-drag.ts` holds it in module state between dragstart and
  dragend. A drag from outside the window has no payload and is refused.
- **A `<webview>` swallows the drag.** For as long as a view is being dragged, `data-view-drag` on
  the body takes every embedded page out of the pointer's way (one rule in `styles.css`): the parked
  browser pages and the preview of an HTML file, which is a webview of its own. Without it a drag
  passing over such a cell loses its `dragover` and the cell never lights up.
- **One parking layer, clipped per cell.** Every page is placed against the cell of the view it
  belongs to (`shell/cell-rects.ts` says where each cell is), inside a clip box that never changes
  parent. A parking layer per cell would move a `<webview>` between parents whenever a view changes
  cells, and a page that leaves the document reloads.
- **Not done:** the report's plan to fold `useColumnResize` and the git panel's log resize into one
  axis-agnostic hook. Those two drag pixels and the grid drags shares of an axis; there is nothing
  worth sharing. The grid's own splitter is `splitDrag` in `shell/SplitGrid.tsx`.
- **Open: `useDrawing.getState()` means the focused cell, not this one.** An editor hook has two
  halves and they resolve differently. `useDrawing(selector)` reads the cell the component is drawn
  in (`CellViewContext`); `useDrawing.getState()`, `.setState()` and `.subscribe()` go through
  `asStore` in `state/workspace-stores.ts`, which resolves the cell that has the focus, because
  outside React that is what every call site meant. `DrawingView.tsx` uses the second half eleven
  times over, for the viewport, the pointer handlers, the zoom and the fit, so a drawing in a cell
  without the focus measures, pans and draws against the store of another cell. Same family as the
  camera bug `fd202cd` fixed: a component per cell reaching for a singleton that has moved on. The
  fix is to take the store once (`useEditorStoreOf`) and use that handle everywhere in the
  component, rather than the module-level hook.
- **Not measured:** nine cells at once. The WebGL budget already spreads itself over them (ten
  contexts, LRU), but the React trees, pointer handlers and resize observers scale with the cells.
  If a full grid stutters, lowering the limit is two numbers in `split.ts`.

### Local state per client

Landed on 2026-09-14. Everything in `<projectId>.local.json` used to be per machine, so a laptop and
a desktop on one daemon overwrote each other's camera, grid, panels and open view, without an event
to tell the other. Four decisions, taken on 2026-09-13:

- **The daemon stays the starting point.** A client still sends everything to `project.save-local`,
  and a project or a view a client never saw opens the way the machine has it. A third client
  starts where the last one stopped.
- **Everything per client, at once.** The camera and focus per view, the grid, the panels and
  `activeViewId`. The one exception is `panels.favicons`, a cache of pages rather than of a screen,
  which is never kept by the client and always read from the machine.
- **The camera is stored from the middle.** On disk and in localStorage it is the world point in
  the middle of the cell plus the zoom (`ViewCameraSchema`), so a smaller window or another cell
  keeps the same stretch of canvas in front. In memory it stays `{ x, y, zoom }`, because every
  calculation leans on that. A camera in the old shape cannot be turned around without the viewport
  it was taken in, so it reads as none and the view is fitted once; the payload of
  `project.save-local` accepts it, so an older client does not see its whole local file refused.
- **Camera history stays in the editor.** Cmd+[ and Cmd+] (roadmap point 8) keep their history in
  the editor of this client and store nothing.

How it came out:

- The copy is `ruimte.local` in localStorage, a row per `${endpointId}:${projectId}` with `at` and
  the local state (`project/client-local.ts`). A "client" is therefore an origin: every window of
  the desktop app shares one, the dev app has its own `userData`, and a browser on `localhost` and
  one on `127.0.0.1` are two. Two workspaces on one project in one window share a row, the same as
  they shared the file before.
- `overlayLocal` lays the row over what `project.open` returns before the document loads. A row
  brings its grid, panels and open view even when its grid is one cell; a view is looked up on its
  own and takes the machine's camera when the client has none for it. Views that are no longer in
  the document are dropped on load, so they go from both copies at the next write.
- A save writes the row first and then the daemon; `pagehide` flushes, because localStorage is
  synchronous and makes it where the socket may not. At most 100 projects, the oldest `at` goes; a
  full storage drops the oldest and tries once more, then gives up without a word.
- Forgetting a machine drops its rows, the rekey onto a daemon id moves them like
  `rekeyLastProject`, and deleting a project drops its row after the close wrote it.
- Restoring waits for a size: `loadView` and a drawing's `load` put a stored camera in
  `pendingCamera` (`{ kind: 'view' }`) until `setViewport` measures the cell, the same wait a fit
  and a jump to a node already had, which also removed the fit effect from `DrawingView.tsx`. An
  editor that was never measured exports the camera it was given, so a cell nobody drew yet does
  not lose it.

### Processes

The panel landed on 2026-09-13; what follows is what the design left open and what the build
decided.

- **Warn, never act.** A stuck agent is a warning with the button that fits the signal (Interrupt,
  Terminate, Show process, Resume) and a dismiss. An opt-in "interrupt an agent that is silent for X
  minutes" can come later; nothing in the daemon sends a signal a person did not press.
- **Disk on macOS is per process.** The machine's number is the sum of every readable process, so
  root's processes are missing from it and the line undercounts; a real system counter is IOKit and
  phase 4. The free space is `statfs` of the daemon's home, not of a project volume: the monitor is
  per machine and a project folder is per workspace.
- **Windows gets an empty state**, from `platform` in `server.hello` or `supported: false` in the
  answer to `processes.subscribe`. No `tasklist` fallback.
- **Warnings sit on the row in the panel and as a mark on the node and its sidebar row**, never as a
  toast. With no panel open a warning can take up to five minutes to show, except after a hook, a
  shell exit or a kill, which read out of rhythm.
- **An agent outside Ruimte** is visible in "All" (the family comes from the path, the name and, for
  Ruimte's own tree, the script a runtime was given, and is inherited down to the root of a group but
  never through the daemon), and no signal judges it: without hooks there is nothing to disagree with.
- **History lives in memory**, empty after a restart. A sleep clears it too, the report's rule, which
  takes the coarse day with it after a night with the lid closed. If that hurts, a gap marker instead
  of a reset is a small change in `monitor.ts`.
- **Orphans after a restart work.** `KERN_PROCARGS2` reads the environment of a process of the same
  user, so a process under launchd whose `RUIMTE_SESSION_ID` names a session this daemon no longer
  runs is an orphan, as long as its `RUIMTE_CONTEXT_URL` is this daemon's: dev beside production is
  two daemons on one machine with two ports. The environment is read once per process. Inside one
  life of the daemon the members of every node's tree are remembered as well, which also covers chats.
- **Resume after "agent gone".** The warning is the daemon's evidence that the CLI died without a
  SessionEnd, so `agent.resume` accepts a live agent when the monitor says it is gone
  (`SessionManager.isAgentGone`). Once dismissed, the warning no longer counts as that evidence.
- **Interrupt on a chat is `chat.cancel`**, not SIGINT to its CLI: the turn is what hangs, and a
  cancel is what that protocol understands.
- **The thresholds are the report's starting values, not calibrated.** Phase 1 asked for an hour of
  real Claude and Codex sessions before phase 3; the script that logs them is there, the hour is not.
- **Not built:** the sparkline of a hovered row in the charts; Electron's renderer and guest pages as
  pids of their own (phase 4, so a browser node stays under "Ruimte app"); a `devices` panel kind
  beside `processes`, which the report suggested adding at once but which nothing uses yet.
- **Measured** on this Mac (macOS 27, 16 cores, about 1,600 processes): a warm reading of the whole
  table costs 3 ms (0.15 ms to list, about 2 ms of FFI, the rest decoding), 9 to 15 ms when the CPU
  has been idle; a subscription answers in 2 to 10 ms. CPU time agrees with `ps` within 0.1 s, the
  footprint with `top` within 5%, and the sampler works in a `bun build --compile` binary signed ad
  hoc.

### Staying awake while an agent works

- It is a client setting (`agentsKeepAwake`, `apps/client/src/state/settings.ts`), not a project
  setting and not a daemon one. The thing being kept awake is the computer this window runs on, and
  that is the one machine a project cannot name: a project lives on several, and a daemon has no
  say over the laptop someone is looking at it from. It starts off, because a laptop that no longer
  sleeps is a decision about somebody's battery and not a default worth taking for them.
- The client decides when an agent is working and the shell only holds what it is told. That keeps
  the seam at one boolean and leaves the hooks, which already know, as the single source of it.
  `state/keep-awake.ts` subscribes to the session and chat stores rather than polling, so the block
  starts with the first agent that goes to `running` and ends with the last one that settles.
- Every machine this window watches counts, not only the one the project runs on. The laptop on the
  desk is what falls asleep, and a socket it was streaming a remote turn into goes with it.
- There is no browser half. `canKeepAwake()` is false without the bridge and the row is not drawn,
  the way the Updates pane hides auto-download where there is no updater: a switch that cannot do
  what it says is worse than no switch.
- **The mode is `prevent-app-suspension`, measured rather than read.** On macOS that mode takes an
  IOKit assertion and `prevent-display-sleep` takes another one, so the two are not a matter of
  precedence: app suspension is `NoIdleSleepAssertion`, which keeps the machine running and lets the
  screen go dark, and display sleep is `NoDisplaySleepAssertion`, which lights the screen a laptop
  with its lid open should be allowed to put out. The first is what the setting promises.
- **Grep the assertion's type, never Ruimte.** `NoIdleSleepAssertion` is the name the type had
  before 10.7, which Chromium still creates it under, and `pmset` prints the name it was created
  with rather than the `PreventUserIdleSystemSleep` it counts as. The owner it prints is "Electron"
  as well, since that name is compiled into Chromium and no app of ours reaches it. So
  `pmset -g assertions | grep -i preventuseridlesystemsleep` finds nothing, twice over, and the
  feature reads as dead while it is working. What shows it is
  `pmset -g assertions | grep NoIdleSleepAssertion`: it appears within a second of a turn starting
  and is gone within a second of the last one settling, sample for sample against the statuses
  `session.list` reports.

### Attention

- **Unseen is about the window, the cell and the camera, and not about which cell has the focus.** A
  turn that ends counts as seen when this window has the keyboard, the node's view stands in a cell
  of the grid, and (on a canvas) the node falls inside what the camera has in front of it at a zoom
  of `READABLE_ZOOM` or more. Nine cells are all in front of the same pair of eyes, so the cell with
  the focus is no part of it: marking the eight beside it would make a mark out of every turn that
  ends in a split. The renderer's culling margin is no part of it either. It keeps a node alive half
  a screen past the edge so a pan does not thrash, which is not the same as a person having read it.
- **Marking and clearing are one rule read twice.** `nextUnseen` takes the marks, adds what just
  ended, and subtracts everything in sight, so a turn that ends in front of somebody never leaves a
  mark and a marked node loses it the moment it comes into sight. Nothing is on a timer, and nothing
  has to remember to clear: every pass counts the project from scratch, so a subscription that misses
  a change delays a clear by one event instead of leaving a stale mark behind.
- **The mark is the finished count's own glyph, and it is nothing to press.** A node whose turn
  ended out of sight wears the check the toolbar wears (`attention/UnseenMark.tsx`), in the idle
  color and not in the warning one a stuck agent gets: a turn that finished is good news, and the
  two marks stand beside each other in the same header, so they had better not read alike. It is
  drawn on the node header and on the sidebar row, the two places the process warning is already
  drawn, and not in the processes panel, whose rows are about a machine's process table and have
  nothing to say about who looked at what. Up close the mark is already gone, since looking clears
  it: what it is for is the canvas zoomed out over everything and the window standing beside
  another app. `clearUnseen` is still there for a dismiss and still has no caller, because a
  button would be a second answer to a question the camera already answers.
- **A turn that stopped to ask did not end.** `needs-you` is a person's turn and the needs-you count
  is already about it, so it never becomes a finished mark. That is also what keeps the dock badge
  from counting one node twice.
- **The client counts, the shell displays.** One push (`setAgentActivity`) carries the working count
  and the attention count, and the shell keeps the last one for its dock badge and its quit dialog.
  A pull would have had `before-quit` waiting on a renderer that may be busy or gone, and counting in
  the shell would have meant a second answer to "is this an agent or a shell somebody left open".
  The badge is macOS and Linux; Windows has no dock to put a number on.
- **The notification starts on and its sound starts off.** It only ever fires while this window is
  not the one in front, which is to say after somebody walked away, so it cannot land on top of what
  they were doing and there is nothing to protect them from by default. A sound can: it arrives in
  whatever they walked away to, which may be a call. The same sound setting covers the needs-you
  and permission notifications, so a person has one answer to "should this machine make noise"
  rather than three.
- **Quitting asks once.** `before-quit` fires again for the same quit, so the answer is remembered;
  a window that is already closed is never asked, since the client that would have counted is gone.

### Settings

- Eight panes in five groups, with a separator between two groups: Appearance and Keyboard, Views
  and Files and Git, Agents and Usage, Machines, About. `SETTINGS_SECTIONS` is the list of groups;
  the separator is no tab, so the arrow keys of Base UI Tabs pass over it.
- A pane is a preference or it is not in the settings. Zoom, the locks and the layouts act on the
  canvas that is open and nothing about them is stored, so the old Canvas pane went: the dock and the
  palette have all three, and `LayoutDialog` stays because the dock opens it. The name Canvas went to
  what used to be Drawing, and then became Views once the browser's swipe joined the drawing's snap:
  one pane with a section per kind of view, which is where canvas preferences (a font size for chat
  and text) land as well. The section id was never stored, so `canvas` needed no alias.
- Files and Git are one pane because they are the two panels beside the canvas and hold three rows
  each. Usage sits beside Agents because the only thing it sets is what agents cost.
- The five accents in the open are blue, orange, lime, indigo and pink, spread around the wheel. The
  twelve others are a list with a dot, a name and a check, in the order of the wheel, and never repeat
  one of the five. Someone who picked a color that left the five keeps it: the overflow wears it.
- Updates went into About, so "which version do I run" has one place, and the green button in the
  toolbar opens it. The header carries the app's version with the update state and its one button; in
  a browser there is no app version of its own, so it shows the machine's and no button. The details
  (the machine of the workspace with the focus, Electron, Chromium, Node, platform, data folder) copy
  as plain lines for a bug report.
- About and Settings in the macOS application menu open the client's dialog rather than Electron's
  About panel, which knew nothing about the machine or updates and had no Settings next to it. With
  Cmd+, as the menu's accelerator macOS takes the key before the page sees it; both do the same thing,
  and the shortcut in `app-shortcuts.ts` stays for the browser.

### Streaming in chats

- Replies came in chunks although every delta already arrived on its own: a delta often holds several
  tokens and was on screen the moment it landed, half-written markdown changed shape, and every delta
  parsed the whole reply again (and highlighted an open code block again). The deltas keep their
  shape on the wire; the client spreads what arrived over the time after it and fades every new word
  in over 300 ms (`chat/ui/reveal.ts`, where the constants live).
- The daemon holds the deltas of a chat back for 16 ms and sends a run on one item as one delta
  (`apps/server/src/chat/delta-coalescer.ts`), the rhythm terminal output already had. Every CLI
  delta used to be a frame to every client and a store update there, while the reveal only moves
  once a frame. Any other event sends what is held first, so the order stays the thread's; `attach`
  flushes before the client joins, because the snapshot already carries the held text, and `detach`
  flushes before it leaves. The client derives the rows from `structure` rather than `items`
  (`state/chats.ts`): the same map, except that a delta growing a reply or a thought that already
  has text leaves it alone. The row reads its text from `items`, so a word renders that row and not
  the thread. The first text of an item, a sub-agent's text and tool output still change the
  structure, since the rows are what decides whether and where those are drawn.
- The first version closed a sixth of the gap per frame and revealed a character at a time, and it
  looked like a fade that started at half and trailed, with the text still coming in steps. Three
  causes: a span made with half a word showed its later letters at the opacity it had already
  reached, `ease-out` jumps up and then trails, and a step per frame closed a delta in about 100 ms
  (twice as fast on a 120 Hz screen) and then stood still until the next one. The reveal is now a
  position in time, `lag * (1 - exp(-dt / 250 ms))` with a floor of 40 characters a second (120
  once the item is done) and a frame capped at 100 ms. Only whole words are drawn, the last one of
  a text still arriving waiting for the whitespace after it (a word over 32 characters goes through,
  or a URL would hold everything behind it). The fade is `ease-in-out`.
- The fade needs no keys of its own. `hast-util-to-jsx-runtime` keys an element by its tag and its
  place among the siblings with the same tag, and words only arrive at the end, so a span on screen
  keeps its element and its animation; `rehype-fade.test.ts` holds that down. An item that is done
  is not shown whole at once: the reveal runs on until it caught up, and the spans stay until the
  last fade is over. Only then does it render without spans, which looks the same. An item that was
  already done on mount is shown whole.
- A reply is cut into blocks at blank lines outside a fence, and not before a list item or an
  indented line, so a loose list or a paragraph inside a list item stays one piece; a text with a
  reference definition stays whole. The split is the same while streaming and after, so the end of a
  stream moves nothing.
- A code block used to be drawn bare and then swapped for Shiki's HTML, a flash of uncolored code
  per block, and a fence still being written stayed bare until it closed and then colored all at
  once. `CodeBlock.tsx` now draws Shiki's tokens as elements, a line at a time: a line that ended
  keeps its tokens, and the grammar state after it is where the next line starts (`code-lines.ts`),
  so a delta tokenizes the new lines and the one being written however long the block is. Code with
  a carriage return is tokenized whole every time, since a cut at newlines cannot see its lines.
  Until Shiki and the grammar are loaded the block holds its place invisibly (`aria-hidden`) and
  fades in once; only a failed load shows it bare. Whether a fence is still open reaches the block
  through a context rather than a second set of components, because a different component mounts
  the block again the moment its fence closes and throws its lines away.
- Every user message and every reply starts with a visually hidden `h3` naming its author ("You", or
  the provider's name), so a screen reader walks a thread a message at a time instead of hearing
  one long run of text. It is `select-none`, so a selection copied across messages leaves the names
  out. A heading inside a reply keeps its tag, which the styles and the copy read, and takes an
  `aria-level` three deeper, so a `#` in an answer never outranks the message it is in.
- The client ignored deltas on thinking items, so the thought stood still until it closed. It now
  grows like a reply, under the same switch.
- "Show replies" is one setting for everything an agent writes, the thought included, and it is the
  client's: the daemon keeps sending deltas either way. It was a switch; a stored `true` reads as
  `words` and a stored `false` as `whole`. Whole, a reply fades in only on a row that saw it being
  written, so scrolling back through an old thread does not animate it.
- The middle mode, `blocks` ("Paragraph by paragraph"), is for a reader who finds a word at a time restless and
  whole too slow. It draws only the blocks of the splitter that are closed (`settledBlocksText`),
  so half a block is never on screen, and a block is closed once the line after its blank line
  starts, not at the blank line itself: that line may still be a list item or an indented paragraph
  that continues the block. Each block fades in with `@starting-style` under `data-arriving`, which
  only a row that saw the reply being written sets. A thought shows its closed paragraphs the same
  way, without a fade. The fence rules the splitter follows are stricter now: a closing fence has no
  info string and sits at most three spaces deeper than its opening, and a line holding a no-break
  space is not blank.

### Shortcuts per platform

- One `Shortcut` value per shortcut (`ui/shortcut.ts`, parsed from `Mod+Shift+K`) drives both the
  binding and the label, so a label can no longer say something the handler does not do. The tables
  sit in pure modules beside their handlers (`shell/shortcuts.ts`, `canvas/shortcuts.ts`,
  `drawing/shortcuts.ts`), because the handlers load stores a test and the terminal keymap cannot.
- Modifiers are strict: `Mod` is Cmd on macOS and Ctrl elsewhere, and the other one has to be up.
  Ctrl+K on macOS no longer opens the palette. Letters and digits match on `code`, so Shift+1 still
  is Shift+1 while `key` says `!`, and Option's dead keys do not get in the way.
- macOS prints `⌥⇧⌘K`; Windows and Linux print `Ctrl+Alt+Shift+K`. Enter is `↩` on macOS only.
- Off macOS a focused terminal keeps Ctrl+W, Ctrl+T and Ctrl+\ next to Ctrl+B: they are control
  characters a program reads. Ctrl+Shift+\ still splits down from inside a terminal.
- In a plain browser tab Cmd/Ctrl+T and W belong to the browser and there is nothing to do about it.
  The Keyboard pane says so there and nowhere else.
- The wheel zooms on Ctrl on every platform, because Chromium reports a trackpad pinch as a wheel
  with Ctrl held; Cmd joins it on macOS.
- The desktop View menu dropped reload and the zoom roles: their accelerators reached the menu before
  the page, so Cmd+0 never zoomed the canvas. Off macOS the canvas always takes Ctrl+W, even with
  nothing to close, so the window menu's Close never shuts the window on it; the first column there is
  `fileMenu` rather than `appMenu`, which is a macOS menu.

### Kinds a newer Ruimte wrote

Landed on 2026-09-14, after Ruimte Dev added a `diagram` view to a project the installed Ruimte had
open. The installed daemon did not know the kind, could not parse the file and set it aside as
`project.json.corrupt-<time>`, which took the project away from both apps. The file was valid JSON
and a valid document apart from that one view.

- **An unknown kind is carried, not refused.** A view or a canvas node whose `kind` this version
  does not know, with an `id`, is read into an entry of kind `unknown` that holds what was read in
  `raw` (`UNKNOWN_KIND` in `packages/contracts/src/project.ts`). `storedContentOf` puts it back in
  the file exactly as it came, so the entry survives a save, a merge and every verb byte for byte.
  A known kind with a broken field is still refused, and so is an entry without an id or a kind.
- **A real discriminant, not a looser type.** Keeping the raw shape and typing `kind` as a branded
  string was tried first: TypeScript then stops narrowing the whole view union on `kind`, and every
  `view.kind === 'canvas'` in the code breaks. `'unknown'` in memory narrows like any other kind,
  and the places that list kinds (`Record<CanvasNodeKind, ...>`) fail to compile until they say what
  an unknown entry wears. `unknown` is therefore a reserved name that no real kind may take.
- **The wire takes both shapes.** Reading opens an `unknown` entry back up before it is checked, so
  a client on this version that sends one to a daemon that knows the kind hands over the real thing.
  Only the file has to be in the raw shape, and `serializeDocument` is the one place that writes it.
- **What a person may change is the frame.** A node of an unknown kind moves, resizes and is
  deleted; its id follows a copy of the canvas. Those five fields are laid over `raw` when they
  differ from what was read, and nothing else is: a rename, an accent, a patch and a duplicate of
  the node itself are refused in the canvas store, since they would never reach the file. A view of
  an unknown kind is a dimmed row that does not open or drag into a cell, and a person may delete it.
- **Its files are kept.** The orphan cleanup of drawings and diagrams counts a view of an unknown
  kind as live for both folders, since a newer kind may keep a file under either. A layout in
  `.local.json` that names such a view loses that cell on the way in (`openableViewIds`), as it does
  for a view that is gone.
- **Only kinds.** A field a newer Ruimte adds to a kind this version knows is still stripped by zod
  on the first save, as `apps/server/src/agents/lineage.ts` already notes. Nothing needed that yet.
- **Limit: this only helps from this version on.** A release without this fix still sets aside a
  project that holds a kind it does not know. A new view or node kind is only safe to write once the
  release before it already carried this fix, so the first kind after it should wait one release, or
  ship knowing that anyone on an older release who opens the project loses it to a `.corrupt-` file
  until they update and rename it back. The canvas node `diagram` was that first kind, and it
  shipped on the second terms (see "A diagram").

### Error boundaries

Added on 2026-09-14, after a render error in `DiagramView.tsx` unmounted the whole tree and every
parked `<webview>` answered `Invalid guestInstanceId` from then on.

- **One component, three levels.** A node's body, a view, and the app; the sidebar, a panel's body,
  the preview and the usage page carry one as well, because each of them is cheap and a failure in
  any of them would otherwise reach the last resort, which unmounts the parked browser pages too.
- **The view's boundary sits in `ViewSurface`, not around the cell.** The cell and the view are two
  places (`Cell` in `SplitGrid.tsx` draws the bar, the box and the dock; `ViewSurface` draws the view),
  and the inner one keeps the cell's toolbar, its drop target and the dock working while the view is
  down. With one cell the window's toolbar and the sidebar are outside it anyway.
- **The node's boundary is around the body, not the frame.** The header, the menu, a drag and a resize
  belong to the frame, so a broken node can still be closed. The rev is read in a small wrapper
  rather than in `NodeFrame`, so a save re-renders one boundary per node and not every frame.
- **Reset keys are what the subtree draws from, and they only count while it failed.** A node resets on
  the project rev and its kind; a view on its id, the project rev, and the drawing's elements or the
  diagram's content (a diagram changes without the project rev moving); a panel on its kind; the preview on
  the active tab. Comparing them while nothing failed would remount a terminal on every save, so
  `shouldReset` answers no for a healthy boundary whatever the keys do.
- **A browser page stays over a failed view.** Pages live in `WebviewParking`, outside every cell and node,
  so no boundary below the app ever remounts one; the flip side is that a browser view whose own
  surface fails keeps its page on top of the message. That surface is a few lines and has not failed yet.
- **Not tested: the render itself.** The client has no DOM renderer, so `error-boundary.test.ts` covers the
  reset decision, the state transitions of the class and the copied report, and not a sibling that stays up.

### Swiping between pages

- Two fingers sideways go back and forward in a browser node or view, read from wheel events inside
  the page. Nothing else carries the gesture: Chrome's history swiper lives in the Chrome browser and
  not in the content layer Electron ships, `input-event` in the shell reports a wheel without its
  deltas, and the window's `swipe` event needs three fingers and the system setting to match. The
  page that follows the finger and springs back is `trackSwipeEventWithOptions:`, which takes a
  native addon or Electron PR #53522. Either one only yields a side and a progress, so the decider
  and the arrow stay when one of them arrives.
- The page measures and the client decides. `apps/desktop/src/guest.ts` is registered on the browser
  partition with `registerPreloadScript`, runs in a main frame only and sends to its own `<webview>`
  (`sendToHost`, heard as `ipc-message` in `browser/registry.ts`), so the shell never sits between
  and no web contents id is looked up. A swipe over an iframe never navigates: its wheel never
  reaches the main frame's window.
- Off is really off. The preload starts without a wheel listener, and the registry tells every new
  document (`dom-ready`) and every page on a change of `browserSwipe` whether to add one. The setting
  is drawn on macOS only (`canSwipeBetweenPages`), since a sideways wheel elsewhere is a mouse and
  back belongs to its side buttons, which the same preload forwards on every platform.
- The rules are pure in `browser/swipe.ts`: 150 px of net horizontal travel, horizontal at more
  than three times the vertical, and nothing a momentum sample says counts. Chromium 151's
  `WheelEvent.momentum` is what makes that a fact instead of a timing guess. The first momentum
  sample or 70 ms without one ends the gesture, and only then does it navigate, so moving back
  below the threshold before lifting cancels it the way Chrome does. 500 ms after navigating the
  tail of the same gesture is ignored. No history on that side, no arrow.
- The page gets its turn first. The listener is passive in the bubble phase, so a page that called
  `preventDefault` (a map, a canvas app) keeps the whole gesture. The first horizontal sample also
  asks whether anything under the pointer can still scroll that way, or claims its overscroll with
  `overscroll-behavior-x: contain` or `none`; if so the gesture is the page's until it ends, and a
  carousel that reaches its end halfway does not hand it over. Most browsers ignore overscroll
  behavior for swipe navigation, but it is the one thing a page has to say "this gesture is mine",
  and Chromium's own macOS swiper reads it.
- **The zoom is unmeasured.** On a canvas the host is scaled by the camera, and whether Chromium
  scales a guest's wheel deltas with that transform has not been checked with a trackpad. The
  reading of the source is that routing an event into a guest moves its point and leaves its deltas
  alone, so the travel is the finger's at every zoom and nothing corrects for it.
  `SWIPE_THRESHOLD_PX` is the one number to divide by the zoom if a swipe at 50% turns out to need
  half the travel.
- The arrow is Chrome's half circle at the edge, not Safari's page sliding along: `WebviewParking`
  never moves a page, and sliding one needs a snapshot of the page before it underneath. It is
  portaled into the parked host like the error plate, so a node and a view get it alike. Its
  progress sits in a store of its own (`browser/swipe-overlay.ts`), because `WebviewParking` places
  every page whenever `useBrowser` changes and a swipe writes every 16 ms. The fade out is the one
  motion it has, and the reduced motion rule in `styles.css` already takes it away.
- Cmd+[ and Cmd+] (Ctrl elsewhere) go back and forward in the focused browser: a browser view in the
  focused cell or a browser node stepped into. With the keyboard inside the page the client never
  sees the key, so the guest preload sends it, after the page had its turn, which is how an editor
  in a page still outdents on Cmd+[. The chord is only taken with a browser focused: a drawing
  keeps it for its order, and a canvas keeps it for the camera history in "Next".
- **A page does not pinch-zoom.** Chromium applies the page scale only in the top-most widget, the
  client's window. A `<webview>` guest's main frame is a GuestView, not the top-most main frame, so
  its widget takes the page scale as external, and a touchpad pinch over it is forwarded to the
  root. `setVisualZoomLevelLimits` on the guest changes nothing (checked in Chromium 152 and tried on
  Electron 44.3: the pinch did nothing). A pinch over a page that owns the pointer goes nowhere.
  It still arrives as a wheel with Ctrl held, so the guest marks it and the decider ignores it
  whole: it neither adds to a swipe nor holds the next one when the page prevents it.
- Real visual zoom needs a `WebContentsView` per page instead of a `<webview>`, and that costs a
  lot: a native view only moves and resizes, so it no longer scales with the camera; its bounds
  cross IPC, so it lags a frame behind a pan; it always sits above the HTML, so every menu,
  tooltip, dialog, palette and toast has to hide it or show a `capturePage` snapshot; it clips only
  to a rounded rectangle; and page management moves to the main process (`WebviewParking`,
  `browser/registry.ts`, the context menu, `guest-focus.ts`, favicons, the guest preload). A reflow
  zoom through `setZoomFactor` on a Ctrl-wheel was considered and not chosen.

### Loopback is no proof

- The source address never grants access, on any host. Behind a tunnel, a reverse proxy or a port
  forward every visitor arrives from `127.0.0.1`, so "loopback means the person at the keyboard"
  was a hole the moment anything stood in front of the daemon, and `/auth/pairing-token` handed
  such a visitor a pairing link of its own. What proves a process runs on this machine under this
  account now is that it can read `$RUIMTE_HOME/local.key`: 32 random bytes the daemon writes on
  its first start with `0600` in a home of `0700`, kept across restarts. It belongs to a home and
  not to a machine, because the dev daemon on 4211 has a home of its own.
- The secret is a third credential beside a ticket and a session token, in the same places
  (`?token=` or a bearer), compared in constant time over a SHA-256 of both sides so a length
  difference ends nothing early. A client on it has `sessionId: null`, and `mayInvite`
  (`auth/access.ts`) is the one rule for minting a pairing link: the HTTP route runs `decideAccess`
  and then that rule, `auth.pairingToken` asks the same function. A paired client cannot mint one,
  loopback or not, or one pairing would be enough to hand out access forever.
- No `--exposed` flag, and `--require-token` is gone. The first plan kept the old rule for a daemon
  that only listens on loopback and wanted a flag for a proxy in front of it, which nothing in the
  configuration can see and which a person forgets to set. Requiring a credential everywhere is
  simpler, and it costs only clients that can read the file (the desktop app, `ruimte pair`, the
  scripts) or can pair. Pre 1.0, so breaking the flag was fine.
- The desktop app gets the secret over the bridge (`localSecret`, read from the home on every
  connection attempt), not by handing one to the daemon it spawns: once the daemon runs as a
  background service the shell no longer starts it. Reading on every attempt is also what lets
  `bun dev` start the window before the daemon has written the file. The IPC handler answers only
  the main window's page; a guest page has no `ipcRenderer` to begin with.
- A browser tab on the same machine without the shell pairs like any other client. A page cannot
  read a file, and the browser version is meant to be self-hosted later, where pairing is the rule
  anyway. Its "This machine" row stays unreachable; the row the pairing adds is how it gets in.

### Routes remote access did not take

- A tunnel per machine: Cloudflare allows 1,000 tunnels and 1,000 routes per account, so it stops
  at a thousand machines, and cloudflared terminates TLS on their side, which puts Cloudflare in the
  data path.
- Quick tunnels (trycloudflare.com): capped at two hundred concurrent requests, a new address on
  every start, no uptime promise, and thousands of installs on someone else's free development
  service can disappear without notice.
- A relay of our own in the data path: cheap while idle, but every keystroke crosses our server,
  which makes us the processor of other people's source code, turns an outage from annoying into
  fatal, and needs end-to-end encryption on top that WebRTC gives for free. TURN is the exception
  and carries only DTLS it cannot read, for the networks where no direct pair exists.
- Tailscale: works well, but needs an install on every device a person looks from, which moves the
  setup cost to the user. The lesson kept: a tunnel only supplies an endpoint and never needs a kind
  of connection of its own, so a person's own domain (a tunnel or reverse proxy in front of the
  daemon) and an address on their own network stay beside the broker, on the same daemon and the
  same handshake.

### A direct connection

- Phase 2b of remote access: the client's wire over a WebRTC DataChannel, with no broker yet. The
  signals ride over a socket the client already holds to the same daemon (`direct.signal`, answered
  with the `direct.signaled` event), carrying the `packages/pulsar` envelope unchanged. `DirectPeers`
  takes a signal and a function that sends the reply back the way it came, and knows nothing else
  about the socket, so the broker replaces that leg without touching the peer code. The envelope is
  not signed on this leg: the socket is authenticated, and the channel handshake below binds the
  fingerprints anyway. Over the broker `signalMessage` still signs every signal.
- The channel inherits nothing from the socket that signaled it, since over the broker there is no
  such socket. Its first frames are the HTTP handshake: the daemon speaks first with a challenge it
  signed, the client answers with a key signature or the local secret's proof, the daemon answers
  with a verdict, and nothing before that verdict reaches the dispatcher. A frame before then is at
  most 4 KiB, and anything that is not a proof gets a refusal and a closed channel.
- The DTLS fingerprints are bound into both signatures, because it was cheap: both peers hold the
  offer and the answer as text, so `channelBinding` is the fingerprints each side applied, and the
  signed messages have prefixes of their own (`ruimte-daemon-channel-v1`, `ruimte-client-channel-v1`)
  so neither verifies as the HTTP handshake's. Something in the signaling path that swaps a
  fingerprint for its own ends up with two DTLS sessions, each with a binding the other side did
  not sign. A challenge remembers the binding it was handed out for, so one from `/auth/challenge`
  cannot be spent on a channel and one from a channel cannot be spent on another.
- The local secret crosses no channel. The row of this machine has no pinned daemon key, so the
  client cannot check who is on the other end before it answers; it sends an HMAC-SHA256 of the
  binding keyed with the secret (`direct.secret`) instead of the secret itself.
- A frame goes out in pieces. werift announces an SCTP max-message-size of 64 KiB and refuses to
  send more, Chromium announces 256 KiB, and a screen at attach or a project document is easily
  larger. `splitFrame` cuts at 16,000 UTF-16 units (at most 48 KiB of UTF-8) behind one mark
  character that says whether more follow, never between the halves of a surrogate pair, since each
  piece is encoded on its own. A binary framing would not need that rule and would cost a copy per frame.
- The adapter answers `send` like Bun's socket, because the output gate reads it that way: the byte
  count of the whole frame once every piece is queued, 0 on a channel that is not open. A send that
  throws closes the channel rather than counting as dropped, since half a frame may already be out
  and nothing after it would parse. werift queued 6.4 MB without refusing anything, so the gate's
  1 MB high-water mark pauses output long before SCTP would, and `bufferedamountlow` at
  `LOW_WATER_MARK` is the drain.
- One transport per machine, with the link chosen per attempt. The first plan was a
  `WebRtcTransport` object next to the WebSocket one, picked by the pool's factory. Switching a
  machine over would then replace the transport under every `SessionClient`, `ChatClient` and
  project client built on it, and a terminal node that is attached keeps its `SessionClient`, so
  it would go blank until it remounted. `LinkTransport` holds the requests, the events and the
  reconnect loop, and each attempt opens `socketLink` or `webRtcLink` depending on the row, so
  switching is `pool.reconnect` and the clients reattach exactly as they do after any reconnect.
- No fallback. A direct connection that does not come up ends with a sentence (ICE failed, the
  machine refused, the machine does not know `direct.signal`) and the reconnect loop tries direct
  again. The sentence stands under the machine's name. A connection that quietly turned back into a
  socket would test nothing.
- ICE is gathered whole before the offer and before the answer (at most 5 s each), so an attempt is
  one offer and one answer and nothing trickles. The daemon takes `--stun` (`stun:turn.ruimte.app:3478` by
  default, see "TURN"), `--no-stun`, `--direct-ports` and `--direct-host-address`. The Docker containers publish a
  UDP range and announce `127.0.0.1`, which is how a client on the host reaches a werift inside
  Docker Desktop's VM. The client's STUN servers are a stored setting (`directStunServers`, the same server by
  default); since the web client the field is no longer drawn, see "The web client" below.
- Phase 3: the bytes an `<img>` or a `<video>` draws (a chat attachment, a project icon, an image or a
  video file) travel as `bytes.read` over a direct connection and as the HTTP routes over a socket.
  One hook decides, `useMachineUrl`, from the row's `direct` flag and never from whether the address
  answers HTTP: across two networks it will not, and a draw site that quietly used HTTP would pass
  every test on one machine. The ticket the channel hands out is still remembered, for nothing that
  needs it yet.
- The transfer is pulled, not pushed. The client asks for 256 KiB and asks for the next piece once the
  one before landed, so the daemon keeps no stream, a client that loses interest costs nothing, and the
  round trip is the backpressure. A piece is about 342 KiB of base64, under the output gate's 1 MB
  high-water mark, so a picture on its way never pauses a terminal on the same connection. Every piece
  looks the resource up and stats it again and carries its mtime and size; a piece of another version
  starts the read over once and fails it the second time. Base64 in JSON costs a third more than a
  binary framing would, the price of keeping one framing. Measured in the Docker bench: 528 KB in
  three pieces in 33 ms from the host into the container.
- The checks are the routes' own lookups (`readBytes`): an attachment only as a chat's thread names it,
  an icon only as the folder declares it, a file only when it sniffs as an image or a video. Access is
  the connection's, decided by the handshake. Past 32 MB the answer is `too-large` with the size in
  the message, which the viewer shows where the picture or the player would be.
- The blob cache keys on machine, resource and version, as the HTTP URL does, so a file that changed
  is a new key and the old one only goes idle. A blob URL lives as long as someone draws it and is
  revoked when the last user goes; the blob stays idle up to 64 MB, least recently used out first, so
  a chat row scrolled back does not fetch again. What is on screen is never evicted, so the bound is
  on what nobody sees. A failed load is forgotten when its users go and retried when the connection opens.
- A blob URL has the client's origin, so a blob keeps its type only for what a browser draws without
  running anything (raster images, SVG for an `<img>`, video, PDF, plain text) and is
  `application/octet-stream` otherwise. An attachment link carries `download`, because the shell hands
  a link that opens a window to the system browser, which cannot open a blob of this page.
- A quiet direct connection is pinged. Chromium calls a path failed only when ICE consent freshness
  runs out, 30 seconds after the last answer (RFC 7675), and a machine that was killed or lost its
  network says nothing before then. After 2 s without a frame the client sends `server.ping` under an
  id no request waits for, and 10 s without a single packet from the machine ends the link. Any piece
  that arrives counts, so a busy connection never pings; the timeout counts from the ping, so a window
  whose timers were throttled does not take its own silence for a dead peer. The daemon does not ping
  its clients; a client that vanished holds a channel until ICE fails on that side.
- The trap: the answer to a ping is no measure of a live peer on this channel. It is ordered and
  reliable, so the reply queues behind whatever the daemon sent first (up to the output gate's 1 MB of
  terminal output, plus the frames the gate never holds back: a screen on attach, a 342 KiB piece of
  `bytes.read`), and every channel of a connection shares werift's one queue and one congestion window,
  so a second channel for control frames would wait in the same line. After a loss werift waits at
  least a second (`SCTP_RTO_MIN`), longer as the round trip swings, and starts again from one packet
  (`cwnd` of 1,200 bytes); while one packet is missing nothing behind it is delivered. On a path with
  round trips of 15 to 40 ms that spike to 1.2 s after a burst, the first version (5 s from the ping to
  the reply) ended healthy connections. So the client reads the bytes the DTLS transport received from
  `getStats` once a tick, and any growth counts as heard: the machine's SCTP acknowledges the ping
  itself within a round trip, however long its answer waits, and the retransmissions arrive too. Only
  a transport that received nothing at all for 10 s is a dead peer, noticed within about 13 s, still
  well before ICE gives up. Werift's `bufferedAmount` drops once a message is in its SCTP queue, not
  once it is on the wire, which is why the gate's 1 MB is a line in the daemon rather than SCTP's.
- A drop is not a reload. A link that closes and opens again used to boot the project client as if
  the page had just started: `project.open`, a document load, and a fresh editor for every view,
  which draws nothing until it is measured. Now a client with a project on screen only asks the daemon
  to open it again, lets the document through the path of a change from disk when the rev moved, and
  writes what waited; a save waits while the link is down instead of failing with nobody to retry it.
  The drawings and diagrams on screen are opened again from `afterResume`, since nothing reloads the
  document that used to trigger that.
- werift is pinned at 0.24.4, the version the report measured. Measured here, werift on both ends in
  one process on macOS: a channel open in about 240 ms over loopback and about 310 ms from the host
  into the Docker container, an 8 MB burst in 16 KiB pieces at 2.4 MB/s, a round trip of 3 to 4 ms.
  Crossing two real networks is what `apps/server/scripts/webrtc-probe.ts` is for, and has not been
  measured yet.

### The broker

- Phase 4 of remote access: `apps/pulsar-broker`, so a client reaches a machine it paired with without
  a socket to that machine. The broker holds a `Map` from public key to socket and passes a signal on,
  nothing more: no database, no accounts, nothing on disk. It does not verify the signature on a signal
  and does not look inside the envelope beyond the schema, because the receiver has to check it anyway
  and is the one a lying broker would be lying to. A machine relays to clients and a client to machines;
  a relay to the same role answers `not-connected`, so a client cannot use the broker to reach another
  client.
- The broker names itself. The challenge carries the host the broker answers to, the peer refuses a
  challenge for a host it did not dial, and the broker verifies against the name it put in. With
  `--name` a `Host` header it does not know gets a 421, so a service in the middle cannot pass a peer
  this broker's nonce and announce that peer's key here. Without a name the header is believed, which is
  what a laptop wants and what the systemd unit does not do.
- A second announcement of a key replaces the first socket. The later one proved the key, so it is the
  one that is really there; the earlier one is a NAT mapping that died quietly or a second process. A
  daemon that is told `replaced` waits the full backoff before it tries again, so two processes on one
  home do not knock each other off in turn. The client signs in with one key for every machine, so it
  keeps one broker socket per page shared by every attempt and closes it when the last channel is in.
  Two tabs of one origin still share a key and can replace each other, but only during the seconds of
  signaling, and the loser's reconnect tries again.
- The limits, all flags: 30 upgrades per minute and 32 sockets per address, 20 frames per second per
  address (counted before a frame is parsed), 60 relays and 10 announcements per minute per key, 64 KiB
  per frame, a ping every 25 seconds and a drop after two without an answer, 10 seconds from open to a
  verified signature. A bucket fills to its limit and refills evenly, so the limit is also the burst.
  One attempt is two or three frames (hello, prove, the offer), and a reconnect loop tops out at one
  attempt per 10 seconds, so a person never meets them; a script does. An announcement over the limit
  closes the socket that made it and leaves the one holding the key alone, so a flood of announcements
  cannot knock a machine off. Behind Caddy every socket is loopback, so `--trust-proxy` counts against
  the last `X-Forwarded-For` entry, and only for a socket from loopback.
- The daemon hears the broker's pings as Bun's client `ping` event and calls a broker that said nothing
  for 90 seconds gone, which is why `--heartbeat-seconds` stops at 40. Reconnecting backs off from 1 to
  30 seconds with 20% jitter, so a restarted broker does not get every machine back in one millisecond.
- What a key gets from the daemon. A signal whose signature does not verify gets nothing, not even a
  refusal: an answer would let anyone make the machine sign messages for keys of their choosing. A
  signature that verifies from a key nobody paired gets one signed `close` with `not-paired` for an
  offer and nothing for anything else, so a revoked client says why at once instead of after its 20
  second timeout, and no werift peer connection is ever made for it. Whether a key is paired is the
  same `AuthStore` lookup the channel handshake makes, which still runs on the channel and still
  decides access. An attempt belongs to the key that offered it, so a second paired client cannot close
  or feed it.
- Two URLs on the daemon: `--broker` is what it dials, `--broker-advertise` what it hands clients in the
  pairing answer and `endpoint.info`. The Docker container reaches a broker on the Mac as
  `host.docker.internal` while a client on the Mac dials `127.0.0.1`, and the name is part of what gets
  signed, so one URL could not serve both. In production they are the same and the second is left off.
- The client takes the broker route only with Direct on, a `brokerUrl` from the machine and a pinned
  machine key (`brokerRouteOf`), never for the row of this machine. On that route the address the
  transport resolves is the broker URL itself and `socketAddressFor` never runs, so no
  `/auth/challenge`, no ticket over HTTP and nothing else touches the machine's address: across two
  networks there is nothing there to ask. An answer is believed only when the pinned key signed it for
  this client's key, which catches a broker that swaps a fingerprint before the channel handshake does.
  A row that says the broker is gone (`brokerUrl` null in `endpoint.info`) goes back to signaling over
  a socket on its next attempt.
- Measured in the Docker bench, broker on the host and the daemon in the container: a channel open in
  301 ms and signed in after 304 ms through the broker alone, against 274 and 283 ms signaled over a
  socket. Killing the broker afterwards leaves the terminal on that channel answering. Not measured yet:
  two machines on two networks through a broker on the VPS, and nothing is deployed.
- A daemon is on a broker without any flag: the build carries `wss://broker.ruimte.app` as the default,
  a name rather than an address so the broker moves hosts through DNS alone. The rule, highest first:
  `--no-broker`, `--broker` or `RUIMTE_BROKER_URL` (where `off` is off), then `broker` in `endpoint.json`
  (default, a custom URL or off), then the default. Off wins wherever it stands, over everything below it.
  A flag decides for the person who started the process, which is why it beats a setting any paired
  client can change; the setting is still kept, and `brokerFixed` in `endpoint.info` tells the client it
  waits. The setting lives beside `refuseStatements` because the daemon is what dials, and a change is
  applied at once by `BrokerSwitch`, which stops the old relay before it starts the new one, one change at
  a time. A custom URL is `wss:`, or `ws:` for a host on this machine, a container's host or the local
  network (`brokerUrlProblem`); a flag is held to the same rule. `brokerUrl` follows the effective broker
  (or `--broker-advertise` while one is on), in `endpoint.changed` as well, so a signed-in client
  re-registers the machine with its new broker without asking. Compose passes `off` for an unset variable,
  so the Docker container never announces itself to the public broker by accident.
- The broker runs behind Cloudflare's proxy. Only signaling crosses it, a few frames per attempt, while
  the channel itself goes direct, so the proxy costs no bandwidth and hides the origin. Behind it every
  socket comes from an edge address, which would put everyone near one edge in one bucket, so
  `--trust-cloudflare` counts against `CF-Connecting-IP`, and only when the address the connection came
  from (the socket, or the last `X-Forwarded-For` entry of a trusted local proxy) is in Cloudflare's
  published ranges, which the broker carries in `src/cloudflare.ts`. From anyone else the header is
  ignored, or a client could pick the bucket it is counted in. Cloudflare closes a WebSocket that is idle
  for 100 seconds; the broker pings every 25 and at most every 40, so a socket is never idle that long,
  and a socket Cloudflare resets anyway comes back through the daemon's backoff and the client's next
  attempt.

### TURN

- The fallback for a direct connection that ICE cannot make: a TURN relay, coturn on the broker's host at
  `turn.ruimte.app` (a DNS-only name, since Cloudflare's proxy carries no UDP), UDP and TCP on 3478, TLS
  on 5349 once there is a certificate, relays on UDP 49152 to 49999. Nothing in Ruimte chooses the relay:
  both ends hand ICE every server they have and ICE prefers a direct pair on its own. A fallback of our
  own would second-guess the one component that measures the paths.
- The same coturn is the STUN server, `stun:turn.ruimte.app:3478`, the default of the daemon's `--stun` and the client's
  `directStunServers`, so a direct connection asks no third party for its address. A binding answer needs
  no credential and costs one packet, so `no-stun` is gone from its config. The default is a constant in
  both apps rather than something the broker hands out: a machine without a broker or with a broker that
  has no TURN still gets its public address. A provider may still hand out STUN URLs of its own
  (Cloudflare's does); `mergeIceServers` keeps a URL both lists carry once, and werift takes the first STUN
  URL, which is the daemon's own. A client moved to the new default through a new key: the old
  `directStunServer` held the previous default for nearly everyone, since every save writes the whole
  blob, and a hidden field left nobody a way to change it.
- The broker hands out the credentials, because it is the one place that already knows a key proved
  itself. After `ready` a peer sends `ice` and gets `ice` back with `servers` and `expiresAt`, limited per
  key like announcements (`--key-ice-per-minute`, 10). The credential is TURN REST (`use-auth-secret`):
  the username is the expiry in unix seconds and `m-` or `c-` plus the first 16 characters of the key,
  the password the base64 HMAC-SHA1 of the username under a secret coturn and the broker read from one
  file (`/etc/ruimte/turn-secret`, 0640, group `ruimte-turn`). They live 24 hours. A client paired by
  link gets them as well as one from the account list, since both announce a key; a daemon never sees
  the secret. The role letter rather than a fixed `m-` is so coturn's log says which side allocated.
- The provider is a seam, `TurnProvider` in `apps/pulsar-broker/src/turn.ts`: `noTurn` (the default, so
  a broker hands out nothing until it is told), `sharedSecretTurn` and `cloudflareTurn`, picked with
  `--turn`. Cloudflare's credentials are not bound to a key, so one set serves every peer until two
  thirds of its lifetime; it is tested with a fake fetch and configured nowhere.
- A broker from before `ice` refuses the frame with `bad-frame` and no id and keeps the socket. The
  daemon and the client read that as no servers rather than as a lost broker, so a new client against
  an old broker still signals.
- The daemon asks after every announcement and again with a third of the lifetime left, and keeps the
  credentials when the broker goes away: a restarted broker revokes nothing. Past `expiresAt` it hands
  werift none rather than credentials coturn would refuse.
- werift 0.24.4 reads the first STUN URL and the first TURN URL of the whole list, so the daemon gets
  every STUN URL and one TURN URL, UDP first. Its TURN client can reject a STUN transaction nobody awaits
  when the TURN server restarts (werift issue 374), and an unhandled rejection ends a Bun process.
  `guardWeriftTurn` logs that one and crashes on everything else as before. It matches the error by the
  string its `str` getter returns, because a minified build keeps no class names or file paths.
- `relayed` on `ConnectionState` is read from `getStats`: the pair the transport names as selected
  (Chromium, Safari), else a selected or a nominated and succeeded pair (Firefox), relayed when either
  candidate is. It is read on every liveness tick rather than once, since ICE may send over the relay
  before a direct pair succeeds.
- coturn's config (`deploy/turnserver.conf`) refuses every private, loopback, link-local, CGNAT,
  documentation and multicast range as a peer, and the host's own address, so the relay is no way into
  anything behind it. Measured on the droplet with `turnutils_uclient`: an Allocate works, a wrong
  password gets none, a private peer and the host's own address get 403. The last one has a cost: every
  allocation lives on that address, so two peers that both need the relay are refused as well. Allowing
  it is one `allowed-peer-ip` line and opens UDP to anything else listening on the host; that choice is
  still open.
- `bps-capacity` is a reservation, not a measurement: coturn sets `max-bps` aside for every allocation,
  used or not, and every attempt allocates on both ends. At 12 MB/s with 3 MB/s per session that was four
  allocations on the whole server (486 on the fifth, measured), so the capacity is 60 MB/s, twenty
  allocations. The traffic that crosses it is what a relayed connection sends, which is the same either way.
- coturn cannot read `static-auth-secret` from a file, and a flag would put the secret in the process
  list, so its drop-in writes a copy of the config with the secret into `/run/coturn` (0700, coturn's
  own) before it starts.

### The address book

- Phase 5a of remote access: `apps/pulsar-worker`, a Cloudflare Worker with D1 at `https://pulsar.ruimte.app`
  (a Custom Domain on the Worker, with `ruimte-pulsar.bas.workers.dev` beside it) and the database
  `ruimte-pulsar`. The client and the daemon use it since 5b, below.
- The routes: `GET /health`, `GET /auth/github/start` and `/callback`, `POST /v1/session` (a login code for
  a session), `POST /v1/session/refresh`, `DELETE /v1/session`, `GET` and `POST /v1/machines`,
  `DELETE /v1/machines/<id>` and `POST /v1/statements`. The report called the last one `/v1/grants`; the
  schemas already said statement, so the route does too.
- How a login gets back to the app. The app opens `/auth/<provider>/start` in the system browser with a
  redirect, a state of its own and a PKCE S256 challenge. The redirect is `ruimte://pulsar/callback` or
  `http://127.0.0.1:<port>/pulsar/callback` (or `[::1]`) and nothing else (`isAppRedirectUri`): the scheme
  for an app that can claim one (a packaged desktop app, the mobile app), a loopback listener on any port
  for one that cannot (an unpackaged dev app). Both, because Electron only claims a scheme when packaged and
  a phone has no loopback listener. The Worker keeps the app's challenge and state and is a PKCE client of
  GitHub itself with a verifier of its own. Its state is stored only as a hash, lives ten minutes, is
  spent by the first callback whatever happens, and is bound to the browser that opened the start URL with
  a `__Host-` cookie. The callback sends the browser to the app's redirect with a one-time code (60 s,
  stored as a hash) and the app's state, or with `error` and the state. The app posts the code, its
  verifier and the redirect to `/v1/session`; a wrong verifier spends the code.
- Sessions are short and revocable: an access token of 15 minutes and a refresh token, both 32 random bytes
  kept only as SHA-256, ending 30 days after sign-in whatever happens. A refresh rotates both. A refresh
  token that was already spent revokes the session, since two holders of one token means a copy; a client
  that lost the answer to a refresh pays for that by signing in again.
- An account is found through an identity: the provider plus the provider's user id (GitHub's numeric id,
  Apple's `sub`), never an email. The login is kept for display and updated at every sign-in. No scope is
  asked, and the provider's tokens are dropped once it said who signed in. A provider is an entry in
  `PROVIDERS` (`providers.ts`) and in `ProviderIdSchema`. Since 2026-09-15 an account holds one identity per
  provider; see "Two ways to sign in" below.
- A machine is keyed on the account plus its id, so a daemon two people share can be in both lists. A
  registration needs the daemon's signature over `machineRegistrationMessage`, which names the account, and
  an `issuedAt` within 10 minutes of the Worker's clock. Registering again with the key the machine is
  listed with replaces the name, the icon and the broker; another key for a listed machine is refused with
  `bad-signature` (since 2026-09-15), because every client that opens it from the list pins that key. A
  machine with a new key comes back after a person removes it. The icon was not in the schemas and is added
  unsigned, as decoration a signed-in client may set anyway. `lastSeenAt` is the latest registration: the Worker never sees a machine online.
- A statement: the request's signature proves the client key, the machine has to be on the session's
  account (a machine on another account answers `not-found`, like one that does not exist), and the answer
  is signed over `accessStatementMessage` with the key in the `STATEMENT_PRIVATE_KEY` secret. Every one lands
  in `statement_log` (account, machine, device key, session, address, times) and the key in `device` with
  the label the session was opened with, for the list of who got access in 5b. The public half is pinned as
  `PULSAR_STATEMENT_PUBLIC_KEYS`, a list so a rotation can overlap, and `/health` names the public half the
  Worker signs with, which is how a deploy is checked against the pin.
- Rate limits are fixed one-minute windows in D1 rather than the platform's rate limiting binding, which
  counts per location: 20 logins per address, 30 session calls per address, 20 registrations per account
  and 30 per address, 30 statements per account and 60 per address. A daily cron drops expired logins,
  codes, windows and dead sessions.
- CORS only on `/v1/*`, for loopback origins (the desktop app loads the client from
  `http://127.0.0.1:<port>`, Vite runs on localhost) and whatever `ALLOWED_ORIGINS` lists, which is empty.
  Tokens are bearer and never cookies, so this decides which pages read the answers, not who can send.
- The tests run the bundled Worker in workerd through Miniflare under `bun test`, with the migrations on an
  in-memory D1 and GitHub as the outbound service, rather than `@cloudflare/vitest-pool-workers`, which
  would bring a second test runner. Miniflare is pinned on the 4.x line because the one wrangler brings is a
  5 alpha with another options shape, and the compatibility date is the newest its workerd knows. With
  `PULSAR_STATEMENT_PRIVATE_KEY` in the environment a statement is also checked against the pinned key; CI
  has no such secret and skips that test.
- Deploys go through `.github/workflows/pulsar-worker.yml` on a push to main that touches the app or
  `packages/pulsar`: tests, remote migrations, deploy, `/health`. Migrations go first, so a migration has to
  keep the running Worker working. `apps/pulsar-worker/README.md` lists the token's permissions, the
  secrets and how to rotate the statement key.

### Signing in and statements

- Phase 5b of remote access: a client signs in to the address book, puts a machine it reaches on the account,
  and on another client opens that machine without pairing. The daemon never talks to the address book and
  never holds an account token.
- The login comes back through a loopback listener in the shell, not through `ruimte://`. Electron claims a
  scheme only for a packaged app, and an unpackaged "Ruimte Dev" beside an installed Ruimte would have the
  other app receive its code. The listener binds 127.0.0.1 on a random port, answers the first request on
  `/pulsar/callback`, closes, and gives up after ten minutes. The scheme stays in `isAppRedirectUri` for the
  mobile app, which has no listener.
- The page makes the verifier and the state and checks the state before the code is looked at
  (`apps/client/src/pulsar/pkce.ts`, only WebCrypto and `URL`, so a phone runs the same login). The shell
  trades the code, keeps the refresh token encrypted with `safeStorage` in `userData/pulsar-session.bin`, and
  hands the page access tokens only: a page that can read the refresh token can send it anywhere, and the
  shell's main process is out of reach of anything injected into a page. Without keychain encryption (a Linux
  desktop without a keyring) nothing is written and the session ends with the app. `SessionVault` in
  `packages/pulsar` does one refresh at a time, since the address book ends a session when a spent refresh
  token comes back.
- A plain browser got no sign-in at first: it has no loopback listener and nowhere a script cannot read.
  Since the web client it signs in on an origin the address book sends a login back to, with the session
  bound to its key; see "The web client" below. Anywhere else the Account section still says where it works.
- A machine joins an account through the client: `endpoint.signRegistration` has the daemon sign
  `machineRegistrationMessage` for the account id the client names, and the client posts it with its own
  session. Any client that got in may ask, since it already reaches everything the account would lead to.
  The record also carries the broker URL the machine hands its clients, unsigned like the icon: a wrong
  broker only fails to find a machine whose answers are believed from its key. Migration `0002` adds the
  column as nullable, so the Worker that runs while it applies keeps working.
- The statement travels in the broker offer (`access` on the offer: the statement and the label the machine
  lists the client under), and `signalMessage` signs it with the offer. Not in the channel handshake: since
  phase 4 a machine answers an unpaired key with `not-paired` before any peer connection exists, and keeping
  that means the key has to be let in before the answer. The offer's signature already proves the key, and
  signing the statement with it keeps a broker from moving one statement to another attempt.
- The nonce is the client's, fresh per request, and the machine spends it. The report had the machine hand one
  out, which is a round trip over the broker with a key nobody paired before every first connection, and state
  kept for strangers. What the machine checks instead (`StatementGate`, `apps/server/src/pulsar/statement.ts`):
  the machine id is its own, the statement's key is the key that signed the offer, the time is inside
  `issuedAt` to `expiresAt` with 30 seconds of skew either way, a pinned key signed it, and the nonce was
  never spent. Spent nonces are in `auth.json` until the statement could not be believed anyway, so a restart
  inside the two minutes does not make one new. A replay gets nothing; a statement for another machine fails
  the id; one for another key fails because nobody else can sign an offer as that key.
- A good statement pairs the key with the origin `statement` and the offer's label, logs it, and the ordinary
  channel handshake follows. A key that is paired already is let through on its pairing and its statement is
  not looked at. `refuseStatements` is asked only once a statement holds up, so a stranger learns nothing about
  the switch, and it answers `statements-refused`; everything else that fails answers `not-paired`, as before.
- Revoking a client remembers its key (`revokedKeys` in `auth.json`). Without that, a device a person revoked
  walks back in on the next statement the account hands it, which makes revoking meaningless while that device
  is signed in. Pairing the key with a link clears it: a person handing out a link is taking it back.
- `auth.sessions` carries the origin, absent from an older daemon and read as `link`. This is the visibility
  the report asked for: every client a statement let in is on the machine's own list, with its label and the
  day, and can be revoked there.
- The pinned keys can be replaced only in a daemon that runs from source: `RUIMTE_PULSAR_TEST_STATEMENT_KEY`
  is read by `trustedStatementKeys`, which ignores it in a compiled binary, and `scripts/compile.ts` defines it
  to an empty string as well. The Docker bench makes a key pair per run in `docker/test.sh`; the production
  private key is nowhere near a test.
- A machine opened from the account list is a row with no address, Direct on and the key the list gave, which
  is the trust signing in buys. `needsStatement` makes every offer ask the account for a statement (each one
  is spent) until the machine has let this client in once. The row cannot fall back to a socket, so its
  Direct switch is not drawn.
- A workspace connection holds its machine's socket (`transport/connections.ts`). `pool.require` takes no hold,
  so a workspace on a machine that was not the active one lost its socket to the 30-second idle countdown and
  nothing rebuilt its clients; the Machines pane brought it back only because it holds every machine.
- Not built: the statement log in a client (the Worker keeps it, the machine's own list is what a person
  sees), revoking a device at the address book, and asking for two-factor beyond one sentence in the Account
  section.

### The web client

- `apps/station` serves the client at `https://station.ruimte.app` from a Worker with static assets, so a
  person on an iPad reaches a machine at home through the account and a broker. A Worker rather than Pages,
  because the address book is one already and the deploy, the token and the Custom Domain work the same
  way. The Worker runs first on every path (`run_worker_first`) so no answer leaves without its headers,
  and a path that is no file is the page (`/pulsar/callback`).
- The policy has no inline script. `'wasm-unsafe-eval'` stays for Shiki's WebAssembly grammar engine and
  `style-src 'unsafe-inline'` for the `<style>` elements xterm, CodeMirror and the markdown renderer add.
  `connect-src` is `'self'`, the address book, `wss:` and `https:`. The last one is wider than the address
  book alone: a machine behind a tunnel answers its challenge over HTTPS, and with every `wss:` host open
  already, closing `https:` would not keep a script that got in from sending anything anywhere. Plus
  `frame-ancestors 'none'`, `no-referrer` (a login comes back with a code in the query) and two years of HSTS.
- The web build has no daemon behind its origin. The row of this machine stays in the list, since much of
  the client assumes it is there, but its transport is a `DormantTransport` that never dials, and the main
  column shows a welcome (sign in, then the account's machines) until one is picked. An https page may not
  open plain http or ws, so pairing with such a machine is refused with a sentence before anything is tried.
- Safari on iPadOS stops sockets and timers in the background, so a page that turns visible reconnects
  every machine that is closed or waiting out a backoff. A Home Screen web app is exempt from Safari
  clearing a site's storage after seven days without a visit, which is why the build carries a manifest
  with the app icons and the page asks for persistent storage after signing in. A key or a session that
  is gone anyway is the ordinary way back: the page says the session on this device ended and offers
  signing in, not an error.

### A session bound to a key

- A login may only come back to the redirects `isAppRedirectUri` allows: the app scheme, a loopback
  listener, `https://station.ruimte.app/pulsar/callback` and `http://localhost:5173/pulsar/callback`. An
  exact list, with no prefix match and no query, because signing in opens machines: an open redirect would
  let any page start a login and collect the code, and PKCE does not help when the attacker started the
  login and holds the verifier.
- The provider state stays bound to the browser with the `__Host-pulsar-login` cookie. It survives the
  round trip in Safari with ITP because the cookie is HttpOnly and set by the server, the navigations are
  top-level GETs, and `station.ruimte.app` and `pulsar.ruimte.app` are the same site. The page keeps its
  verifier and state in localStorage rather than sessionStorage, since a Home Screen app may come back from
  GitHub in another browsing context.
- Every session is bound to a key, on every client. The exchange carries a public key and a signature over
  `sessionKeyMessage` (the login code and the key), and every refresh a signature over
  `sessionRefreshMessage` (the refresh token and the time, ten minutes of skew). The token in the signed
  bytes makes a signature good for one rotation; a nonce from the Worker would cost a round trip and buy
  nothing a single-use token does not already give. The web client binds to its own non-extractable
  ed25519 key in IndexedDB, the desktop shell to a key of its own encrypted with `safeStorage` in
  `pulsar-key.bin` beside the session, so a refresh token read off a disk or out of a page refreshes
  nothing elsewhere.
- Nothing happens to a session before the signature holds. A refresh token that was already spent still
  ends the session, but only when the right key signed it: two holders of the key and the token are a copy,
  a token without the key is just a refused request and must not sign the real device out. Migration
  `0003` adds `session_key` as a nullable column so the running Worker keeps working while it applies; the
  new Worker refuses to refresh a session without one, which signs every older session in again.
- Access tokens stay in memory. The refresh token sits in IndexedDB on the web, where script on the origin
  could read it. Keeping it in a `__Host-` HttpOnly cookie on the address book was considered and left
  out: CORS with credentials for one origin, a second storage model beside the desktop shell's, a Vite dev
  origin that is not same-site and so would not send the cookie, and script injected into the page could
  drive a refresh with credentials anyway. The key binding is the one rule for both clients.

### Two ways to sign in

- An account holds identities, one per provider, in a table of their own (`identity`, the primary key is
  provider plus subject, unique on account plus provider), so GitHub and Apple open the same account.
  Migration `0005` copies every account's provider and subject into it and leaves those columns on
  `account`: the Worker still running while it applies keeps writing them, and dropping columns of a table
  sessions and machines reference would mean rebuilding it under their foreign keys. A GitHub account that
  Worker makes in the seconds before the deploy gets its identity on its next sign-in. When the identity an
  account was made with is removed, its subject on `account` is rewritten, so signing in with it later makes
  a new account instead of meeting the old unique pair.
- What an account is shown as is the oldest identity with a login, else the oldest (`accountProviderSql`),
  worked out in every query rather than stored. Apple hands out no login, so an account made with Apple is
  "Signed in with Apple" until GitHub is added, and every client names the same account the same way
  whichever provider it signed in with. `Account` keeps its shape, so a stored session and an older client
  read it as before; `GET /v1/account` adds the identities.
- Apple asks for nothing: no `name`, no `email`. The subject is all an account needs, an email is an
  address that changes hands (and often a relay), and Apple sends a name only on the first authorization,
  which a second device or a link never sees. Without a scope Apple would allow `response_mode=query`; the
  form post is used anyway, since it keeps the code out of the address bar, the history and any log of URLs.
- A form post from `appleid.apple.com` is a cross-site POST, which a `SameSite=Lax` cookie does not ride
  along with. The state was already server-side (hashed in `login_attempt`, ten minutes, spent by the first
  callback), so the question was only the cookie that binds the callback to the browser that started it.
  Dropping it for Apple would let a login started in one browser finish in another; so for a provider that
  posts back the cookie is `SameSite=None` (still `__Host-`, `Secure`, `HttpOnly`). A top-level navigation
  carries it in Safari and Chrome alike, and a forged post has no state to finish. GitHub keeps `Lax`.
- Apple offers no PKCE for a web client. The address book's verifier hash rides as the `nonce` instead, and
  the `id_token` has to carry it back, which ties Apple's code to the login that stored the verifier. The
  token is checked although it came straight from Apple over TLS: an RS256 signature from a key in Apple's
  JWKS (cached per isolate, fetched again for an unknown key id), Apple as the issuer, an accepted audience,
  `exp` with a minute of skew, and the nonce. The audience is a list, because the iOS app will sign in
  natively with `app.ruimte.mobile` as the audience, where the web flow has the Services ID
  `app.ruimte.pulsar`. The client secret is an ES256 JWT signed with the `.p8` per exchange and lives an
  hour, where Apple would allow six months.
- Linking is bound to the session, never to a cookie or a URL alone. `POST /v1/account/link` with the access
  token hands out a link token (five minutes, stored as a hash, with the account and the session), which the
  start URL carries and spends before the provider is asked; a start refuses a token that is spent, expired,
  for another provider or from a session that has since ended. The callback does not touch the account: it
  keeps the identity under a one-time code in `identity_link_code`, a table apart from `login_code` so
  `/v1/session` can never turn it into a session, and redirects to the app as a login does. The identity
  lands only when `POST /v1/account/identities` presents that code with the same session's access token and
  the login's PKCE verifier. So a link token that leaks from a browser's history adds nobody: whoever finishes
  the provider's login with it still needs the session and the verifier.
- An identity already on another account is refused with `identity-taken` and a sentence that says
  accounts are never merged. Merging would move machines, devices and sessions between two people's
  lists on the strength of one login, and a person who really has two accounts can remove the identity
  from one and add it to the other. An account with an identity of that provider already gets
  `provider-linked`; removing an identity is one conditional delete that refuses the last one
  (`last-identity`), so two removals at once cannot both pass.
- The providers a client offers come from `GET /v1/providers` (strings, so an older client skips a provider
  it does not know), with GitHub as the choice until it answers. Deploying the Worker before the Apple
  secrets exist is safe: Apple is left out of the list, `/health` says `"apple": false` and the start
  answers `not-configured`.
- Both choices are the same inverse button (dark on a light theme, light on a dark one) with the mark before
  "Sign in with ...", so neither is less prominent, which is what Apple's guidelines ask of its button; adding
  a provider says "Continue with ...", the other title they allow. The marks are paths in `ui/SignInMark.tsx`
  in `currentColor`, the way `ProviderLogo` draws brand marks Lucide does not have.

### Machines join the account on their own

- A signed-in client puts every machine it reaches on the account, this machine and every paired one,
  without a button (`pulsar/auto-register.ts`). The machine signs `endpoint.signRegistration` as before
  and the client posts it marked `automatic`. Once per machine per account for the life of the page for a
  machine the list does not have. A machine the list has is registered again when the name, icon, broker or
  key it announces in `endpoint.info` (or `endpoint.changed`) differs from its record, once per state it is
  in, since the list may answer a moment behind the write; without that a record kept the host name and the
  broker (or none) of the first registration forever. The key compared is the one the row pinned, else
  the one `endpoint.info` announces: the row of this machine reaches it with the local secret and never
  pins one, and waiting for a pinned key left its record on the first registration for good. A failure
  waits 30 seconds, doubling up to 30 minutes, so an address book that is down or a machine that cannot
  sign costs a request now and then; its reason goes to the console and stands in the machine's dialog
  until it registers.
- A machine a person removes is remembered on the account (`removed_machine`), not in one client: a list
  kept per client would let the next client that reaches the machine put it straight back. An `automatic`
  registration of such a machine answers `removed`; a registration without the flag clears the row, and
  that is what a person pressing a button sends.
- Removing a machine from the account removes it from every signed-in client, a row paired by link
  included. A client learns it from `removedMachineIds` on the account list (on sign in, on every
  refresh, and when the Machines pane opens) and forgets the row exactly as "Forget on this client"
  does (`pulsar/removal-watch.ts`, the rule in `pulsar/removal.ts`). Only a fresh list triggers it,
  never a new row. The row of this machine stays, since the app runs on it, and its dialog keeps "Add
  to your account again". A signed-out client cannot know and keeps its row; the Worker needed no
  change, since the list already carried the removals.
- Pairing a removed machine again by link while signed in is a person saying they want it: the client
  marks it `reclaiming`, waits until the machine answers, and sends a registration without `automatic`,
  which clears the removal. The mark keeps the removal rule off the new row meanwhile, and a
  registration that fails keeps it for the life of the page, with a toast. Auto-registration still
  skips every removed machine.
- The Machines pane is one list: the rows of this client joined with the account list on the machine
  id (`shell/settings/machine-list.ts`), each saying "Paired", "On your account" or both. Everything
  that is done to a machine lives in the dialog its row opens, so the two separate lists that showed
  the same machine twice, and the sections of switches with a row per machine, are gone.
- A machine on the account is opened on demand from wherever it is picked: the palette's machines step
  (the same joined list as the Machines pane), a project in the switcher, a folder, the welcome screen of
  the web client. One helper brings it up (`ensureMachine` in `endpoint/reach.ts`, the rules in
  `endpoint/ensure-machine.ts`): it makes the row the account list would, holds the link, retries one
  waiting out its backoff at once, and ends on the first attempt that fails with that attempt's reason
  rather than sitting through the reconnect loop, which keeps running. Concurrent calls share one
  attempt. A caller reaches the machine before it moves the client, so a machine that does not answer
  leaves the work on screen. Leaving the palette's connecting step drops the wait and not the attempt.
- The switcher lists only projects; a machine it has no list from is opened through "Open folder" in the
  palette, which lists every machine, rather than through a row of its own in the switcher.
- The web client has no daemon behind its origin, so the row of this machine is left out of every list
  of machines behind one predicate (`hasLocalMachine` in `state/local-machine.ts`), counted out of the
  "one machine opens straight on its folders" rule too, and the local row being active means the welcome
  screen rather than a machine.
- `endpoint.info` and `server.hello` are asked of every machine whose link opens and again on its
  `endpoint.changed` (`transport/open-machines.ts`), not only of the active one. The account record of a
  paired machine that was not active only synced after a switch to it, and the lists of machines had no
  icon for it.

### Linking a machine with a code

- A machine without the app (a server, a droplet) joins an account from its own terminal with `ruimte login`,
  the device flow of RFC 8628 without the token at the end. It runs where the daemon's home is and asks the
  daemon to sign over the local secret (`POST /machine/link-request` and `POST /machine/registration`, local
  secret only, like `/machine/work`); the terminal carries the signatures to the address book. The daemon
  still never holds an account token, and neither does the terminal.
- Two signatures rather than one. The brief was one registration signed at the start and stored on approval,
  but `machineRegistrationMessage` names the account, which nobody knows at the start. A start signature over
  no account (`deviceLinkStartMessage`) would put the machine on whichever account approves the code, and a
  copy of that body started again elsewhere would do the same. So the start only proves the key the page
  shows, and once a person approves, the terminal sees the account on its next poll, has the daemon sign the
  ordinary registration bytes for exactly that account (the same as `endpoint.signRegistration`) and hands
  them in with the device code (`POST /v1/device/complete`). An approval without the machine's own signature
  for that account lists nothing.
- The routes: `start`, `poll`, `complete` and `cancel` under `/v1/device/` with the device code and no
  session; `lookup`, `approve` and `deny` with a session and the user code. Migration `0004` adds
  `device_link`, a new table, so the running Worker never sees it while it applies. The device code is 32
  random bytes, stored as a hash, and spent by `complete` (a conditional update, so two racing requests
  register once). The user code is eight consonants from a 20-letter alphabet (no vowels, so no words, and
  no digits, so no 0 and O), printed `BCDF-GHJK`, decided once by a conditional update and only with a
  signed-in session. A code lives ten minutes; an approval leaves the terminal at least two more to finish.
  The daily cron drops expired rows.
- Rate limits: 10 starts per address, 60 polls, completes and cancels per address, and 20 lookups, approvals
  and denials per account and 30 per address, counted before the code is read so every guess costs. A code
  that does not exist, ran out or was used answers the same `not-found`.
- A registration through a link is one a person asked for, so it clears a removal like pairing again by link
  does. The name, icon and broker are the ones the start carried.
- The page shows the machine's name, its icon and a key fingerprint (the first eight bytes of the key in hex,
  in four groups), and the terminal prints the same fingerprint. It is `/link` on the web client with the code
  in the query: the address leaves the address bar at boot and the request waits in localStorage
  (`ruimte.pulsar.pendingLink`, as long as a code lives) through a sign-in round trip. The desktop app offers
  the same dialog under "Link a machine with a code" in Add a machine.
- No QR code in the terminal: there is no small encoder without a dependency, and the URL with the code in it
  is short enough to type.

### A machine connects only when it is used

- Every paired machine used to connect at boot and stay connected: the project list asked `project.list`
  of every machine through `transportFor`, which opened and held a link, and the status dots, the Remote
  pane and the agent settings held every machine while they were on screen. Over a broker each of those
  is a WebRTC channel, which costs an iPad its battery and the broker its load.
- The rule (2026-09-15): a machine has a live link while a workspace has a project open or opening on it
  (a project a boot restores counts until the boot tried it), while an explicit action waits for it
  through `ensureMachine` (the palette, the station welcome, `openProject`, `openFolderOn`), or while its
  dialog in the Remote pane is open, or while the usage dialog shows it. After the last of those the
  pool's 30-second idle close is the grace period. Nothing else opens a link.
- `pool.require` is gone and `transportFor` only peeks, so a call site cannot open a link by accident;
  `pool.hold` is the one way in. The active machine and the page's own daemon are no longer held for
  being what they are: an empty canvas on the desktop app connects to nothing.
- The clients of a workspace are built on `machineTransport(id)`, which follows the link rather than
  being it. Before, a workspace was built on the link itself, had to hold it for good (081ae74) and was
  rebuilt when the pool replaced it; now a link may close under an empty workspace and come back without
  a rebuild. A row that learns its daemon id moves that transport before the pool moves the link, so the
  clients on it never see the link close.
- Accepted: agents, attention, the dock badge, auto-registration and the account record sync only cover
  machines with an open link. A machine without a link is not a failure, so its dot is hollow and says
  "Not connected" with when it was last connected, kept per machine in localStorage.

### A protocol version on the wire

- One integer, `PROTOCOL_VERSION` in `packages/contracts/src/protocol.ts`, bumped when the wire changes
  in a way the other side cannot read and never for an addition an older side ignores. Today a client
  and a daemon work only on the same version.
- A socket carries `?protocol=N`. A daemon that runs another version upgrades it and closes it at once
  with code 4406 and `protocol <its version>` as the reason, because a browser reads the code and reason
  of a close and never the status of a refused upgrade. A client from before versions offers none and is
  let in, since it could not read a refusal anyway.
- A daemon from before versions takes every socket, so the client asks `endpoint.info` (which now
  carries `protocol`) before it calls the link open (`protocolGate` in `transport/protocol.ts`), holds any
  frame that arrives first, and refuses an answer without a version as the older case.
- A direct channel carries the version in `direct.challenge`, checked before the client proves anything,
  and in the proof frames; a daemon that refuses one for its version sends `protocol` on
  `direct.refused`.
- What a person reads, on the machine's row and in the palette where a connection fails: "This machine
  runs an older Ruimte. Update Ruimte there, or restart it to pick up the update." or "This machine runs a
  newer Ruimte than this app. Update this app." The reconnect loop keeps trying, so a machine that
  restarts onto the matching version comes back on its own.

### The machine as a background service

- Phase 6 of remote access: the daemon outlives the app, so a machine stays reachable from station and
  other clients once Ruimte quits. All of it lives in the shell (`apps/desktop/src/service`); the daemon
  only learned to say which build it is.
- On macOS a plist in `~/Library/LaunchAgents/app.ruimte.daemon.plist`, loaded with `launchctl bootstrap
  gui/<uid>` and ended with `bootout`. SMAppService (Electron's `setLoginItemSettings` with `type:
  'agentService'`) was the cleaner registration, but it takes a plist sealed inside the bundle, where the
  login shell's `PATH` and a log path in the home cannot be written, and nothing about it can be tried
  without a signed package. The plist runs the binary inside the bundle with `RUIMTE_HOME=~/.ruimte`, the
  login shell's `PATH` as the app worked it out, `RunAtLoad`, `KeepAlive`, logs in
  `~/Library/Logs/Ruimte/daemon.log`, and `ProcessType` Interactive, because launchd throttles CPU and I/O
  of a job that leaves it out.
- Signing: the daemon already ships as its own signed Mach-O (`mac.binaries` in `electron-builder.yml`,
  hardened runtime, the JIT entitlements of `entitlements.mac.plist`), and hardened runtime entitlements
  belong to the binary rather than to whoever starts it, so launchd needs nothing the app's spawn did not.
  The plist is written at runtime and is no part of the seal or the notarization. What changes is who
  macOS holds responsible: Background Task Management lists the job under Login Items (named after the
  signing team) and shows a notification the first time, a person can switch it off there, and a privacy
  prompt for a folder is asked on behalf of `ruimte` rather than of Ruimte.app. Neither is verified on a
  packaged build yet. A job switched off in Login Items fails `bootstrap`, and the app falls back.
- On Linux a user unit in `~/.config/systemd/user/ruimte-daemon.service`, enabled for `default.target`,
  with `Restart=always`. It ends at logout unless lingering is on, and `loginctl enable-linger` is a
  button in the machine's dialog behind a confirmation, never a step the app takes alone. An AppImage
  gets no service: it runs from a mount that is gone once it quits. Windows gets none yet, and the row
  says so.
- The dev app never installs, starts or stops a service (`serviceSupport` answers `dev` for anything
  unpackaged and the controller then has no manager at all). It spawns its daemon on 4211 with
  `~/.ruimte-dev` as before.
- On start the app asks `/health`, which now carries `build` next to `version`: an id
  `scripts/compile.ts` stamps into the binary and writes beside it as `ruimte.build`. Two local builds of
  0.0.0 are not the same daemon, which a version cannot say. The decision (`service/decide.ts`): the same
  build answering is attached to; an older one (or one without a build) is restarted onto the binary in
  the bundle, with a bootout, a wait until launchd lets go of the label, and a bootstrap; nothing
  answering starts the service; with the service off nothing answering is spawned as before, and anything
  that answers is used and left alone, as the app did when its spawn found the port taken. A service that
  does not come up with the expected build within 20 seconds is stopped, the app runs its own daemon, and
  the reason stands in the dialog.
- "Keep this machine running when Ruimte quits" is kept by the shell in `userData/background-service.json`,
  since it is needed before any window exists. Unset means on in a packaged app. Its row is in the dialog
  of This machine and only where the bridge has `backgroundService`, so never on station or in a tab.
- A switch never ends the daemon that runs, since that would end every session under the person's hands.
  On writes the definition and the service takes over when the app quits: the app ends its own daemon and
  starts the service, which may find the port still held, exits, and is brought back by its keep-alive.
  Off removes the definition at once (nothing starts it at login any more) and stops the running daemon
  when the app quits. A start that finds a definition while the switch is off (a quit that never ran)
  removes and stops it before it asks the port.
- Quitting with the service running leaves it running, and the question asked while an agent works says
  they keep running instead of warning that they end. "Stop the machine" (the application menu and a
  button in the dialog) is a quit that also stops the service and removes its definition, so it stays
  down until the next start of the app puts it back; nothing is left disabled in launchd's database.
- Removing it by hand. macOS: `launchctl bootout gui/$(id -u)/app.ruimte.daemon`, then
  `rm ~/Library/LaunchAgents/app.ruimte.daemon.plist`. Linux: `systemctl --user disable --now
  ruimte-daemon.service`, `rm ~/.config/systemd/user/ruimte-daemon.service`, `systemctl --user
  daemon-reload`, and `loginctl disable-linger` if it was turned on. Turning the switch off and quitting
  does the same, lingering apart.
- Trying launchd without a package: `bun scripts/service-plist.ts` in `apps/desktop` prints the same plist
  pointed at `apps/server/dist/mac-<arch>/ruimte` with another label, port 4212 and
  `~/.ruimte-service-try`, so it never meets an installed Ruimte. That exercises launchd, `PATH` and the
  logs; the attach decisions need a packaged app.
- An update never ends work without asking. The daemon updates itself: the service definition carries
  `RUIMTE_SERVICE=1`, and a daemon with it and a build id reads `ruimte.build` beside its own binary
  (`process.execPath`) every minute and a few seconds after a shell exits or a terminal turn ends, never
  running the new binary to learn its id (`apps/server/src/service/self-update.ts`). A different id with
  the machine idle is a shutdown as on SIGTERM (snapshots flushed, chats persisted) and an exit, and
  launchd's `KeepAlive` or systemd's `Restart=always` starts the new binary. A missing or empty id (a
  bundle halfway through being replaced) is no reason to exit. Every change of verdict is one line in
  the log. The app's own child and the dev daemon never carry the variable, and the daemon removes it
  from its environment so a shell does not pass it on.
- Idle is `workOf` in `apps/server/src/service/work.ts`: no terminal agent in a turn (hook status
  `running` or `needs-you`, and still live), no chat with an active turn, and no shell with a child
  process. A child is how the process table says "something runs in this shell"; a background job counts
  too, and without a process table every live shell counts as work. An agent between turns still has its
  CLI as the child, so its terminal is not idle either.
- The app asks `GET /machine/work` before it restarts an older build, with the local secret as a bearer
  and a 403 for anything else. It answers two counts and nothing more; `/health` stays without it, since
  what runs on a machine is nobody's business on an unauthenticated route. Nothing running restarts as
  before. Work running, or a daemon from before the route that cannot say, leaves the old daemon attached
  (`pendingRestart` in the controller) and the client asks "Ruimte was updated. Restart this machine
  now?" with the count, "When idle" being the default and what Escape means. The dialog is the client's
  (`shell/MachineUpdateDialog.tsx`): the old daemon serves the client from the bundle folder, which the
  update already replaced, so the page is the new one. "When idle" leaves the question answered for the
  session, a row in This machine keeps "Restart" within reach, and the shell asks the port every 30
  seconds until the new build answers. A daemon from before this change does not update itself, so on
  that one transition "When idle" means the next start of the app asks again.
- Not done: log rotation for `daemon.log`, `LANG` and the rest of the login environment beyond `PATH`
  (the app's own spawn never had them either), and the process panel still looks for the app around the
  daemon, which is launchd now.

### Orchestration

The design is `docs/reports/2026-09-16-orchestration-design.html`, approved on 2026-09-16 with the
recommended answer on all eight product questions. It is built in five phases; this is what the
code will not say on its own.

- The model adds as few words as it can. A **run** is the `turn` item that is already there, since
  that word is on the wire and cannot go; a person reads it as a turn. An **attempt** is one CLI
  process working on a run, which `ChatSession.generation` already counts, so it gets no record of
  its own, only an optional `attempt` on the turn once a run can outlive a process. A **step** is
  every item carrying that `turnId`; no item kind is added for it. A **subagent** is the `subagent`
  item, with an origin: `native` when the CLI opened it with its own tool, `ruimte` when a verb
  opened a node for it, and absent meaning `native`, which is what every older item was. A native
  subagent carries the pointer to its whole conversation (`native.agentId` for Claude,
  `native.threadId` for Codex), because the thread keeps only what fits under its cap of 200 items
  and 64 KiB and that cap stays where it is: the thread file is rewritten on every tool call. A
  **task** is what a parent asked of a child node, with a status and a result, in a record of its
  own under `$RUIMTE_HOME/tasks` beside the lineage.
- The wire only ever gains optional fields, new requests and new events, through every phase, and
  `PROTOCOL_VERSION` stays where it is. Never a new member of `ChatItemSchema` and never a new value
  in an enum a chat or a push already carries (`turn.state`, `turn.origin`, `subagent.status`, the
  kind of a push alert). The iPhone app in the store validates the answer of `chat.attach` and
  `chat.history` as a whole, so one item of a kind it does not know rejects the entire conversation,
  where an unknown event only falls away. A cancelled child is therefore a `failed` subagent row with
  a note, and a finished task pushes as a `turn` alert.
- A task is a record the daemon keeps, not a field in `project.json`: waking the parent is a promise
  the daemon makes, and a field an agent with a shell in the project folder can rewrite is no
  promise, the argument that already put the depth of a node under `$RUIMTE_HOME/lineage`. A copy of
  its status on the edge would be a second truth the merge has to learn.
- A task shows on the edge from parent to child and on the child's header and sidebar row, the edge
  first. The edge is where the relation is drawn; below `READABLE_ZOOM` a label on it is unreadable,
  so the child carries the mark as well.
- A task ends with `ruimte-context done`, or else with the last answer of the child's first turn; a
  `done` during that turn wins. A child asking a question does not end it: the parent is woken with
  "asks a question". A terminal child has no first answer to take, so it needs `done`, and a
  terminal that exits without one fails its task. A terminal agent may be a child with a task only
  that way; the parent always has to be a chat, since nothing else can be woken.
- No budget per task in these phases. The caps on depth, count and (from phase 5) mode are the
  limit. A cap on turns is the first thing to add if children turn out to give themselves turns.
- The iPhone app stays compatible in every phase (regenerated models, no new kinds) and gets the
  subagent view and the task status in one round after phase 4. A finished task gets no push of its
  own: the parent is woken and says so itself when its turn ends, which is when a person can act. A
  child that fails and a wake that is parked do deserve one, as `attention`.
- A subagent's conversation opens in the chat's own place, read-only, from a row in the thread or
  from the sub-agents button in the chat's bar (the node's header, the view's toolbar or its cell's),
  which puts a list of the CLI's own subagents and the tasks the chat gave in that same place: the
  running ones on top and the rest (done, failed, cancelled) under Done, each with its status word
  and the latest thing it did (`chat/subagent-list.ts`: the work the parent's thread kept, else the
  newest page of `chat.subagent` held while the entry is running, else the report). The bar then
  carries a breadcrumb that opens with the chat's own title (the way back to the main agent), then
  Sub-agents when the list was the way in, down to a grandchild, with a close beside it; Escape goes
  one level up before it leaves the node or the view, and the composer is gone until the main agent
  is back. Which one is
  shown is held per `${endpointId}:${chatId}` for the page's life (`chat/subagent-view.ts`) and never
  kept: a look into a subagent is a moment, not a place. The side panel it started as went, because
  it put the conversation beside a chat other than the one it belonged to. It grows while it is open (a counted `fs.watch` for Claude,
  a poll for Codex) for as long as a client holds it, and the event says only that there is more.
- A canvas is still not a scheduler, and the rule is made sharper rather than stretched. Nothing
  starts on a clock (no cron, loop or trigger), there is no queue of tasks handed out over nodes, no
  worker looking for an idle agent, no retry of a failed task, no blocking wait in a verb, no
  dependencies between tasks and no moving a task to another node. What does come, in one sentence:
  a finished task wakes the chat that delegated it, once, with the result, as soon as that chat has no
  turn running. That is a reaction to something the parent set in motion, like a hook that ends a
  turn, not a plan. The limits that keep it so: only a chat can be woken, only the parent of the task
  is, tasks that settle together wake together, a wake that fails is tried three times and then
  parked with a note, and the outbox holds only work a verb or a restart created, never something
  planned for a time. `notify` stays a message that waits until its receiver starts a turn anyway and
  wakes nobody.
- An observer on `ChatManager.observe()` only notes things: it may write a task record or a file in
  the outbox, never act. A handler that sent a turn to another chat from inside an event would run
  in the call stack of the first chat and be gone in a crash; only the outbox worker executes.
- Phase 1 (a subagent's conversation) was measured before it was built. `codex app-server` 0.154.0
  answers `thread/items/list` for a thread the process never loaded, from disk, with its own cursor
  and a newest-first order; a spawned agent's thread holds only its own items, not the parent's
  history it forked from. So a Codex child is read through the chat's running app-server when there
  is one and through a process started for the one question otherwise (kept five seconds per page),
  and nothing has to be resumed first.
- Holding a conversation is `watch` on `chat.subagent` itself (true holds, false lets go) rather than a
  request of its own or a lease. Reading and holding in one round trip leaves no gap in which a line
  could land unseen, a lease would need a clock on both sides, and a client that vanishes is let go by
  `detachAll` either way. The daemon watches Claude's `subagents` folder once however many of its
  transcripts are held, and polls the running Codex every 2 s only while something is held.
- A Claude transcript is projected once and read on from where the last read stopped, with the
  cursors of an ordinary `ChatThread` history, so a rewritten transcript expires them the way a
  cleared chat does. Every Codex item is projected on its own: two reasoning items merged into one
  thinking row would carry an id that depends on where a page began, and the view merges by id.
- The view lays the newest page over what it holds by id, and a page that shares nothing with it
  replaces it, since more happened than a page holds. Items read back have no turn, so the timeline
  draws them flat with the same rows as the thread (`chat/ui/rows/Rows.tsx`).
- `renderTranscript` gives a subagent one line with its tool use id in it, because that id is what
  `read <id> --subagent` takes and an agent has nowhere else to find it.
- Phase 2 (the daemon starts agents) is the outbox with its first kind, `start-agent`, and not a
  scan of the prompt store at start: a node opened without a prompt is started as well, and the
  later kinds (`resume-run`, `wake-parent`, `end-children`) need the same file per piece of owed work.
  The worker starts after the socket listens rather than right after `warmIndex`, since a terminal
  started before `hookUrl` is set would run without hooks for the rest of its life.
- A start that fails is not retried, although the worker can: both creates take the prompt before
  they spawn, so a second attempt would start the agent without its task. The entry goes with a log
  line and the node stays as it was, so a client that mounts it starts it the way it always did. The
  retries of 1, 5 and 30 seconds are there for the kinds of the later phases.
- `ChatManager.create` and `SessionManager.create` make one id at a time and every caller shares
  the outcome. The design took `ChatManager.create` to be safe against a second caller, and it was
  not: both managers awaited a disk read between the check and the insert, so the daemon starting a
  node and a client mounting it in the same moment made two shells, or two chats of which one held
  the prompt, and a chat was in the map before its prompt was sent. A kill that arrives during a
  create waits for it, so a node deleted mid-start ends what was made; the handler also checks that
  a project still places the node before and after the create, for a delete that did not come
  with a kill.
- A terminal the daemon starts is 120 columns by 40 rows and the first client that attaches sizes
  it to itself, like every attach. A chat opened by a chat takes that chat's permission mode, and a
  terminal node carried no mode, so its launch had none, until phase 5 wrote one onto the node under
  the ceiling (below).
- Any other chat the daemon starts takes the composer preference a mounting client would have sent
  (decided by Bas after phase 3): the mode, and the model with its options for the chat's CLI, with
  the parent's mode beating the preference's. A client tells every machine it has a socket to with
  `chat.setPreferences`, on every fresh socket and on every change, the way `agent.setApprovals`
  travels, and the daemon holds it per socket and drops it with the socket. Among several clients
  the newest `changedAt` (the moment a person last changed it, kept in the client's localStorage)
  wins rather than the client that spoke last, since a laptop that reconnects says an old pick again;
  a tie goes to the one told last. It is read when the chat is made, not when the entry is written:
  after a restart no socket has spoken yet either way, and the entry keeps its shape. With no client
  connected the chat gets what it got before, `full-access` and the CLI's own default model; a machine
  never remembers a person's pick after that person's client is gone, since on a shared machine it
  would start someone else's agents with it. The iPhone app sends nothing, so with only the phone
  connected the defaults apply as well. Phase 5 narrows all of it to the mode of the node that opened
  the chat (below).
- Nothing about approvals changed: a terminal agent with nobody attached has no client that wants
  a request held, so its CLI's own prompt asks (or an offline device through a push), and a client
  that mounts the node later sees the prompt on the screen.
- Phase 3 (a run that survives a restart) numbers the stream rather than the thread. The log is
  appended synchronously in `ChatManager.broadcast`, after the coalescer and before any sink hears
  the event, so no client ever holds a seq the log lacks and the order on disk is the order sent:
  one small write per coalesced event is cheaper than a log whose order depends on which
  asynchronous write finished first. The lines since the last fold stay in memory as well, so an
  attach with `since` is answered in the tick the client is put on the list, like every attach.
- A fold happens only after the awaited snapshot write in the per-chat chain, and it rewrites the
  log with the lines that came after the snapshot's seq (events broadcast while the write was out)
  rather than emptying it; a fold for an older seq does nothing. `persistAllSync` writes the
  snapshots but never folds: an older asynchronous write still in flight may land after it, and the
  log is what covers for that snapshot until `shutdown` folds after a write of its own.
- A daemon that goes down freezes its chats first: a CLI that dies in the same moment (Ctrl+C
  reaches the whole process group) would otherwise settle the running turn to `error` in the log
  after the snapshot, and the resume would find nothing to resume. What loading settles
  (approvals and questions cancelled, a tool that was running failed, the info) is emitted as
  events with seqs of their own, so a client that comes back with a seq from before hears it too.
- A chat whose first snapshot never landed is rebuilt from its log when the log starts at seq 1 and
  holds an info; otherwise it starts over after the last seq the log handed out, with a reset
  marked just past it, so a client still holding one of those seqs is answered with the whole
  thread and never with events on top of a thread that is gone.
- The resume is decided where a chat is loaded, not in the scan at start: a record whose active
  turn is running, with a CLI session to resume and no attempt past the first, asks the daemon to
  owe a `resume-run`, and the turn stays running only once that entry is written. The scan
  (`recoverInterrupted`, after the socket listens) only loads those chats, so a client that opens
  one first goes through the same rule and the handler finds the resume already owed. One resume
  per turn: a resumed CLI sees its transcript up to the break and may run a command again, so a
  second restart ends the turn instead of looping. A resume whose CLI will not start is
  retried after 1, 5 and 30 seconds and then ends the turn `aborted` with a note; stopping a turn
  that waits for its resume ends it the same way without a note. No message of a person is made up:
  the prompt that says the machine restarted goes to the CLI only, and the thread gets a note.
- A chat that is a view of its own is resumed like a chat on a canvas. `ProjectIndex.locate` already
  placed a session view under its own id with no canvas, so nothing in the rule had to change; a
  test holds it there, because "a chat no canvas holds" was how the rule read at first.
- A running turn that a restart does not take up again ends `aborted` with a warning note that names
  the reason, never as a silent `error` (decided by Bas after phase 3): no CLI session yet, already
  resumed once, no project holds the chat, the resume could not be owed, or an older running turn
  beside the active one. The sentence is the one the resume that gives up already used ("This turn
  could not be resumed after the machine restarted: <reason>", `notResumedNote`), so a person reads
  one kind of ending for everything a restart broke. Aborted rather than error because the turn did
  not fail; the machine went down under it. No new state: the wire keeps its enum.
- The timeline tells that turn from one a person stopped (decided by Bas after phase 3): "Stopped after
  X" where the machine ended it, "You stopped after X" where a person did. It reads the data already
  there, the warning note with the not-resumed sentence in the turn (`abortedByMachine` in
  `packages/contracts`, beside `notResumedNote`), rather than a field of its own; any other warning in
  a stopped turn, a CLI that retried say, leaves it the person's.
- Phase 4 (tasks) settles a chat child on the end of a turn, not on "the first turn" as such: the turn
  that ends with no task of the child's own still open or still owing it a wake. For the ordinary child
  that is its first turn; a child that delegated in turn would otherwise report "I asked a helper" as
  its result and be done before its helper was. A terminal child settles only with `done` or fails when
  its shell exits or its agent reports `exited`; a failed task raises attention on the child through the
  push service, which is the same entry a client's finished mark now reads (below).
- A wake waits for a busy chat without a clock and without a retry: the handler answers `wait`, the
  entry keeps its file and its attempts and holds no lane (a `resume-run` of the same chat behind it
  must not queue behind a wake that waits for that resume), and the daemon calls `OutboxWorker.wake`
  from a chat observer whenever an event leaves a chat idle. A wake that lands while the handler is
  still deciding to wait (the chat was loaded, and its settle freed it, inside the handler's own await)
  is counted per target and runs the entry again, so it is never lost. After a restart nothing is
  marked waiting and the handler simply looks again.
- "Several children finishing close together give one turn" means: everything settled at the moment the
  parent is free. A parent runs `agent --task` inside its own turn, so children that finish while it is
  still working always wake it together; a child that finishes after the parent went idle wakes it at
  once, and a later one wakes it again. Waiting for "all open tasks" would be a product rule (a wait
  mode), which the "not a scheduler" rule leaves out.
- A wake opens its turn through a method of its own (`ChatSession.wake`) and never through `send`: `send`
  steps on a turn with `origin: 'agent'`, which is exactly what a wake turn is, so a second wake would
  close the first one. It checks and opens in one synchronous step. The turn goes out before the tasks
  are marked `sent`; the chat log is appended synchronously, so a restart in between finds the turn
  with those `taskIds` and marks them without a second turn.
- The row of a task in the parent's thread is derived from the task and written after the task store
  write, deferred out of the broadcast of the child that settled it, and laid down again for every
  task of a chat when that chat is loaded. It is not outbox work: it is a projection that heals itself.
  `chat.subagent` on such a row reads the child's own thread through its history pages, with `source`
  set after the child's CLI, since the result carries a closed set of sources. A terminal child has no
  thread and answers `chat-unsupported`.
- "Unseen" per node lives on the daemon as the push service's attention entries (`issuedAt` and
  `readThrough` per node, written on every turn end and every alert whether or not a client is
  connected), and a client lays the entries still unread for a machine over its own marks
  (`unreadOnMachine` in `state/push-attention.ts`). Looking at a node already reads its entry, so the
  two never disagree for long. A failed task and a parked wake are `attention` alerts, which is how they
  count.
- An outbox entry given up on leaves a note in the chat it was for: the chat that opened the node for a
  `start-agent` or a `resume-run`, the chat itself for a `wake-parent`. A start is still never retried,
  so its failure is handed to the same note right away and fails the task of that child.
- Not built in phase 4: waking the parent with "asks a question" while a child's first turn waits on a
  question. Such a task stays open until the question is answered and the turn ends. Marking a wake
  about a question apart from the wake about the result needs a second wake per task, which the rule
  "a task named in a turn has woken its parent" cannot express yet.
- The marks a client takes from the machine's attention entries start at the moment the machine first
  ran a version that hands them out (`marksFrom` in `push-attention.json` and on `push.attention`,
  decided by Bas after phase 4). Up to 30 days of entries written only for notifications would
  otherwise all turn into marks after the update. A machine that does not say gives no marks at all,
  rather than every old entry.
- Phase 5 closes the orchestration. The mode ceiling is one order for every CLI, `supervised <
  auto-accept-edits < auto < full-access`: every CLI's flags widen in that order, and where two modes
  map to the same flags (Codex in a terminal, Gemini's `auto`) narrowing grants the same, never more.
  A terminal caller counts as the mode the daemon started its CLI with, and one it cannot know (a
  resume without a mode, a CLI a person typed into a plain shell) as `supervised`: strict rather than
  precise, as the design said. The ceiling is read when the verb runs and carried on the entry, since
  the caller may be gone when the agent starts, and it binds what the daemon starts, the composer
  preference included; a person may still widen a child's mode from its composer afterwards. Terminal
  agents take a terminal mode the clients tell the daemon (`terminalRuntimeMode`, beside the composer
  preference), written onto the node so a reload starts the same line.
- A worktree per role is made before the project is written, on a new branch named after the task or
  the title with a number when that branch exists, so parallel roles never share a checkout. The group
  of a team gets no `worktree` field, because that field means every node made inside it starts in one
  checkout. Nothing removes a worktree on its own, not when its task settles and not when its node is
  deleted: a branch with commits is a person's work, and merging and removing is still roadmap item
  11. The turn diff needed no change for a worktree (its toplevel is the worktree); it is now also
  narrowed to the chat's own subfolder of a repository.
- Stopping or deleting a node ends its agents through one entry, `end-children`, owed by every trigger
  there is: the kill requests, the verbs that end a session, and the node leaving the document by any
  way (an agent rewriting `project.json` kills nothing), deduplicated per node. `session.kill` on a
  shell that already exited owes nothing, which is what keeps Restart from ending the children of a
  lead whose shell had ended. The children are marked `endedAt` in their lineage first, so a restart
  halfway finishes the same way and a node is never ended twice; their open tasks are cancelled before
  any turn is aborted, so no parent is woken by a child that was stopped; and the entry holds its
  children's lanes while it runs, so a start or a resume already running finishes first and one only
  owed is taken away. A chat child keeps its thread and a terminal child its exited screen, since
  removing the node is a person's call. A turn that started before `endedAt` is never resumed, however
  late the chat is loaded, but a person who carries on in an ended chat is not held back by the mark.

### Skipped on purpose

Skipped: kanban, loop and trigger nodes, minimap, dictation, notch HUD, agent-to-agent
messages through the PTY, mobile app, managed accounts, terminal color schemes, most of its
settings panes. Also left out: a pull request client, a hosted cloud account and relay, SSH and WSL environments, MCP
browser automation, cookie and theme import, usage scanning, the mobile app. Neither has fork,
retry or edit-and-resend in a shape worth building yet.
Also decided against for now: a scheduler (see "Orchestration" for the one thing a finished task
may start), checkpoint restore and telemetry.

## Gotchas already paid for

- **`nodeStatus` calls an attached terminal "running", and nothing about agents may.** A terminal
  node with no agent in it reports `running` the moment this client is attached, which every open
  terminal is, so the status summary's "N agents working" used to count shells waiting at a prompt.
  Reusing that for "keep this machine awake" would have pinned a laptop open for the length of every
  session. `state/agent-work.ts` is the honest answer and now the only one: it reads the agent record
  itself and only while it is `live`, since a CLI that went down with its shell leaves the status it
  had behind, and `needs-you` is a person's turn rather than work. The pill, the dock badge and the
  quit dialog all count through it, which is also what stopped the pill from saying three where the
  quit dialog said one. `nodeStatus` keeps its meaning for the dot on a node, which is about the
  session and not about an agent. And of Electron's two blockers only `prevent-app-suspension` stops
  the system from sleeping; `prevent-display-sleep` keeps the screen lit, which an agent does not
  need and a person did not ask for.

- **libproc lies by omission.** `proc_pid_rusage` gives CPU time in Mach ticks (125/3 ns on Apple
  silicon), so a number read as nanoseconds is 40 times too low. `PROC_PIDTBSDINFO` refuses the
  processes of other users, where `PROC_PIDT_SHORTBSDINFO` still names them but without a start
  time, so they are listed dimmed and can never be signaled. A `BigInt` per counter was most of the
  cost of a reading at 1,600 processes. A fresh process gives pages back during its first moments,
  so a footprint read right after a spawn disagrees with `top`. And `bun test` runs in UTC while `ps`
  writes `lstart` in local time, which is why the test compares `etime`.

- **A dragged file has no path, and an effect the source did not allow kills the drop.** Two traps
  in one gesture. `File.path` was taken out of Electron, so only the preload can name a dragged
  file (`webUtils.getPathForFile`), and a browser cannot name one at all: that is a boundary, not
  an omission. And setting `dropEffect` to something outside the source's `effectAllowed` makes the
  browser call the drop refused and never fire it, which reads exactly like a handler that is not
  bound: the files tree allows a move and nothing else, so the canvas asking for a copy silently
  dropped every drag until `dropEffectFor`.

- **A new node or view kind is not backward compatible.** `NodeKindSchema` is an enum and
  `ProjectViewSchema` a discriminated union, so a daemon older than the client that wrote the file
  refuses the whole document, not just the node it does not know. Since projects live on several
  machines this is real: pairing with a machine that runs an older daemon and opening a project
  with a file node there fails to parse. It is the price of every kind that was ever added and
  nothing about the file changed (it is still version 2), but it is the reason a kind is worth
  adding once rather than twice.
  Since 2026-09-14 a version reads and keeps a kind it does not know ("Kinds a newer Ruimte
  wrote"); a release from before that still refuses one.

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
- **Dev runs beside the installed app, never on top of it.** Both used to take port 4210,
  `~/.ruimte` and the Electron name "Ruimte": whichever started second crashed on the port or
  quietly talked to the other daemon, shared its machine id and key pair (so a client could not
  tell the two apart), and an unpackaged shell lost the single instance lock and just focused the
  installed app. So dev has its own port (4211), its own home (`~/.ruimte-dev`, `RUIMTE_HOME`
  still wins) and, unpackaged, its own name and `userData` ("Ruimte Dev"). The packaged app is
  unchanged. A dev client on `localhost:5173` that paired with the old dev daemon holds that id in
  localStorage and needs it cleared once.
- **A daemon inherits the session it was started from.** Started from a terminal node, the daemon
  has that node's `RUIMTE_HOOK_URL`, `RUIMTE_HOOK_TOKEN`, `RUIMTE_CONTEXT_URL`,
  `RUIMTE_CONTEXT_TOKEN` and `RUIMTE_SESSION_ID`. Sessions pass `process.env` on (and never set
  `RUIMTE_CONTEXT_TOKEN` themselves), and the usage limit probes spawn `claude -p` and codex with
  it, so their hooks reported into the other daemon's node. `main.ts` drops them before the daemon
  starts, after the CLI commands, because `ruimte context` is the one caller that needs them.
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
  one sentence names the verbs (`VERBS_NOTE`) and goes out whether or not anything is linked,
  once per CLI life, so an agent knows the canvas is there before the first edge is drawn and is
  not nagged with it every turn. A chat gets it at process start, in the system prompt where the
  CLI has a flag for one (Claude Code) and in front of the first prompt where it has none
  (Codex), with the sentence about the links behind it when the chat has links at that moment; a
  Claude Code agent inside a shell gets it as `additionalContext` from its `SessionStart` hook,
  which is why the hook command prints curl's reply now. No skill file or instruction block is
  written into anyone's `$HOME`: a file per CLI and per SSH host is a copy that
  goes stale unnoticed, while a sentence from the daemon travels with it and `help` renders from
  the registry. Everything after that is about links
  only: `UserPromptSubmit` answers with the linked-context hint plus whatever only this turn has
  to hear (`hookContext`), a chat whose set of links changed between turns gets a note in front of
  the next prompt (also shown as an info note in the thread), and a plain shell keeps one dimmed
  line above its first prompt when it has links and stays silent when it has none (on the screen
  only, never typed into the PTY): a shell is not an agent, and a line about verbs above every
  `cd` would be noise. A link drawn while a Claude Code agent is already running reaches it the
  same way: the daemon remembers the links it last told that agent about and hands the difference
  to the prompt hook, quiet when nothing moved and silent at a `SessionStart`, which carries the
  whole list anyway. A shell with no hooks still only shows it as the "context" chip in the node
  header.
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
- **A `PermissionRequest` hook does not gate anything; it races the TUI.** Everything about this
  hook is a trap for anyone who reads it as "the CLI waits for my answer". Measured against
  Claude Code 2.1.270 in a real PTY: the prompt appears on screen at the same moment the hook
  starts, both stay live, and the first answer settles it (the transcript then says "Allowed by
  PermissionRequest hook"). **Answering in the TUI tells the hook nothing.** Measured again on the
  same version: the hook was not cancelled, the request sat out its whole 110 seconds while the
  approved command ran and the turn ended, and the only abort that ever arrived was the CLI
  itself dying. So an aborted request is not the signal to withdraw one; the end of the turn is
  (`applyHook` in `apps/server/src/sessions/manager.ts`).
  A hook that outlives its `timeout` is cancelled and its output discarded, and the prompt simply
  stays up, so a hold that runs out costs nothing. The reply shape is not what the published docs
  say either: for `PermissionRequest` it is `hookSpecificOutput.decision` as an *object*,
  `{"behavior":"allow"}` or `{"behavior":"deny","message":"..."}` (the binary says so in as many
  words, and a string is rejected), with `updatedPermissions` beside an allow carrying the CLI's
  own `permission_suggestions` back. `PreToolUse` is the one with a string `permissionDecision`,
  and its `defer` is print-mode only ("ignoring (defer is print-mode only)"), so it is no use for
  this. The suggestions come in three shapes: `addRules` (`rules[].toolName` plus `ruleContent`),
  `addDirectories` and `setMode`; the last widens the whole session rather than one call and is
  deliberately not offered as a button.
- **A direct connection has to close its channel before its peer, or the daemon waits 30 s.** werift's
  `RTCPeerConnection.close` stops DTLS without sending an alert and only then sends its SCTP abort, on
  a transport that is already gone, so neither reaches the other side. The one word that does is the
  stream reset a channel close starts, and closing the peer in the same tick races it; the daemon then
  keeps the peer until ICE consent fails 30 s later (CI lost that race, a laptop rarely does). Both
  clients (`DirectClient.close`, `webRtcLink`) close the channel, wait for it to report closed (the
  reset answered) for at most 2 s, and only then close the peer. The daemon's werift ends a channel on
  a stream reset and on any DTLS alert, and ICE consent stays the fallback for a client that vanished.
  `DirectPeers` logs every connection that opens and ends, with the reason.


## Next

The two open issues first, then the rest in the order that makes sense. Sizes are rough: hours,
a day, several days. Each of the larger ones becomes a GitHub issue when it starts.

1. **#13**: a webview keeps the canvas's z-order only by being above everything, so a node
   dragged over a browser node slides under its page.
2. **#15**: Windows, which can wait. The daemon on Bun's Windows PTY or Node with node-pty, the
   shell and a release build (`docs/research/windows.md` is the design for a project in its own
   window, not for the platform). Linux runs, see `docs/LINUX.md`; the signed and notarized
   macOS build, the icon and the update path are done, see `docs/RELEASE.md`.
3. **The daemon as a background service** is built (see "The machine as a background service")
   and waits for a packaged release to be tried, updates included (see "A protocol version on the
   wire"). Accepting a window of previous protocol versions (the last three, say) instead of only the
   same one is for later, once a bump is in sight. The ruimte.app landing page comes later and gets
   an issue when it starts. A known gap in the checkpoints: the turn diff is of the chat's own folder
   (or its worktree), so an edit the person made there during a turn lands in the card too.
4. **A third chat provider** (Gemini, Copilot or opencode) as the proof that the backend seam
   holds: a provider value, a backend and a protocol mapper, plus one literal in `AgentKind`.
   Hooks for Gemini and Copilot are a day per CLI on top.
5. **The rest of the git panel**: commit, push and a PR through `gh` as one stacked action with
   its progress as a toast, the branch chip with a ref picker, pull when behind, and a commit
   message written by the chat CLI when the field is left empty.
6. **Agents on the canvas** is done, and what is left of it is three CLIs. Hook-reply approvals are
   Claude Code's alone, because it is the only terminal CLI with a hook that offers one: Codex
   waits on the contract in 1 above, Gemini and Copilot on their hooks in 4. Everything else of it
   stands: the verbs in 66 commits between `323d4dd` and `fd202cd`, then keeping the machine awake,
   attention and the approvals in 28 more up to `6313ae8`, and the `diagram` verb with the diagram
   view (see "A diagram"). Every decision is above, from "The daemon parses a verb's arguments"
   onward for the verbs, and under "Staying awake while an agent works", "Attention" and the
   permission bullets for the rest.
7. **Terminal basics**, about two days. Search on Cmd+F, clickable file paths and URLs across
   wrapped rows, OSC 52 clipboard, a dropped file types its quoted path, Unicode 11 widths on both
   xterms, "Clear" in the node menu. Then "Send to linked chat" (a terminal selection lands as a
   fenced block in the composer of the chat the node has an edge to) and port discovery: an `lsof`
   poll tied to the owning session, an "Open :5173" chip that adds a browser node with an edge.
8. **Canvas ergonomics**, about two days, all client state. Directional focus on Cmd+Arrow,
   maximize on Cmd+Shift+Enter, camera history on Cmd+[ and Cmd+] (Cmd+1..9 belongs to the views,
   and Cmd+[ to a browser while one is focused).
   Arrange, align and tidy as pure functions with palette entries; palette ranking (exact, prefix,
   substring), `>` for actions, recent nodes on an empty query, settings rows as entries. Images on
   the canvas from paste or drop, stored under `<folder>/.ruimte/images`. An image that is already
   in the folder needs none of this: it is a file node, dragged in from the file manager included.
   What is left is the half with no path behind it, which is the clipboard.
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
    merge and removal from the group menu (more pressing now that `agent` and `team --worktree` leave a
    worktree per role behind), shared paths (`node_modules`, `.env`) linked into a new
    worktree, clone a repository as a project.
12. **The editor and the diff node**, the half of this the file node does not cover. Saving is the
    whole of it: there is no `fs.write` on the wire, and adding one is a decision about what a
    client may change on a machine, with a conflict question under it (an agent rewrote the file
    meanwhile). Plus a PDF renderer, a diff node that reuses the git panel's scopes, a line number
    in a file node's path, and "open in editor": an editor probe and preference, `fs.open` with
    `path:line`, used from menus, diff rows and paths in terminal output. Still unmeasured: what a
    canvas of ten file nodes on the largest files of a repository costs, now that the plate and the
    highlighting cap are the two things standing between it and the thirty-node goal.
13. **A test floor**: a 30-node harness (a dev-only palette command or a Playwright spec, out of
    CI) and whatever it finds; a DOM setup for `bun test` with first specs for the composer and the
    canvas wiring; a daemon-backed e2e job in CI for the terminal spec.
14. **Usage v2**: a Days table, price and plan overrides, a currency setting, and an export.
15. **Two projects side by side**: `openWorkspace` and the four stores per workspace are there, the
    layout is not. `docs/research/windows.md` is the design: a project opens in a window of its own
    rather than in a split pane.
16. **Smaller ones**: a color or an arrowhead per plain line; a note's title as the first heading
    of its body.

Known gaps to keep in mind: the WebGL budget is a fixed 10 contexts, not a setting and not
measured against what a given machine really keeps alive; the 30-node performance target is
unmeasured. Backpressure is handled per socket (output dropped over the high-water mark,
repaired with `session.resync` on drain); what is not there is a per-session cap, so one very
loud shell can still be the reason a client is dropped.

Research that is written but not built: `docs/research/browser-streaming.md` (a headless Chromium
on the daemon, streamed over the socket; it and a relay wait until a remote daemon is in daily
use), `docs/research/windows.md`, and the reports under `docs/reports` for accounts and remote access.


### iPhone and iPad

- `apps/ios` follows the report reviewed against `8b3fe06`. Bas subsequently asked for the
  complete app; the initial pause between phases no longer applies. Hardware acceptance is
  recorded separately from local build and test results. The minimum is iOS/iPadOS 26;
  the bundle is `app.ruimte.mobile`. No daemon runs on the phone. Nodes open as pages;
  the mobile canvas does not move or resize existing nodes.
- The app uses one ed25519 key for the account session and machine access. Unlike Electron,
  there is no separate trusted shell process that needs its own key. The key and refresh
  session stay in a nonsynchronizing, device-only Keychain item accessible after first unlock.
  Every scene shares one vault so two windows cannot spend the same refresh token twice.
- Login uses the existing Worker PKCE redirect and exactly `ruimte://pulsar/callback`.
  The browser session checks the whole callback and its state before exchanging the code.
  Provider discovery already exposes Apple when configured; native Apple token exchange is
  separate future work. Pairing-link entry accepts HTTPS only and refuses redirects before sending a one-time token elsewhere.
- The full daemon API is generated from Zod, including request/result/event validation,
  TypeScript signing/framing fixtures and the protocol constant. JSON Schema drops custom
  refinements, so known refinements remain explicit generator overrides. Unknown node/view
  kinds carry their raw content through saves. Conflicting edits stay local until resolved.
- The default ICE policy allows libwebrtc to select the path. The test app's relay-only switch
  exists to measure TURN, since reaching a machine over a direct candidate proves nothing about
  relay configuration. No production broker or TURN deployment is part of this work.
- A visible iPad scene keeps held links alive when another scene backgrounds. Once all scenes
  background, connections close and foreground builds new peers. There is no background audio,
  VoIP or daemon workaround. Path changes come from `NWPathMonitor`; it does not claim to
  observe libwebrtc through a separate `NWConnection`.
- With the local CryptoKit runtime, repeated ed25519 signing produced different valid
  signatures for the same message. Interoperability fixtures therefore assert identical message
  bytes and verify each side's signatures, rather than requiring identical signature output.
- Simulator Keychain tests require local signing. An unsigned app returned status -34018,
  missing entitlement; this is distinct from a malformed Keychain query. Real browser login,
  Wi-Fi/5G relay reachability and reconnect targets still require Bas's device checks.

- A terminal attached with `follow:true` observes the existing PTY dimensions. It cannot resize
  a desktop session just by opening on a smaller screen. Shared attachment leases keep one
  iPad window from detaching another window from the same chat or terminal.
- Push alerts use X25519, HKDF-SHA256 and AES-256-GCM, signed by the machine's ed25519 key.
  AES-GCM is supported by both the deployed Bun runtime and CryptoKit; the tested Bun runtime
  did not offer ChaCha20-Poly1305 through node:crypto. A shared test vector fixes the routing
  bytes, AAD, key derivation, ciphertext and tag. The notification extension verifies the
  machine key, handle, validity window and replay receipt before showing decrypted content.
  ActivityKit title and phase are the explicit unencrypted exception.
- XcodeGen remains the native project source. The generated Xcode project is committed so
  Xcode Cloud can discover the app and its extensions, with resolved packages committed for
  repeatable builds. Xcode user state and build output remain local. APNs credentials,
  development-team signing and TestFlight configuration are external, never source secrets.
