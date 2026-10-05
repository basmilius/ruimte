import type { LanguageServerKind, LanguageServerState, LanguageServerStatus } from '@ruimte/contracts';

/* The names of the servers are names and stay as they are in every language. */
export const SERVER_NAMES: Record<LanguageServerKind, { name: string; package: string }> = {
    typescript: { name: 'TypeScript', package: 'typescript' },
    vue: { name: 'Vue', package: '@vue/language-server' },
    php: { name: 'PHP', package: 'Intelephense' },
    css: { name: 'CSS', package: 'vscode-langservers-extracted' },
    html: { name: 'HTML', package: 'vscode-langservers-extracted' },
    json: { name: 'JSON', package: 'vscode-langservers-extracted' },
    yaml: { name: 'YAML', package: 'yaml-language-server' },
    python: { name: 'Python', package: 'Pyright' },
    bash: { name: 'Bash', package: 'bash-language-server' },
    docker: { name: 'Dockerfile', package: 'dockerfile-language-server-nodejs' },
    eslint: { name: 'ESLint', package: 'vscode-langservers-extracted' },
    tailwind: { name: 'Tailwind CSS', package: '@tailwindcss/language-server' }
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

/* A catalog server has a name here, one of a person's own carries its name in its status. */
export function nameOf(server: string, statuses: readonly LanguageServerStatus[] = []): string {
    return SERVER_NAMES[server as LanguageServerKind]?.name ?? statuses.find((status) => status.server === server)?.name ?? server;
}

/* What a row says a server is: the package of a catalog server, what a server of a person's own serves. */
export function packageOf(server: string, statuses: readonly LanguageServerStatus[] = []): string {
    const own = statuses.find((status) => status.server === server);
    if (own?.languages !== undefined && own.patterns !== undefined) {
        return [...own.languages, ...own.patterns].join(', ');
    }
    return SERVER_NAMES[server as LanguageServerKind]?.package ?? server;
}

/* Where the Language servers tab lists the servers of the catalog, by what they are for. Anything else lands in the last group. */
export const SERVER_GROUPS = [
    { id: 'scripts', kinds: ['typescript', 'vue', 'eslint'] },
    { id: 'web', kinds: ['html', 'css', 'tailwind'] },
    { id: 'data', kinds: ['json', 'yaml'] },
    { id: 'other', kinds: ['php', 'python', 'bash', 'docker'] }
] as const satisfies readonly { id: string; kinds: readonly LanguageServerKind[] }[];

export type ServerGroupId = (typeof SERVER_GROUPS)[number]['id'];

/* The catalog statuses by group, in the order of the groups, and the servers no group knows with the last. */
export function groupedStatuses(statuses: readonly LanguageServerStatus[]): { id: ServerGroupId; statuses: LanguageServerStatus[] }[] {
    const known = new Set<string>(SERVER_GROUPS.flatMap((group) => group.kinds));
    return SERVER_GROUPS.map((group) => ({
        id: group.id,
        statuses: [
            ...group.kinds.flatMap((kind) => statuses.filter((status) => status.server === kind)),
            ...(group.id === 'other' ? statuses.filter((status) => !known.has(status.server) && !isOwn(status)) : [])
        ]
    })).filter((group) => group.statuses.length > 0);
}

/* A server of a person's own, which the catalog does not name. */
export function isOwn(status: Pick<LanguageServerStatus, 'server'>): boolean {
    return status.server.startsWith('custom:');
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

/* What can be done to a server in this state, and only that. A server of a person's own is never installed. */
export function actionsOf(status: LanguageServerStatus): { install: boolean; restart: boolean; log: boolean } {
    return {
        install: status.state === 'not-installed' && !isOwn(status),
        restart: status.state === 'crashed' || status.state === 'ready' || status.state === 'indexing',
        log: status.state !== 'not-installed' || status.message !== undefined
    };
}

/* The wire's kind of a server named in a status, or null for one this client does not know. */
export function kindOf(server: string): LanguageServerKind | null {
    return server in SERVER_NAMES ? (server as LanguageServerKind) : null;
}
