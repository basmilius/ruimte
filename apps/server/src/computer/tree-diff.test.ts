import { describe, expect, test } from 'bun:test';
import type { StateResult } from './helper-protocol.ts';
import { diffTree, handleOf, rememberTree } from './tree-diff.ts';

const stateOf = (tree: string[], extra: { sheet?: string; instance?: string; pid?: number } = {}): StateResult => ({
    app: { name: 'Mail', pid: extra.pid ?? 42, bundleId: 'com.example.mail' },
    window: { title: 'Inbox', frame: { x: 0, y: 0, width: 800, height: 600 }, ...(extra.sheet === undefined ? {} : { sheet: extra.sheet }) },
    screenshot: {},
    elements: tree.length,
    tree,
    instance: extra.instance ?? 'run-1'
});

const INBOX = [
    '[0] Window:StandardWindow "Inbox" (0,0 800x600)',
    '  [1] Button "Archive" (10,10 60x20)',
    '  [2] TextField value="" (100,10 200x20)',
    '  [3] StaticText "3 unread" (10,40 80x20)'
];

describe('a tree told against the last one', () => {
    test('reads the handle of a line, indented or not', () => {
        expect(handleOf('    [17] Button "OK"')).toBe(17);
        expect(handleOf('Button "OK"')).toBeNull();
    });

    test('marks what went, what changed and what is new, and nothing else', () => {
        const after = [INBOX[0]!, INBOX[1]!, '  [2] TextField value="invoice" (100,10 200x20) focused', '  [9] StaticText "1 result" (10,40 80x20)'];
        expect(diffTree(rememberTree(stateOf(INBOX)), rememberTree(stateOf(after)))).toEqual({
            kind: 'diff',
            added: 1,
            gone: 1,
            changed: 1,
            lines: [
                '-   [3] StaticText "3 unread" (10,40 80x20)',
                '~   [2] TextField value="invoice" (100,10 200x20) focused',
                '+   [9] StaticText "1 result" (10,40 80x20)'
            ]
        });
    });

    test('is empty when nothing changed', () => {
        expect(diffTree(rememberTree(stateOf(INBOX)), rememberTree(stateOf(INBOX)))).toEqual({ kind: 'diff', added: 0, gone: 0, changed: 0, lines: [] });
    });

    test('is whole for the first tree, a new window, a new sheet, and a helper or app that started again', () => {
        const before = rememberTree(stateOf(INBOX));
        const window = ['[20] Window:StandardWindow "Compose" (0,0 800x600)', '  [21] Button "Send" (10,10 60x20)'];
        expect(diffTree(undefined, before)).toEqual({ kind: 'full', reason: 'the first state of this app you got' });
        expect(diffTree(before, rememberTree(stateOf(window)))).toEqual({ kind: 'full', reason: 'a new window' });
        expect(diffTree(before, rememberTree(stateOf([...INBOX, '  [30] Sheet "save"'], { sheet: 'save' })))).toEqual({ kind: 'full', reason: 'a new sheet' });
        expect(diffTree(before, rememberTree(stateOf(INBOX, { instance: 'run-2' })))).toMatchObject({ kind: 'full' });
        expect(diffTree(before, rememberTree(stateOf(INBOX, { pid: 43 })))).toMatchObject({ kind: 'full' });
    });

    test('tells a sheet that closed as the lines that went', () => {
        const withSheet = rememberTree(stateOf([...INBOX, '  [30] Sheet "save" (0,0 400x200)'], { sheet: 'save' }));
        expect(diffTree(withSheet, rememberTree(stateOf(INBOX)))).toMatchObject({ kind: 'diff', gone: 1, lines: ['-   [30] Sheet "save" (0,0 400x200)'] });
    });
});
