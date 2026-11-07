import { afterEach, describe, expect, test } from 'bun:test';
import { KEYMAP_IDS } from '@adecore/editor/keymap';
import { shortcut, shortcutText, type Shortcut } from '@adecore/ui';
import { DEFAULT_KEYS } from '@/shell/default-keys';
import {
    createShortcutOverrides,
    currentEditorKeymap,
    isRebound,
    keyIn,
    keyOf,
    overridesSnapshot,
    rebind,
    removeOverrideOf,
    SHORTCUT_OVERRIDES_KEY
} from '@/shell/shortcut-overrides';

function memoryStorage(initial?: unknown) {
    const items = new Map<string, string>();

    if (initial !== undefined) {
        items.set(SHORTCUT_OVERRIDES_KEY, typeof initial === 'string' ? initial : JSON.stringify(initial));
    }

    return {
        items,
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key)
    };
}

function writtenBy(storage: ReturnType<typeof memoryStorage>): Record<string, unknown> {
    return JSON.parse(storage.items.get(SHORTCUT_OVERRIDES_KEY) ?? '{}') as Record<string, unknown>;
}

function textOf(found: Shortcut | undefined): string | undefined {
    return found === undefined ? undefined : shortcutText(found);
}

describe('the stored overrides', () => {
    test('read the entries that parse and ignore the rest', () => {
        const storage = memoryStorage({ palette: 'Mod+Shift+K', find: 'Mod+Bogus', fit: 5, 'split-right': 'Mod', 'view-new': '' });
        const { snapshot } = createShortcutOverrides(() => storage);

        expect([...snapshot().keys.keys()]).toEqual(['palette']);
        expect(textOf(snapshot().keys.get('palette'))).toBe('Mod+Shift+K');
    });

    test('keep an entry they ignore, and an id this release does not know, through a write', () => {
        const storage = memoryStorage({ find: 'Mod+Bogus', 'a-future-row': 'Mod+9', fit: 5 });
        const overrides = createShortcutOverrides(() => storage);

        overrides.set('palette', shortcut('Mod+Shift+K'));
        overrides.remove('palette');
        overrides.set('sidebar', shortcut('Mod+Alt+K'));

        expect(writtenBy(storage)).toEqual({ find: 'Mod+Bogus', 'a-future-row': 'Mod+9', fit: 5, sidebar: 'Mod+Alt+K' });
    });

    test('start empty over a storage that is missing, broken or not a map', () => {
        for (const storage of [memoryStorage(), memoryStorage('{nope'), memoryStorage('[1,2]')]) {
            expect(createShortcutOverrides(() => storage).snapshot().keys.size).toBe(0);
        }

        expect(createShortcutOverrides(() => null).snapshot().keys.size).toBe(0);
    });

    test('keep a change for the session when the storage refuses it', () => {
        const refusing = {
            getItem: () => null,
            setItem: () => {
                throw new Error('full');
            },
            removeItem: () => undefined
        };
        const overrides = createShortcutOverrides(() => refusing);

        overrides.set('palette', shortcut('Mod+Shift+K'));

        expect(textOf(overrides.snapshot().keys.get('palette'))).toBe('Mod+Shift+K');
    });

    test('restore only the ids they are given', () => {
        const storage = memoryStorage({ palette: 'Mod+Shift+K', find: 'Mod+Alt+K', 'a-future-row': 'Mod+9' });
        const overrides = createShortcutOverrides(() => storage);

        overrides.removeMany(['palette', 'find']);

        expect(writtenBy(storage)).toEqual({ 'a-future-row': 'Mod+9' });
    });

    test('tell a listener about a change, hand it a new snapshot, and stop at unsubscribe', () => {
        const overrides = createShortcutOverrides(() => memoryStorage());
        const before = overrides.snapshot();
        let heard = 0;
        const stop = overrides.subscribe(() => heard++);

        overrides.set('palette', shortcut('Mod+Shift+K'));
        expect(heard).toBe(1);
        expect(overrides.snapshot()).not.toBe(before);

        overrides.removeMany(['unknown']);
        expect(heard).toBe(1);

        stop();
        overrides.remove('palette');
        expect(heard).toBe(1);
    });

    test('follow a write of another window when told to read again', () => {
        const storage = memoryStorage();
        const overrides = createShortcutOverrides(() => storage);
        let heard = 0;
        overrides.subscribe(() => heard++);

        storage.setItem(SHORTCUT_OVERRIDES_KEY, JSON.stringify({ palette: 'Mod+Shift+K' }));
        overrides.reload();

        expect(textOf(overrides.snapshot().keys.get('palette'))).toBe('Mod+Shift+K');
        expect(heard).toBe(1);
    });
});

