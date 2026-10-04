import { describe, expect, test } from 'bun:test';
import { chordMatches, type KeyLike, keyAction } from './keymap.ts';
import { chordOf, KEYMAP_IDS, parseChord } from './keymap-table.ts';
import type { KeyChord } from './types.ts';

function key(name: string, modifiers: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike {
    return { key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers };
}

const chord = (name: string, modifiers: Partial<KeyChord> = {}): KeyChord => ({
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: name,
    ...modifiers
});

describe('chordMatches', () => {
    test('reads mod as Cmd on macOS and Ctrl elsewhere', () => {
        expect(chordMatches(chord('K', { mod: true }), key('k', { metaKey: true }), true)).toBe(true);
        expect(chordMatches(chord('K', { mod: true }), key('k', { ctrlKey: true }), true)).toBe(false);
        expect(chordMatches(chord('K', { mod: true }), key('k', { ctrlKey: true }), false)).toBe(true);
    });

    test('needs the same modifiers and no others', () => {
        expect(chordMatches(chord('P', { mod: true, shift: true }), key('P', { metaKey: true, shiftKey: true }), true)).toBe(true);
        expect(chordMatches(chord('P', { mod: true }), key('p', { metaKey: true, shiftKey: true }), true)).toBe(false);
        expect(chordMatches(chord('P', { mod: true }), key('p', { metaKey: true, altKey: true }), true)).toBe(false);
    });

    test('matches a named key by its name and a physical modifier as it is', () => {
        expect(chordMatches(chord('ArrowLeft', { ctrl: true }), key('ArrowLeft', { ctrlKey: true }), true)).toBe(true);
        expect(chordMatches(chord('ArrowLeft', { ctrl: true }), key('ArrowRight', { ctrlKey: true }), true)).toBe(false);
    });
});

describe('keyAction', () => {
    test('maps the editing keys to model commands', () => {
        expect(keyAction(key('z', { metaKey: true }), true)).toEqual({ type: 'command', command: 'undo' });
        expect(keyAction(key('z', { metaKey: true, shiftKey: true }), true)).toEqual({ type: 'command', command: 'redo' });
        expect(keyAction(key('Enter'), true)).toEqual({ type: 'command', command: 'insertNewline' });
        expect(keyAction(key('Backspace'), true)).toEqual({ type: 'command', command: 'smartBackspace' });
        expect(keyAction(key('Tab', { shiftKey: true }), true)).toEqual({ type: 'command', command: 'outdent' });
        expect(keyAction(key('Tab'), true)).toEqual({ type: 'command', command: 'insertTab' });
        expect(keyAction(key('/', { metaKey: true }), true)).toEqual({ type: 'command', command: 'toggleLineComment' });
    });

    test('toggles a block comment with the platform`s chord for each system', () => {
        expect(keyAction(key('÷', { metaKey: true, altKey: true, code: 'Slash' }), true)).toEqual({ type: 'command', command: 'toggleBlockComment' });
        expect(keyAction(key('?', { ctrlKey: true, shiftKey: true, code: 'Slash' }), false)).toEqual({ type: 'command', command: 'toggleBlockComment' });
        expect(keyAction(key('/', { ctrlKey: true }), false)).toEqual({ type: 'command', command: 'toggleLineComment' });
    });

    test('maps the line commands that have a key', () => {
        expect(keyAction(key('Enter', { shiftKey: true }), true)).toEqual({ type: 'command', command: 'startNewLine' });
        expect(keyAction(key('Enter', { metaKey: true }), true)).toEqual({ type: 'command', command: 'splitLine' });
        expect(keyAction(key('Enter', { metaKey: true, altKey: true }), true)).toEqual({ type: 'command', command: 'startNewLineBefore' });
        expect(keyAction(key('U', { metaKey: true, shiftKey: true }), true)).toEqual({ type: 'command', command: 'toggleCase' });
        expect(keyAction(key('J', { ctrlKey: true, shiftKey: true }), true)).toEqual({ type: 'command', command: 'joinLines' });
        expect(keyAction(key('i', { ctrlKey: true, altKey: true }), false)).toEqual({ type: 'command', command: 'autoIndentLines' });
    });

    test('moves by word with Option on macOS and Ctrl elsewhere, and to a line end with Cmd', () => {
        expect(keyAction(key('ArrowLeft', { altKey: true }), true)).toEqual({ type: 'command', command: 'wordLeft' });
        expect(keyAction(key('ArrowRight', { ctrlKey: true, shiftKey: true }), false)).toEqual({ type: 'command', command: 'selectWordRight' });
        expect(keyAction(key('ArrowLeft', { metaKey: true }), true)).toEqual({ type: 'command', command: 'smartHome' });
    });

    test('leaves a plain arrow to the view, which knows how the lines are drawn', () => {
        expect(keyAction(key('ArrowDown'), true)).toEqual({ type: 'move', key: 'ArrowDown', extend: false });
        expect(keyAction(key('PageUp', { shiftKey: true }), true)).toEqual({ type: 'move', key: 'PageUp', extend: true });
    });

    test('goes to the ends of the document', () => {
        expect(keyAction(key('ArrowUp', { metaKey: true }), true)).toEqual({ type: 'edge', end: false, extend: false });
        expect(keyAction(key('End', { ctrlKey: true, shiftKey: true }), false)).toEqual({ type: 'edge', end: true, extend: true });
    });

    test('saves on the platform modifier only', () => {
        expect(keyAction(key('s', { metaKey: true }), true)).toEqual({ type: 'save' });
        expect(keyAction(key('s', { ctrlKey: true }), true)).toBeNull();
        expect(keyAction(key('s', { ctrlKey: true }), false)).toEqual({ type: 'save' });
    });

    test('ignores what is the page`s or the textarea`s', () => {
        expect(keyAction(key('a'), true)).toBeNull();
        expect(keyAction(key('c', { metaKey: true }), true)).toBeNull();
    });
});

describe('the key table', () => {
    for (const apple of [true, false]) {
        const platform = apple ? 'macOS' : 'the other platforms';

        test(`reads every chord on ${platform} and gives no two commands the same one`, () => {
            const seen = new Map<string, string>();
            for (const id of KEYMAP_IDS) {
                const text = chordOf(id, apple);
                if (text === null) {
                    continue;
                }
                const chord = parseChord(text);
                const signature = [apple ? chord.mod || chord.meta : false, chord.ctrl || (!apple && chord.mod), chord.alt, chord.shift, chord.key].join('|');
                expect(seen.get(signature), `${id} and ${seen.get(signature)} share ${text}`).toBeUndefined();
                seen.set(signature, id);
            }
        });
    }

    test('matches letters and punctuation by the physical key, since Option changes the character on macOS', () => {
        expect(keyAction(key('¬', { metaKey: true, altKey: true, code: 'KeyL' }), true)).toBeNull();
        expect(chordMatches(parseChord('Mod+Alt+L'), key('¬', { metaKey: true, altKey: true, code: 'KeyL' }), true)).toBe(true);
        expect(chordMatches(parseChord('Mod+Alt+-'), key('–', { metaKey: true, altKey: true, code: 'Minus' }), true)).toBe(true);
        expect(chordMatches(parseChord('Mod+Shift+='), key('+', { metaKey: true, shiftKey: true, code: 'Equal' }), true)).toBe(true);
    });

    test('folds with the platform`s keys, whatever Shift and Option make of the character', () => {
        expect(keyAction(key('-', { metaKey: true, code: 'Minus' }), true)).toEqual({ type: 'view', command: 'collapseRegion' });
        expect(keyAction(key('+', { metaKey: true, shiftKey: true, code: 'Equal' }), true)).toEqual({ type: 'view', command: 'expandAllRegions' });
        expect(keyAction(key('–', { metaKey: true, altKey: true, code: 'Minus' }), true)).toEqual({ type: 'view', command: 'collapseRegionRecursively' });
        expect(keyAction(key('.', { metaKey: true, code: 'Period' }), true)).toEqual({ type: 'view', command: 'foldSelection' });
        expect(keyAction(key('=', { ctrlKey: true, code: 'Equal' }), false)).toEqual({ type: 'view', command: 'expandRegion' });
    });

    test('has the platform`s key for the line commands on each system', () => {
        expect(keyAction(key('Backspace', { metaKey: true }), true)).toEqual({ type: 'command', command: 'deleteLine' });
        expect(keyAction(key('y', { ctrlKey: true }), false)).toEqual({ type: 'command', command: 'deleteLine' });
        expect(keyAction(key('d', { metaKey: true }), true)).toEqual({ type: 'command', command: 'duplicateLine' });
        expect(keyAction(key('ArrowUp', { altKey: true, shiftKey: true }), true)).toEqual({ type: 'command', command: 'moveLineUp' });
        expect(keyAction(key('ArrowUp', { altKey: true }), true)).toEqual({ type: 'command', command: 'expandSelection' });
        expect(keyAction(key('g', { ctrlKey: true }), true)).toEqual({ type: 'command', command: 'selectNextOccurrence' });
        expect(keyAction(key('j', { altKey: true }), false)).toEqual({ type: 'command', command: 'selectNextOccurrence' });
    });
});
