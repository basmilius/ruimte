# Chats, forks and plans

## The core and the manager

- `ChatManager` (`chat-manager.ts`) holds a `ChatCore` from `@adecore/agents/chat` as `core` and gives it its hooks; it never extends it. The wiring hands out the core as `agents.chats` and the manager as `agents.chatManager`. Code that reads or drives a chat takes the core; only what Ruimte adds (forks, `findAttachment` with the agent images, the notes of a prompt) goes through the manager. The core writes the task rows (`taskRows` hook, `core.syncTaskRow`) and keeps the cleared ones, and a brief for one prompt travels with the wake or the send (`brief`), never through the manager.
- Plans and agent images are sidecars of the core (`ChatManager` registers them): the core lists, removes and forks them with the bookmarks and visuals, and a fork copies them through `core.copySidecars`.
- The UI fence name is `RUIMTE_UI_FENCE`, handed to the core once in `ChatManager`; notes read it back as `core.uiFence`, and tool text reads the constant.
- What the daemon answers to the chat (depth, mode ceiling, linked context, the project a chat is in) is one required `ChatFacts` object built in `wiring/agents.ts`. A test builds a manager with `testChatManager` (`chat-manager-test-helpers.ts`), whose `quietFacts` answer nothing.
- A change to a chat's start, its UI access or the deletion of its record is a hook of the core (`opening`, `admitUi`, `deleted`), never a method the manager overrides.

## Forks

- A fork (`chat.fork`, `fork.ts`) copies the CLI's conversation at the click: a Claude transcript cut at `native.lastUuid` (format checked against Claude Code 2.1.273, refused otherwise), or Codex `thread/fork` at `native.turnId`.
- Its record is written before its node, and its agent's note waits in `preambles`, never on the wire. Its lineage has `relation: 'fork'`, so ending, capping or orphaning the original never touches it. A fork and its original with no shared canvas read each other through that lineage (`apps/server/src/context/fork-origin.ts`).
- A chat view forks into a chat view after it; a node forks into a node, or with `asView` into a view after its canvas.
- A fork in a worktree puts its files to the turn's settled tree (`checkpointAfter`) only in its new worktree, never in a shared folder.
- A fork into another CLI, or into an account without the original's transcripts, copies no conversation: it gets a handoff preamble (`handoff.ts`) and a mode no wider than the original's. A fork stays on the original's account unless it names another; another CLI starts on its default account.
- A chat on a provider the machine no longer offers forks only as a handoff, which is how it goes on with another provider. A started chat has no other way to change provider.
- A fork's summary is delivered through a `deliver-summary` entry, whose note id `summary-<turnId>` lands once.
- A fork node deleted before anyone wrote in it takes its record and transcript copy along, never its worktree.
- An agent forks only a chat it opened (`agent_fork`), after its last finished turn, on the original's CLI, account and model. That fork is the agent's child (no `relation`, one level deeper, the agent's mode as ceiling): it counts toward depth and the per-caller cap, ends with the agent, and takes work only through `task_new`, whose result wakes the agent once. A hidden agent's fork is hidden too.

## What belongs to a chat

Each of these goes with the chat or a clear, and a fork copies only what its copied turns hold.

- A plan: `$RUIMTE_HOME/chats/<chatId>.plans.json` (`apps/server/src/plans/plan-store.ts`), never a project's. The daemon is its only writer, by item id at the latest rev; an operation on a gone id is refused. An agent never overwrites a status a person set, never removes or retitles a step only a person checks or one a person checked, and never deletes a plan holding such a check. Nothing about a plan wakes an agent or schedules work.
- A bookmark: `$RUIMTE_HOME/chats/<chatId>.bookmarks.json`, on an item of the chat's own thread, never a subagent's. Every change sends the whole list as `chat.bookmarks`.
- A visual: listed in `<chatId>.visuals.json`, each page `attachments/<chatId>/<visualId>.html`, served by id, never inline on the daemon's origin. Only an agent's `visual_show` adds one, to its own chat; a person or agent removes one. A fork also copies those shown until the end of the cut turn. Changes go as `chat.visuals`.
- An attachment an agent adds (`chat_attach`, `src/tools/chat-tools.ts`): the agent names a path, which the daemon reads only inside the project folder, its worktrees, the chat's own folder or the system temp folder. PNG, JPEG, GIF, WebP, HEIC and HEIF up to 10 MiB, binary glTF, USDZ and STL up to 50 MiB, typed by their bytes (`attachment-type.ts`), with no per-chat count limit (`agent-images.ts`), found by id with no index. Only an AI chat attaches, to its own thread.

## Questions and approvals

- A question or approval ends with its turn only when the CLI takes it back (`control_cancel_request`, or a Codex turn completing for a blocking request), when the process goes, or when a person stops the turn.
- One asked by work beside the turns (a background subagent, a workflow member, named in `agent_id`) outlives the turn: it stays pending, the chat reads `needs-you`, and the answer goes back over `control_response`. Optional Codex questions also outlive a successful turn: an answer joins the running turn or starts a new one, and an explicit withdrawal still closes the card.
- A stop declines what the CLI still holds (`declineRequest`), so that work goes on.

## Limits and other accounts

- `chat.continueOn` (`continue-on.ts`) moves a limited chat to another account of its CLI. An account that reads its transcripts takes it over in place and opens a turn at once, refusing with `chat-busy` while the CLI runs background work or waits on a request. Any other account gets a fork cut after the limited turn, whose first turn opens at once.
- Either way the owed `resume-limit` lapses. After a fork the original keeps a note under that turn (`continued-<turnId>`), no longer says it is limited, and no switch turned on later owes that turn a resume there.
- A fork made by Continue on takes the original's work over: its open task (the task's child becomes the fork, whose first turn answers it), the agent that opened it with its depth and ceiling, a place in its group (grown when full) and the lines into it. A chat a person opened, or one an agent on another machine opened, keeps the fork a sibling as before.

