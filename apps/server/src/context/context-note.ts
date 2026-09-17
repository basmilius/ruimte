import type { ContextSource } from '@ruimte/contracts';
import { MAX_AGENT_DEPTH, MAX_TEAM_DEPTH } from '../canvas/depth.ts';

const doesAt = (depth: number): string => {
    if (depth < MAX_TEAM_DEPTH) {
        return 'reads context linked to you, places nodes on the canvas and opens agents (`agent` for one, `team` for several in parallel)';
    }
    if (depth < MAX_AGENT_DEPTH) {
        return 'reads context linked to you, places nodes on the canvas and opens a helper agent with `agent`';
    }
    return 'reads context linked to you and places nodes on the canvas';
};

/*
 * Said once to every agent, linked or not, so it knows the verbs exist before anyone links a thing.
 * Never a skill file or instruction block in anyone's `$HOME`: a copy per CLI and per SSH host goes
 * stale unnoticed, while this sentence travels with the daemon and `help` renders from the registry.
 * Every agent reads it every session, so it names only what saves a call: the verbs its depth may
 * still open agents with, the help that gives their flags, and that a task answers by itself.
 */
export const verbsNote = ({ depth }: { depth: number }): string => {
    const parts = [
        `Ruimte: \`ruimte-context\` ${doesAt(depth)}.`,
        '`ruimte-context help <verb>` gives the flags of one verb and `ruimte-context help` lists them all.'
    ];
    if (depth < MAX_AGENT_DEPTH) {
        parts.push('With `--task` a result comes back as your next message once it settles, so end your turn instead of polling.');
    }
    parts.push('Ids in its output are for your commands; to the person, name things by their title, never by id.');
    return parts.join(' ');
};

export const CONTEXT_PROMPT =
    'The person linked context to this chat on their canvas. Run `ruimte-context` to list it and `ruimte-context read <id>` to read one item, whenever it could help.';

/*
 * What an agent is told once at the start of a chat process, so it knows the CLI without being
 * nagged every turn. Claude Code takes it as a system prompt and Codex as a thread's developer instructions.
 */
export const chatPrompt = ({ hasContext, depth }: { hasContext: boolean; depth: number }): string => {
    const note = verbsNote({ depth });
    return hasContext ? `${note} ${CONTEXT_PROMPT}` : note;
};

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
 * What Claude Code's hooks fold into the model's context. `SessionStart` always carries the verbs,
 * once per CLI life; a prompt only hears about links, so a turn is never nagged. `turn` is what
 * only this turn has to hear: a line drawn while the agent was running, and any message another
 * node left for it. A SessionStart is handed the whole list of links anyway, so a change note has
 * nothing to add there; a message does, since it may have been waiting since before the CLI started.
 */
export const hookContext = (
    event: string,
    sources: ContextSource[],
    turn: { changed?: string | null; messages?: readonly string[]; depth?: number } = {}
): string | null => {
    const start = event === 'SessionStart';
    const hint = contextHint(sources);
    const parts = [
        ...(start ? [verbsNote({ depth: turn.depth ?? 0 })] : []),
        ...(hint === null ? [] : [hint]),
        ...(start || !turn.changed ? [] : [turn.changed]),
        ...(turn.messages ?? [])
    ];
    return parts.length === 0 ? null : parts.join(' ');
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
