import { describe, expect, test } from 'bun:test';
import { appChordFor, type ChordKey } from './app-chords';

const key = (patch: Partial<ChordKey>): ChordKey => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: '', code: '', ...patch });

const mac = { inNode: false, apple: true };

describe('the chords of the window', () => {
    test('the palette, find in files and the settings open over every workspace', () => {
        expect(appChordFor(key({ metaKey: true, key: 'k', code: 'KeyK' }), mac)).toBe('palette');
        expect(appChordFor(key({ metaKey: true, shiftKey: true, key: 'F', code: 'KeyF' }), mac)).toBe('find-in-files');
        expect(appChordFor(key({ metaKey: true, key: ',', code: 'Comma' }), mac)).toBe('settings');
    });

    test('the sidebar is chrome of the window, and so is its chord', () => {
        expect(appChordFor(key({ metaKey: true, key: 'b', code: 'KeyB' }), mac)).toBe('sidebar');
    });

    test('off macOS Ctrl+B stays out of a node, where readline owns it', () => {
        expect(appChordFor(key({ ctrlKey: true, key: 'b', code: 'KeyB' }), { inNode: true, apple: false })).toBeNull();
        expect(appChordFor(key({ ctrlKey: true, key: 'b', code: 'KeyB' }), { inNode: false, apple: false })).toBe('sidebar');
        expect(appChordFor(key({ metaKey: true, key: 'b', code: 'KeyB' }), { inNode: true, apple: true })).toBe('sidebar');
    });

    test('a chord that acts on one project is not one of them', () => {
        /* These belong to the workspace with the focus and live in the canvas, which is what keeps
           them off the project in the pane next to it. */
        expect(appChordFor(key({ metaKey: true, key: '1', code: 'Digit1' }), mac)).toBeNull();
        expect(appChordFor(key({ metaKey: true, key: 't', code: 'KeyT' }), mac)).toBeNull();
        expect(appChordFor(key({ metaKey: true, shiftKey: true, key: ']', code: 'BracketRight' }), mac)).toBeNull();
        expect(appChordFor(key({ metaKey: true, altKey: true, key: 'b', code: 'KeyB' }), mac)).toBeNull();
        expect(appChordFor(key({ metaKey: true, key: 'z', code: 'KeyZ' }), mac)).toBeNull();
    });

    test('a key without the modifier belongs to nobody', () => {
        expect(appChordFor(key({ key: 'k', code: 'KeyK' }), mac)).toBeNull();
        expect(appChordFor(key({ key: 'b', code: 'KeyB' }), mac)).toBeNull();
    });
});
