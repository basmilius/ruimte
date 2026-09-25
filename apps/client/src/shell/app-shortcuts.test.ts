import { describe, expect, test } from 'bun:test';
import { appShortcutFor } from './app-shortcuts';
import type { KeyLike } from '@/ui/shortcut';

const key = (patch: Partial<KeyLike>): KeyLike => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: '', code: '', ...patch });

const mac = { inNode: false, apple: true, settingsOpen: false };
const other = { inNode: false, apple: false, settingsOpen: false };

describe('the shortcuts of the window', () => {
    test('the palette, find in files and the settings open over the workspace and the start screen alike', () => {
        expect(appShortcutFor(key({ metaKey: true, key: 'k', code: 'KeyK' }), mac)).toBe('palette');
        expect(appShortcutFor(key({ metaKey: true, shiftKey: true, key: 'F', code: 'KeyF' }), mac)).toBe('find-in-files');
        expect(appShortcutFor(key({ metaKey: true, key: ',', code: 'Comma' }), mac)).toBe('settings');
        expect(appShortcutFor(key({ ctrlKey: true, key: 'k', code: 'KeyK' }), other)).toBe('palette');
        expect(appShortcutFor(key({ ctrlKey: true, shiftKey: true, key: 'F', code: 'KeyF' }), other)).toBe('find-in-files');
        expect(appShortcutFor(key({ ctrlKey: true, key: ',', code: 'Comma' }), other)).toBe('settings');
    });

    test('the modifier is strict: Ctrl on macOS and Meta elsewhere open nothing', () => {
        expect(appShortcutFor(key({ ctrlKey: true, key: 'k', code: 'KeyK' }), mac)).toBeNull();
        expect(appShortcutFor(key({ metaKey: true, key: 'k', code: 'KeyK' }), other)).toBeNull();
        expect(appShortcutFor(key({ metaKey: true, ctrlKey: true, key: 'k', code: 'KeyK' }), mac)).toBeNull();
        expect(appShortcutFor(key({ metaKey: true, altKey: true, key: 'k', code: 'KeyK' }), mac)).toBeNull();
    });

    test('the sidebar is chrome of the window, and so is its shortcut', () => {
        expect(appShortcutFor(key({ metaKey: true, key: 'b', code: 'KeyB' }), mac)).toBe('sidebar');
    });

    test('off macOS Ctrl+B stays out of a node, where readline owns it', () => {
        expect(appShortcutFor(key({ ctrlKey: true, key: 'b', code: 'KeyB' }), { inNode: true, apple: false, settingsOpen: false })).toBeNull();
        expect(appShortcutFor(key({ ctrlKey: true, key: 'b', code: 'KeyB' }), other)).toBe('sidebar');
        expect(appShortcutFor(key({ metaKey: true, key: 'b', code: 'KeyB' }), { inNode: true, apple: true, settingsOpen: false })).toBe('sidebar');
    });

    test('a shortcut that acts on one project is not one of them', () => {
        /* These belong to the open project, which binds them, so the start screen has none of them. */
        expect(appShortcutFor(key({ metaKey: true, key: '1', code: 'Digit1' }), mac)).toBeNull();
        expect(appShortcutFor(key({ metaKey: true, key: 't', code: 'KeyT' }), mac)).toBeNull();
        expect(appShortcutFor(key({ metaKey: true, shiftKey: true, key: ']', code: 'BracketRight' }), mac)).toBeNull();
        expect(appShortcutFor(key({ metaKey: true, altKey: true, key: 'b', code: 'KeyB' }), mac)).toBeNull();
        expect(appShortcutFor(key({ metaKey: true, key: 'z', code: 'KeyZ' }), mac)).toBeNull();
    });

    test('Mod+F searches the settings while they are open, and is the canvas find otherwise', () => {
        const find = key({ metaKey: true, key: 'f', code: 'KeyF' });
        expect(appShortcutFor(find, { ...mac, settingsOpen: true })).toBe('settings-search');
        expect(appShortcutFor(key({ ctrlKey: true, key: 'f', code: 'KeyF' }), { ...other, settingsOpen: true })).toBe('settings-search');
        expect(appShortcutFor(find, mac)).toBeNull();
    });

    test('a key without the modifier belongs to nobody', () => {
        expect(appShortcutFor(key({ key: 'k', code: 'KeyK' }), mac)).toBeNull();
        expect(appShortcutFor(key({ key: 'b', code: 'KeyB' }), mac)).toBeNull();
    });
});
