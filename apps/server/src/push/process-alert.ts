import type { ProcessAlert } from '@ruimte/contracts';

/* The sentence a push carries for a process warning; the panel words the same warning with its own measures. */
export const processAlertBody = (alert: ProcessAlert): string => {
    const name = alert.name ?? 'A process';
    switch (alert.kind) {
        case 'silent':
            return 'Working, but silent for a while.';
        case 'busy-after-turn':
            return `${name} is still busy after its turn ended.`;
        case 'memory':
            return `${name} uses a lot of memory.`;
        case 'agent-gone':
            return `${alert.name ?? 'The agent'} has exited, but still shows as running.`;
        case 'orphan':
            return `${name} is still running after its terminal closed.`;
        case 'probe-hung':
            return `${name}, started by Ruimte, keeps running.`;
    }
};
