import { describe, expect, test } from 'bun:test';
import { parseSnippet, tabOrder } from '@adecore/editor-react/models';

describe('parseSnippet', () => {
    test('turns placeholders, choices and bare stops into text and stops', () => {
        const parsed = parseSnippet('for (const ${1:item} of ${2|items,list|}) {\n\t$0\n}');
        expect(parsed.text).toBe('for (const item of items) {\n\t\n}');
        expect(parsed.stops).toEqual([
            { index: 1, start: 11, end: 15 },
            { index: 2, start: 19, end: 24 },
            { index: 0, start: 29, end: 29 }
        ]);
    });

    test('undoes escapes and drops variables, keeping the default of one that has it', () => {
        expect(parseSnippet('cost: \\$5 \\} $TM_FILENAME ${name} ${LINE:7}').text).toBe('cost: $5 }   7');
        expect(parseSnippet('${TM_SELECTED_TEXT/(a)/$1/g}x').text).toBe('x');
    });

    test('reads a placeholder inside a placeholder as its text, with a stop of its own', () => {
        const parsed = parseSnippet('${1:a ${2:b}} $0');
        expect(parsed.text).toBe('a b ');
        expect(parsed.stops).toEqual([
            { index: 2, start: 2, end: 3 },
            { index: 1, start: 0, end: 3 },
            { index: 0, start: 4, end: 4 }
        ]);
    });

    test('keeps a lone dollar and a closing brace outside a placeholder as text', () => {
        expect(parseSnippet('a $ b } c').text).toBe('a $ b } c');
    });
});

describe('tabOrder', () => {
    test('visits 1, 2 and on, once per index, and ends on the final stop', () => {
        const order = tabOrder(parseSnippet('f(${2:b}, ${1:a}, ${1:a})$0'));
        expect(order.map((stop) => stop.index)).toEqual([1, 2, 0]);
        expect(order[0]!.start).toBe(5);
    });

    test('puts the final stop at the end of the text when the snippet names none', () => {
        expect(tabOrder(parseSnippet('f(${1:a})'))).toEqual([
            { index: 1, start: 2, end: 3 },
            { index: 0, start: 4, end: 4 }
        ]);
        expect(tabOrder(parseSnippet('plain'))).toEqual([{ index: 0, start: 5, end: 5 }]);
    });
});
