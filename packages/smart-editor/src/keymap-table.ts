/*
 * Every key of the editor and of the language commands that act on it, written once. A chord is text
 * the client's `shortcut()` reads too: `Mod` is Cmd on macOS and Ctrl elsewhere, `Ctrl`, `Meta`, `Alt`
 * and `Shift` are the physical keys. The menu, the palette, the context menu and the handlers all read
 * this table, so what a menu prints is what the key does.
 *
 * The keys are the platform's own: its macOS keymap on macOS and its default keymap everywhere else.
 * Where Ruimte's own shortcuts hold a key, `taken` says which key the platform has there and what
 * holds it, and the chord below it is the closest free one. Plain text motion (arrows, Home, End, Page
 * Up and Down, Enter, Tab, Backspace, Delete and Escape) is the same everywhere and not listed.
 */

import type { KeyChord } from './types.ts';

export interface TakenKey {
    /* The chord the platform binds on the platform this entry is for. */
    readonly platform: string;
    /* What of Ruimte's holds that chord. */
    readonly by: string;
}

export interface KeyBinding {
    readonly mac: string | null;
    readonly other: string | null;
    readonly takenMac?: TakenKey;
    readonly takenOther?: TakenKey;
}

function bind(mac: string | null, other: string | null = mac, taken: { mac?: TakenKey; other?: TakenKey } = {}): KeyBinding {
    return {
        mac,
        other,
        ...(taken.mac === undefined ? {} : { takenMac: taken.mac }),
        ...(taken.other === undefined ? {} : { takenOther: taken.other })
    };
}

const SIDEBAR = 'Toggle sidebar';
const PANEL = 'Toggle panel';
const CLOSE_CELL = 'Close cell';
const VOICE = 'Voice control';
const DEVTOOLS = 'Developer tools';
const BARE_KEY = 'Every shortcut needs a modifier';

