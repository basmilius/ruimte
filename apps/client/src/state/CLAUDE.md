# Client state

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere.

- State about a machine is keyed on it: `${endpointId}:${nodeId}` is written only in `apps/client/src/state/keys.ts`. A machine is keyed on the id it mints, never on its address.
- Attention is counted once in `apps/client/src/state/attention.ts`, and `state/agent-work.ts` defines "working". Everything that shows a number reads those. The shell never counts.
