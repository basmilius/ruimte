import { describe, expect, test } from 'bun:test';
import { parser } from '@lezer/markdown';
import { type EnterContext, enterAction, inCode, inFenceBody, inOpenFence, listItemAt, recallDirection, tabSpaces } from './keys';

const fenceAt = (doc: string, pos: number = doc.length): boolean => inOpenFence(parser.parse(doc), pos);

const ENTER = { shift: false, mod: false };
const SHIFT = { shift: true, mod: false };
const MOD = { shift: false, mod: true };
const PROSE: EnterContext = { inOpenFence: false, list: null, column: 0 };
const FENCE: EnterContext = { inOpenFence: true, list: null, column: 0 };

const itemContext = (line: string, column: number = line.length): EnterContext => ({ inOpenFence: false, list: listItemAt(line), column });

describe('enterAction', () => {
    test('sends outside a fence and a list and adds a line with Shift', () => {
        expect(enterAction(ENTER, PROSE)).toBe('send');
        expect(enterAction(SHIFT, PROSE)).toBe('newline');
    });

    test('adds a line inside an open fence, with or without Shift', () => {
        expect(enterAction(ENTER, FENCE)).toBe('newline');
        expect(enterAction(SHIFT, FENCE)).toBe('newline');
    });

    test('continues a list item from its end or its middle', () => {
        expect(enterAction(ENTER, itemContext('- one'))).toBe('continue-list');
        expect(enterAction(ENTER, itemContext('- one', 3))).toBe('continue-list');
    });

    test('leaves the list from an empty item', () => {
        expect(enterAction(ENTER, itemContext('- '))).toBe('leave-list');
        expect(enterAction(ENTER, itemContext('2. [ ] '))).toBe('leave-list');
    });

    test('adds a plain line in front of the marker and with Shift', () => {
        expect(enterAction(ENTER, itemContext('- one', 0))).toBe('newline');
        expect(enterAction(SHIFT, itemContext('- one'))).toBe('newline');
        expect(enterAction(SHIFT, itemContext('- '))).toBe('newline');
    });

    test('sends with Mod from anywhere', () => {
        expect(enterAction(MOD, FENCE)).toBe('send');
        expect(enterAction({ shift: true, mod: true }, PROSE)).toBe('send');
        expect(enterAction(MOD, itemContext('- one'))).toBe('send');
    });
});

describe('listItemAt', () => {
    test('continues a bullet with the same marker and indentation', () => {
        expect(listItemAt('- one')).toEqual({ prefix: '- ', next: '- ', empty: false });
        expect(listItemAt('  * two')?.next).toBe('  * ');
        expect(listItemAt('+\tthree')?.next).toBe('+\t');
    });

    test('counts an ordered list on with its own delimiter', () => {
        expect(listItemAt('1. one')?.next).toBe('2. ');
        expect(listItemAt('9) nine')?.next).toBe('10) ');
        expect(listItemAt('   3.  three')?.next).toBe('   4.  ');
    });

    test('continues a task, checked or not, as an unchecked one', () => {
        expect(listItemAt('- [ ] todo')).toEqual({ prefix: '- [ ] ', next: '- [ ] ', empty: false });
        expect(listItemAt('- [x] done')?.next).toBe('- [ ] ');
        expect(listItemAt('1. [X] done')?.next).toBe('2. [ ] ');
    });

    test('calls an item with nothing after its marker empty', () => {
        expect(listItemAt('- ')?.empty).toBe(true);
        expect(listItemAt('  3.   ')?.empty).toBe(true);
        expect(listItemAt('- [ ]')?.empty).toBe(true);
    });

    test('finds no item in prose, emphasis or a marker without a space', () => {
        expect(listItemAt('plain')).toBeNull();
        expect(listItemAt('**bold**')).toBeNull();
        expect(listItemAt('-dash')).toBeNull();
        expect(listItemAt('1.5 liters')).toBeNull();
    });
});

