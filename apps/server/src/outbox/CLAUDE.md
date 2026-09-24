# The outbox, tasks and lineage

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere.

- The daemon, not a client, starts the agents a verb creates: through a durable entry in `$RUIMTE_HOME/outbox` (`apps/server/src/outbox`) that survives a restart. A running turn is resumed from the outbox too. Session and chat managers create one id at a time.
- Tasks (`apps/server/src/tasks`) settle on the child's result and wake the parent through the outbox, triggered by chat observers, never a clock. The one exception is `resume-limit` (`chat/limit-resume.ts`): an entry with a `notBefore` in the future that takes a chat up again after a usage limit resets or an overload passed, owed only while the machine's and the chat's `resumeAtReset` allow it. Work due later holds no lane, so nothing owed after it waits for it, and its handler opens a turn only while the limited turn is still the chat's last. The tasks of one `team --task` call (`batchId`) wake it once, when all of them settled. A turn that stopped on a limit (`limit`) is no result: the task pauses (`paused`) and stays open until a later turn of the child answers it.
- Stopping or deleting a node ends its descendants through an `end-children` entry (`apps/server/src/outbox/end-children.ts`); their threads and screens stay.
