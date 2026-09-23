import type { KeyCode } from 'monaco-editor/editor';

/* A shortcut as the client writes it (`ui/shortcut.ts`): `mod` is Cmd on macOS and Ctrl elsewhere, `ctrl` and `meta` the physical keys. */
export interface KeyChord {
    readonly mod: boolean;
    readonly ctrl: boolean;
    readonly meta: boolean;
    readonly alt: boolean;
    readonly shift: boolean;
    /* An uppercase letter, a digit, a punctuation mark or a named key such as `ArrowLeft`. */
    readonly key: string;
}

export type MonacoModifier = 'CtrlCmd' | 'WinCtrl' | 'Alt' | 'Shift';

export interface MonacoKey {
    readonly modifiers: readonly MonacoModifier[];
    readonly code: keyof typeof KeyCode;
}

const NAMED: Readonly<Record<string, keyof typeof KeyCode>> = {
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    ';': 'Semicolon',
    "'": 'Quote',
    '`': 'Backquote',
    '\\': 'Backslash',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    Enter: 'Enter',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab',
    Space: 'Space',
    ArrowLeft: 'LeftArrow',
    ArrowRight: 'RightArrow',
    ArrowUp: 'UpArrow',
    ArrowDown: 'DownArrow'
};

const codeOf = (key: string): keyof typeof KeyCode | null => {
    if (/^[A-Z]$/.test(key)) {
        return `Key${key}` as keyof typeof KeyCode;
    }
    if (/^[0-9]$/.test(key)) {
        return `Digit${key}` as keyof typeof KeyCode;
    }
    if (/^F([1-9]|1[0-2])$/.test(key)) {
        return key as keyof typeof KeyCode;
    }
    return NAMED[key] ?? null;
};

/*
 * The Monaco keybinding a shortcut is, or null for one Monaco cannot name the same way (`+`, `-` and
 * `=` are matched on the character, which sits on another key per layout). Monaco's `CtrlCmd` is the
 * client's `mod`; the physical Ctrl and Meta swap between it and `WinCtrl` by platform.
 */
export const monacoKeyOf = (chord: KeyChord, apple: boolean): MonacoKey | null => {
    const code = codeOf(chord.key);
    if (code === null) {
        return null;
    }
    const modifiers = new Set<MonacoModifier>();
    if (chord.mod || (chord.ctrl && !apple) || (chord.meta && apple)) {
        modifiers.add('CtrlCmd');
    }
    if ((chord.ctrl && apple) || (chord.meta && !apple)) {
        modifiers.add('WinCtrl');
    }
    if (chord.alt) {
        modifiers.add('Alt');
    }
    if (chord.shift) {
        modifiers.add('Shift');
    }
    return { modifiers: [...modifiers], code };
};
