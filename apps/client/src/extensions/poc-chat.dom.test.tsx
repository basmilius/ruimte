import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { assertShortcut, matchesExtensionShortcut } from '@/extensions/action-shortcuts';
import { wantsLoading } from '@/extensions/activation';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { useInstalledExtensions } from '@/extensions/loader';
import { useContributions } from '@/state/extension-registry';
import { useToasts } from '@/state/toasts';
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
        expect(wantsLoading('acme.chat', undefined)).toBe(true);
        expect(wantsLoading('acme.chat', ['start'])).toBe(true);
        expect(wantsLoading('acme.chat', ['node:never-on-this-canvas'])).toBe(false);
    });
});

describe('settings in groups', () => {
    test('draws a titled card per group, and every key still reads by itself', async () => {
        const { SchemaSettings } = await import('@/extensions/SchemaSettings');
        const { mount } = await import('../../testing/dom');
        const page = mount();

        await page.render(<SchemaSettings id="poc.chat" />);

        const text = page.host.textContent ?? '';

        expect(text.indexOf('Greeting')).toBeLessThan(text.indexOf('Loud'));
        expect(text.indexOf('Loud')).toBeLessThan(text.indexOf('Style'));
        expect(text.indexOf('Style')).toBeLessThan(text.indexOf('Tone'));
        expect(useContributions.getState().extensionSchemas[0]?.groups.map((group) => group.title)).toEqual(['Greeting', 'Style']);
        await page.unmount();
    });

    test('says when the browser refused a setting, and keeps the switch where it was', async () => {
        const { SchemaSettings } = await import('@/extensions/SchemaSettings');
        const { clickOn, mount } = await import('../../testing/dom');
        const page = mount();
        const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        // A browser whose storage is full, or turned off for the page.
        const full: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
            getItem: () => null,
            setItem: () => {
                throw new DOMException('The quota has been exceeded', 'QuotaExceededError');
            },
            removeItem: () => undefined
        };

        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: full });
        useInstalledExtensions.setState({ installed: [{ manifest: extension.manifest, base: '/', enabled: true, hasClient: true, dev: false }] });

        try {
            await page.render(<SchemaSettings id="poc.chat" />);
            await clickOn(page.host.querySelector('[role="switch"]'));

            expect(page.host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
            expect(useToasts.getState().toasts.map((toast) => [toast.title, toast.description])).toContainEqual([
                'POC chat could not keep what it stores',
                'Loud'
            ]);
        } finally {
            await page.unmount();

            if (before !== undefined) {
                Object.defineProperty(globalThis, 'localStorage', before);
            }
        }
    });
});
