import { describe, expect, test } from 'bun:test';
import type { KeyLike } from '@adecore/ui';
import { behaviorOf, type KeyPress } from '@/commands/behavior';
import { commandForKey } from '@/commands/registry';
import { useUi } from '@/state/ui';

function key(patch: Partial<KeyLike>): KeyLike {
    return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: '', code: '', ...patch };
}

const windowKey = (patch: Partial<KeyLike>, apple: boolean): string | null => commandForKey('window', key(patch), apple);

function pressOn(target: EventTarget | null, apple: boolean): KeyPress {
    const event = new KeyboardEvent('keydown', { cancelable: true });
    Object.defineProperty(event, 'target', { value: target });

    return { event, apple, onCanvas: () => false, is: () => false };
}

describe('the keys of the window', () => {
    test('the palette, find in files and the settings open over the workspace and the start screen alike', () => {
        expect(windowKey({ metaKey: true, key: 'k', code: 'KeyK' }, true)).toBe('palette');
        expect(windowKey({ metaKey: true, shiftKey: true, key: 'F', code: 'KeyF' }, true)).toBe('find-in-files');
        expect(windowKey({ metaKey: true, key: ',', code: 'Comma' }, true)).toBe('settings');
        expect(windowKey({ ctrlKey: true, key: 'k', code: 'KeyK' }, false)).toBe('palette');
        expect(windowKey({ ctrlKey: true, shiftKey: true, key: 'F', code: 'KeyF' }, false)).toBe('find-in-files');
        expect(windowKey({ ctrlKey: true, key: ',', code: 'Comma' }, false)).toBe('settings');
    });

    test('Project settings has the key beside the one of Settings, only where a project is open', () => {
        const semicolon = key({ metaKey: true, key: ';', code: 'Semicolon' });

        expect(commandForKey('workspace', semicolon, true)).toBe('project-settings');
        expect(commandForKey('workspace', key({ ctrlKey: true, key: ';', code: 'Semicolon' }), false)).toBe('project-settings');
        expect(commandForKey('window', semicolon, true)).toBeNull();
    });

    test('the modifier is strict: Ctrl on macOS and Meta elsewhere open nothing', () => {
        expect(windowKey({ ctrlKey: true, key: 'k', code: 'KeyK' }, true)).toBeNull();
        expect(windowKey({ metaKey: true, key: 'k', code: 'KeyK' }, false)).toBeNull();
        expect(windowKey({ metaKey: true, ctrlKey: true, key: 'k', code: 'KeyK' }, true)).toBeNull();
        expect(windowKey({ metaKey: true, altKey: true, key: 'k', code: 'KeyK' }, true)).toBeNull();
    });

    test('a new window and a new chat are keys of the window', () => {
        expect(windowKey({ metaKey: true, shiftKey: true, key: 'N', code: 'KeyN' }, true)).toBe('window-new');
        expect(windowKey({ ctrlKey: true, shiftKey: true, key: 'N', code: 'KeyN' }, false)).toBe('window-new');
        expect(windowKey({ metaKey: true, altKey: true, key: 'n', code: 'KeyN' }, true)).toBe('chat-new');
        expect(windowKey({ ctrlKey: true, altKey: true, key: 'n', code: 'KeyN' }, false)).toBe('chat-new');
        expect(windowKey({ altKey: true, key: 'n', code: 'KeyN' }, true)).toBeNull();
    });

    test('a new window opens only where the shell keeps windows', () => {
        const taken = behaviorOf('window-new')!.key!(pressOn(null, true));

        expect(taken).toBe(false);
    });

    test('the sidebar is chrome of the window, and so is its shortcut', () => {
        expect(windowKey({ metaKey: true, key: 'b', code: 'KeyB' }, true)).toBe('sidebar');
    });

    test('off macOS Ctrl+B stays out of a node, where readline owns it', () => {
        const node = document.createElement('div');
        node.setAttribute('data-node-body', '');
        const inside = document.createElement('input');
        node.append(inside);
        document.body.append(node);
        try {
            const before = useUi.getState().sidebarOpen;
            const sidebar = behaviorOf('sidebar')!;

            expect(sidebar.key!(pressOn(inside, false))).toBe(false);
            expect(useUi.getState().sidebarOpen).toBe(before);
            expect(sidebar.key!(pressOn(inside, true))).toBe(true);
            expect(useUi.getState().sidebarOpen).toBe(!before);
            useUi.getState().setSidebarOpen(before);
        } finally {
            node.remove();
        }
    });

    test('a shortcut that acts on one project is not one of the window', () => {
        expect(windowKey({ metaKey: true, key: '1', code: 'Digit1' }, true)).toBeNull();
        expect(windowKey({ metaKey: true, key: 't', code: 'KeyT' }, true)).toBeNull();
        expect(windowKey({ metaKey: true, altKey: true, key: 'b', code: 'KeyB' }, true)).toBeNull();
        expect(windowKey({ metaKey: true, key: 'z', code: 'KeyZ' }, true)).toBeNull();
    });

    test('Mod+F searches the settings while they are open, and is the canvas find otherwise', () => {
        const search = behaviorOf('settings-search')!;
        const open = useUi.getState().settings;
        useUi.getState().setSettings({ open: false });

        expect(commandForKey('window', key({ metaKey: true, key: 'f', code: 'KeyF' }), true)).toBe('settings-search');
        expect(search.key!(pressOn(null, true))).toBe(false);
        useUi.getState().setSettings({ open: true, searchAt: 0 });
        expect(search.key!(pressOn(null, true))).toBe(true);
        expect(useUi.getState().settings.searchAt).toBe(1);
        useUi.getState().setSettings(open);
    });

    test('a key without the modifier belongs to nobody', () => {
        expect(windowKey({ key: 'k', code: 'KeyK' }, true)).toBeNull();
        expect(windowKey({ key: 'b', code: 'KeyB' }, true)).toBeNull();
    });
});
