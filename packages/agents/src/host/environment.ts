/*
 * What a Ruimte terminal hands its shell. An app started from one inherits them, and its CLIs would
 * then post their hooks and run their verbs against that terminal's daemon.
 */
export const RUIMTE_SESSION_VARIABLES = ['RUIMTE_HOOK_URL', 'RUIMTE_HOOK_TOKEN', 'RUIMTE_CONTEXT_URL', 'RUIMTE_CONTEXT_TOKEN', 'RUIMTE_SESSION_ID'] as const;

// Every hook and context variable, including ones a later version of Ruimte adds.
const RUIMTE_SESSION_PREFIXES = ['RUIMTE_HOOK_', 'RUIMTE_CONTEXT_'];

const inherited = (name: string): boolean =>
    (RUIMTE_SESSION_VARIABLES as readonly string[]).includes(name) || RUIMTE_SESSION_PREFIXES.some((prefix) => name.startsWith(prefix));

/* The environment a host starts its CLIs in: its own, without a Ruimte session it may have been started from. */
export const cliEnvironment = (env: Record<string, string | undefined> = process.env): Record<string, string> => {
    const clean: Record<string, string> = {};
    for (const [name, value] of Object.entries(env)) {
        if (value !== undefined && !inherited(name)) {
            clean[name] = value;
        }
    }
    return clean;
};
