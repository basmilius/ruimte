import type { ContextSource } from '@ruimte/contracts';

// Past this many, a busy canvas would flood a prompt line; the rest becomes a count.
const MAX_NAMED = 5;

const quote = (source: ContextSource): string => `"${source.title}" (${source.kind})`;

const nameSources = (sources: ContextSource[]): string => {
    const named = sources.slice(0, MAX_NAMED).map(quote);
    const rest = sources.length - named.length;
    return rest > 0 ? `${named.join(', ')} and ${rest} more` : named.join(', ');
};

/*
 * One line that tells an agent the linked context exists and how to read it. Shown above a
 * shell's first prompt and returned to Claude Code's prompt hooks, where the agent has no
 * system prompt of ours. Null without links, so a plain shell stays quiet.
 */
export const contextHint = (sources: ContextSource[]): string | null => {
    if (sources.length === 0) {
        return null;
    }
    return `Ruimte: linked context is available with ruimte-context (list, read <id>): ${nameSources(sources)}.`;
};

/*
 * What an agent that already knows the CLI must hear at the start of its next turn: which
 * links came and went since the previous one. Null when the set is the same, so a chat is
 * never nagged. Sources are matched by id; a renamed one is not a change.
 */
export const contextChangeNote = (previous: ContextSource[], current: ContextSource[]): string | null => {
    const before = new Set(previous.map((source) => source.id));
    const after = new Set(current.map((source) => source.id));
    const added = current.filter((source) => !before.has(source.id));
    const removed = previous.filter((source) => !after.has(source.id));
    if (added.length === 0 && removed.length === 0) {
        return null;
    }
    const parts = ['Ruimte: the linked context changed since your last turn.'];
    if (added.length > 0) {
        parts.push(`Added: ${nameSources(added)}.`);
    }
    if (removed.length > 0) {
        parts.push(`Removed: ${nameSources(removed)}.`);
    }
    parts.push(current.length === 0 ? 'Nothing is linked now.' : 'Run `ruimte-context` to list it and `ruimte-context read <id>` to read one item.');
    return parts.join(' ');
};
