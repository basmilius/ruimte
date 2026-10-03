# Ruimte for iPhone and iPad

A native remote client for your Ruimte machines, requiring iOS or iPadOS 26. It opens
projects, chats, terminals, files, drawings, diagrams and devices without running a local daemon.
The canvas supports navigation, nodes, groups and context links; existing nodes keep their position
and size. Browser pages use an isolated WKWebView without a machine bridge.

## Included

- Native Sign in with Apple, GitHub web sign-in, HTTPS pairing links and
  shared authenticated WebRTC connections. Normal ICE selection allows direct connections;
  TURN is a fallback. The relay-only switch is confined to connection diagnostics.
- Project creation and navigation, view ordering and names, local camera/selection, and
  three-way merges with explicit conflict resolution. Unknown view/node kinds survive saves.
  Separators group the view list into sections; rows show the name and the Lucide mark the desktop gives them.
  Projects use native grouped lists with a separate recently closed page. Custom image icons,
  including `.idea/icon.svg`, use the existing authenticated `projectIcon` byte resource and dark variant.
  A cold start opens on Now; an iPad puts the project you left open back in its sidebar. An empty canvas offers tiles for the installed agents from `provider.list`
  and for each kind of node, an empty drawing says so until its first element, and an empty diagram asks an
  agent to draw it.
- Native chat timeline, streaming, markdown/code highlighting, model options, drafts,
  attachments, context selection, approvals and questions. The composer styles Markdown
  while editing and shows selected files and skills as inline badges.
- Chats outside any project. New chat on the projects page (a menu of the machines when there are
  several) and on a machine's Projects page picks one of the machine's installed chat agents from `provider.list`,
  asks the machine for it with `project.newChat` and opens it; the machine hands back the chat of that
  agent nobody wrote in yet instead of making another. Each machine's Chats project (`scratch` on its
  summary) has a row of its own, "Chats", and stays out of the projects and Recently closed. It shows
  neither files nor git, its plus starts a new chat, and a chat nobody wrote in yet stays out of its list
  unless it is open. A machine that cannot hold such chats, being older or keeping its Ruimte folder in a
  git checkout, says so in the sheet.
- Deleting a chat or terminal view or node, or a canvas with such nodes on it, ends those sessions on the
  machine, as the desktop does: a chat with `chat.kill`, so the CLI stops and the thread, its attachments and
  bookmarks go, and a terminal with `session.kill`, so its shell and everything running in it end. The agents
  they opened end too. The confirmation says so and counts those agents. Stopping a turn keeps the chat.
- Drawing with a finger or Apple Pencil, pressure, pen colors and widths, whole-element
  erasing, undo, pan and zoom. Selection, shapes and text creation are included.
  Unsaved drawing drafts persist locally for recovery.
- SwiftTerm terminals with snapshots, output, resync, keyboard controls and paste confirmation.
  `session.attach` uses `follow:true` so opening a phone never resizes the desktop PTY.
  A command from the project file that nobody on the machine has approved yet waits above the
  keys as a prompt with Run until someone taps it (`heldCommand`, `session.runHeld`).
- File previews. Pictures open in every format ImageIO reads, HEIC, HEIF, AVIF, TIFF, BMP and ICO
  included, with pinch-zoom and a line with their dimensions, size and type. PDFs open in PDFKit. Sound
  plays in a player of its own with a scrubber and video in AVKit's player, both read in pieces without
  a size limit. Source is colored in the language the machine names, and a folder listing marks each
  file with the icon of its type. A file without a view of its own opens in Quick Look and can be
  shared to another app, once the machine serves it (images, video, sound and PDFs) and it fits in 32 MB.
- Files of a project (`App/Pages/Files`), as a sheet from the project's toolbar that opens large and pulls down to
  medium: each row carries what git says about it (`M`, `A` for new, `D`, `R`, `!` for a conflict, and `M` on a
  folder with a change under it), read once for the whole folder from the same watch the git sheet uses. Find in
  files searches the text under a folder with `fs.grep` (match case, whole word, regular expression) and groups the
  hits per file; a hit opens the file at its line. A text file marks its changed lines in the gutter against the last
  commit (green added, blue changed, a red notch where lines went), from `git.diff` of that one file. The bar under a
  file mentions it in a chat of the project (the one opened last first), shows its diff and copies it. Mention adds
  `@path` to that chat's draft: the composer on screen when the chat is open (`ChatDraftInbox`), its saved draft when
  not. The file's menu edits a text file, opens it as a view of the project (or the view it already has), and
  deletes it to the machine's trash after a question (`fs.delete`). An edit is written over the mtime it was read at
  (`fs.write` with `expectedMtime`), so a file that moved on the machine refuses with the edit kept, to reload or copy.
