# Agent verbs

`ruimte-context help` is the reference for every verb.

- `verbs.ts` is the one registry: the parser dispatches from it and `help` renders from it. No aliases for old spellings. A refusal is a 422 whose first line is `refused\t<code>\t<message>`, followed only by what that same call would accept.
- The action handlers (`src/actions`, catalog from `@ruimte/actions`) enforce what a verb checks, so a person, Voice and an agent meet the same checks. Selectors are ids, never titles. Every write goes through `ProjectStore.mutate`.
- Depth and the per-caller count live in the lineage under `$RUIMTE_HOME/lineage` (`depth.ts`), never on the node. A person's node is depth 0; `agent` opens up to depth 2 and `team` up to depth 1. One caller holds at most `MAX_OPENED_PER_CALLER` agent nodes at a time.
- `fork` takes only a chat the caller opened, and the fork is its child under the same depth, count and mode ceiling as an `agent` child (`src/actions/fork-actions.ts`).
- `task new` gives work only to an agent the caller opened, read from the lineage, never from a canvas line, since lines can run both ways and lineage is a tree.
- The mode ceiling (`mode.ts`) is read when the verb runs, carried on the `start-agent` entry and the lineage record, and applied again by `SessionManager.create` and `ChatManager.create` at every start. A terminal agent no agent opened keeps the mode a person's save gave it (`src/sessions/mode-approvals.ts`), or `supervised` with no client to say otherwise.
- Every start of a node an agent made checks its folder again (`startCwdGuard` in `project-paths.ts`), since a checked path may since have become a symlink.
- A first prompt never reaches `project.json`. It waits in `$RUIMTE_HOME/prompts/<nodeId>.json` and is delivered once when the session or chat is made (`src/agents/pending-prompts.ts`). It is capped, because a terminal agent's prompt rides on the launch line, which the tty cuts off silently.
- A view's maker is `createdBy` in the shared file; a node's maker is in the lineage. Delete verbs remove only what the caller made, unless the machine's `agentsDeleteAnyView` allows more, and never the caller's own node or view. A terminal or chat node ends before the write.
- A verb never approves a command, launch, routine or mode. It sets a command only in a routine or launch, which then waits for a person's approval. `--dry-run` runs every check under the write's lock and writes nothing; a verb that cannot preview refuses the flag by name.
- A verb into a feature follows that feature's rules, beside its code: `launch-verb.ts` (`src/launches`), `routine-verb.ts` (`src/routines`), `browser-verb.ts` (`src/browser`), `device-verb.ts` (`src/devices`), `computer-verb.ts` (`src/computer`) and `database-verb.ts` (`src/database`).
- No verb reads, writes in or operates a node bound to another machine (`ProjectStore.machineOfNode`). `read`, `node edit`, `node color`, `device`, `browser`, `link new` and `notify` refuse it with `node-on-other-machine` (`remote-node.ts`).
- `--machine` on `agent` and `team` gives a task to an agent on a machine the project is linked to and this machine can work in (else `machine-not-linked`). It needs `--task` and refuses `--cwd`, `--reads`, `--model`, `--effort` and `--base`. The node goes on a private canvas only, bound through `ProjectMutation.bindMachines`, with no line to it. Ceiling and depth ride on the `start-remote-agent` entry, and that machine takes the narrowest of them and its own link's bounds (`remote-agent.ts`, `remote/remote-tasks.ts`). `task new` to such a node refuses with `task-on-other-machine`.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- A node on a canvas reads, writes in and operates another node only over a line or a `#` reference, and keeps to them exactly.
- A chat reads and writes in every view or node of its project a person referenced with `#` in one of its messages, as along a line (`apps/server/src/context/references.ts`). The reference is checked again at every call, so one that went or left the project is closed again.
- A referenced terminal stays read-only: no agent types into it, and `notify` reaches it as along a line. A referenced chat gets `notify` and never `task new`. A `#` to a whole canvas reads everything on it and adds nodes, but writes only in a node with a `#` or a line of its own. Every other node still needs a line.
- An AI chat that is a view of its own arranges a canvas the way a person does (`chat-view.ts`). No line can run to a view, so with `--view <canvas>` it adds, edits, renames, arranges and groups that canvas's nodes, draws lines between them, and reads and operates every node there without a line (`read`, `node edit`, `browser`, `device`). A node it adds gets no line to it. Without `--view` those refuse with `view-required`.
- The rest holds for a chat view too. It never types into or closes another session, and the mode ceiling, `--cwd`, launch approvals and the database and computer use grants keep their own checks.
