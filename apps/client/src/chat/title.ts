import { SUGGESTED_TITLE_LIMIT, type NodeTitleSource } from '@ruimte/contracts';

/*
 * The name a node takes from what its CLI called the session, or null to leave it as it is. A person's
 * name is never replaced; a name the session derived is, since the CLI read the whole exchange. The
 * text is a model's, so it is flattened to one line and capped whatever the machine sent.
 */
export const suggestedTitleFor = (current: { title: string; titleSource?: NodeTitleSource }, suggestion: string | null | undefined): string | null => {
    if (!suggestion || current.titleSource === 'user') {
        return null;
    }
    const title = suggestion.replace(/\s+/g, ' ').trim().slice(0, SUGGESTED_TITLE_LIMIT);
    return title !== '' && title !== current.title ? title : null;
};

/* Past this a title stops being a name and starts being the message it came from. */
const TITLE_LIMIT = 48;

const withoutTail = (text: string): string => text.replace(/[\s.,;:!?]+$/, '');

/*
 * The name a node takes from the prompt that opened it. Only the first line: a prompt that goes on
 * is a message, not a name. A cut lands on a word boundary when there is one worth using, and the
 * punctuation that ended the sentence goes, since a title is not a sentence. Answers null when the
 * prompt leaves nothing readable, so the node keeps the name it has.
 */
export const deriveNodeTitle = (prompt: string): string | null => {
    const line = (prompt.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim();
    if (line === '') {
        return null;
    }
    if (line.length <= TITLE_LIMIT) {
        return withoutTail(line) || null;
    }
    const cut = line.slice(0, TITLE_LIMIT);
    const space = cut.lastIndexOf(' ');
    const head = withoutTail(space > TITLE_LIMIT / 2 ? cut.slice(0, space) : cut);
    return head === '' ? null : `${head}…`;
};
