import { describe, expect, test } from 'bun:test';
import { parser } from '@lezer/markdown';
import { enterAction, inOpenFence, recallDirection } from './keys';

const fenceAt = (doc: string, pos: number = doc.length): boolean => inOpenFence(parser.parse(doc), pos);

describe('enterAction', () => {
    test('sends outside a fence and adds a line with Shift', () => {
        expect(enterAction({ shift: false, mod: false }, false)).toBe('send');
        expect(enterAction({ shift: true, mod: false }, false)).toBe('newline');
    });

    test('adds a line inside an open fence, with or without Shift', () => {
        expect(enterAction({ shift: false, mod: false }, true)).toBe('newline');
        expect(enterAction({ shift: true, mod: false }, true)).toBe('newline');
    });

    test('sends with Mod from anywhere', () => {
        expect(enterAction({ shift: false, mod: true }, true)).toBe('send');
        expect(enterAction({ shift: true, mod: true }, false)).toBe('send');
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
