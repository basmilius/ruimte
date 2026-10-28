# Routines

The `routine-run` entry is in `apps/server/src/outbox/CLAUDE.md`.

- A routine starts work once at a set time or on repeat, in one project: an agent with a prompt, a shell command, or a project launch. It lives in `.ruimte/routines.json` (shared) or `.ruimte/private/routines.json`. The private file also keeps what is one person's per routine (`local`): the account, a pause, a refusal. An entry this release cannot read is written back as it stands.
- A routine runs for every project in the machine's register, whether or not a client has it open. A removed project runs nothing.
- Each routine owes at most one `routine-run` entry, due at its next time, and the handler rereads the files from disk. A run whose previous one still runs or waits on a person is recorded as `skipped`, never queued. Times missed while the machine slept or was off run once on wake, as `caught-up`. Resuming owes the next time from now. Daylight saving follows the machine's wall clock: a skipped time runs after the skip, a doubled one runs once.
- An agent run is a hidden agent chat of the project, opened by `routine:<id>` and started through the outbox like `start-agent`, with the person's mode as ceiling. It is on no canvas and outlives its routine. Its brief tells it to publish a result to Output under the routine's output key, and nothing when it has none. The daemon marks a version published from that chat `maker: 'routine'` from its own record (`provenanceOf`). A command or launch run delivers its output itself (`Artifacts.deliver`).
- Removing a routine never removes its runs, their chats or its artifact.
- A routine node (kind `routine`) holds only the id of a routine of its own project (`routine`, the last field of `ProjectNodeSchema`), and that id travels in the shared file. A private routine's id names nothing on a teammate's machine, and the node says so. A Ruimte older than the kind writes it back as `unknown` (`project-split.test.ts`).
- The node draws from the client's routine list and asks the machine nothing. Beside it the canvas draws its newest runs and its Output (`apps/client/src/routines/RoutineBeside.tsx`). That view is never written to a project and is never a node, so a run's chat stays off every canvas.
- `read` of the node prints the routine and its newest runs (`routine-report.ts`). `node new routine --routine` adds one and approves nothing.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A routine runs only as a person on this machine approved it as it stands now: its digest (`digestOf`) under `$RUIMTE_HOME/command-approvals`, key `routine:<id>`. A person's `routine.save` approves what it writes. A verb, git, a hand edit or anything else never does, so a change from any of them asks again. An agent's save is narrowed to its own mode ceiling first, and the chat that made it is recorded under `$RUIMTE_HOME/routine-authors` for the approval card.
- A routine runs at most once per due time and once on wake for the times it missed, never beside its previous run, and not while a person paused it. Pausing is how a person stops one.
- A launch routine starts a launch only as an agent would: when a person approved that launch as it stands now.
- An agent reaches routines only through `ruimte-context routine` (`canvas/routine-verb.ts`, `actions/routine-actions.ts`, through `agent-host.ts`). It lists, adds, edits, pauses and resumes its own project's routines. It runs one now only when a person approved it as it stands (`routine-held` otherwise, `routine-busy` while the previous run goes on). Every add or edit goes through `saveByAgent`, so it waits on a person again. No verb approves, declines or removes a routine.
