type Bundle = Record<string, unknown>;

/* The words of this package, a namespace per surface, which the app adds to its i18next beside its own namespaces. */
export const AGENTS_NAMESPACES = ['agent-chat', 'agent-providers'] as const;

export type AgentsNamespace = (typeof AGENTS_NAMESPACES)[number];

type Files = Record<AgentsNamespace, () => Promise<{ default: Bundle }>>;

const open = async (files: Files): Promise<Record<AgentsNamespace, Bundle>> =>
    Object.fromEntries(await Promise.all(Object.entries(files).map(async ([namespace, file]) => [namespace, (await file()).default]))) as Record<
        AgentsNamespace,
        Bundle
    >;

/* One loader per language that answers every namespace of it, so a bundler splits them and a window only downloads the language it shows. */
export const AGENTS_LOCALES: Record<string, () => Promise<Record<AgentsNamespace, Bundle>>> = {
    en: () =>
        open({
            'agent-chat': () => import('./locales/en/agent-chat.json'),
            'agent-providers': () => import('./locales/en/agent-providers.json')
        }),
    nl: () =>
        open({
            'agent-chat': () => import('./locales/nl/agent-chat.json'),
            'agent-providers': () => import('./locales/nl/agent-providers.json')
        })
};
