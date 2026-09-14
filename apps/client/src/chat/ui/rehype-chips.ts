import { chipText, tokenizeChips, type ChipSegment } from '@/chat/mentions';

/* Just the part of hast this plugin touches; the package's own types are not a dependency of the client. */
interface HastText {
    type: 'text';
    value: string;
}

interface HastElement {
    type: 'element';
    tagName: string;
    properties: Record<string, unknown>;
    children: HastNode[];
}

type HastNode = HastText | HastElement | { type: 'comment' | 'doctype' | 'raw'; value?: string };

interface HastParent {
    children: HastNode[];
}

export interface ChipOptions {
    mentions?: string[];
    skills?: string[];
}

// Inline code overrules a chip: `@a.ts` between backticks is code, not a mention.
const SKIPPED = new Set(['code', 'pre']);

/* A chip as an element: the renderer reads `data-chip` and `data-value`, the text keeps the sigil. */
const chipElement = (segment: Exclude<ChipSegment, { kind: 'text' }>): HastElement => ({
    type: 'element',
    tagName: 'span',
    properties: { dataChip: segment.kind, dataValue: segment.kind === 'mention' ? segment.path : segment.name },
    children: [{ type: 'text', value: chipText(segment) }]
});

const split = (parent: HastParent, mentions: string[], skills: string[]): void => {
    parent.children = parent.children.flatMap((child): HastNode[] => {
        if (child.type === 'text') {
            return tokenizeChips(child.value, mentions, skills).map((segment) =>
                segment.kind === 'text' ? { type: 'text', value: segment.text } : chipElement(segment)
            );
        }
        if (child.type === 'element' && !SKIPPED.has(child.tagName)) {
            split(child, mentions, skills);
        }
        return [child];
    });
};

/* The `@path` and `$name` tokens a person picked in the composer, cut out of the text as chips. */
export const rehypeChips =
    ({ mentions = [], skills = [] }: ChipOptions = {}) =>
    (tree: HastParent) => {
        if (mentions.length === 0 && skills.length === 0) {
            return;
        }
        split(tree, mentions, skills);
    };
