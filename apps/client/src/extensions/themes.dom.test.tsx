import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { activeExtensionTheme, applyStoredExtensionTheme, chooseExtensionTheme, refreshExtensionTheme, type ThemeChoice } from '@/extensions/themes';

const CHOICE: ThemeChoice = {
    key: 'acme.midnight/themes/midnight.json',
    extensionId: 'acme.midnight',
    path: 'themes/midnight.json',
    name: 'Midnight',
    theme: { name: 'Midnight', side: 'dark', tokens: { '--surface': '#000' } },
    cssUrl: null
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

    test('goes away with its extension', async () => {
        chooseExtensionTheme(CHOICE);

        await refreshExtensionTheme([]);

        expect(themeText()).toBeNull();
        expect(activeExtensionTheme()).toBeNull();
    });
});
