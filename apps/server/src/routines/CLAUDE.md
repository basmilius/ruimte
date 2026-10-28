# Routines

The `routine-run` entry is in `apps/server/src/outbox/CLAUDE.md`.

- A routine starts an agent with a prompt, a shell command or a project launch, once or on repeat, in one project. It lives in `.ruimte/routines.json` or `.ruimte/private/routines.json`; the private file also keeps a person's account, pause and refusal per routine (`local`). An unreadable entry is written back as it stands.
- Every project in the machine's register runs its routines, open or not; a removed project runs nothing.
- Each routine owes at most one `routine-run`, and the handler rereads the files. A run whose previous one still runs or waits on a person is `skipped`, never queued. Missed times run once on wake as `caught-up`. Resuming owes the next time from now. Daylight saving follows the machine's wall clock: a skipped time runs after the skip, a doubled one once.
- An agent run is a hidden agent chat opened by `routine:<id>`, started through the outbox with the person's mode as ceiling, on no canvas, outliving its routine. Its brief has it publish a result to Output under the routine's output key, or nothing. The daemon marks that version `maker: 'routine'` (`provenanceOf`). A command or launch run delivers its output itself (`Artifacts.deliver`).
- Removing a routine never removes its runs, their chats or its artifact.
- A routine node (kind `routine`) holds only a routine id of its own project (`routine`, the last field of `ProjectNodeSchema`), which travels in the shared file; a private routine's id names nothing for a teammate, and the node says so. An older Ruimte writes it back as `unknown` (`project-split.test.ts`).
- The node draws from the client's routine list. Beside it the canvas draws its newest runs and Output (`apps/client/src/routines/RoutineBeside.tsx`), never written to a project, so a run's chat stays off every canvas.
- `read` of the node prints the routine and its newest runs (`routine-report.ts`). `node new routine --routine` approves nothing.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A routine runs only as a person on this machine approved it as it stands now: its digest (`digestOf`) under `$RUIMTE_HOME/command-approvals`, key `routine:<id>`. A person's `routine.save` approves what it writes. A verb, git, a hand edit or anything else never does, so a change from any of them asks again. An agent's save is narrowed to its own mode ceiling first, and the chat that made it is recorded under `$RUIMTE_HOME/routine-authors` for the approval card.
- A routine runs at most once per due time and once on wake for the times it missed, never beside its previous run, and not while a person paused it. Pausing is how a person stops one.
- A launch routine starts a launch only as an agent would: when a person approved that launch as it stands now.
- An agent reaches routines only through `ruimte-context routine` (`canvas/routine-verb.ts`, `actions/routine-actions.ts`, through `agent-host.ts`). It lists, adds, edits, pauses and resumes its own project's routines. It runs one now only when a person approved it as it stands (`routine-held` otherwise, `routine-busy` while the previous run goes on). Every add or edit goes through `saveByAgent`, so it waits on a person again. No verb approves, declines or removes a routine.
