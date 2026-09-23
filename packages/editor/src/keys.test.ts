import { describe, expect, test } from 'bun:test';
import { type KeyChord, monacoKeyOf } from './keys.ts';

const chord = (key: string, held: Partial<Omit<KeyChord, 'key'>> = {}): KeyChord => ({
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    ...held,
    key
});

describe('monacoKeyOf', () => {
    test('reads mod as Monaco reads CtrlCmd, on every platform', () => {
        expect(monacoKeyOf(chord('K', { mod: true }), true)).toEqual({ modifiers: ['CtrlCmd'], code: 'KeyK' });
        expect(monacoKeyOf(chord('K', { mod: true }), false)).toEqual({ modifiers: ['CtrlCmd'], code: 'KeyK' });
    });

    test('puts the physical Ctrl and Meta where each platform has them', () => {
        expect(monacoKeyOf(chord('Escape', { ctrl: true, shift: true }), false)).toEqual({ modifiers: ['CtrlCmd', 'Shift'], code: 'Escape' });
        expect(monacoKeyOf(chord('Escape', { ctrl: true }), true)).toEqual({ modifiers: ['WinCtrl'], code: 'Escape' });
        expect(monacoKeyOf(chord('Escape', { meta: true }), true)).toEqual({ modifiers: ['CtrlCmd'], code: 'Escape' });
    });

    test('names digits, punctuation, arrows and function keys the way Monaco does', () => {
        expect(monacoKeyOf(chord('3', { mod: true }), true)?.code).toBe('Digit3');
        expect(monacoKeyOf(chord('\\', { mod: true, shift: true }), true)).toEqual({ modifiers: ['CtrlCmd', 'Shift'], code: 'Backslash' });
        expect(monacoKeyOf(chord('ArrowLeft', { mod: true, alt: true }), true)).toEqual({ modifiers: ['CtrlCmd', 'Alt'], code: 'LeftArrow' });
        expect(monacoKeyOf(chord('F2'), true)?.code).toBe('F2');
    });

    test('leaves out a key matched on its character', () => {
        expect(monacoKeyOf(chord('+'), true)).toBeNull();
        expect(monacoKeyOf(chord('-', { mod: true }), true)).toBeNull();
    });
});
