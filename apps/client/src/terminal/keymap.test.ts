import { describe, expect, test } from 'bun:test';
import { CANVAS_SHORTCUTS, FOCUS_SHORTCUTS, VIEW_SHORTCUTS } from '@/canvas/shortcuts';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import type { KeyLike, Shortcut } from '@/ui/shortcut';
import { isAppShortcut, isClearShortcut, isLeaveNodeShortcut, isShellShortcut, macMotionSequence, TERMINAL_HANDED_BACK } from './keymap.ts';

const shortcut = (key: string, modifiers: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
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
        expect(macMotionSequence(shortcut('ArrowLeft', { metaKey: true }), false)).toBe('\x1b[H');
        expect(macMotionSequence(shortcut('ArrowRight', { metaKey: true }), false)).toBe('\x1b[F');
    });

    test('the application cursor keys mode takes the SS3 form of Home and End', () => {
        expect(macMotionSequence(shortcut('ArrowLeft', { metaKey: true }), true)).toBe('\x1bOH');
        expect(macMotionSequence(shortcut('ArrowRight', { metaKey: true }), true)).toBe('\x1bOF');
    });

    test('Option with an arrow is a word, in either mode', () => {
        expect(macMotionSequence(shortcut('ArrowLeft', { altKey: true }), false)).toBe('\x1bb');
        expect(macMotionSequence(shortcut('ArrowRight', { altKey: true }), false)).toBe('\x1bf');
        expect(macMotionSequence(shortcut('ArrowLeft', { altKey: true }), true)).toBe('\x1bb');
        expect(macMotionSequence(shortcut('ArrowRight', { altKey: true }), true)).toBe('\x1bf');
    });

    test('Cmd+Backspace kills the line backwards', () => {
        expect(macMotionSequence(shortcut('Backspace', { metaKey: true }), false)).toBe('\x15');
        expect(macMotionSequence(shortcut('Backspace', { metaKey: true }), true)).toBe('\x15');
    });

    test('a bare key, another modifier or Ctrl in the shortcut belongs to xterm', () => {
        expect(macMotionSequence(shortcut('ArrowLeft'), false)).toBeNull();
        expect(macMotionSequence(shortcut('Backspace'), false)).toBeNull();
        expect(macMotionSequence(shortcut('ArrowUp', { metaKey: true }), false)).toBeNull();
        expect(macMotionSequence(shortcut('ArrowLeft', { metaKey: true, altKey: true }), false)).toBeNull();
        expect(macMotionSequence(shortcut('ArrowLeft', { ctrlKey: true }), false)).toBeNull();
        expect(macMotionSequence(shortcut('ArrowLeft', { metaKey: true, ctrlKey: true }), false)).toBeNull();
        expect(macMotionSequence(shortcut('a', { metaKey: true }), false)).toBeNull();
    });

    test('Shift rides along, so a selection shortcut still moves the cursor', () => {
        expect(macMotionSequence(shortcut('ArrowLeft', { metaKey: true, shiftKey: true }), false)).toBe('\x1b[H');
    });
});

describe('isLeaveNodeShortcut', () => {
    test('macOS leaves on Cmd+Escape and keeps every other Escape in the terminal', () => {
        expect(isLeaveNodeShortcut(shortcut('Escape', { metaKey: true }), true)).toBe(true);
        expect(isLeaveNodeShortcut(shortcut('Escape'), true)).toBe(false);
        expect(isLeaveNodeShortcut(shortcut('Escape', { ctrlKey: true }), true)).toBe(false);
    });

    test('elsewhere it is Ctrl+Shift+Escape, because Ctrl+Escape is the Start menu', () => {
        expect(isLeaveNodeShortcut(shortcut('Escape', { ctrlKey: true, shiftKey: true }), false)).toBe(true);
        expect(isLeaveNodeShortcut(shortcut('Escape', { ctrlKey: true }), false)).toBe(false);
        expect(isLeaveNodeShortcut(shortcut('Escape', { shiftKey: true }), false)).toBe(false);
        expect(isLeaveNodeShortcut(shortcut('Escape'), false)).toBe(false);
    });

    test('another key is never the shortcut', () => {
        expect(isLeaveNodeShortcut(shortcut('Enter', { metaKey: true }), true)).toBe(false);
    });
});

