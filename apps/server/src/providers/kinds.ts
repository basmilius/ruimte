/*
 * The agent CLIs this daemon offers, then the API providers, in the order every menu lists them. Apart from
 * the providers so a note or a verb can name them at load without importing every backend.
 */
export const BUILT_IN_KINDS = ['claude', 'codex', 'antigravity', 'copilot', 'grok', 'nanogpt', 'anthropic-claude-api'] as const;

/* Whether this daemon ships this kind; a node may still name one it dropped (`gemini`) or never knew. */
export function offersKind(kind: string): boolean {
    return (BUILT_IN_KINDS as readonly string[]).includes(kind);
}
