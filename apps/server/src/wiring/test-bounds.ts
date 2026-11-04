import type { AgentBounds } from './agent-bounds.ts';

/* Bounds that let every command type, every mode start and every folder be a cwd: only for a test about something else. */
export const OPEN_BOUNDS: AgentBounds = {
    commands: {
        approved: () => true,
        approve: () => Promise.resolve()
    },
    modeCeiling: () => null,
    checkCwd: () => Promise.resolve()
};
