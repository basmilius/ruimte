import { describe, expect, test } from 'bun:test';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { remarkHtmlAsText } from '@/chat/ui/remark-html-as-text';

interface Rendered {
    type: string;
    children: ReactNode;
}

/* The elements react-markdown hands React, flattened, without rendering them into a DOM. */
const elementsOf = (node: ReactNode): Rendered[] => {
    if (Array.isArray(node)) {
        return node.flatMap(elementsOf);
    }
    if (!isValidElement(node)) {
        return [];
    }
    const element = node as ReactElement<{ children?: ReactNode }>;
    const own = typeof element.type === 'string' ? [{ type: element.type, children: element.props.children }] : [];
    return [...own, ...elementsOf(element.props.children)];
};

/* Every string under a node, in order. */
const textOf = (node: ReactNode): string => {
    if (typeof node === 'string') {
        return node;
    }
    if (Array.isArray(node)) {
        return node.map(textOf).join('');
    }
    if (isValidElement(node)) {
        return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
    }
    return '';
};

const render = (text: string): ReactNode => ReactMarkdown({ children: text, remarkPlugins: [remarkGfm, remarkHtmlAsText, remarkBreaks] });

describe('remarkHtmlAsText', () => {
    test('keeps an inline tag as the text a person typed', () => {
        const rendered = render('Look at the <span> element');
        expect(textOf(rendered)).toBe('Look at the <span> element');
        expect(elementsOf(rendered).some((element) => element.type === 'span')).toBe(false);
    });

    test('leaves a tag in inline code to the code', () => {
        const code = elementsOf(render('Look at `<span>` here')).find((element) => element.type === 'code');
        expect(code?.children).toBe('<span>');
    });

    test('puts an HTML block in a paragraph with its line breaks', () => {
        const elements = elementsOf(render('<div>\nhello\n</div>'));
        const paragraph = elements.find((element) => element.type === 'p');
        expect(paragraph).toBeDefined();
        expect(textOf(paragraph!.children)).toBe('<div>\nhello\n</div>');
        expect(elements.filter((element) => element.type === 'br')).toHaveLength(2);
    });

    test('keeps a comment as text', () => {
        expect(textOf(render('before <!-- note --> after'))).toBe('before <!-- note --> after');
    });
});
