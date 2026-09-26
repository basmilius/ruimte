import { describe, expect, test } from 'bun:test';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { rehypeChips, type ChipOptions } from './rehype-chips';

interface Rendered {
    type: string;
    props: { children?: ReactNode; 'data-chip'?: string; 'data-value'?: string };
}

/* The elements react-markdown hands React, flattened, without rendering them into a DOM. */
const elementsOf = (node: ReactNode): Rendered[] => {
    if (Array.isArray(node)) {
        return node.flatMap(elementsOf);
    }
    if (!isValidElement(node)) {
        return [];
    }
    const element = node as ReactElement<Rendered['props']>;
    const own = typeof element.type === 'string' ? [{ type: element.type, props: element.props }] : [];
    return [...own, ...elementsOf(element.props.children)];
};

const chips = (text: string, options: ChipOptions): { chip?: string; value?: string; text: ReactNode }[] =>
    elementsOf(ReactMarkdown({ children: text, rehypePlugins: [[rehypeChips, options]] }))
        .filter((element) => element.props['data-chip'] !== undefined)
        .map((element) => ({ chip: element.props['data-chip'], value: element.props['data-value'], text: element.props.children }));

describe('rehypeChips', () => {
    test('cuts the picked mentions and skills out of the text', () => {
        expect(chips('Open @src/a.ts, then run $review.', { mentions: ['src/a.ts'], skills: ['review'] })).toEqual([
            { chip: 'mention', value: 'src/a.ts', text: '@src/a.ts' },
            { chip: 'skill', value: 'review', text: '$review' }
        ]);
    });

    test('finds a chip inside emphasis and a list', () => {
        expect(chips('- **@src/a.ts**', { mentions: ['src/a.ts'] }).map((chip) => chip.value)).toEqual(['src/a.ts']);
    });

    test('leaves inline code and a fence alone', () => {
        expect(chips('See `@src/a.ts`\n\n```\n@src/a.ts\n```', { mentions: ['src/a.ts'] })).toEqual([]);
    });

    test('draws nothing for a token nobody picked', () => {
        expect(chips('Open @src/b.ts', { mentions: ['src/a.ts'] })).toEqual([]);
        expect(chips('Open @src/a.ts', {})).toEqual([]);
    });
});
