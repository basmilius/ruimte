import { SUGGESTED_TITLE_LIMIT } from '@adecore/agent-contracts/agent';
import type { NodeTitleSource } from './project.ts';
import { clipText } from './text.ts';

/* Past this a title stops being a name and starts being the message it came from. */
const TITLE_LIMIT = 48;

/* A name a person typed stays; one a session or a prompt derived is replaced by a later, better one. */
export function mayReplaceTitle(source: NodeTitleSource | undefined): boolean {
    return source !== 'user';
}

/*
 * The name a node takes from what its CLI called the session, or null to leave it as it is. The text is a
 * model's, so it is flattened to one line and capped whatever the machine sent.
 */
export function suggestedTitleFor(current: { title: string; titleSource?: NodeTitleSource }, suggestion: string | null | undefined): string | null {
    if (!suggestion || !mayReplaceTitle(current.titleSource)) {
        return null;
    }
    const title = clipText(suggestion.replace(/\s+/g, ' ').trim(), SUGGESTED_TITLE_LIMIT);
    return title !== '' && title !== current.title ? title : null;
}

function withoutTail(text: string): string {
    return text.replace(/[\s.,;:!?]+$/, '');
}

/*
 * The name a node or a task takes from the first line of the prompt that opened it, cut on a word boundary
 * when one is worth using and without the closing punctuation. Null leaves the node the name it has.
 */
export function deriveNodeTitle(prompt: string): string | null {
    const line = (prompt.split('\n').find((candidate) => candidate.trim() !== '') ?? '').replace(/\s+/g, ' ').trim();
    if (line === '') {
        return null;
    }
    if (line.length <= TITLE_LIMIT) {
        return withoutTail(line) || null;
    }
    const cut = clipText(line, TITLE_LIMIT);
    const space = cut.lastIndexOf(' ');
    const head = withoutTail(space > TITLE_LIMIT / 2 ? cut.slice(0, space) : cut);
    return head === '' ? null : `${head}…`;
}
