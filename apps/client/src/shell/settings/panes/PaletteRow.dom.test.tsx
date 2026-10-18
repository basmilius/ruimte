import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { PaletteRow } from '@/shell/settings/panes/PaletteRow';
import { useSettings } from '@/state/settings';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';

let page: Mounted;

function everything(): string {
    return document.body.textContent ?? '';
}

function button(label: string): HTMLButtonElement | null {
    return [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === label) ?? null;
}

function swatch(label: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="Palette"] [aria-label="${label}"]`);
}

/* The colors the app wears now: the palette's stylesheet sets the grounds only for a palette other than the default. */
function wearsTint(): boolean {
    return document.getElementById('ruimte-palette')?.textContent?.includes('--bg:') ?? false;
}

async function openWheel(): Promise<void> {
    // The row alone: the pane around it reads its languages through a bundler glob a test run has not.
    page = mount();
    await page.render(<PaletteRow />);
    await until(() => button('Default') !== null);
    await clickOn(button('Default'));
    await until(() => swatch('Teal') !== null);
}

beforeEach(async () => {
    await act(async () => useSettings.getState().update({ palette: 'default' }));
});

afterEach(async () => {
    await page.unmount();
});

describe('Settings > Appearance > Palette', () => {
    test('the wheel opens on the palette in use and leaves the app in its colors', async () => {
        await openWheel();
        await until(() => document.activeElement === swatch('Default'));
        expect(wearsTint()).toBe(false);
        expect(useSettings.getState().palette).toBe('default');
    });

    test('a palette with the focus dresses the app until the wheel closes without a pick', async () => {
        await openWheel();
        await act(async () => swatch('Teal')?.focus());
        expect(wearsTint()).toBe(true);
        expect(everything()).toContain('Teal');
        await act(async () => {
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await until(() => swatch('Teal') === null);
        expect(wearsTint()).toBe(false);
        expect(useSettings.getState().palette).toBe('default');
    });

    test('a click picks the palette and keeps the app in it', async () => {
        await openWheel();
        await clickOn(swatch('Mauve'));
        await until(() => button('Mauve') !== null);
        expect(useSettings.getState().palette).toBe('mauve');
        expect(wearsTint()).toBe(true);
    });
});