## Moving a chat out of Chats

- A chat leaves Chats only through `chat.move` (`apps/server/src/chat/move-chat.ts`). It refuses what the Chats write would end or orphan (`chat/move-refusal.ts`), decided before it makes anything.
- It moves the folder only once the CLI is gone, writes the target before Chats, so a project places the chat at every moment, and rehomes a fork's lineage between the two writes. Each step has an undo. A running move is recorded in `$RUIMTE_HOME/chat-moves` and finished at the next start before the outbox runs (`chat/move-repair.ts`).
- An agent in Chats only proposes that its chat become a project (`project_propose`, `projects/project-proposals.ts`), refused outside Chats. Its card holds the chat at `needs-you`, which the move ignores for that card alone (`wiring/chat-move.ts`), releases before it makes anything, and restores if it fails. Any other wait refuses the move. A decline wakes the chat where it is; a move that ran through while the card stood is the confirm, and wakes the chat in the new project once the note of the move is in it (`src/outbox`).

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A chat moves to another account after a limit only when a person asks, never by itself.
- An idle chat lets go of its CLI process by itself, by Bas's choice (November 13, 2026, basmilius/ruimte#104): after 10 minutes when no client reads it, when it also leaves memory (`CHAT_UNLOAD_AFTER_MS`), and after 30 minutes when a client does (`CHAT_PROCESS_IDLE_MS`, both in `wiring/agents.ts`). The conversation stays and the next message resumes it in a new process. A CLI in a turn, or one that holds a request, a goal, a subagent or a background command, is never ended on a clock.
- Resuming after a limit runs on a clock only when a person turned it on: a machine setting (`resumeAtReset` in `endpoint.json`, off by default) and a chat's own switch beside it, which follows the machine when absent.
- A `resume-limit` outbox entry carries the time: the reset of a usage limit, or 1, 5 and 15 minutes after an overload, after which the overload is an ordinary error. The entry lapses when a person writes first, stops the chat, turns a switch off, or the node goes.
