import { describe, expect, test } from 'bun:test';
import { isAppChord, isClearChord, isLeaveNodeChord, leaveNodeChordLabel, macMotionSequence, type KeyChord } from './keymap.ts';

const chord = (key: string, modifiers: Partial<Omit<KeyChord, 'key'>> = {}): KeyChord => ({
    key,
    code: '',
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...modifiers
});

describe('macMotionSequence', () => {
    test('Cmd with an arrow is the start or the end of the line', () => {
        expect(macMotionSequence(chord('ArrowLeft', { metaKey: true }), false)).toBe('\x1b[H');
        expect(macMotionSequence(chord('ArrowRight', { metaKey: true }), false)).toBe('\x1b[F');
    });

    test('the application cursor keys mode takes the SS3 form of Home and End', () => {
        expect(macMotionSequence(chord('ArrowLeft', { metaKey: true }), true)).toBe('\x1bOH');
        expect(macMotionSequence(chord('ArrowRight', { metaKey: true }), true)).toBe('\x1bOF');
    });

    test('Option with an arrow is a word, in either mode', () => {
        expect(macMotionSequence(chord('ArrowLeft', { altKey: true }), false)).toBe('\x1bb');
        expect(macMotionSequence(chord('ArrowRight', { altKey: true }), false)).toBe('\x1bf');
        expect(macMotionSequence(chord('ArrowLeft', { altKey: true }), true)).toBe('\x1bb');
        expect(macMotionSequence(chord('ArrowRight', { altKey: true }), true)).toBe('\x1bf');
    });

    test('Cmd+Backspace kills the line backwards', () => {
        expect(macMotionSequence(chord('Backspace', { metaKey: true }), false)).toBe('\x15');
        expect(macMotionSequence(chord('Backspace', { metaKey: true }), true)).toBe('\x15');
    });

    test('a bare key, another modifier or Ctrl in the chord belongs to xterm', () => {
        expect(macMotionSequence(chord('ArrowLeft'), false)).toBeNull();
        expect(macMotionSequence(chord('Backspace'), false)).toBeNull();
        expect(macMotionSequence(chord('ArrowUp', { metaKey: true }), false)).toBeNull();
        expect(macMotionSequence(chord('ArrowLeft', { metaKey: true, altKey: true }), false)).toBeNull();
        expect(macMotionSequence(chord('ArrowLeft', { ctrlKey: true }), false)).toBeNull();
        expect(macMotionSequence(chord('ArrowLeft', { metaKey: true, ctrlKey: true }), false)).toBeNull();
        expect(macMotionSequence(chord('a', { metaKey: true }), false)).toBeNull();
    });

    test('Shift rides along, so a selection chord still moves the cursor', () => {
        expect(macMotionSequence(chord('ArrowLeft', { metaKey: true, shiftKey: true }), false)).toBe('\x1b[H');
    });
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

describe('isAppChord', () => {
    const key = (code: string, modifiers: Partial<Omit<KeyChord, 'key'>> = {}): KeyChord => chord('', { code, ...modifiers });

    test("the chords that move between views stay the app's", () => {
        expect(isAppChord(key('Digit1', { metaKey: true }), true)).toBe(true);
        expect(isAppChord(key('Digit9', { metaKey: true }), true)).toBe(true);
        expect(isAppChord(key('KeyT', { metaKey: true }), true)).toBe(true);
        expect(isAppChord(key('KeyB', { metaKey: true }), true)).toBe(true);
        expect(isAppChord(key('KeyB', { metaKey: true, altKey: true }), true)).toBe(true);
        expect(isAppChord(key('BracketLeft', { metaKey: true, shiftKey: true }), true)).toBe(true);
        expect(isAppChord(key('BracketRight', { metaKey: true, shiftKey: true }), true)).toBe(true);
        expect(isAppChord(chord(',', { code: 'Comma', metaKey: true }), true)).toBe(true);
    });

    test('everything else in a terminal belongs to the program', () => {
        expect(isAppChord(key('KeyK', { metaKey: true }), true)).toBe(false);
        expect(isAppChord(key('KeyZ', { metaKey: true }), true)).toBe(false);
        expect(isAppChord(key('KeyA', { metaKey: true }), true)).toBe(false);
        expect(isAppChord(key('Digit0', { metaKey: true }), true)).toBe(false);
        expect(isAppChord(key('Digit1'), true)).toBe(false);
        expect(isAppChord(key('KeyT', { metaKey: true, shiftKey: true }), true)).toBe(false);
    });

    test("on macOS Ctrl is the shell's, and off macOS Cmd is nothing", () => {
        expect(isAppChord(key('Digit1', { ctrlKey: true }), true)).toBe(false);
        expect(isAppChord(key('Digit1', { metaKey: true }), false)).toBe(false);
        expect(isAppChord(key('Digit1', { ctrlKey: true }), false)).toBe(true);
    });

    test('off macOS Ctrl+B is the tmux prefix, so the shell keeps it', () => {
        expect(isAppChord(key('KeyB', { ctrlKey: true }), false)).toBe(false);
        expect(isAppChord(key('KeyB', { ctrlKey: true, altKey: true }), false)).toBe(true);
    });
});

describe('isClearChord', () => {
    test('macOS clears on Cmd+K, the way every native terminal does', () => {
        expect(isClearChord(chord('k', { code: 'KeyK', metaKey: true }), true)).toBe(true);
        expect(isClearChord(chord('k', { code: 'KeyK' }), true)).toBe(false);
        expect(isClearChord(chord('k', { code: 'KeyK', metaKey: true, shiftKey: true }), true)).toBe(false);
        expect(isClearChord(chord('k', { code: 'KeyK', ctrlKey: true }), true)).toBe(false);
    });

    test("elsewhere it is Ctrl+Shift+K, because Ctrl+K is readline's kill-line", () => {
        expect(isClearChord(chord('K', { code: 'KeyK', ctrlKey: true, shiftKey: true }), false)).toBe(true);
        expect(isClearChord(chord('k', { code: 'KeyK', ctrlKey: true }), false)).toBe(false);
    });

    test('another key is never the chord', () => {
        expect(isClearChord(chord('l', { code: 'KeyL', metaKey: true }), true)).toBe(false);
    });
});

describe('leaveNodeChordLabel', () => {
    test('reads as the platform writes it', () => {
        expect(leaveNodeChordLabel(true)).toBe('⌘Esc');
        expect(leaveNodeChordLabel(false)).toBe('⌃⇧Esc');
    });
});
