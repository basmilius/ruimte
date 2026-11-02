import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AppearancePane } from '@/shell/settings/panes/AppearancePane';
import { useSettings } from '@/state/settings';
import { mount } from '../../testing/dom';
import { activeExtensionTheme, applyStoredExtensionTheme, chooseExtensionTheme, refreshExtensionTheme, type ThemeChoice } from '@/extensions/themes';

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

    test('goes away with its extension', async () => {
        chooseExtensionTheme(CHOICE);

        await refreshExtensionTheme([]);

        expect(themeText()).toBeNull();
        expect(activeExtensionTheme()).toBeNull();
    });
});
