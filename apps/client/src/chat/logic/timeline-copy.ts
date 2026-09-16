import type { TimelineRow } from '@/chat/logic/timeline';

/*
 * What a row of the thread puts on the clipboard. An answer is markdown on the wire and rendered
 * text on the screen, so copying it as text has to undo the marks the renderer swallowed; the
 * source itself stays available as "Copy as markdown".
 */

/*
 * The marks that only exist to be rendered come off, what they marked stays. `_` is left alone on
 * purpose: it is a letter in half the identifiers an agent writes, and no italic is worth mangling
 * `file_path`.
 */
export const stripMarkdown = (text: string): string =>
    text
        .replace(/^ *```[^\n]*\n?/gm, '')
        .replace(/^ *(#{1,6}) +/gm, '')
        .replace(/^ *> ?/gm, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
        .replace(/\*(?=\S)([^*\n]*\S)\*/g, '$1')
        .replace(/`+([^`]+)`+/g, '$1')
        .trim();

/* What a tool call has to show for itself: what it answered, or what it has answered so far. */
const outputOf = (tool: { output: string | null; progress?: { output: string | null } }): string | null => tool.output ?? tool.progress?.output ?? null;

/* The whole item under the pointer as plain text, or null for a row that carries no message. */
export const messageTextOf = (row: TimelineRow): string | null => {
    switch (row.kind) {
        case 'user':
            return row.item.text || null;
        case 'assistant':
            return stripMarkdown(row.item.text) || null;
        case 'report':
            return stripMarkdown(row.text) || null;
        case 'thinking':
            return row.item.text || null;
        case 'work':
        case 'work-live':
            return outputOf(row.tool);
        case 'work-group': {
            const outputs = row.tools.map(outputOf).filter((output): output is string => output !== null);
            return outputs.length > 0 ? outputs.join('\n\n') : null;
        }
        case 'subagent':
            return row.item.result ?? row.item.summary ?? null;
        case 'note':
            return row.text;
        default:
            return null;
    }
};

/* The markdown an answer was written in; every other row has none to copy. */
export const markdownOf = (row: TimelineRow): string | null =>
    row.kind === 'assistant' ? row.item.text || null : row.kind === 'report' ? row.text || null : null;