describe('inOpenFence', () => {
    test('is true in the body of a fence nobody closed', () => {
        expect(fenceAt('look at this\n```ts\nconst a = 1;')).toBe(true);
        expect(fenceAt('```\n')).toBe(true);
    });

    test('is true at the end of the opening fence line', () => {
        expect(fenceAt('```ts')).toBe(true);
        expect(fenceAt('~~~')).toBe(true);
    });

    test('is false in and after a closed fence', () => {
        const doc = '```ts\nconst a = 1;\n```\nand then';
        expect(fenceAt(doc, 10)).toBe(false);
        expect(fenceAt(doc, doc.length)).toBe(false);
        expect(fenceAt('```\ncode\n```')).toBe(false);
    });

    test('is false before the fence and in plain text or inline code', () => {
        expect(fenceAt('```ts\ncode', 0)).toBe(false);
        expect(fenceAt('plain text')).toBe(false);
        expect(fenceAt('see `code')).toBe(false);
        expect(fenceAt('see `code`')).toBe(false);
    });
});

describe('inFenceBody', () => {
    const bodyAt = (doc: string, pos: number = doc.length): boolean => inFenceBody(parser.parse(doc), doc, pos);

    test('is true below the opening line of a fence, open or closed', () => {
        expect(bodyAt('```php\n<?php')).toBe(true);
        expect(bodyAt('```\n')).toBe(true);
        expect(bodyAt('```\ncode\n```\nafter', 5)).toBe(true);
    });

    test('is false on the opening line, after a closed fence and outside one', () => {
        expect(bodyAt('```php')).toBe(false);
        expect(bodyAt('```\ncode\n```')).toBe(false);
        expect(bodyAt('```\ncode\n```\nafter')).toBe(false);
        expect(bodyAt('plain text')).toBe(false);
        expect(bodyAt('see `code`', 6)).toBe(false);
    });
});

describe('tabSpaces', () => {
    test('fills up to the next stop of four', () => {
        expect(tabSpaces(0)).toBe('    ');
        expect(tabSpaces(1)).toBe('   ');
        expect(tabSpaces(3)).toBe(' ');
        expect(tabSpaces(4)).toBe('    ');
    });
});

describe('inCode', () => {
    const codeAt = (doc: string, pos: number = doc.length): boolean => inCode(parser.parse(doc), doc, pos);

    test('is true in the body of a fence, open or closed', () => {
        expect(codeAt('```php\n<?php\n$basmilius')).toBe(true);
        const closed = '```\n$a\n```\nafter';
        expect(codeAt(closed, 6)).toBe(true);
        expect(codeAt(closed)).toBe(false);
    });

    test('is true inside a code span and after a backtick nobody closed', () => {
        expect(codeAt('see `$a` here', 6)).toBe(true);
        expect(codeAt('see `$a')).toBe(true);
        expect(codeAt('- item `@a')).toBe(true);
        expect(codeAt('see `one\n$two')).toBe(true);
    });

    test('is false in prose, after a closed span and after an escaped backtick', () => {
        expect(codeAt('plain $a')).toBe(false);
        expect(codeAt('see `a` and $b')).toBe(false);
        expect(codeAt('see \\` and $b')).toBe(false);
        expect(codeAt('see `a`\n\n$b')).toBe(false);
    });
});

describe('recallDirection', () => {
    test('walks back from an empty box', () => {
        expect(recallDirection({ key: 'ArrowUp', text: '', from: 0, to: 0, recalled: false })).toBe(-1);
    });

    test('walks on from an unedited recall with the caret at its start or end', () => {
        expect(recallDirection({ key: 'ArrowUp', text: 'one\ntwo', from: 0, to: 0, recalled: true })).toBe(-1);
        expect(recallDirection({ key: 'ArrowDown', text: 'one\ntwo', from: 7, to: 7, recalled: true })).toBe(1);
    });

    test('leaves the arrows to the caret in the middle of a recall or in a prompt being written', () => {
        expect(recallDirection({ key: 'ArrowUp', text: 'one\ntwo', from: 5, to: 5, recalled: true })).toBeNull();
        expect(recallDirection({ key: 'ArrowDown', text: 'one\ntwo', from: 2, to: 2, recalled: true })).toBeNull();
        expect(recallDirection({ key: 'ArrowUp', text: 'draft', from: 0, to: 0, recalled: false })).toBeNull();
        expect(recallDirection({ key: 'ArrowDown', text: 'draft', from: 5, to: 5, recalled: false })).toBeNull();
    });

    test('ignores every other key', () => {
        expect(recallDirection({ key: 'Enter', text: '', from: 0, to: 0, recalled: false })).toBeNull();
    });
});
