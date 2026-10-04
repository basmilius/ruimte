import type { LanguageServerKind, LanguageServerState, LanguageServerStatus } from '@ruimte/contracts';

/* The names of the servers are names and stay as they are in every language. */
export const SERVER_NAMES: Record<LanguageServerKind, { name: string; package: string }> = {
    typescript: { name: 'TypeScript', package: 'typescript-language-server' },
    vue: { name: 'Vue', package: '@vue/language-server' },
    php: { name: 'PHP', package: 'Intelephense' }
};

export type ServerTone = 'ok' | 'busy' | 'error' | 'idle';

export function toneOf(state: LanguageServerState): ServerTone {
    switch (state) {
        case 'ready':
            return 'ok';
        case 'indexing':
        case 'starting':
        case 'installing':
            return 'busy';
        case 'crashed':
            return 'error';
        default:
            return 'idle';
    }
}

export function nameOf(server: string): string {
    return SERVER_NAMES[server as LanguageServerKind]?.name ?? server;
}

export function packageOf(server: string): string {
    return SERVER_NAMES[server as LanguageServerKind]?.package ?? server;
}

/* Whether a server does something a person would want to see, as opposed to one that only could be installed. */
function isActive(state: LanguageServerState): boolean {
    return state !== 'not-installed' && state !== 'stopped';
}

/* The servers the status popover lists: the ones that serve the open file, and any other that is up or has failed. */
export function listedServers(statuses: readonly LanguageServerStatus[], serving: readonly string[]): LanguageServerStatus[] {
    return statuses.filter((status) => serving.includes(status.server) || isActive(status.state));
}

/* The one a file's chip reports: the first server that serves it, or any that is up. */
export function chipServer(statuses: readonly LanguageServerStatus[], serving: readonly string[]): LanguageServerStatus | null {
    for (const server of serving) {
        const found = statuses.find((status) => status.server === server);
        if (found) {
            return found;
        }
    }
    return statuses.find((status) => isActive(status.state)) ?? null;
}

/* What can be done to a server in this state, and only that. */
export function actionsOf(status: LanguageServerStatus): { install: boolean; restart: boolean; log: boolean } {
    return {
        install: status.state === 'not-installed',
        restart: status.state === 'crashed' || status.state === 'ready' || status.state === 'indexing',
        log: status.state !== 'not-installed' || status.message !== undefined
    };
}

/* The wire's kind of a server named in a status, or null for one this client does not know. */
export function kindOf(server: string): LanguageServerKind | null {
    return server in SERVER_NAMES ? (server as LanguageServerKind) : null;
}
