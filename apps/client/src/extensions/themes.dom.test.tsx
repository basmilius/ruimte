import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { defineTheme } from '@/extensions/internal';
import { contribute, type BuiltInThemeContribution } from '@/extensions/registry';
import {
    activeExtensionTheme,
    applyStoredExtensionTheme,
    chooseExtensionTheme,
    listExtensionThemes,
    refreshExtensionTheme,
    type ThemeChoice
} from '@/extensions/themes';
import { AppearancePane } from '@/shell/settings/panes/AppearancePane';
import { useSettings } from '@/state/settings';
import { mount } from '../../testing/dom';

const CHOICE: ThemeChoice = {
    key: 'acme.midnight/themes/midnight.json',
    extensionId: 'acme.midnight',
    path: 'themes/midnight.json',
    name: 'Midnight',
    theme: { name: 'Midnight', side: 'dark', thumbnail: 'themes/midnight.png', tokens: { '--surface': '#000' } },
    cssUrl: null,
    thumbnailUrl: '/themes/midnight.png'
};

function themeText(): string | null {
    return document.getElementById('ruimte-extension-theme')?.textContent ?? null;
}

describe('an extension theme', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => chooseExtensionTheme(null));

    test('writes its tokens under its side, and comes back on the next start', () => {
        chooseExtensionTheme(CHOICE);

        expect(themeText()).toContain(`[data-theme='dark'][data-theme] { --surface: #000; }`);

        document.getElementById('ruimte-extension-theme')?.remove();
        applyStoredExtensionTheme();

        expect(themeText()).toContain('--surface: #000');
    });

    test('stays ahead of the palette, so a person keeps their accent', () => {
        const palette = document.createElement('style');

        palette.id = 'ruimte-palette';
        document.head.append(palette);
        chooseExtensionTheme(CHOICE);

        const theme = document.getElementById('ruimte-extension-theme') as HTMLElement;

        expect(theme.compareDocumentPosition(palette) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        palette.remove();
    });

    test('keeps the palette at its default while it is on, and gives back the chosen one after', async () => {
        useSettings.getState().update({ palette: 'stone' });
        const palette = () => document.getElementById('ruimte-palette')?.textContent ?? '';
        const withStone = palette();

        chooseExtensionTheme(CHOICE);

        expect(palette()).not.toBe(withStone);

        const page = mount();

        await page.render(<AppearancePane />);

        expect(page.host.textContent).toContain('Accent');
        expect(page.host.textContent).not.toContain('Palette');
        await page.unmount();

        chooseExtensionTheme(null);

        expect(palette()).toBe(withStone);
        useSettings.getState().update({ palette: 'default' });
    });

    test('stops painting while its extension is off, and stays chosen', async () => {
        const installed = {
            manifest: { id: 'acme.midnight', name: 'Midnight', version: '0.1.0', api: 1 },
            base: '/',
            enabled: false,
            hasClient: false,
            dev: false
        };

        chooseExtensionTheme(CHOICE);

        await refreshExtensionTheme([installed]);

        expect(themeText()).toBeNull();
        expect(activeExtensionTheme()).toBe(CHOICE.key);
    });

    test('a refresh that waited on the theme files never undoes a theme chosen meanwhile', async () => {
        const installed = {
            manifest: { id: 'acme.midnight', name: 'Midnight', version: '0.1.0', api: 1, themes: ['themes/midnight.json'] },
            base: '/__extensions/acme.midnight/x/',
            enabled: true,
            hasClient: false,
            dev: false
        };
        const previousFetch = globalThis.fetch;
        let answer: (response: Response) => void = () => undefined;
        globalThis.fetch = (() => new Promise<Response>((resolve) => (answer = resolve))) as unknown as typeof fetch;

        try {
            chooseExtensionTheme(CHOICE);
            const refreshing = refreshExtensionTheme([installed]);
            chooseExtensionTheme(null);
            answer(new Response(JSON.stringify({ ...CHOICE.theme, tokens: { '--surface': '#111' } })));
            await refreshing;

            expect(activeExtensionTheme()).toBeNull();
            expect(themeText()).toBeNull();
        } finally {
            globalThis.fetch = previousFetch;
        }
    });

    test('goes away with its extension', async () => {
        chooseExtensionTheme(CHOICE);

        await refreshExtensionTheme([]);

        expect(themeText()).toBeNull();
        expect(activeExtensionTheme()).toBeNull();
    });
});

describe("a built-in's theme", () => {
    const DUSK: BuiltInThemeContribution = {
        id: 'acme.dusk/dusk',
        extensionId: 'acme.dusk',
        theme: { name: 'Dusk', side: 'dark', thumbnail: 'dusk.svg', tokens: { '--surface': '#010101' } },
        thumbnailUrl: 'data:,'
    };
    let takeBuiltInOut = (): void => {};
    let takeThemeOut = (): void => {};

    async function dusk(): Promise<ThemeChoice> {
        const choice = (await listExtensionThemes([])).find((each) => each.key === DUSK.id);

        if (choice === undefined) {
            throw new Error('Dusk is not offered');
        }

        return choice;
    }

    beforeEach(() => {
        localStorage.clear();
        takeBuiltInOut = contribute('builtIns', {
            id: 'acme.dusk',
            manifest: { id: 'acme.dusk', name: 'Dusk', version: '1.0.0', api: 1 },
            setEnabled: () => {}
        });
        takeThemeOut = defineTheme(DUSK);
    });

    afterEach(() => {
        chooseExtensionTheme(null);
        takeThemeOut();
        takeBuiltInOut();
    });

    test('is offered with no extension installed, and stays chosen through a refresh', async () => {
        chooseExtensionTheme(await dusk());
        await refreshExtensionTheme([]);

        expect(themeText()).toContain('--surface: #010101');
        expect(activeExtensionTheme()).toBe(DUSK.id);
    });

    test('leaves the page while its built-in is off, and comes back with it', async () => {
        chooseExtensionTheme(await dusk());
        takeThemeOut();

        expect(themeText()).toBeNull();
        expect(activeExtensionTheme()).toBe(DUSK.id);

        takeThemeOut = defineTheme(DUSK);

        expect(themeText()).toContain('--surface: #010101');
    });
});