describe('the key of a row', () => {
    test('is the default until a person changes it', () => {
        const { snapshot } = createShortcutOverrides(() => memoryStorage());

        expect(keyIn(snapshot(), 'palette')).toBe(DEFAULT_KEYS.palette);
    });

    test('is the override of a command row and of a key of the editor', () => {
        const { snapshot } = createShortcutOverrides(() => memoryStorage({ palette: 'Mod+Shift+K', goToSymbol: 'Mod+Alt+Y' }));

        expect(textOf(keyIn(snapshot(), 'palette'))).toBe('Mod+Shift+K');
        expect(textOf(keyIn(snapshot(), 'goToSymbol'))).toBe('Mod+Alt+Y');
        expect(textOf(keyIn(snapshot(), 'find'))).toBe('Mod+F');
    });

    test('is the keymap of the editor with its overrides, on every platform', () => {
        const { snapshot } = createShortcutOverrides(() => memoryStorage({ goToSymbol: 'Mod+Alt+Y', palette: 'Mod+Shift+K' }));
        const keymap = currentEditorKeymap(snapshot());

        expect(keymap.goToSymbol).toMatchObject({ mac: 'Mod+Alt+Y', other: 'Mod+Alt+Y' });
        expect(currentEditorKeymap(snapshot())).toBe(keymap);
    });

    test('keeps the rest of the keymap as Ruimte defines it', () => {
        const keymap = currentEditorKeymap(createShortcutOverrides(() => memoryStorage({ goToSymbol: 'Mod+Alt+Y' })).snapshot());

        expect(keymap.expandSelection.other).toBe('Alt+ArrowUp');
        expect(keymap.selectionToChat.mac).toBe('Mod+Alt+K');
    });

    test('has no id that is both a command row and a key of the editor', () => {
        const keymapIds = new Set<string>(KEYMAP_IDS);

        expect(Object.keys(DEFAULT_KEYS).filter((id) => keymapIds.has(id))).toEqual([]);
    });
});

describe('a rebind of the app', () => {
    afterEach(() => {
        removeOverrideOf(['palette', 'goToSymbol']);
    });

    test('is the key of its row at once, and the default again when the default is recorded', () => {
        rebind('palette', shortcut('Mod+Alt+Y'));
        expect(textOf(keyOf('palette'))).toBe('Mod+Alt+Y');
        expect(isRebound(overridesSnapshot(), 'palette')).toBe(true);

        rebind('palette', shortcut('Mod+K'));
        expect(keyOf('palette')).toBe(DEFAULT_KEYS.palette);
        expect(isRebound(overridesSnapshot(), 'palette')).toBe(false);
    });

    test('reaches the keymap an open editor reads on every key press', () => {
        const before = currentEditorKeymap();

        rebind('goToSymbol', shortcut('Mod+Alt+Y'));

        expect(currentEditorKeymap().goToSymbol).toMatchObject({ mac: 'Mod+Alt+Y', other: 'Mod+Alt+Y' });
        expect(currentEditorKeymap()).not.toBe(before);
        expect(before.goToSymbol.mac).not.toBe('Mod+Alt+Y');
    });
});
