import type { AgentKind, RuntimeMode } from '@ruimte/contracts';
import { ProviderRegistry } from '../providers/registry.ts';
import type { CommandGate, SessionManagerOptions } from './manager.ts';

let registry: ProviderRegistry | null = null;

/* The providers as the table makes them, built when a test first asks one. */
function shipped(): ProviderRegistry {
    // Codex asks its own help for terminal flags, which a test must not start a process for.
    registry ??= new ProviderRegistry({ commands: { codexHelp: async () => '' } });

    return registry;
}

/* Bounds that let every command type, every mode start and every folder be a cwd: only for a test about something else. */
export const OPEN_BOUNDS: {
    commands: CommandGate;
    modeCeiling(nodeId: string): RuntimeMode | null;
    checkCwd(nodeId: string, cwd: string): Promise<void>;
    providers: SessionManagerOptions['providers'];
} = {
    commands: {
        approved: () => true,
        approve: () => Promise.resolve()
    },
    modeCeiling: () => null,
    checkCwd: () => Promise.resolve(),
    providers: {
        get: (kind: AgentKind) => shipped().get(kind),
        kinds: () => shipped().kinds()
    }
};
