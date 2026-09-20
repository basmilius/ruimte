# Transport

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere.

- A link to a machine opens only for a hold (`transport/workspace-hold.ts`, `ensureMachine`, an open machine dialog or usage page) and closes 30 s after the last one. Nothing else may open one: not lists, status dots, auto-registration or limit bars. Clients sit on `machineTransport(id)`, which never opens a link.
