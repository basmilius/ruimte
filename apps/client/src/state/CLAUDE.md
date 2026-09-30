# Client state

The invariants of this folder. The repository root's `CLAUDE.md` has the map, the wire protocol and the rules that hold everywhere.

- State about a machine is keyed on it: `${endpointId}:${nodeId}` is written only in `apps/client/src/state/keys.ts`. A machine is keyed on the id it mints, never on its address.
- Attention is counted once in `apps/client/src/state/attention.ts`, and `state/agent-work.ts` defines "working". Everything that shows a number reads those. The shell never counts.
- Every window is a page of one origin and shares `localStorage` with the others. A key a person means for the whole app (the machines, the settings, the theme) is read again when another window writes it (`state/shared-storage.ts`); a new key of that kind joins the list there. What a window keeps for itself (the open view, the camera, the panels) stays per page.
