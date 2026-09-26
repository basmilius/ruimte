import { describe, expect, test } from 'bun:test';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { rehypeFadeWords, wordSegments } from './rehype-fade';

interface Rendered {
    type: string;
    key: string | null;
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
    const own = typeof element.type === 'string' ? [{ type: element.type, key: element.key, children: element.props.children }] : [];
    return [...own, ...elementsOf(element.props.children)];
};

const render = (text: string): Rendered[] => elementsOf(ReactMarkdown({ children: text, rehypePlugins: [rehypeFadeWords] }));

const spans = (text: string): { key: string | null; word: ReactNode }[] =>
    render(text)
        .filter((element) => element.type === 'span')
        .map((element) => ({ key: element.key, word: element.children }));

describe('wordSegments', () => {
    test('keeps the whitespace between words as segments of its own', () => {
        expect(wordSegments('Hello  big\nworld ')).toEqual(['Hello', '  ', 'big', '\n', 'world', ' ']);
    });
});

describe('rehypeFadeWords', () => {
    test('wraps every word and leaves code alone', () => {
        const rendered = render('Run `bun test` now.\n\n```\ncode here\n```');
        expect(rendered.filter((element) => element.type === 'span').map((element) => element.children)).toEqual(['Run', 'now.']);
        expect(rendered.find((element) => element.type === 'code' && element.children === 'bun test')).toBeDefined();
        expect(rendered.find((element) => element.type === 'code' && element.children === 'code here\n')).toBeDefined();
    });

    test('the spans already there keep their keys when more text arrives', () => {
        const before = spans('Hello **bold** wor');
        const after = spans('Hello **bold** world, and more text');
        expect(after.slice(0, before.length - 1)).toEqual(before.slice(0, -1));
        expect(after[before.length - 1]!.key).toBe(before.at(-1)!.key);
    });
});
