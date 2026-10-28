# Chats, forks and plans

## Forks

- A fork (`chat.fork`, `fork.ts`) copies the CLI's conversation at the click: a Claude transcript cut at the turn's `native.lastUuid` (format checked against Claude Code 2.1.273, refused otherwise), or Codex `thread/fork` with `native.turnId`.
- Its record is written before its node, and its agent's note waits in the record's `preambles`, never on the wire. Its lineage entry has `relation: 'fork'`, so ending, capping or orphaning the original never touches it.
- A chat view forks into a chat view right after it; a node forks into a node, or with `asView` into a view after its canvas. A fork and its original with no shared canvas read each other through that lineage entry (`apps/server/src/context/fork-origin.ts`).
- A fork in a worktree puts its files to the tree its turn settled with (`checkpointAfter`) only in its new worktree, never in a shared folder.
- A fork into another CLI, or into an account whose folder lacks the original's transcripts, copies no conversation. It gets a handoff preamble (`handoff.ts`) and a mode no wider than the original's. A fork stays on the original's account unless it names another; a fork into another CLI starts on that CLI's default account.
- A fork's summary is a fork turn with `summaryFor`; `SummaryCoordinator` only owes a `deliver-summary` entry. Its handler draws the line back, then writes the note (id `summary-<turnId>`, so it lands once) and a preamble in the original.
- A fork node deleted before anyone wrote in it takes its record and transcript copy along, never its worktree.
- An agent forks only a chat it opened (`ruimte-context fork`, `forkForAgent`), after its last finished turn, on the original's CLI, account and model. That fork is the agent's child: no `relation`, one level deeper, the agent's mode as ceiling. It counts toward depth and the per-caller cap, ends with the agent, and takes work only through `task new`, whose result wakes the agent once. A hidden agent's fork is a hidden agent of the forking one.

## What belongs to a chat

- A plan belongs to a chat, never a project: `$RUIMTE_HOME/chats/<chatId>.plans.json` (`apps/server/src/plans/plan-store.ts`). It goes with the chat or a clear, and a fork copies it. The daemon is its only writer, applying operations on item ids at the latest rev; an operation whose id is gone is refused. An agent never overwrites a status a person set, never removes or retitles a step only a person checks or one a person checked, and never deletes a plan holding such a check. Nothing about a plan wakes an agent or schedules work.
- A bookmark belongs to a chat: `$RUIMTE_HOME/chats/<chatId>.bookmarks.json` (`@adecore/agents/chat/bookmark-store.ts`), on an item of the chat's own thread, never a subagent's. It goes with the chat or a clear; a fork copies those on the items it copied. Every change sends the whole list as `chat.bookmarks`, and `chat.attach` carries it.
- A visual belongs to a chat: the list in `$RUIMTE_HOME/chats/<chatId>.visuals.json`, each page in `attachments/<chatId>/<visualId>.html` (`@adecore/agents/chat/visual-store.ts`). It is served by id, never inline on the daemon's origin. Only an agent's `visual show` adds one, to its own chat; a person or agent can remove one. It goes with the chat or a clear. A fork copies those its copied turns showed, plus those shown until the end of the cut turn. Every change goes as `chat.visuals`, and `chat.attach` carries the list.
- An image or 3D model an agent attaches belongs to a chat (`ruimte-context chat attach`, `src/canvas/chat-verb.ts`). The agent's own process reads the file; the daemon never opens a path. Accepted: PNG, JPEG, GIF, WebP, HEIC and HEIF (10 MiB each), binary glTF, USDZ and STL (50 MiB each), typed by their bytes (`attachment-type.ts`). They are stored as `attachments/<chatId>/agent-<uuid>~<name>.<ext>` (`agent-images.ts`, 64 per chat) and found by id with no index, so a clear, a deletion or an id-keeping move takes them along; a fork copies them under the same ids. Only an AI chat attaches, to its own thread.

## Questions and approvals

- A question or approval ends with its turn only when the CLI takes it back (`control_cancel_request`, or a Codex turn completing for a blocking request), when the process goes, or when a person stops the turn.
- One asked by work beside the turns (a background subagent, a workflow member; Claude Code 2.1.282 names the agent in `agent_id`) outlives the running turn. It stays pending, the chat reads `needs-you` between turns, and the answer goes back over the same `control_response`.
- Optional Codex questions also outlive a successful turn. An answer joins the running turn or starts a new one in the same chat, and an explicit withdrawal still closes the card.
- A stop declines what the CLI still holds (`declineRequest`), so that work goes on instead of waiting on an answer nobody can give.

## Limits and other accounts

- A chat whose last turn stopped on a limit moves to another account of its CLI only when a person asks (`chat.continueOn`, `continue-on.ts`).
- An account that reads the chat's transcripts (Codex accounts over one home, shadow homes included) takes the chat over in place, as `chat.configure` switches it, and a turn opens at once carrying what the limited turn answered. It refuses with `chat-busy` while the CLI runs background work or waits on a request.
- Any other account gets a fork cut after the limited turn, with the conversation handed over, and its first turn opens at once.
- Either way the original's owed `resume-limit` lapses, so the limited turn is taken up once. After a fork the original keeps a note under that turn (`continued-<turnId>`), and no switch turned on later owes that turn a resume there again.

## Moving a chat out of Chats

- A chat leaves Chats only through `chat.move` (`apps/server/src/projects/move-chat.ts`). It refuses what the Chats write (`onPlaces`) would end or orphan (`projects/move-refusal.ts`), and decides every refusal before it makes a folder, repository or project.
- It changes the chat's folder only once its CLI is gone (`ChatCore.relocate`). It writes the target before Chats, so a project places the chat at every moment, and rehomes a fork's lineage between the two writes.
- Each step has an undo; a failure puts back the ones before it. A running move is recorded in `$RUIMTE_HOME/chat-moves`, and one a stop interrupted is finished at the next start before the outbox runs (`projects/move-repair.ts`).
- An agent in Chats only suggests that its chat become a project (`ruimte-context project propose`, `projects/project-proposals.ts`). The verb makes nothing and refuses outside Chats. Its card holds the chat at `needs-you`, which the move's `working` check ignores for that one card (`wiring/chat-move.ts`). The move releases the hold before it makes anything and restores it if the move fails. Any other wait still refuses the move.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A chat moves to another account after a limit only when a person asks, never by itself.
- Resuming after a limit runs on a clock only when a person turned it on: a machine setting (`resumeAtReset` in `endpoint.json`, off by default) and a chat's own switch beside it, which follows the machine when absent.
- A `resume-limit` outbox entry carries the time: the reset of a usage limit, or 1, 5 and 15 minutes after an overload, after which the overload is an ordinary error. The entry lapses when a person writes first, stops the chat, turns a switch off, or the node goes.
