# The outbox, tasks and lineage

- The daemon, not a client, starts the agents a verb creates, through a durable entry in `$RUIMTE_HOME/outbox` that survives a restart. Store and worker: `@adecore/agents/outbox`. Ruimte's entry kinds: `outbox/outbox.ts`, handlers beside it. Task handlers: `@adecore/agents/tasks`, bound in `tasks/wiring.ts`. Message handlers: `@adecore/agents/messages`. Lineage and the mode ceiling: `@adecore/agents/lineage.ts` and `modes.ts`. A running turn resumes from the outbox too (`resume-run.ts`). Session and chat managers create one id at a time.
- Chat observers settle tasks (`@adecore/agents/tasks/task-coordinator.ts`), never a clock.
- Entries due later: `resume-limit` (`@adecore/agents/chat/limit-resume.ts`), `background-limit` (`@adecore/agents/tasks/background-limit.ts`), `deliver-waiting` (`@adecore/agents/tasks/waiting-child.ts`), `connect-peer` and `routine-run`.
- `connect-peer` (`remote/connect-peer.ts`) is at most one per machine, target `peer:<machineId>`. Each failure writes a fresh entry with the wait doubled from one minute up to ten, and a restart makes it due at once. It gives up at once when that machine refuses this one's key or statement; another Ruimte version is waited out. Giving up fails the tasks still owed there (`RemoteTasks.giveUp`). An agent that ran there, or whose start may have reached it, is owed a stop, asked once over a link that happens to be open, never opening one (`once`). New work starts a fresh window.
- `routine-run` is written only by `routines/routines.ts`, at most one per routine (target `routine:<projectId>:<routineId>`). It outlives its target, its handler rereads the routine from disk, and one due in the past after a restart runs once as a caught-up run.
- Entries due at once: `deliver-pr-watch`, written only by `github/pr-watch.ts`, opens one turn in the watching chat, which wakes nobody. `run-after-settle`, written only when a worktree chat settles (`launches/after-settle.ts`), starts the project's chosen task there, never twice per turn, and only notes in the chat.
- The outbox timer never waits more than a minute (`wakeful-clock.ts`), so a time that passed during sleep is seen within a minute of waking. Work due later holds no lane.
- While a `resume-limit` is owed, nothing else the outbox owes that chat opens a turn (`@adecore/agents/chat/wake-chat.ts`), since a turn before the reset would hit the same limit.
- The tasks of one `team --task` call (`batchId`) wake the parent once, when all settled. A wake that finds its chat in a turn answers `wait` and runs again when `OutboxWorker.wake` names that chat.
- After a restart a `background-limit` entry is due at once (`restarted`), since its commands went down with the CLI.
- Stopping or deleting a node ends its descendants through an `end-children` entry (`@adecore/agents/tasks/end-children.ts`, bound in `end-children.ts`), written before the node goes; their threads and screens stay. Two openers no project places are no orphans when the project is indexed again: another machine's agent (`peer` on the record) and a Voice session (`openedBy` = `voice:<sessionId>`), whose chat outlives it.
- No observer here settles a task whose child runs on another machine (`machine` on the task). That machine reports it, and `settleFromElsewhere` settles it, waking the parent once. `connect-peer` counts four kinds as owed to the machine:
    - `start-remote-agent` (target the node) waits for the link and a place on the machine; neither ever fails the task. An ended node drops it.
    - `take-remote-result` (target the node) waits for the machine's word, takes in the result and branch, and acknowledges.
    - `stop-remote-agent` (target `peer:<machineId>`) outlives the node, and is owed only for an agent that started (`remote/remote-tasks.ts`).
    - `deliver-remote-result` (target `peer:<machineId>`), on the machine doing the work, stays until the other machine acknowledges.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

### What wakes a chat

- Three things wake a chat, each once. A finished task wakes the chat that delegated it. A message wakes the chat it was sent to. A PR-watch a person turned on for one chat wakes that chat once per terminal check state of the current head, or per new review.
- The wake runs through the outbox; an observer only notes. A message goes one step deep, so the turn it opened wakes nobody, and neither does a PR-watch's turn. A terminal is never woken.

### When a task settles

- A child that stops on a limit pauses its task. The turn says which limit and when it lifts (`limit`, read only from the CLI's own stream), the task stays open with `paused`, and its parent sleeps on until the child finishes after the reset. An overload the daemon does not try again is an ordinary error and fails the task.
- A task settles only once its child is really done. A turn that ends while its CLI still runs background work (a background subagent, a Claude workflow, an agent Codex spawned: `@adecore/agents/chat/background-work.ts`) settles nothing, and the parent is not woken in between.
- The task then settles on the turn the CLI opens by itself once that work ended, on the child's last turn when its CLI opens none (Codex), or on `ruimte-context done`, which works all the while.
- A command or monitor the child's CLI runs in the background (its own or a subagent's, as the chat's `background` shows it) holds the task too, for at most 30 minutes from the moment it is all that is left, since a dev server never ends. That limit is a `background-limit` entry with a time. It survives a restart, runs once, and lapses when the task settles otherwise. When it passes, the task settles on the child's last result, which names the commands that still ran.
- A daemon restart takes the CLI and its commands down. A task only commands held then fails at once with the child's last result and a line naming what was lost, and wakes its parent once, as when the CLI goes within one run.
- Subagents and workflows have no limit.
- An active goal (`/goal`) holds the task the same way, with no limit, through every turn its CLI opens toward it. The task settles once the goal is met, paused or cleared and the turn has ended. It fails with the child's last result when the CLI goes while the goal is still active.

### A child that waits

- A child with a task that waits on a question or an approval leaves its parent one note per request (`deliver-waiting`) and does not wake it. The note is due 15 seconds after the request came and is written only if the request still waits then, so a request settled at once leaves none.
- A child on another machine leaves no such note. Its requests wait on that machine, where a person answers them, and its parent hears only the result.
- A parent may answer a question of a child it opened itself with `ruimte-context answer`, as a person's `chat.answer` does; whoever answers first wins. Approvals, logins and every other card stay with the person.
- A parent may `ruimte-context read` a child it opened itself without a line, by the same lineage.

### Work on a clock

- The daemon schedules work on a clock only for these: a `resume-limit` (`apps/server/src/chat/CLAUDE.md`), a `background-limit`, the end of a snooze (`apps/server/src/push/snoozes.ts`), the poll of a PR-watch (`apps/server/src/github/pr-watch.ts`), the hold on a push while a person is at a desktop (`apps/server/src/push/CLAUDE.md`), the reconnect of a link to another machine while work for it is owed (`apps/server/src/remote/connect-peer.ts`), a routine a person approved at the time it set (`apps/server/src/routines/CLAUDE.md`), and the hourly sweep of expired disposable files (`apps/server/src/maintenance`).
- The sweep runs once at the start and then every hour, only while no agent is in a turn (a terminal never holds it, since a dev server never ends), and never beside its previous pass. It takes only screenshots, unplaced device captures, the computer use helper's captures, the chat store's abandoned temporary writes past the age their writer keeps them, and the PHP server's index caches beyond a 512 MiB budget or of checkouts that vanished, never while a PHP server uses them.
- A PR-watch polls only while a person has one on and backs off while nothing changes. It ends when a person stops the watch or removes the chat (a turn's Stop leaves it), when the pull request is merged or closed, or after 7 days.
- A reconnect backs off while the machine does not answer. It ends when nothing is owed to that machine any more, when a person stops the task or removes the link, or after 7 days. After 7 days every task still owed to that machine fails with a line that says so and wakes its parent once. Leaving the account fails every task owed to a machine at once in the same way.