describe('isAppShortcut', () => {
    const key = (code: string, modifiers: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => shortcut('', { code, ...modifiers });

    test("the shortcuts that move between views stay the app's", () => {
        expect(isAppShortcut(key('Digit1', { metaKey: true }), true)).toBe(true);
        expect(isAppShortcut(key('Digit9', { metaKey: true }), true)).toBe(true);
        expect(isAppShortcut(key('KeyT', { metaKey: true }), true)).toBe(true);
        expect(isAppShortcut(key('KeyB', { metaKey: true }), true)).toBe(true);
        expect(isAppShortcut(key('KeyB', { metaKey: true, altKey: true }), true)).toBe(true);
        expect(isAppShortcut(key('BracketLeft', { metaKey: true, shiftKey: true }), true)).toBe(true);
        expect(isAppShortcut(key('BracketRight', { metaKey: true, shiftKey: true }), true)).toBe(true);
        expect(isAppShortcut(shortcut(',', { code: 'Comma', metaKey: true }), true)).toBe(true);
    });

    test('everything else in a terminal belongs to the program', () => {
        expect(isAppShortcut(key('KeyK', { metaKey: true }), true)).toBe(false);
        expect(isAppShortcut(key('KeyZ', { metaKey: true }), true)).toBe(false);
        expect(isAppShortcut(key('KeyA', { metaKey: true }), true)).toBe(false);
        expect(isAppShortcut(key('Digit0', { metaKey: true }), true)).toBe(false);
        expect(isAppShortcut(key('Digit1'), true)).toBe(false);
        expect(isAppShortcut(key('KeyT', { metaKey: true, shiftKey: true }), true)).toBe(false);
    });

    test("on macOS Ctrl is the shell's, and off macOS Cmd is nothing", () => {
        expect(isAppShortcut(key('Digit1', { ctrlKey: true }), true)).toBe(false);
        expect(isAppShortcut(key('Digit1', { metaKey: true }), false)).toBe(false);
        expect(isAppShortcut(key('Digit1', { ctrlKey: true }), false)).toBe(true);
    });

    test('off macOS Ctrl+B is the tmux prefix, so the shell keeps it', () => {
        expect(isAppShortcut(key('KeyB', { ctrlKey: true }), false)).toBe(false);
        expect(isAppShortcut(key('KeyB', { ctrlKey: true, altKey: true }), false)).toBe(true);
    });
});

describe('isShellShortcut', () => {
    const key = (code: string, modifiers: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => shortcut('', { code, ...modifiers });

    test('a text field that stops its own keys still hands back every app shortcut', () => {
        expect(isShellShortcut(key('Digit1', { metaKey: true }), true)).toBe(true);
        expect(isShellShortcut(key('Digit9', { metaKey: true }), true)).toBe(true);
        expect(isShellShortcut(key('BracketRight', { metaKey: true, shiftKey: true }), true)).toBe(true);
        expect(isShellShortcut(key('Digit1', { ctrlKey: true }), false)).toBe(true);
    });

    test("the palette and find in files are the app's here, unlike in a terminal", () => {
        expect(isShellShortcut(key('KeyK', { metaKey: true }), true)).toBe(true);
        expect(isShellShortcut(key('KeyF', { metaKey: true, shiftKey: true }), true)).toBe(true);
        expect(isAppShortcut(key('KeyK', { metaKey: true }), true)).toBe(false);
    });

    test('the shortcuts the composer answers itself stay in the composer', () => {
        expect(isShellShortcut(key('KeyS', { metaKey: true }), true)).toBe(false);
        expect(isShellShortcut(key('KeyF', { metaKey: true }), true)).toBe(false);
        expect(isShellShortcut(key('KeyK', { metaKey: true, altKey: true }), true)).toBe(false);
        expect(isShellShortcut(key('Enter', { metaKey: true }), true)).toBe(false);
    });
});

describe('isClearShortcut', () => {
    test('macOS clears on Cmd+K, the way every native terminal does', () => {
        expect(isClearShortcut(shortcut('k', { code: 'KeyK', metaKey: true }), true)).toBe(true);
        expect(isClearShortcut(shortcut('k', { code: 'KeyK' }), true)).toBe(false);
        expect(isClearShortcut(shortcut('k', { code: 'KeyK', metaKey: true, shiftKey: true }), true)).toBe(false);
        expect(isClearShortcut(shortcut('k', { code: 'KeyK', ctrlKey: true }), true)).toBe(false);
    });

    test("elsewhere it is Ctrl+Shift+K, because Ctrl+K is readline's kill-line", () => {
        expect(isClearShortcut(shortcut('K', { code: 'KeyK', ctrlKey: true, shiftKey: true }), false)).toBe(true);
        expect(isClearShortcut(shortcut('k', { code: 'KeyK', ctrlKey: true }), false)).toBe(false);
    });

    test('another key is never the shortcut', () => {
        expect(isClearShortcut(shortcut('l', { code: 'KeyL', metaKey: true }), true)).toBe(false);
    });
});

/* The key event a shortcut stands for, as a keyboard would send it. */
const eventFor = (target: Shortcut, apple: boolean): KeyLike => {
    const code = /^[A-Z]$/.test(target.key)
        ? `Key${target.key}`
        : /^[0-9]$/.test(target.key)
          ? `Digit${target.key}`
          : (({ ',': 'Comma', '\\': 'Backslash', '[': 'BracketLeft', ']': 'BracketRight' } as Record<string, string>)[target.key] ?? target.key);
    return {
        key: target.key,
        code,
        metaKey: target.meta || (target.mod && apple),
        ctrlKey: target.ctrl || (target.mod && !apple),
        altKey: target.alt,
        shiftKey: target.shift
    };
};

describe('what a terminal hands back', () => {
    /* The canvas answers these from anywhere, a focused node included, so a terminal that ate one
       would leave the keyboard with no way to another view or cell. */
    const windowWide = [
        ...VIEW_SHORTCUTS,
        CANVAS_SHORTCUTS.newView,
        CANVAS_SHORTCUTS.splitRight,
        CANVAS_SHORTCUTS.splitDown,
        CANVAS_SHORTCUTS.closeCell,
        CANVAS_SHORTCUTS.previousView,
        CANVAS_SHORTCUTS.nextView,
        CANVAS_SHORTCUTS.togglePanel,
        ...Object.values(FOCUS_SHORTCUTS)
    ];

    test('every shortcut the canvas answers from inside a node is in the list', () => {
        for (const target of windowWide) {
            expect(TERMINAL_HANDED_BACK).toContain(target);
        }
    });

    test('on macOS every one of them reaches the app', () => {
        for (const target of TERMINAL_HANDED_BACK) {
            expect(isAppShortcut(eventFor(target, true), true)).toBe(true);
        }
    });

    test('off macOS Ctrl+W, Ctrl+T, Ctrl+\\ and Ctrl+B stay with the program', () => {
        const kept = [CANVAS_SHORTCUTS.closeCell, CANVAS_SHORTCUTS.newView, CANVAS_SHORTCUTS.splitRight, APP_SHORTCUTS.sidebar];
        for (const target of TERMINAL_HANDED_BACK) {
            expect(isAppShortcut(eventFor(target, false), false)).toBe(!kept.includes(target));
        }
    });

    test('a text field without a program behind it hands Ctrl+W, Ctrl+T and Ctrl+\\ back off macOS', () => {
        expect(isShellShortcut(eventFor(CANVAS_SHORTCUTS.closeCell, false), false)).toBe(true);
        expect(isShellShortcut(eventFor(CANVAS_SHORTCUTS.newView, false), false)).toBe(true);
        expect(isShellShortcut(eventFor(CANVAS_SHORTCUTS.splitRight, false), false)).toBe(true);
        expect(isShellShortcut(eventFor(APP_SHORTCUTS.sidebar, false), false)).toBe(false);
    });

    test('the modifier is strict', () => {
        expect(isAppShortcut({ ...eventFor(CANVAS_SHORTCUTS.nextView, true), ctrlKey: true }, true)).toBe(false);
        expect(isAppShortcut({ ...eventFor(CANVAS_SHORTCUTS.nextView, true), altKey: true }, true)).toBe(false);
        expect(isLeaveNodeShortcut({ key: 'Escape', code: 'Escape', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false }, true)).toBe(false);
    });
});
