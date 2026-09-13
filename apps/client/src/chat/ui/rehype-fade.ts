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

export const FADE_CLASS = 'chat-fade';

// Code is read as one string by the renderer, so a span inside it would come out as "[object Object]".
const SKIPPED = new Set(['code', 'pre']);

const WHITESPACE = /^\s+$/;

/* A text cut into its words and the whitespace between them, in order. */
export const wordSegments = (text: string): string[] => text.split(/(\s+)/).filter((segment) => segment !== '');

export const isWhitespace = (segment: string): boolean => WHITESPACE.test(segment);

const wrap = (parent: HastParent): void => {
    parent.children = parent.children.flatMap((child): HastNode[] => {
        if (child.type === 'text') {
            return wordSegments(child.value).map((segment) =>
                isWhitespace(segment)
                    ? { type: 'text', value: segment }
                    : { type: 'element', tagName: 'span', properties: { className: [FADE_CLASS] }, children: [{ type: 'text', value: segment }] }
            );
        }
        if (child.type === 'element' && !SKIPPED.has(child.tagName)) {
            wrap(child);
        }
        return [child];
    });
};

/*
 * Every word of a reply that is still streaming in a span that fades in. Words only ever arrive at
 * the end, and the renderer keys a span by its place among the spans beside it, so the spans already
 * on screen keep their element and their fade does not start again.
 */
export const rehypeFadeWords = () => (tree: HastParent) => {
    wrap(tree);
};
