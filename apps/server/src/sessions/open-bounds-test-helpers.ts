import type { RuntimeMode } from '@ruimte/contracts';
import type { CommandGate } from './manager.ts';

/* Bounds that let every command type, every mode start and every folder be a cwd: only for a test about something else. */
export const OPEN_BOUNDS: {
    commands: CommandGate;
    modeCeiling(nodeId: string): RuntimeMode | null;
    checkCwd(nodeId: string, cwd: string): Promise<void>;
} = {
    commands: {
        approved: () => true,
        approve: () => Promise.resolve()
    },
    modeCeiling: () => null,
    checkCwd: () => Promise.resolve()
};
