/* Just the part of mdast this plugin touches; the package's own types are not a dependency of the client. */
interface MdastNode {
    type: string;
    value?: string;
    children?: MdastNode[];
    position?: unknown;
}

// Parents whose children are blocks, where a bare text node would stand outside any paragraph.
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);

const literal = (parent: MdastNode): void => {
    if (parent.children === undefined) {
        return;
    }
    const flow = FLOW_PARENTS.has(parent.type);
    parent.children = parent.children.map((child): MdastNode => {
        if (child.type !== 'html') {
            literal(child);
            return child;
        }
        const text = { ...child, type: 'text' };
        return flow ? { type: 'paragraph', position: child.position, children: [text] } : text;
    });
};

/*
 * Raw HTML in a message as the characters a person typed. react-markdown drops an `html` node, so
 * "the <span> element" without backticks would lose the tag. Runs before `remark-breaks`, so the
 * newlines of an HTML block still become line breaks.
 */
export const remarkHtmlAsText = () => (tree: MdastNode) => {
    literal(tree);
};
