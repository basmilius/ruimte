import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { assertShortcut, matchesExtensionShortcut } from '@/extensions/action-shortcuts';
import { useContributions } from '@/extensions/registry';
import { wantsLoading } from '@/extensions/activation';
import { loadPoc } from '../../testing/poc';

let extension: LoadedExtension;

beforeAll(async () => {
    extension = await loadPoc('chat');
});
afterAll(() => extension.disposers.forEach((dispose) => dispose()));

describe('poc-chat', () => {
    test('a slash command expands into the prompt, with what follows it', async () => {
        const command = useContributions.getState().slashCommands.find((each) => each.name === 'review');

        expect(await command?.expand('the parser')).toContain('Review the parser');
    });

    test('a reference comes down to text', async () => {
        const [reference] = useContributions.getState().references;
        const [issue] = (await reference?.list()) ?? [];

        expect(await reference?.read(issue as { id: string; name: string })).toContain('login fails');
    });

    test('offers voice, settings, a template and a diff viewer', () => {
        const state = useContributions.getState();

        expect(state.voiceActions.map((action) => action.id)).toEqual(['poc.chat/count']);
        expect(state.extensionSchemas[0]?.fields.map((field) => field.key)).toEqual(['greeting', 'loud', 'tone']);
        expect(state.slotEntries.some((entry) => entry.id === 'poc.chat/template/trio' && entry.addsNode === true)).toBe(true);
        expect(state.diffViewers[0]?.extensions).toEqual(['poc']);
    });
});

describe('a shortcut', () => {
    test('needs a modifier, as every shortcut in Ruimte', () => {
        expect(() => assertShortcut('k')).toThrow('no modifier');
        expect(() => assertShortcut('shift+k')).toThrow('no modifier');
        expect(() => assertShortcut('mod+k')).not.toThrow();
    });

    test('matches only its own keys', () => {
        const press = { key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: true };

        expect(matchesExtensionShortcut('mod+alt+k', press, true)).toBe(true);
        expect(matchesExtensionShortcut('mod+k', press, true)).toBe(false);
        expect(matchesExtensionShortcut('mod+alt+k', press, false)).toBe(false);
    });
});

describe('activation', () => {
    test('loads with the app unless it names when', () => {
        expect(wantsLoading(undefined)).toBe(true);
        expect(wantsLoading(['start'])).toBe(true);
        expect(wantsLoading(['node:never-on-this-canvas'])).toBe(false);
    });
});
