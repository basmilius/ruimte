import { afterEach, describe, expect, test } from 'bun:test';
import { shortcut, type Shortcut } from '@adecore/ui';
import i18next from 'i18next';
import { boundCommands, COMMAND_IDS, commandForKey, commandKey, COMMANDS, isCommandId, menuPlacesOf } from './command-table';
import { DEFAULT_KEYS } from './default-keys';
import { removeOverrideOf, setOverride } from './shortcut-overrides';

function keysOf(shortcut: Shortcut, apple: boolean): string {
    const meta = shortcut.meta || (shortcut.mod && apple);
    const ctrl = shortcut.ctrl || (shortcut.mod && !apple);
    return [meta && 'meta', ctrl && 'ctrl', shortcut.alt && 'alt', shortcut.shift && 'shift', shortcut.key].filter(Boolean).join('+');
}

describe('the command table', () => {
    test('every shortcut has a modifier', () => {
        // The bare keys CLAUDE.md allows, a drawing's tools and a prompt card's widget keys, are bound where they act and never here.
        for (const id of COMMAND_IDS) {
            const shortcut = commandKey(id);
            if (shortcut !== undefined) {
                const modified = shortcut.mod || shortcut.ctrl || shortcut.meta || shortcut.alt || shortcut.shift;
                expect(modified ? id : `${id} has no modifier`).toBe(id);
            }
        }
    });

    test('no two rows one listener binds share a key, on macOS or elsewhere', () => {
        for (const listener of ['window', 'workspace'] as const) {
            for (const apple of [true, false]) {
                const seen = new Map<string, string>();
                for (const [id, shortcut] of boundCommands(listener)) {
                    const keys = keysOf(shortcut, apple);
                    expect(seen.has(keys) ? `${id} and ${seen.get(keys)} share ${keys}` : id).toBe(id);
                    seen.set(keys, id);
                }
            }
        }
    });

    test('the window binds what the start screen needs, and the workspace the rest', () => {
        expect(
            boundCommands('window')
                .map(([id]) => id)
                .sort()
        ).toEqual(['chat-new', 'find-in-files', 'palette', 'settings', 'settings-search', 'sidebar', 'window-new']);
        expect(boundCommands('workspace').map(([id]) => id)).toContain('close-cell');
        expect(boundCommands('workspace').map(([id]) => id)).not.toContain('tab-close');
    });

    test('a row has the words of every place it shows in', () => {
        for (const id of COMMAND_IDS) {
            const { key, palette } = COMMANDS[id];
            if (menuPlacesOf(id).length > 0) {
                expect(i18next.exists(`shell:menu.${key}`) ? id : `${id} has no shell:menu.${key}`).toBe(id);
            }
            if (palette) {
                expect(i18next.exists(`shell:palette.commands.${key}`) ? id : `${id} has no shell:palette.commands.${key}`).toBe(id);
            }
        }
    });

    test('a row the palette does not have sits in the menu, or only has its key', () => {
        for (const id of COMMAND_IDS) {
            if (!COMMANDS[id].palette && COMMANDS[id].keyOnly !== true) {
                expect(menuPlacesOf(id).length > 0 ? id : `${id} is offered nowhere`).toBe(id);
            }
        }
    });

    test('every default key is the key of a row of the table', () => {
        for (const id of Object.keys(DEFAULT_KEYS)) {
            expect(isCommandId(id) ? id : `${id} is no row`).toBe(id);
        }
    });

    test('a row that shows the key of another names a row with a key of its own', () => {
        for (const id of COMMAND_IDS) {
            const { keyOf } = COMMANDS[id];

            if (keyOf !== undefined) {
                expect(Object.keys(DEFAULT_KEYS)).toContain(keyOf);
            }
        }
    });

    test('voice control and dictation are rows the workspace binds', () => {
        expect(boundCommands('workspace').map(([id]) => id)).toEqual(expect.arrayContaining(['voice-control', 'dictation']));
    });
});

describe('the command table after a rebind', () => {
    const chord = shortcut('Mod+Alt+Y');

    afterEach(() => {
        removeOverrideOf(['palette', 'close-cell', 'chat-text-larger', 'find', 'jumpToSource', 'cell-maximize']);
    });

    function press(target: Shortcut) {
        return { key: target.key.toLowerCase(), code: `Key${target.key}`, metaKey: true, ctrlKey: false, altKey: target.alt, shiftKey: target.shift };
    }

    test('the new key finds the row, and the old one finds none', () => {
        setOverride('palette', chord);

        expect(commandForKey('window', press(chord), true)).toBe('palette');
        expect(commandForKey('window', press(DEFAULT_KEYS.palette), true)).toBeNull();
        expect(commandKey('palette')).toBe(boundCommands('window').find(([id]) => id === 'palette')![1]);
    });

    test('a row a person rebound comes first, so a default of a later release never takes their key', () => {
        setOverride('palette', DEFAULT_KEYS.sidebar);

        expect(commandForKey('window', press(DEFAULT_KEYS.sidebar), true)).toBe('palette');
    });

    test('a row that shows the key of another moves with it', () => {
        expect(commandKey('tab-close')).toBe(DEFAULT_KEYS['close-cell']);
        expect(commandKey('node-maximize')).toBe(DEFAULT_KEYS['cell-maximize']);

        setOverride('close-cell', chord);
        setOverride('cell-maximize', chord);

        expect(commandKey('tab-close')).toEqual(chord);
        expect(commandKey('node-maximize')).toEqual(chord);
    });

    test('the aliases of a row stay with its own key', () => {
        const larger = (): number => boundCommands('workspace').filter(([id]) => id === 'chat-text-larger').length;

        expect(larger()).toBe(3);

        setOverride('chat-text-larger', chord);

        expect(larger()).toBe(1);
    });

    test('a command row of the editor shows the key its keymap row has now', () => {
        const before = commandKey('open-file-at-line');

        setOverride('jumpToSource', chord);

        expect(commandKey('open-file-at-line')).toEqual(chord);
        expect(before).not.toEqual(chord);
    });
});