export const KEYMAP = {
    undo: bind('Mod+Z'),
    redo: bind('Mod+Shift+Z'),
    selectAll: bind('Mod+A'),
    save: bind('Mod+S'),

    duplicateLine: bind('Mod+D'),
    deleteLine: bind('Mod+Backspace', 'Mod+Y'),
    moveLineUp: bind('Alt+Shift+ArrowUp'),
    moveLineDown: bind('Alt+Shift+ArrowDown'),
    toggleLineComment: bind('Mod+/'),
    toggleBlockComment: bind('Mod+Alt+/', 'Mod+Shift+/'),
    joinLines: bind('Ctrl+Shift+J'),
    startNewLine: bind('Shift+Enter'),
    startNewLineBefore: bind('Mod+Alt+Enter'),
    splitLine: bind('Mod+Enter'),
    toggleCase: bind('Mod+Shift+U'),
    autoIndentLines: bind('Ctrl+Alt+I'),

    expandSelection: bind('Alt+ArrowUp', 'Alt+ArrowUp', { other: { platform: 'Ctrl+W', by: CLOSE_CELL } }),
    shrinkSelection: bind('Alt+ArrowDown'),
    matchBrace: bind('Ctrl+M', 'Ctrl+M', { other: { platform: 'Ctrl+Shift+M', by: VOICE } }),

    selectNextOccurrence: bind('Ctrl+G', 'Alt+J'),
    unselectOccurrence: bind('Ctrl+Shift+G', 'Alt+Shift+J'),
    selectAllOccurrences: bind('Meta+Ctrl+G', 'Ctrl+Alt+Shift+J'),
    addCaretPerSelectedLine: bind('Alt+Shift+G'),
    // Tap the modifier twice, hold it and press an arrow: Option on macOS, Ctrl elsewhere (`modifier-gesture.ts`). It has no chord to print.
    addCaretAbove: bind(null),
    addCaretBelow: bind(null),
    toggleColumnMode: bind('Mod+Shift+8'),

    wordLeft: bind('Alt+ArrowLeft', 'Ctrl+ArrowLeft'),
    wordRight: bind('Alt+ArrowRight', 'Ctrl+ArrowRight'),
    selectWordLeft: bind('Alt+Shift+ArrowLeft', 'Ctrl+Shift+ArrowLeft'),
    selectWordRight: bind('Alt+Shift+ArrowRight', 'Ctrl+Shift+ArrowRight'),
    deleteWordLeft: bind('Alt+Backspace', 'Ctrl+Backspace'),
    deleteWordRight: bind('Alt+Delete', 'Ctrl+Delete'),
    smartHome: bind('Meta+ArrowLeft', null),
    selectSmartHome: bind('Meta+Shift+ArrowLeft', null),
    smartEnd: bind('Meta+ArrowRight', null),
    selectSmartEnd: bind('Meta+Shift+ArrowRight', null),
    textStart: bind('Meta+ArrowUp', null),
    selectTextStart: bind('Meta+Shift+ArrowUp', null),
    textEnd: bind('Meta+ArrowDown', null),
    selectTextEnd: bind('Meta+Shift+ArrowDown', null),

    collapse: bind('Mod+-'),
    expand: bind('Mod+='),
    collapseAll: bind('Mod+Shift+-'),
    expandAll: bind('Mod+Shift+='),
    collapseRecursively: bind('Mod+Alt+-'),
    expandRecursively: bind('Mod+Alt+='),
    foldSelection: bind('Mod+.'),

    triggerCompletion: bind('Ctrl+Space'),
    parameterInfo: bind('Mod+P'),
    quickInfo: bind('Ctrl+J', 'Ctrl+Q'),
    codeActions: bind('Alt+Enter'),
    renameSymbol: bind('Shift+F6'),
    organizeImports: bind('Ctrl+Alt+O'),
    formatDocument: bind('Mod+Alt+L'),

    goToSymbol: bind('Mod+F12'),
    goToDefinition: bind('Alt+Shift+D', 'Alt+Shift+D', {
        mac: { platform: 'Mod+B', by: SIDEBAR },
        other: { platform: 'Ctrl+B', by: SIDEBAR }
    }),
    goToTypeDefinition: bind('Ctrl+Shift+B'),
    goToImplementation: bind('Alt+Shift+I', 'Alt+Shift+I', {
        mac: { platform: 'Mod+Alt+B', by: PANEL },
        other: { platform: 'Ctrl+Alt+B', by: PANEL }
    }),
    peekDefinition: bind('Alt+Space', 'Alt+Shift+P', { other: { platform: 'Ctrl+Shift+I', by: DEVTOOLS } }),
    peekReferences: bind('Alt+F7'),
    historyBack: bind('Mod+[', 'Mod+[', { other: { platform: 'Ctrl+Alt+ArrowLeft', by: 'Focus the cell on the left' } }),
    historyForward: bind('Mod+]', 'Mod+]', { other: { platform: 'Ctrl+Alt+ArrowRight', by: 'Focus the cell on the right' } }),
    recentLocations: bind('Mod+Shift+E'),
    nextProblem: bind('Alt+F2', 'Alt+F2', { mac: { platform: 'F2', by: BARE_KEY }, other: { platform: 'F2', by: BARE_KEY } }),
    previousProblem: bind('Alt+Shift+F2'),
    nextHighlight: bind('Ctrl+Alt+ArrowDown', 'Alt+F3'),
    previousHighlight: bind('Ctrl+Alt+ArrowUp', 'Alt+Shift+F3'),

    findNext: bind('Mod+G', 'Ctrl+L'),
    findPrevious: bind('Mod+Shift+G', 'Ctrl+Shift+L'),
    replace: bind('Mod+R')
} as const satisfies Record<string, KeyBinding>;

export type KeymapId = keyof typeof KEYMAP;

export const KEYMAP_IDS = Object.keys(KEYMAP) as KeymapId[];

/* The chord of a command on a platform, or null when the platform has none. */
export function chordOf(id: KeymapId, apple: boolean): string | null {
    return KEYMAP[id][apple ? 'mac' : 'other'];
}

const MODIFIERS = new Map<string, 'mod' | 'ctrl' | 'meta' | 'alt' | 'shift'>([
    ['Mod', 'mod'],
    ['Ctrl', 'ctrl'],
    ['Meta', 'meta'],
    ['Alt', 'alt'],
    ['Shift', 'shift']
]);

/* Reads `Mod+Shift+K`. Throws on a text it cannot read, so a typo in the table fails when the module loads. */
export function parseChord(text: string): KeyChord {
    const words = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
    const chord = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: '' };
    for (const word of words) {
        const modifier = MODIFIERS.get(word);
        if (modifier !== undefined) {
            chord[modifier] = true;
        } else if (word === '' || chord.key !== '') {
            throw new Error(`Cannot read the chord "${text}"`);
        } else {
            chord.key = word.length === 1 ? word.toUpperCase() : word;
        }
    }
    if (chord.key === '') {
        throw new Error(`The chord "${text}" names no key`);
    }
    return chord;
}
