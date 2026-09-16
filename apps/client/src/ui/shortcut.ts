/*
 * One shortcut, written once: the same value decides whether a key event is the shortcut and how the
 * shortcut is printed. `mod` is Cmd on macOS and Ctrl everywhere else; `ctrl` and `meta` name the
 * physical key and exist for the few shortcuts that differ per platform on purpose.
 */
export interface Shortcut {
    mod: boolean;
    ctrl: boolean;
    meta: boolean;
    alt: boolean;
    shift: boolean;
    /* An uppercase letter, a digit, a punctuation mark or a named key (`Enter`, `ArrowLeft`, `F2`).
       Empty for modifiers held during a pointer gesture (`Mod` then "drag"), which never match a key. */
    key: string;
}

/* What a shortcut is matched against. A real `KeyboardEvent` satisfies it, a test writes one by hand. */
export type KeyLike = Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key' | 'code'>;

/* Matched on the physical key: Shift turns `[` into `{` and Option turns most keys into a dead key. */
const PUNCTUATION_CODES: Record<string, string> = {
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    ';': 'Semicolon',
    "'": 'Quote',
    '`': 'Backquote',
    '\\': 'Backslash',
    '[': 'BracketLeft',
    ']': 'BracketRight'
};

/* Matched on the character, because `+` sits on a different key per layout. */
const CHARACTER_KEYS = new Set(['+', '-', '=']);

const NAMED_KEYS = new Set(['Enter', 'Escape', 'Backspace', 'Delete', 'Tab', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/;

const MODIFIER_WORDS = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;

const isKey = (word: string): boolean =>
    /^[A-Za-z0-9]$/.test(word) || word in PUNCTUATION_CODES || CHARACTER_KEYS.has(word) || NAMED_KEYS.has(word) || FUNCTION_KEY.test(word);

/**
 * Parses `Mod+Shift+K`. Throws on a word it does not know or on two keys, so a typo in a table fails
 * the moment the module loads instead of leaving a shortcut that never fires.
 */
export const shortcut = (text: string): Shortcut => {
    // A trailing `++` is the plus key itself, which a plain split would read as two empty words.
    const words = text === '+' ? ['+'] : text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
    const result: Shortcut = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: '' };
    for (const word of words) {
        const modifier = MODIFIER_WORDS.find((candidate) => candidate === word);
        if (modifier) {
            result[modifier === 'Mod' ? 'mod' : modifier === 'Ctrl' ? 'ctrl' : modifier === 'Meta' ? 'meta' : modifier === 'Alt' ? 'alt' : 'shift'] = true;
            continue;
        }
        if (!isKey(word)) {
            throw new Error(`Unknown key "${word}" in shortcut "${text}"`);
        }
        if (result.key !== '') {
            throw new Error(`Shortcut "${text}" names two keys`);
        }
        result.key = word.length === 1 ? word.toUpperCase() : word;
    }
    return result;
};

// Letters and digits match on `code`: with Shift held `key` says `!` for 1, and Option's dead keys change it on macOS.
const matchesKey = (key: string, event: KeyLike): boolean => {
    if (/^[A-Z]$/.test(key)) {
        return event.code === `Key${key}`;
    }
    if (/^[0-9]$/.test(key)) {
        return event.code === `Digit${key}`;
    }
    const code = PUNCTUATION_CODES[key];
    if (code) {
        return event.code === code;
    }
    if (key === 'Space') {
        return event.code === 'Space';
    }
    return event.key === key;
};

/* Strict: every modifier the shortcut does not name has to be up, so Ctrl+K on macOS is not Cmd+K. */
export const matchesShortcut = (target: Shortcut, event: KeyLike, apple: boolean): boolean => {
    const meta = target.meta || (target.mod && apple);
    const ctrl = target.ctrl || (target.mod && !apple);
    if (target.key === '' || event.metaKey !== meta || event.ctrlKey !== ctrl || event.altKey !== target.alt || event.shiftKey !== target.shift) {
        return false;
    }
    return matchesKey(target.key, event);
};

const KEY_LABELS: Record<string, { apple: string; other: string }> = {
    Enter: { apple: '↩', other: 'Enter' },
    Backspace: { apple: '⌫', other: 'Backspace' },
    Delete: { apple: '⌦', other: 'Delete' },
    Escape: { apple: 'Esc', other: 'Esc' },
    Tab: { apple: '⇥', other: 'Tab' },
    Space: { apple: 'Space', other: 'Space' },
    ArrowLeft: { apple: '←', other: '←' },
    ArrowRight: { apple: '→', other: '→' },
    ArrowUp: { apple: '↑', other: '↑' },
    ArrowDown: { apple: '↓', other: '↓' }
};

/* The modifiers and the key as separate caps, in the order the platform prints them. */
export const shortcutParts = (target: Shortcut, apple: boolean): string[] => {
    const parts: string[] = [];
    if (apple) {
        if (target.ctrl) {
            parts.push('⌃');
        }
        if (target.alt) {
            parts.push('⌥');
        }
        if (target.shift) {
            parts.push('⇧');
        }
        if (target.meta || target.mod) {
            parts.push('⌘');
        }
    } else {
        if (target.ctrl || target.mod) {
            parts.push('Ctrl');
        }
        if (target.alt) {
            parts.push('Alt');
        }
        if (target.shift) {
            parts.push('Shift');
        }
        if (target.meta) {
            parts.push('Meta');
        }
    }
    if (target.key !== '') {
        const label = KEY_LABELS[target.key];
        parts.push(label ? label[apple ? 'apple' : 'other'] : target.key);
    }
    return parts;
};

/* `⌥⇧⌘K` on macOS, `Ctrl+Alt+Shift+K` elsewhere. */
export const formatShortcut = (target: Shortcut, apple: boolean): string => shortcutParts(target, apple).join(apple ? '' : '+');

/* The browser's own editing shortcuts, which the app only ever prints in a menu. */
export const EDIT_SHORTCUTS = {
    copy: shortcut('Mod+C'),
    cut: shortcut('Mod+X'),
    paste: shortcut('Mod+V'),
    selectAll: shortcut('Mod+A')
} as const;

/* Keys that are not a shortcut of their own but are printed as one in a hint. */
export const KEY_SHORTCUTS = {
    enter: shortcut('Enter'),
    modEnter: shortcut('Mod+Enter'),
    backspace: shortcut('Backspace'),
    escape: shortcut('Escape'),
    shift: shortcut('Shift')
} as const;

/* Whether the platform's own modifier is down during a pointer gesture: Cmd on macOS, Ctrl elsewhere. */
export const isModHeld = (event: Pick<KeyLike, 'metaKey' | 'ctrlKey'>, apple: boolean): boolean => (apple ? event.metaKey : event.ctrlKey);