- Filesystem updates, usage and machine access management. Destructive actions require confirmation.
- A machine's page (`App/Pages/Machine`) stands from the first frame of its push: how the machine is reached with
  the round trip of `server.ping` (every ten seconds while a page shows it) and its version, then the update of its
  app, the rows Projects, Files, Devices, Processes and Usage with the limits of each CLI under it, and On this
  machine with keep awake, the connection and Agents. `MachineEndpoint` reads `endpoint.info` on every link and
  follows `endpoint.changed` and `endpoint.updateChanged`; it also keeps when this phone last reached the machine.
  Keep awake (Off, While agents work, Always, then Also on battery and, under Always and only with battery, Keep the
  display on) shows only where the machine can hold it (`keepAwakeAvailable`) and is written with
  `endpoint.setIdentity`, which sends the name back only when a person chose it. The update banner says what the app
  on the machine has (available, downloading with its percent, ready, failed); Update or Restart first asks
  `endpoint.installUpdate` with `confirm: false`, says what a restart ends right now (terminals and agents, or
  nothing under the service) and installs only after Restart on that question. Without the app on the machine it says
  to install it there, and `update-no-app` and `update-none` read as such. The menu holds Name and icon (a sheet with
  the name, empty for the machine's own, and twenty icons from the project set) and Apps with access: every client
  from `auth.sessions` with how it came in and when it was last there, Revoke after a question that explains what
  that means for its way in, and revoking this phone forgets the machine here. A paired client cannot mint a pairing
  link, so the sheet says where to get one on the machine instead.
- Devices of a machine (`device.list`, read again every three seconds while the page is open), grouped as the
  desktop's devices panel: running simulators first, then iOS simulators and devices and Android emulators and
  devices. Start and Shut down where the machine offers them (`device.boot`, `device.shutdown`), Retry for a device
  that waits on a person. A running device shows a read-only preview from `device.open` with `stream: events` and
  JPEG only, a few frames a second and never input; a device that streams video says its picture shows in its view.
  Open as view adds a device view to a chosen project of the machine (or finds the one it has) and opens it there.
  With streaming off on the machine the page says so, since the machine then answers no device request.
- Launches of a project, in the project menu (the play button in an iPad's bar): each with a dot in the color of its state, its
  command and a line that says what it does (running and on which port, needs approval, passed or stopped how long
  ago, failed with its exit code), grouped by the checkout it runs in. The output and Stop while it runs, Approve
  while it waits for a person, Launch otherwise, Restart in its menu and Force stop only while a launch is stopping,
  as on the desktop; Stop all from the plus menu. What the machine finds in the project and is no launch yet stands
  under "Found in this project", a row per file, and Add imports it. A tap shows the
  launch's output, the machine's own terminal for it, followed and never resized; a group shows the member that runs
  or failed. The phone is a person to the machine, as every paired client is, so a launch nobody approved here
  shows the command, folder and every variable it would run with, and only Launch on that sheet sends the approval
  (`approve` on `launch.start`). A launch that needs a port another launch holds asks before stopping that one. New
  launches and edits save the whole list against the rev they were read at, which approves what they add or
  change, as the sheet says; a conflict offers to start over from the latest. Find in this project imports what the
  machine detects (`launches.detect`). An older machine says it needs an update.
- Processes, on a machine's page (`processes.subscribe` while the page is open): CPU
  and memory of the machine against the share of Ruimte as two tiles, over the last ten minutes or the last day, with
  disk as a line under them, then per project a group per terminal, chat or launch with its processes and what
  belongs to no project under Machine tasks, for what Ruimte started or everything. A warning sits under
  the group it is about with the button the desktop offers (interrupt, terminate, show, resume) and can be dismissed.
  Long-press a node's group or a process for Interrupt, Terminate or Force quit; Force quit asks first, as on the
  desktop, and the machine refuses a pid that now names another process.
- Git over every repository a project folder holds: the one the folder is in, its initialized
  submodules and the repositories beside it. It is one sheet with three segments, Changes, History and Branches,
  under a pill that names the branch (or how many repositories there are) with what is ahead and behind. The pill
  switches the sheet between the project folder and one of its worktrees, and leads to the branches, or with several
  repositories to a page of them with Pull all and Push N repositories. Changes are grouped per state and named per
  repository, the staged files decide where a commit lands, and fetch, pull and push run over the whole folder.
  The commit opens inside the sheet, with Write with Claude (or Codex, `git.suggestMessage`), Commit and Commit and
  push. A branch that moved on both sides asks Merge or Rebase before a pull brings it together, since a pull only
  fast-forwards until a person says how. History is every repository at once and a row opens the whole commit's diff.
  Branches is one repository at a time: its branches (switching stashes a dirty tree after asking), its worktrees with
  who works in them, binding a group of the project to a worktree as the desktop's worktree dialog does
  (`git.worktree-add`, the group's `worktree` in the private project file), and its stash with Stash changes and Pop
  per stash. A repository of its own also has a page with its remote actions, stash, pull request and history; the
  pull request has its base and branch, title, description and what it carries over the base, publishes the branch
  first when needed and opens in the browser. Diffs read a working-tree file, a file against a ref, or a whole commit.
  A checkout that stopped halfway in a merge, rebase, cherry-pick or revert heads the Changes segment, with Abort
  and Continue in its bar (`git.operation`). Its conflicts are worked out in the app, never through markers in
  the file: a page per file folds what merged by itself and shows each conflict with both sides, to take
  one, both or a stretch written by hand, or the whole file can be edited at once; a conflict whose lines
  that edit changed counts as answered and one it left alone stays open. The wand closes what needs no choice, and an agent on the
  machine can propose answers (`git.resolveAi`); a proposal is an answer to check, not a write. Mark
  resolved writes the file over the digest it was read at, so a file that moved on the machine refuses
  and is read again, keeping the answers that still fit. The stretch logic is a Swift port of
  `packages/merge` that splits and fingerprints exactly as the daemon does.
  Worktrees of a repository list what they hold and open their changes against the branch they came
  from. A new one is made for a branch; a merge commits loose work first if asked, squashes, merges or
  rebases, and runs in the checkout that has the target branch out. A target checked out nowhere is
  refused on purpose and offers the branch the folder is on instead; a conflict leads to the conflict
  pages or is taken back. When git refuses because the merge would overwrite changes of your own in the
  target checkout, Stash and retry parks them in a stash named "Before merging <branch>" and merges again,
  only when you press it. Removing asks with the work counted again and only forces when it says so.
- The usage page is the desktop's: Today (per hour), 7, 30 or 90 days, counted in euros, dollars or tokens, a bar
  per day stacked per CLI where a tap shows that day, the six tiles, and a breakdown per model, project or day with
  each row's share. The title switches between machines and Scan again reads it all again. It counts in the region's
  money until a person picks: euros in a EUR region at the ECB rate the machine supplies, dollars elsewhere. Missing or
  invalid rates keep dollar amounts and say so, and the line at the end names the scan, the prices and the rate.
- Optional encrypted push alerts and approval actions, per-session follows, a notification
  service extension and Live Activities. APNs delivery requires the service configuration below.
- Small and medium Home Screen widgets with the usage limits and today's cost of one chosen machine.
  A widget never connects itself: the app writes what a connected machine reports into the app group,
  and a background refresh asks again at most every half hour. Offline the widget shows the last numbers
  and the time they came in. A widget shows the default account of each CLI unless its Account setting picks
  another; a CLI with several accounts names the account in its rows, and one CLI's widget then shows that
  account's cost of today.
- A Needs you widget with the count of what waits on you and what works, and a Needs you list widget (medium and
  large) whose rows open their chat or terminal (`ruimte://node`). Now writes the board into the app group whenever
  it changes (`NeedsYouWidgetRecorder`); the widgets show the last state the app saw.
- A Project widget (large and extra large) with the views of one chosen project and whether each needs you or
  works, counting the nodes on a canvas toward it. A row opens its view (`ruimte://node` with `target=view`), found
  in its project as a notification is. `ProjectWidgetRecorder` writes every open project from what Now reads.
- The usage page has a limits card per account, amber once a window comes close, titled with the account once a CLI has several. An account
  that is signed out or not read yet says so instead of drawing empty bars. A signed-out account offers Log in where the machine
  names a login command for its CLI, as the desktop's usage page does: the CLI's own login runs in a terminal of its
  own on the machine (`session.login`, no approval since the machine picks the command), the sheet closes by itself
  once the account reads logged in, and closing it ends that session.

## Navigation on an iPhone

Four tabs, each at most two levels deep: Now, Projects, Machines and Search. They stand as the root of one
navigation stack (`PhoneHome`), and every page opens on that stack over the whole tab view, so the tab bar leaves
with a push and comes back with the pop, following the finger on a swipe back. A tab's page is hosted apart from the
stack's bar, so the title and the bar's items of each tab sit on the tab view, chosen by the selected tab. Settings
opens as a sheet from the avatar, the last item on the right of the bar on every tab, on a project's page and on a
machine's, and the tab bar folds in while a list scrolls down. A push only morphs the bar into the title and items a
page has when it starts, so a pushed page gets them from its route (the avatar's `SettingsLink`, the project's row as
its summary), keeps them the same while it opens, and the push runs without an animation of ours around it. The
avatar is the account's GitHub picture as the desktop shows it (`AccountAvatar.swift`, kept in Caches and asked again
once per launch), else the first letter of its name.

- Now (`App/Now`) is where the app opens: Needs you, Working and Finished over every connected machine, then the
  machines that are not connected. `NowModel` reads each machine's open projects with `project.sidebar`, again on
  `project.changed`, `project.summary` and `session.list-changed` and every 15 seconds while Now is on screen, as the
  desktop's sidebar watch does. What each session is doing comes from the machine's `AttentionStore` (`chat.list`,
  `chat.status`, `session.status`), and Finished holds what ended while nobody looked until it is opened. `NowBoard`
  is the pure grouping. Rows wear the task mark from `task.list`. A tap opens the chat or terminal over Now, inside
  its project; a long press also offers Open project. The tab's badge counts what needs you.
  A chat between turns whose sub-agents or workflow still run (`delegating` on its info), or that gave another agent
  a task that is still open, stays under Working with a gray mark, as the desktop draws it.
- A needs-you card answers the chat's oldest request in place (`NowRequest`, `NowCard`), from the summary the machine
  keeps on the chat's info (`requests` on `chat.list` and `chat.status`), without attaching the chat: Deny, Allow and
  Reply for an approval, where Reply is a denial with a message and only shows for a CLI that passes one on
  (`denyReason` in `provider.list`), and for a single question its choices and a reply field. A request with several
  questions is answered in the chat. The card goes once the machine drops the request, whoever answered it; an answer
  that finds it settled (`request-not-found`) counts as given. A machine from before request summaries shows the card
  as before, and its header opens the chat.
- Snooze (`Snoozes.swift`) puts a needs-you card or a chat or terminal in a project's list aside for 10 minutes,
  an hour or until the next 09:00 on the phone, by swiping a card to the left (an hour) or from the context menu.
  `MachineSnoozes` reads the machine's own with `snooze.list` and `snooze.changed` and sends `snooze.set` and
  `snooze.clear` with an absolute `until`. A snoozed card leaves Needs you, the tab's badge and the app icon's badge
  and waits folded under "Snoozed until …" until it runs out. A snooze set without a connection waits on the phone,
  also across a restart, and goes out once the link is back unless it ran out; a machine that answers
  `unknown-request` keeps its snoozes on this phone, for that machine only, until an update makes it list them.
- The write button on Now starts a chat with one of a machine's installed agents in the machine's Chats
  (`project.newChat`) or as a new chat view at the end of one of its open projects, and opens it.
- Projects lists the open projects under the machine each is on, with a green dot while it answers and "via relay"
  when it answers through one, and the machine's Chats among them; New chat and Recently closed follow. A row's
  second line is its branch (`git.status` of the folder, asked when the list shows and on a pull) and how many views
  it holds; beside it stand how many of its nodes need you and a spinner while one works, both from the
  `project.sidebar` answers Now already reads (`ProjectOverview`, `ProjectGitLines`). Search finds a project by name,
  so this tab has no field of its own.
- A project page is its part of the desktop's sidebar (`PhoneProjectList`): the views in the project's order, and
  under a canvas the nodes on it that run, folded with its chevron (remembered on the phone). Each row wears the
  draft dot of a chat with an unsent message on this phone, a process warning (`processes.listAlerts` and
  `processes.alerts`), the shared mark of a view in the team's file, a task mark, and its status: an amber dot when
  it needs you, a spinner while it works, the alarm clock while snoozed. A long press shows the row with what it
  waits on over its menu: Rename, Change icon and View settings (name, mark and a browser's address), then Fork for a
  chat whose CLI forks (the chat opens with the fork sheet on its last turn), Snooze and Stop turn while it works,
  then Delete. A drag reorders a section; dividers keep their place. The title names the machine and the branch with
  what changed on it. Its bar holds the project's menu beside the avatar: New view (New chat in Chats) in a group of
  its own, then Files, Git, Launches (none of these in Chats) and Usage, each a sheet, then Project settings; Files
  and Git open large and pull down to medium. New view has no form: an agent, a kind or a divider is one
  tap that makes the view and opens it; a browser then asks its address in View settings, a heading its words, and
  File picks a file in the project's files. Project settings holds the name (`project.setIdentity`), the color (in
  the project file, from the palette of the design), the initial, a symbol or an image (`project.setIcon`), the
  launches and Close project, which says what closing ends (`project.closing`) before `project.close`. While the
  machine does not answer and a try failed, the list dims under a glass card that says so, when it was last
  connected, and offers Diagnostics and Other project; it goes once the machine is back. A view opens over the
  project.
- Machines lists every machine as a card with how it is reached and how fast, the limits of its CLIs and an update
  when one is ready; one that is away says when it was last there and offers Retry. Pairing is the plus and the row at
  the end. A machine's page opens its projects with New chat and Chats (a project opens under Projects), files,
  devices, processes and usage, and keeps keep awake, name and icon and apps with access.
- Search is the desktop's command palette (`SearchPage`, `CommandPalette.swift`): views, projects, files and commands
  over every project of every machine, without searching text inside chats. Every typed word has to appear; a name
  that starts with the query ranks first, then one where every word starts a word. Files come from `fs.search` in the
  folder of each open project. The commands are the ones that mean something on a phone: New chat, a new view or
  terminal in a project, its Files, Git, Launches and settings, opening a folder (on the machine's page), Usage,
  Recently closed, pairing, Settings and the appearance. Nothing typed shows what needs you and the most used
  commands. A view or a file opens over Search in its project; a project and its sheets open under Projects.

`PhoneRouter` holds the tab and the stack's path. Each route (a project, a view, a notification, a machine, Recently
closed, a file Search found) replaces what was pushed, and a project goes to Projects. A sheet a command asks of a
project waits until the project opened (`pendingSheet`), since one asked for during the push would not stand. The
stack only shortens the path once a pop
settles, so a swipe back the person takes back leaves the route standing. A view opened outside its project's list
(`ProjectViewPage`) opens the project behind it, so it has the project's sessions, forks and plans, and names the
project under its title.

## The iPad

The iPad keeps the iPhone's pages and none of its tabs (`PadHome`, `PadRouter`). Its sidebar is always the open
project's, as on the desktop, and floats as glass beside the content. At the top the project switcher names the
project and its machine; a tap lists every open project per machine with its Chats, then All projects, Machines, Open
a folder and Recently closed, and the project's own Project settings and Usage. Under it Search (⌘K, bound once on
the window, opens the palette as a sheet), Now with its count and the first three that need you from any project,
then the project's views and the running nodes under a canvas, and New view at the foot, as a popover. A cold start
opens on Now with the last project back in the sidebar (`LastProject`). Opening a view of another project, from Now,
the palette, a notification or the widget, puts that project in the sidebar.

- The content column shows Now (`PadNowPage`: the cards in two columns, Working and Finished side by side), the
  project's view, All projects (the project cards per machine with their counts), Machines or Recently closed. Each
  has a stack of its own, so a page pushed in one never outlives a switch.
- A view can stand in a second cell beside the first, as in the desktop's split grid: drag its row onto the content
  or pick Open beside in its menu. Each chat cell has its own composer, and a fork opens in the next cell.
- Its bar holds New chat (in this project or in Chats, as a popover), the launches as a popover from the play
  button, Search, and Files and Git, which stand as an inspector beside the content. A file the files inspector
  opens shows in the content column, its row marked.
- A sub-agent opens as an inspector beside its chat, with its conversation and Stop; Open as view gives it the first
  cell, on this iPad only.
- Machines are the list and the machine picked side by side; its Machine settings is one form sheet with the name,
  the icon and the apps with access. Processes is a table sorted by any column, with the signals in a row's menu
  and a warning's actions above it. Devices are a grid, a running one with its live preview.
- When the project's machine stops answering, its card stands in the content and the sidebar stays usable.
- Settings, pairing, Project settings and Compare models are form sheets; Run settings is a popover over the
  composer.

## Views on an iPhone

Every view fills the screen with the same chrome. Back, its title and one menu sit at the top, and at the bottom
the glass that belongs to its kind. A view stands with its content and bar from the first frame of the push; a
terminal or canvas that still waits for its project or session shows a spinner over itself instead of in its place.

- A terminal has a capsule of keys under it with esc, tab, ctrl (held for the next key typed), up, down and the
  keyboard. Up and down follow the cursor mode the program asked for (`TerminalKeys`). A held command waits as a
  prompt of glass above the keys. Font size, theme, reloading and clearing the scrollback are in the menu.
- A canvas has the desktop's dock as two capsules (`CanvasDock`). The first counts what needs you and what works,
  and a tap on the amber count opens the next node that needs you. The second adds a node, fits, and holds the
  locks and the saved layouts. The locks are this phone's, the `locks` of the view in the project's local state. A
  phone only pans and zooms, so it shows those two and keeps move and resize as it read them. Layouts are the
  canvas's own (`layouts`), to apply, delete, or save where every node stands now. The list button in the bar
  shows the nodes as rows. Groups are frames with their title, notes take their color, and a line an agent reads
  along is amber with its label. A group's page lists what lies inside its frame, as the desktop decides it
  (`CanvasEditing.members`).
- A long press on a node opens its menu (`CanvasNodeAction`). Open as view takes a chat, terminal, browser or
  device off the canvas and keeps its session. Link as context draws a line from it into the node that reads it,
  both ways between two agents, and lists the links it has. Group selection puts a frame around the nodes picked,
  on the grid as `groupFrame` draws it. Rename, Snooze (`snooze.set`, chats and terminals) and Delete follow.
- A browser's page runs under the bars, with back, the address and a menu at the bottom as Safari has them. A tap
  on the address edits it.
- A drawing has a tool bar of glass with pen, shape, arrow, text and hand, and the pen color beside it. A second
  tap on the active tool opens its options, with the tools of its sort, the color, the width and snap to the grid
  (stored per phone, as the desktop keeps it per client). Once a Pencil drew on the page, or with Only Draw with
  Apple Pencil on, a finger pans and only the Pencil draws. Undo, selection, zoom and export are in the menu.
- A diagram has zoom beside it and Change with an agent under it. That sends a question with `chat.send` to a new
  chat with one of the machine's agents, placed after the diagram, or to a chat the project has, and names
  `ruimte-context view diagram` and the diagram's file (`DiagramAgentPrompt`). An empty diagram asks what it should
  show, with the same choice of chat and Draw. The chat opens once the question went out.
- A device view, or a device node, finds its device by platform, kind, name and runtime in `device.list`, every
  two seconds while it waits and every five while it shows. A stopped simulator offers Start (`device.boot`). A
  booted one opens with `device.open` as `device.frame` events in JPEG, which is what simulators send. Taps and
  swipes go back as pointer input (`device.input`, with the bottom edge for a swipe home); Home, Back and the app
  switcher sit in a capsule, the other buttons and rotating in the menu. Without input it is a read-only preview.
  A phone or an Android emulator streams video, so the machine refuses the format and the page says it shows on
  the computer only. A device the machine does not have says so, as does one whose screen it cannot capture. When
  the link to the machine drops, the last screen stays dimmed until it is back.

## First run

Three steps (`App/Onboarding`), centered on an iPad as on an iPhone.

- The welcome (`WelcomePage`) shows the light app icon in the desktop's eclipse, with the two ways in: Continue with
  Apple or GitHub, as `/v1/providers` offers them, or Connect directly to your computer with a pairing link. When the
  providers do not load it says so and offers Try again; a failed sign-in is an alert.
- The eclipse (`App/Design/Eclipse.swift`) is the desktop's `ui/Eclipse.tsx` with its seeded stars, colors and
  timings, and stands still under Reduce Motion. On the welcome and on About it is the page's background, edge to
  edge under the bars, centered on the icon as the page scrolls.
- Add a machine (`PairMachinePage`, the same sheet as the plus on Machines) takes a pairing link only, with the steps
  that find one: Settings, Account, Show pairing link in Ruimte on the computer, or `ruimte pair` there. When the
  sheet opens and the clipboard looks like a web address (`detectPatterns`, which asks nothing), it reads the
  clipboard, which is what raises the system's paste prompt, and fills in a pairing link it finds there
  (`PairingClipboard`). The paste button pastes without a prompt. Connect appears once the field holds a link.
- Once a machine is there, the notification step (`NotificationStepPage`) says which machines connected, shows an
  example notification and, on an iPhone, the Live Activity, and asks. Turn on notifications is the same as the
  switch in Settings; Not now skips it. Either answer opens the app on Now. The step follows only a way in taken
  from the welcome (`Onboarding`, kept as `ruimte.ios.onboarding.notifications` until it is answered), so a phone
  set up before it existed is never asked, and an account without machines waits for its first one.

## Settings


Settings (`App/Settings`) is an opaque sheet behind the avatar, at the top of the sidebar on an iPad, with the sections of the desktop's settings that mean something on a phone. The account comes first, with
how it signed in and how many machines the phone reaches; behind it are those machines, Sign out and Delete account.
Then Appearance (theme, terminal font size), Agents, Files and Git (hidden files), Connection diagnostics and About.

- Show replies (word by word, per paragraph or when complete) is one setting for every chat, stored as
  `ruimte.chat.streaming`; the chat's own menu reads and writes the same value.
- Agents on a machine (`MachineAgents.swift`, also under a machine's page) lists its installed CLIs from
  `provider.list` with their accounts from `accounts.list`: version, plan and email, or why an account cannot run. A
  signed-out account offers Sign in again where the machine names a login command, which runs the CLI's own login
  in a terminal there, as on the usage page. Defaults hold this phone's permission mode and a model per chat CLI,
  the picks it already sends with `chat.setPreferences`, and the machine's own switches for resuming after a limit
  and for agents deleting any view (`endpoint.setIdentity`, sending a name nobody chose as null so it stays unchosen).
  Computer Use shows only its state (`computer.status`): turning it on and letting an agent into an app happens on
  the machine itself. Installing a CLI or adding an account does too.
- Notifications and Live Activities: see below.
- About shows the light app icon in the desktop's eclipse, the version and build, the desktop's links, the licenses
  of what the app ships (`App/Design/Lucide-LICENSE.txt`, `App/Resources/package-licenses.txt` for Highlightr,
  highlight.js, SwiftTerm and WebRTC, and `App/Resources/document-renderer-licenses.txt`) and What's new.
- Release notes come from `App/Resources/release-notes.json` in the bundle, never the network. The file names the
  version it was written for; write it anew for a release whose notes change. They show once by themselves, at the
  first launch after an update from a version older than the notes (`ReleaseNotesGate`, which records the version
  each launch). A fresh install shows nothing, and a Debug build (version 0.1.0) is older than any notes, so there
  they only open from About.
- Delete account (App Store guideline 5.1.1(v)) says what goes and asks for the account's name as the address book
  holds it now (`GET /v1/account`), or `DELETE` for an account without one, compared as `confirmsAccountDeletion` in
  `packages/pulsar` does. An account with an Apple identity gets a fresh Sign in with Apple authorization (no scope,
  no nonce) right before `DELETE /v1/account`, and its code goes along as `appleAuthorizationCode`, so the address
  book revokes Sign in with Apple first. A refused name (`confirmation-mismatch`) or a failed revocation
  (`apple-revocation-failed`) deletes nothing and says so; cancelling Apple's sheet sends nothing. After a deletion
  the phone signs out as Sign out does, without trying to revoke push devices the deletion already removed.

## AI conversations

The timeline shows a Working timer, live Thinking text and individual running tools
with summaries, elapsed time and the last output lines. Active labels shimmer; new
words fade in. Show replies in the chat menu picks Word by word, Paragraph by paragraph or When complete.
Reduce Motion shows text directly and keeps static activity labels.

Completed turns fold their work behind a duration label while keeping the answer and
warnings visible. Subagent messages stay under their agent, with a separate result and
links from automatic follow-up turns. Changed files use checkpoint diffs when available,
then provider patches or replacement fragments. Tool output initially shows 4,000
characters; large diffs initially show 400 lines, with explicit expansion controls.

The chat's menu grows from the button at the top right: Plan with its progress, Messages, Bookmarks, then Fork
conversation, Rename (a view by its name, a node by its title, as `titleSource: user`) and Snooze for 10 minutes, an
hour or Tomorrow (the next 09:00 here, sent as an absolute `until` with `snooze.set`; a snoozed chat offers Unsnooze
with its time, kept current by `snooze.changed`), then Show replies and Reload, and Clear conversation last. A machine
without snoozes offers none. Its Messages and Bookmarks lists hang off the screen, not off the toolbar item: a
presentation inside the item went with the item's host whenever the menu opened, which blanked the screen.

The sub-agents chip over the composer opens a menu with a row per sub-agent the chip counts (its title, state and
running time), a Stop for each one that can stop, and All sub-agents. A row opens that conversation; All sub-agents
opens the full list, which the chat menu also offers while no chip stands for it. The list has Active and Done
sections, most recently updated first, each entry with its state, the latest tool call or
reply (or the report a sub-agent handed back) and its running time or end time. An entry, or a
subagent row in the timeline, opens that conversation read-only on its own page; Back returns
one level. A bar over it names the agent's state, time, model, kind, tokens and tool calls, with its task
behind Show task. The chat's composer stays under it with its field switched off, so an approval or a
question the chat asks meanwhile is answered there. Swipe or long-press an active entry to stop a task (after a confirmation that counts
what ends) or mark a sub-agent of the CLI's own as stopped. Long-press the composer's Stop for
Stop with sub-agents. Task marks appear on the nodes a task opened, wake turns say how many
tasks woke them, and a failed task or a wake the machine gave up on leaves an unseen mark.
Once a chat's CLI has two accounts that are on, the composer names the chat's account with its dot beside the
model, and Run settings has an Account section. Before the first turn any account can be picked; after it only
an account that writes its conversations to the same folder, and the others say to fork. Each account shows how
much of its session window is spent and when it resets, from `usage.limits`, amber from 70% and red from 90%.
The account picked there is remembered per machine and CLI: a new chat started here asks for it, and every
connected machine is told it (`accounts` in `chat.setPreferences`) for the chats it starts on its own, unless that
machine turned the account off or removed it.
Model and permission picks are remembered and sent to every connected machine for the chats it
starts on its own. Older machines keep working: requests they do not know are ignored.
A chat whose last turn stopped on a usage limit or an overload says so in a glass card over the composer, with when
the limit resets or when the machine takes the chat up again, and names the account that ran into it. After a usage limit,
another account of the same CLI that is on, signed in and has room (the least of its session spent) is offered in the
card with its window and a Continue on button; `chat.continueOn` goes on in the chat itself or in a fork, which then opens. Accounts the machine has
not read yet are asked for with `usage.refreshLimits`, at most every five minutes per machine. The bar holds the
chat's own Resume at reset switch (`resumeAtReset` in `chat.configure`), which follows the machine's setting from
`endpoint.info` while the chat has none of its own. It only counts while the machine allows it, so with the
machine's setting off it stands off and says where to turn it on.

A chat whose agent keeps a plan offers Plan at the top of the chat menu with its progress ("3 of 5", and New for a
plan made since the chat was last opened); the phone never opens a plan on its own. While the agent works on a step the check turns into a spinning ring. The sheet
is drawn after the desktop plan panel: the chat as its title, a header with the plan's title, kind, counters, status
line and a progress bar, which never move with the agent's progress. While a step is active the toolbar holds its
spinning ring (or the pause once the agent stopped), kept for 1.5 seconds after the step ends so it does not flicker
between steps; a tap scrolls to that step, unfolding or clearing whatever hides it, and cycles through several. The overflow menu holds the filter (All, Open or Issues: failed,
blocked or warning), Collapse done, Expand all and Collapse all, kept on the phone, and Copy as Markdown and Send results to chat. Under the list Show chat goes back and Send results puts the failed,
blocked, warning and info steps with their notes in the chat's draft, as the desktop's plan panel words them, for the
person to send. Sections,
text blocks and steps follow as custom rows with the same Lucide circles, one column per row: a step under a section
lines up with the section's caret and a child sits under its parent's title. A parent shows "2/3" instead of a circle,
and a tap anywhere on a section or parent folds it. Warning (amber) and info (blue) are outcomes like passed. The step the
agent works on spins with an accent background while its turn runs; once the agent stopped it shows a pause and
"<Agent> stopped here". A step a person set shows "you" and the time; who else set a step and a lock's reason sit in
its long-press menu and its VoiceOver value. In a steps plan the circle toggles open and done; in a test plan the
circle opens the outcomes and a swipe gives Passed, Info, Failed, Warning or Skipped; Failed, Warning and Info ask for
a note. Long-press a step for every state, Add note, Unlock and Copy. A chat with several plans switches in the title
menu, newest first. Changes go through `plan.apply`, and a refusal from the machine is shown.
One `plan.list` per connection fills the pills, and `plan.changed` and `plan.removed` keep them current.

Long-press a message you sent, an answer or a turn's duration label for Fork from here. A sheet
asks what the desktop dialog asks: the title, the CLI and model to continue with, a node beside the
original or a view of its own (a chat view always forks into a view), and in a repository a git
worktree on a free branch with the work after the turn undone. The chat menu forks after the
last turn that ended. Once the machine has written the fork into the project, the app opens it. A
fork shows "Fork of <original>" under its title; the title menu and the chat menu say where it began ("Forked after
turn 3, 09:24", the turn counted only once the whole thread is read) and offer Summarize for the original and Show
original. In the original, the summary note shows its first line,
folds the rest open and offers Open fork, and a turn that was forked says so beside its duration.
A machine without these requests says it needs an update and nothing else changes.

With three or more messages, Messages in the chat menu lists what you sent and the turns tasks woke: a
popover on iPad, a sheet on iPhone. It opens scrolled to what is on screen, marks those messages,
searches, jumps on a tap and offers Copy and Fork from here on a long press or a swipe.

Long-press a message you sent or an answer for Bookmark message, which asks for an optional name; a bookmarked
message offers Rename bookmark and Remove bookmark instead. A bookmark stands as a line over its message with its
name or the start of the message. Bookmarks in the chat menu lists them in thread order, the same way as
Messages; a tap jumps there, unfolding the turn or reading earlier pages when needed, and a long press or a swipe
renames or removes. Every client of the chat sees the same bookmarks (`chat.bookmarks`). A machine without
bookmarks says it needs an update.

Messages support nested lists, tasks, quotes, tables, matching code fences and reference
links. Long prompts can fold; mentions and skills retain their styling. Message context
menus copy text or Markdown. File links open the machine's native file viewer, including
line references. Raster attachments and supported image reads show thumbnails; tapping
a thumbnail opens the original through Quick Look.

Text deltas update observable message records without rebuilding the timeline structure.
Completed Markdown segments are cached, code highlighting processes the latest pending
text at bounded intervals, and the collection keeps its existing reading anchors.
History uses an optional 60-item first page. The page before loads by itself once the reader
is within one and a half screens of the top, and goes in when the finger lifts, so the row
being read stays put. A page that fails is asked for again only after the next attach. The daemon
uses a 512 KiB item budget per page; a larger atomic item travels alone, without truncation.
Pending approvals and questions are included separately. Cursors expire after clear/reset,
and history replies apply before the next stream event. Older daemons still return their
full snapshot; the app accepts it and does not issue unsupported history requests.
Pagination becomes live only after the daemon is updated.

Physical iPhone builds were installed at milestones. Visual timing, selection during
streaming, VoiceOver, larger text and iPad multitasking still require hands-on acceptance,
and so do long background runs, network switches and a full round of a push handled on the
Mac. Startup time and memory on the device are unmeasured. Distribution waits on Xcode
Cloud and App Store Connect setup, distribution signing and a first upload; push under a
distribution-signed build is tested there and nowhere else.

## Build locally

From the repository root, with Xcode 27, XcodeGen and Bun installed:

```sh
bun install --frozen-lockfile
bun run --cwd packages/contracts generate:swift
xcodebuild -downloadComponent MetalToolchain
xcodegen generate --spec apps/ios/project.yml
open apps/ios/Ruimte.xcodeproj
```

Set `DEVELOPMENT_TEAM = YOUR_TEAM_ID` in `apps/ios/Signing.xcconfig` to keep your local
team selection across project regeneration. This file is ignored by git and is optional
for simulator builds and CI. Choose the Ruimte scheme and your iPhone or iPad, enable
Developer Mode on the device if requested, and run.
The bundle ID is `app.ruimte.mobile`; the extensions are `app.ruimte.mobile.notifications`
and `app.ruimte.mobile.activity`. The project uses automatic signing. `project.yml` is the
source of the committed Xcode project; regenerate it when adding files or dependencies.
Commit the generated project and resolved packages, excluding user state and build products.
SwiftTerm is pinned to 1.15.0, Highlightr to 2.3.0 and WebRTC to 153.0.0. SwiftTerm's
shader compilation requires Apple's separate Metal Toolchain.

App icons use [LucideSwift](https://github.com/ajaxjiang96/lucide-swift), pinned to
0.9.5 with upstream icons 1.46.0. Project/view glyphs use native SwiftUI paths; toolbar,
menu and status icons use template images generated from the same paths. These images
are cached in the app. Live Activities also use Lucide. System-provided controls keep
their native icons, and provider logos and custom project SVGs remain separate.
The package and upstream ISC notices are in `App/Design/Lucide-LICENSE.txt`; About shows them with the other licenses.

In writing mode the composer is three rows of glass. Over the field sit chips for what the
chat keeps working on beside the thread: its sub-agents, with the state of all of them in one
icon, and the shells and monitors its CLI runs in the background. Each chip opens a menu
with its entries, their time and a Stop for each. The field holds the draft and Send; a running turn
puts a separate Stop beside it, whose menu can also stop the sub-agents. Under the field a
scrolling row of pills: Add (photos, camera, files, mentions, skills, commands and the expanded
editor), the queue while it holds a message, the model, its effort when the model has one, and
the permission mode. The model, effort and permission pills are native menus with a check on the current choice. Their
glass comes from the button style on the `Menu` and not from the label, and the row has no `GlassEffectContainer`, so
each menu grows out of its pill. The model's menu ends with Compare models and Run settings; Run settings is also what
`/model` opens and a VoiceOver action on the model pill. A menu takes the touch as soon as it lands, so there is no
long press beside it: holding the pill and sliding to Run settings is the one gesture.
Run settings holds the account with its session window, the context with its parts (tool output, files read,
conversation, system) when the machine estimates them, the window's size and Compact now, and the model, its options
and the permissions. Compare models reads `GET /v1/models/benchmarks` from the address book on every opening and draws
the Intelligence Index against the cost per task, a line per model with a point per effort and a dashed line through
the points no other beats; a tap on a point gives its values, a tap on a model in the list hides it, and legacy models
come in with a switch. The terms of the numbers allow a chart and not the data, so there is no table and no copy. The
editor grows with the available height and can open in a sheet for longer messages. Typing `@`, `$` or `/` offers
files and project conversations, skills or usable commands at the cursor. There is no microphone in 1.0.

Each machine and chat has a local draft containing text, references, attachments and selection.
Metadata saves after a short debounce; attachment bytes live in separate files. Legacy text
drafts migrate after the first successful save. Offline editing remains available. Imports
show progress and errors before sending, with limits of eight files and 10 MiB combined.
Photos support multiple selection; images can be pasted or dropped, and long pasted text can
be attached as a file. Attachment previews and removal are separate actions.

During a turn, Send adds to the queue and the field says so. The queue sheet can edit, remove or send a waiting
message immediately; sending immediately stops the current turn. Editing merges the queued
message into the current draft. A lost send acknowledgement keeps the draft and asks the
person to check the conversation before retrying, including after reopening the app. Text
and attachments added during a send stay in the composer when that earlier send succeeds.

A pending permission or question takes over the field's glass shape, growing upward from the composer, and the
limit card, the chips, the pills and Stop step aside while it is there. The request stays in place until it is handled, and the next
one takes its place; answering the last request restores the draft, attachments and selection, and the keyboard if
the draft had it. Questions show choices and free text inline, with Previous and Next for a sequence. Only optional
questions can be dismissed. Failed submissions retain their input, and sending disables repeat actions. A long
request scrolls inside the shape, which takes at most about half the screen.
The glass container interpolates between measured composer and prompt heights, anchored at
its bottom edge. The editor stays mounted while its content fades and blurs; a shared action
shape grows from the send circle into the prompt button. The send button remains mounted and
disabled for an empty draft. Prompt actions sit in a bottom
safe-area bar with a soft scroll-edge blur. Reduce Motion switches states directly. Under a sub-agent's
conversation a request takes over the switched-off field the same way.
The shape has a 26-point radius, a capsule while the draft is one line. Its glass answers a touch
like the buttons around it, except while a prompt fills it.
The composer and timeline share a UIKit container anchored to `UIKeyboardLayoutGuide`; with the
keyboard down the composer stands half the bottom safe area up while the timeline runs on behind it.
While a composer is there the timeline ends on the keyboard guide's top, so it never runs under the keyboard.
SwiftUI keyboard avoidance is disabled on that screen so it cannot resize the timeline
ahead of the native keyboard animation. The container measures the composer's inset in
the same layout pass, and again each time the composer's host lays itself out; dragging the keyboard remains
interactive. Following the latest message holds on every idle layout of the timeline, so a field that grows or a
keyboard that moves while you type keeps the last message above the composer. A layout during a drag, a programmatic
scroll or an offset correction leaves the restore to the first idle one.

Current iteration agreement: build and install only on Bas's physical iPhone,
`00008160-000C312926A0000A`. No simulator, UI tests or iPad installation. Targeted
protocol, crypto and state tests run on the Mac. Do not restart the running daemon.

```sh
xcodebuild -project apps/ios/Ruimte.xcodeproj -scheme Ruimte -configuration Debug \
    -destination 'generic/platform=iOS' -derivedDataPath /tmp/ruimte-ios-xcode \
    -allowProvisioningUpdates build
xcrun devicectl device install app --device 00008160-000C312926A0000A \
    /tmp/ruimte-ios-xcode/Build/Products/Debug-iphoneos/Ruimte.app
swift test --package-path apps/ios/Packages/RuimtePulsar --scratch-path /tmp/ruimte-ios-pulsar-build
swift test --package-path apps/ios/Packages/RuimteTransport --scratch-path /tmp/ruimte-ios-transport-build
bun run check
```

A Release build installs the same way, with its own derived data so the two builds do not
overwrite each other's products. Both carry the same bundle ID, so installing one replaces
the other on the device and keeps its data.

```sh
xcodebuild -project apps/ios/Ruimte.xcodeproj -scheme Ruimte -configuration Release \
    -destination 'generic/platform=iOS' -derivedDataPath /tmp/ruimte-ios-xcode-release \
    -allowProvisioningUpdates build
xcrun devicectl device install app --device 00008160-000C312926A0000A \
    /tmp/ruimte-ios-xcode-release/Build/Products/Release-iphoneos/Ruimte.app
```

Release sets `PUSH_ENVIRONMENT: production` while a local development profile grants
`aps-environment: development`, so a locally signed Release build registers against the
wrong APNs environment. Test notifications on a Debug build.

## Native Apple sign-in

Apple uses the system authorization sheet, with no browser callback. The app asks
Pulsar for a one-time nonce and sends Apple's identity token and authorization code
back over HTTPS. Pulsar verifies both tokens for `app.ruimte.mobile` and returns a
short-lived login code. The existing PKCE and device-key exchange creates the session.
Apple and web sign-in resolve the same account when their App ID and Services ID are
grouped in Apple Developer.

Deploy Pulsar's `0007_native_apple.sql` migration and `/v1/apple/start` and
`/v1/apple/complete` routes before installing a build that uses native Apple sign-in.
The app requires the Sign in with Apple capability on its provisioning profile.
There is no automatic web fallback when the native service is unavailable. Existing
GitHub sign-in is unchanged. See the Worker README for the Apple configuration.

## How the connection is built

- `RuimtePulsar` owns the device key, Keychain store, PKCE, address-book API and session
  rotation. Every scene shares the same `SessionVault` and ed25519 key. Keychain items use
  `AfterFirstUnlockThisDeviceOnly` without synchronization. Access tokens stay in memory.
- `RuimteTransport` shares each broker socket by URL and public key, waits for its ICE
  response before gathering, and refreshes expired credentials. One held connection per
  machine serves all scenes. The last release leaves a 30-second grace period; background
  closes links and foreground reconnects those still held. `NWPathMonitor` detects path
  changes. Liveness reads libwebrtc transport packets rather than ping replies.
- Normal ICE selection prefers a usable direct route, as in the existing clients. TURN
  supplies a fallback when direct candidates cannot connect. Relay-only is off by default
  and is available only through the test app's diagnostic switch. That switch holds a link of
  its own (`diagnostic:<machine id>`) and turns off again when its screen closes.
- A machine first admits the device with an account statement. After the pinned channel
  handshake succeeds, the app persists that pairing in local preferences, bound to the
  machine ID and both public keys. Later attempts omit the statement and need no account
  request. A revoked pairing remains a refusal; the app does not silently regain access
  through another statement. Every attempt still verifies the machine key and channel proof.
  The statement goes into the offer as the address book answered it, v2 fields included
  (`machinePublicKey`, `accountId`, `accountSignature`): a machine on an account refuses one
  without them. They stay out of the bytes the signal is signed over, as in the other clients.
- `stasel/WebRTC` is pinned to release `153.0.0`, commit
  `4266157cd08f92115de885ab12d87196a8db87e1`. The native adapter exchanges no audio/video
  tracks and declares no microphone, camera or background-audio capability.
- `packages/contracts/scripts/generate-swift.ts` generates the full daemon request/result/event
  API, JSON schemas, constants and TypeScript fixtures. It also generates the closed vocabularies
  of the daemon's own schemas as Swift enums (agent, task, plan and chat), with the plan markers,
  so a switch over one stops compiling when a case is added; their object schemas stay out, since a
  plan step holds its own sub-steps and the resulting `$ref` is not resolved here.
  `AgentKind`, `RuntimeMode`, `AgentStatus` and the Lucide name of a project, view or machine
  icon are open on the wire. Their API schemas carry `x-open-enum` instead of `enum`, so a value
  from a newer machine passes validation and the app shows a generic name and mark for it. The
  Swift enums stay closed for switches.
  `bun run check` refuses stale output.
  `MachineClient` correlates responses and rejects pending requests on disconnect. It times out
  reads only, since a mutation ends when the link closes. An event it cannot validate goes to
  rejected-event subscribers, and a chat then attaches again, once. It shares subscriptions and
  attachments and reads versioned resources in chunks.
- Required nullable fields, optional fields and optional nullable fields remain distinct.
  `Presence` represents missing, null and value when all three occur. The validator strips
  unknown object keys like Zod. The statement lifetime refinement is an explicit generator
  override because JSON Schema does not preserve Zod refinements.

The web authentication callback is exactly `ruimte://pulsar/callback`, checked with the
pending state before exchange. `/v1/providers` controls the login options; Apple uses
the native token exchange described above. HTTPS pairing links are accepted from the
welcome screen, Machines and Search; redirects are refused to
keep a token on its intended origin. This app contains no local daemon.

## Constraints

- One ed25519 key serves the account session and machine access. There is no separate trusted
  shell process, so no second key as in the desktop app.
- A visible iPad scene keeps held links alive when another scene backgrounds. Once every scene is
  in the background, connections close. No background audio, VoIP or other workaround keeps them.
- `NWPathMonitor` reports path changes only; it does not observe libwebrtc's own sockets.
- Push alerts use AES-256-GCM because the Bun runtime offers no ChaCha20-Poly1305 through
  `node:crypto`.
- The app validates `chat.attach` and `chat.history` whole, so one chat item kind or enum value it
  does not know rejects the conversation. The daemon wire only gains optional fields.
- Simulator Keychain tests need local signing. Unsigned, the Keychain answers -34018 (missing entitlement) and
  they skip.
- CryptoKit's ed25519 signatures differ per call, so fixtures compare message bytes and verify
  signatures rather than comparing them.

## Device checks for Bas

Use a current installed Ruimte on the MacBook, already registered on your Pulsar account.
Keep the MacBook awake and its existing broker/TURN configuration intact. The app does
not change any production infrastructure.

1. **Sign in.** Open the app and continue with an available provider. Cancel once and
   confirm you can retry. Complete login, close the app, then reopen it. The account and
   machine list should return without another browser login. The displayed public key
   should stay the same. Test Apple too when `/v1/providers` includes it.
2. **Wi-Fi.** Leave "Require relay for this test" off and select the MacBook. Record
   `server.hello`, the machine version, "Selected ICE path" and the milliseconds in
   "Connection to server.hello". The acceptance target is below 5,000 ms. The selected
   route may be direct or relay; "Not measured" is not proof of either.
3. **5G.** Turn Wi-Fi off in Settings, keeping mobile data enabled. Wait for the reconnect
   and record the same fields. Repeat five times with the Reconnect button. Record every
   failure as well as the median and slowest successful time.
4. **TURN explicitly.** Enable "Require relay for this test" and reconnect on both Wi-Fi
   and 5G. `server.hello` plus "Via relay" proves the selected candidate uses TURN. A
   successful ordinary connection alone does not. If this fails, record the error and
   network; code availability does not prove the broker has working production TURN
   credentials or that the relay ports are reachable. Turn this setting off afterward.
5. **Background.** While connected, go Home for at least 30 seconds. Return and record the
   new `server.hello` time. Repeat five times, including one lock/unlock. The target is
   below 3,000 ms after foreground. The previous hello disappears when the link closes;
   only a new answer counts. A machine that becomes unreachable should show its error
   and reconnect when its network returns.
6. **Two iPad windows.** Open Ruimte in two windows and select the same machine in both.
   Hide one window while keeping the other visible. The visible connection should stay
   live. Background the whole app, then return. Held windows should share one new
   connection. Disconnecting one window must not disconnect the other.
7. **Statement origin.** On the desktop, open Settings > Remote, open the MacBook and
   inspect Apps with access. Find "Ruimte on iPhone" or "Ruimte on iPad" and compare its
   public key with the test app. The underlying `auth.sessions` result must show
   `origin: "statement"`, not `"link"`. If this device was already paired manually,
   test with a fresh simulator/device key because existing pairings retain their origin.
8. **Path change and cancellation.** Start a connection, disconnect while it is still
   opening, then select it again. No late result from the canceled attempt should replace
   the current attempt. Switch Wi-Fi/5G while connected and verify a new hello arrives.

Keep a row for each attempt:

| Device / OS | Network | Relay required | Selected path | Hello ms | Foreground ms | Result / error |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Local build and unit tests cannot establish production relay reachability, browser
login on a device, scene behavior under iPad multitasking, or reconnect latency on 5G.
Record these measurements separately from the local build and tests. Development does not
wait between phases, but these criteria are not established by simulator success.

## Notifications and Live Activities

Notifications are opt-in, in the last step of the first run or in Settings, and automatically cover agents on every
connected machine; approvals can be enabled independently. The phone chooses the kinds (an agent needs you, a turn finishes,
a process misbehaves) and, per project, All, Needs you only or Off (`NotificationPreferences`). Every machine gets
them with `push.subscribe` as `notify` and `projects`: All is no entry, Needs you only is `['needs-you']` and Off is
an empty list, for that machine's own projects. The settings page asks each connected machine `push.preferences`; a
phone that never chose takes the first answer, and a machine that answers `unknown-request` is named as needing an
update, since it ignores both and notifies only when an agent needs you. A snooze already keeps a view quiet on
every device. The phone registers its APNs token
with the address book and sends its opaque handle, push public key and preferences to
each authenticated machine. Alerts are sent only while the paired key has no connected
client. Older daemons receive a snapshot of known sessions as a compatibility follow list.

Live Activities show one automatic overview per daemon, combining terminal agents and
native chats. The overview counts working agents and agents needing attention, and ends
only when neither remains. Opening another chat does not select or replace the overview.
Several machines can each have an activity; tapping one opens that machine's active
agents. The Worker accepts only the fixed machine-summary collapse ID in automatic mode,
checks account ownership and verifies the signature over the counts as well as routing.
Current and rotated push-to-start/update tokens are uploaded through authenticated
account routes. Opt-out disables remote starts and ends local activities. iPad Live
Activities are outside the current scope. Failed device revocations retain their opaque
handle for retry after local keys are erased.

Notification callbacks are installed in the app delegate before launch finishes. Responses
received before account restoration are queued, and UIKit completion handlers run on the
main thread. On an iPhone a notification switches to Now and opens its chat or terminal in the project that holds
it, found with `project.sidebar`, so the prompt waits in the composer; a node no open project holds opens on its own.
A machine's overview opens Now. On an iPad it opens in the content column, with its project in the sidebar.

An approval notification offers Allow and Deny, and Always allow as well where the push's choices carry `remember`.
A push never carries a question's choices, so a question opens its chat.

Background approval actions are claimed once, then checked against fresh machine state.
An expired or already answered request opens its conversation without sending a decision.
The snapshot check also considers approvals outside the loaded history page.

Alert content uses ephemeral X25519, HKDF-SHA256 and AES-256-GCM. Routing fields are
additional authenticated data, and the machine signs the full envelope with ed25519. The
notification extension verifies the pinned machine key, device handle and validity window,
then claims the message ID under a shared lock before displaying plaintext. The nonce,
key derivation and ciphertext are checked against a generated Bun/CryptoKit fixture.
Live Activity machine names, phases, counts and timing are the intentional plaintext exception.

Required configuration and device acceptance:

1. Enable Push Notifications and Time Sensitive Notifications for `app.ruimte.mobile`.
   Register both extension IDs under the same Apple team. Enable app group
   `group.app.ruimte.mobile` for the app and notification extension, with the shared
   `app.ruimte.mobile.push` Keychain group. Regenerate provisioning profiles.
2. Apply the Worker migrations through `0010_pending_activity_updates.sql` to the intended
   environment. Configure `APNS_SANDBOX_KEY` / `APNS_SANDBOX_KEY_ID` and
   `APNS_PRODUCTION_KEY` / `APNS_PRODUCTION_KEY_ID` with the matching APNs credentials.
   The repository now sets `APNS_TEAM_ID=7RGV9KKX87` and `APNS_TOPIC=app.ruimte.mobile`.
   The key must have APNs rights for that team; the Apple login key is not a substitute.
   Missing configuration produces an explicit `not-configured` response; no credentials are embedded here.
3. Deploy the matching Worker and daemon through the project's normal release process.
   Registration is bound to an active account session. Delivery requires an authorized
   machine on the same account; a manually paired machine outside that account cannot
   use this account's push service.
4. On a signed physical device, enable notifications, follow a live session, background
   the app, and test turn completion and both approval choices. Also test an expired
   request, a desktop answer arriving first, revocation, key loss and the generic fallback.
5. Enable Live Activities and follow a turn. Check phase changes, completion, expiry and
   push-to-start on the Lock Screen and Dynamic Island. Try the same node ID on two
   machines to verify that activity routing stays separate.

On September 16, the production Worker secret-name list contained no APNs entries.
The new Worker configuration and migration have not been deployed. The new daemon code
has not been started; existing sessions were left running. Distribution is deferred.

Production APNs delivery and background success rates require those device tests. Unit
tests inject APNs transport and do not send real notifications.

## Xcode Cloud and TestFlight

The app is an Xcode Cloud product in App Store Connect, built from this repository with
the committed project and `Ruimte.xcodeproj/xcshareddata/xcodecloud/manifest.json`. Its
`Release` workflow starts on every `v*` tag, the tag of a Ruimte release, and archives the
app for TestFlight and the App Store. `ci_scripts/ci_post_clone.sh` sets `MARKETING_VERSION`
from that tag and `CURRENT_PROJECT_VERSION` from `CI_BUILD_NUMBER`, generates the project
and installs the required Metal component, so the app carries the desktop's version. Both are
set in the spec because `agvtool` reads a test target's `GENERATE_INFOPLIST_FILE = YES` as a
plist path and fails. A `Check` workflow builds and tests the app on an iPhone simulator on
main and on pull requests that touch `apps/ios`, `packages/contracts` or `packages/pulsar`.

Onboarding refuses a project whose Swift packages live in repositories the team cannot grant
access to, and every package here is someone else's public repository. The product was made
from a generated project without packages (`project.yml` with the `packages` and every
`- package:` dependency taken out, and `Package.resolved` set aside), after which the real
project was generated again. Workflows are edited through the App Store Connect API.

The repository contains the existing Ruimte Icon Composer icon and a privacy manifest for
local preferences, the shared notification store and elapsed connection timing. Review the archive's aggregated SDK
privacy report and the account service's App Store privacy answers before distribution.
No Apple distribution credentials, APNs credentials, Xcode Cloud workflow or TestFlight
upload is created by a local source build.

Apple references: [custom build scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts),
[first workflow](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow),
[required-reason API declarations](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest).

## Feature acceptance on devices

- Open one project in two iPad windows. Close one, and keep the other chat/terminal live.
  Edit a view name on both clients to exercise conflict resolution; move a node on desktop
  while renaming it on the phone to verify independent changes merge.
- Stream a long chat with tools, images, an approval and a question. Check scrolling,
  keyboard accessibility, draft recovery, reconnect and a 300-line code block.
- Attach to `vim`/`htop`, reconnect, resync and paste multiple lines. Confirm desktop rows
  and columns stay unchanged. Measure the memory and responsiveness of large output.
- Pan a 30-node canvas with 20 edges, rotate the screen, return to the saved camera and
  use VoiceOver/list view. Compare drawing paths and text against desktop.
- Test file watching, image/video previews, Git stage/unstage/commit and confirmed process
  signals against a disposable project before using them on active work.
- In a disposable project: edit a file on the phone while the desktop changes it (the save refuses and keeps the
  edit), delete a file and find it in the machine's Trash, mention a file in a chat that is open and one that is not,
  bind a group to a worktree and start a chat in it on the desktop, and stop a rebase halfway to finish it from the
  Changes segment.
