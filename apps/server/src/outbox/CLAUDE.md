# The outbox, tasks and lineage

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere.

- The daemon, not a client, starts the agents a verb creates: through a durable entry in `$RUIMTE_HOME/outbox` (`apps/server/src/outbox`) that survives a restart. A running turn is resumed from the outbox too. Session and chat managers create one id at a time.
- Tasks (`apps/server/src/tasks`) settle on the child's result and wake the parent through the outbox, triggered by chat observers, never a clock. The tasks of one `team --task` call (`batchId`) wake it once, when all of them settled. A turn that stopped on a limit (`limit`) is no result: the task pauses (`paused`) and stays open until a later turn of the child answers it.
- Stopping or deleting a node ends its descendants through an `end-children` entry (`apps/server/src/outbox/end-children.ts`); their threads and screens stay.
