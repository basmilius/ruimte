import { describe, expect, test } from 'bun:test';
import { extensionOpener, isPlaceless, openerOf, peerOpener, routineOpener, storedOpener, voiceOpener, type Opener } from './opener.ts';

const OPENERS: Array<[Opener, string]> = [
    [{ kind: 'node', id: 'chat-1' }, 'chat-1'],
    [{ kind: 'routine', id: 'nightly' }, 'routine:nightly'],
    [{ kind: 'voice', sessionId: 'session-1' }, 'voice:session-1'],
    [{ kind: 'peer', machineId: 'machine-a', parentId: 'chat-parent' }, 'peer:machine-a:chat-parent'],
    [{ kind: 'extension', id: 'acme.tool' }, 'extension:acme.tool']
];

describe('opener', () => {
    test.each(OPENERS)('%j is stored as %s and reads back', (opener, stored) => {
        expect(storedOpener(opener)).toBe(stored);
        expect(openerOf(stored)).toEqual(opener);
    });

    test('the helpers build the stored strings of older releases', () => {
        expect(routineOpener('r1')).toBe('routine:r1');
        expect(voiceOpener('s1')).toBe('voice:s1');
        expect(peerOpener('m1', 'p1')).toBe('peer:m1:p1');
        expect(extensionOpener('e1')).toBe('extension:e1');
    });

    test('a parent id of a peer keeps its own colons', () => {
        expect(openerOf('peer:m1:a:b')).toEqual({ kind: 'peer', machineId: 'm1', parentId: 'a:b' });
    });

    test('a string without a prefix, or a peer lane without a parent, is a node', () => {
        expect(openerOf('0f8c')).toEqual({ kind: 'node', id: '0f8c' });
        expect(openerOf('peer:machine-a')).toEqual({ kind: 'node', id: 'peer:machine-a' });
    });

    test('every kind but a node is placeless', () => {
        expect(OPENERS.filter(([opener]) => isPlaceless(opener)).map(([opener]) => opener.kind)).toEqual(['routine', 'voice', 'peer', 'extension']);
    });
});
