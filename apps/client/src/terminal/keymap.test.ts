import { describe, expect, test } from 'bun:test';
import { isLeaveNodeChord, leaveNodeChordLabel, type KeyChord } from './keymap.ts';

const chord = (key: string, modifiers: Partial<Omit<KeyChord, 'key'>> = {}): KeyChord => ({
    key,
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...modifiers
});

describe('isLeaveNodeChord', () => {
    test('macOS leaves on Cmd+Escape and keeps every other Escape in the terminal', () => {
        expect(isLeaveNodeChord(chord('Escape', { metaKey: true }), true)).toBe(true);
        expect(isLeaveNodeChord(chord('Escape'), true)).toBe(false);
        expect(isLeaveNodeChord(chord('Escape', { ctrlKey: true }), true)).toBe(false);
    });

    test('elsewhere it is Ctrl+Shift+Escape, because Ctrl+Escape is the Start menu', () => {
        expect(isLeaveNodeChord(chord('Escape', { ctrlKey: true, shiftKey: true }), false)).toBe(true);
        expect(isLeaveNodeChord(chord('Escape', { ctrlKey: true }), false)).toBe(false);
        expect(isLeaveNodeChord(chord('Escape', { shiftKey: true }), false)).toBe(false);
        expect(isLeaveNodeChord(chord('Escape'), false)).toBe(false);
    });

    test('another key is never the chord', () => {
        expect(isLeaveNodeChord(chord('Enter', { metaKey: true }), true)).toBe(false);
    });
});

describe('leaveNodeChordLabel', () => {
    test('reads as the platform writes it', () => {
        expect(leaveNodeChordLabel(true)).toBe('⌘Esc');
        expect(leaveNodeChordLabel(false)).toBe('⌃⇧Esc');
    });
});
