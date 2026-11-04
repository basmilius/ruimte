import { describe, expect, test } from 'bun:test';
import type { Shortcut } from '@adecore/ui';
import i18next from 'i18next';
import { boundCommands, COMMAND_IDS, COMMANDS, menuPlacesOf } from './command-table';

function keysOf(shortcut: Shortcut, apple: boolean): string {
    const meta = shortcut.meta || (shortcut.mod && apple);
    const ctrl = shortcut.ctrl || (shortcut.mod && !apple);
    return [meta && 'meta', ctrl && 'ctrl', shortcut.alt && 'alt', shortcut.shift && 'shift', shortcut.key].filter(Boolean).join('+');
}

describe('the command table', () => {
    test('every shortcut has a modifier', () => {
        // The bare keys CLAUDE.md allows, a drawing's tools and a prompt card's widget keys, are bound where they act and never here.
        for (const id of COMMAND_IDS) {
            const shortcut = COMMANDS[id].shortcut;
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

    test('a row the palette does not have sits in the menu', () => {
        for (const id of COMMAND_IDS) {
            if (!COMMANDS[id].palette) {
                expect(menuPlacesOf(id).length > 0 ? id : `${id} is offered nowhere`).toBe(id);
            }
        }
    });
});
