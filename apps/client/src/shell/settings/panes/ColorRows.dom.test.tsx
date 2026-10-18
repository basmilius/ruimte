import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { AccentRow, PaletteRow } from '@/shell/settings/panes/ColorRows';
import { useSettings } from '@/state/settings';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';

let page: Mounted;

function everything(): string {
    return document.body.textContent ?? '';
}

function button(label: string): HTMLButtonElement | null {
    return [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === label) ?? null;
}

function swatch(label: string, wheel = 'Palette'): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${wheel}"] [aria-label="${label}"]`);
}

/* The accent the app wears on the light side now, as the palette's stylesheet writes it. */
function accentWorn(): string | undefined {
    return /\[data-theme='light'\]\[data-theme\] \{[^}]*--accent: (#[0-9a-f]{6});/.exec(document.getElementById('ruimte-palette')?.textContent ?? '')?.[1];
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
    await act(async () => useSettings.getState().update({ palette: 'default', accent: 'blue' }));
});

afterEach(async () => {
    await page.unmount();
});

describe('Settings > Appearance > Palette', () => {
    test('the wheel opens on the palette in use and leaves the app in its colors', async () => {
        await openWheel();
        await until(() => document.activeElement === swatch('Default'));
        expect(wearsTint()).toBe(false);
        // The ring marks the one in use; a tick on a swatch of two tones read as a glitch.
        expect(swatch('Default')?.querySelector('svg')).toBeNull();
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

    test('a wheel taken away while it previews puts the picked colors back', async () => {
        await openWheel();
        await act(async () => swatch('Teal')?.focus());
        expect(wearsTint()).toBe(true);
        await page.unmount();
        expect(wearsTint()).toBe(false);
        // The shared cleanup unmounts again, which a root that is gone already ignores.
        page = mount();
    });

    test('a click picks the palette and keeps the app in it', async () => {
        await openWheel();
        await clickOn(swatch('Mauve'));
        await until(() => button('Mauve') !== null);
        expect(useSettings.getState().palette).toBe('mauve');
        expect(wearsTint()).toBe(true);
    });
});

describe('Settings > Appearance > Accent', () => {
    async function openAccentWheel(): Promise<void> {
        page = mount();
        await page.render(<AccentRow />);
        await until(() => button('Blue') !== null);
        await clickOn(button('Blue'));
        await until(() => swatch('Orange', 'Accent') !== null);
    }

    test('the wheel opens on the accent in use and a focus previews another until it closes', async () => {
        await openAccentWheel();
        await until(() => document.activeElement === swatch('Blue', 'Accent'));
        expect(accentWorn()).toBe('#155dfc');
        await act(async () => swatch('Orange', 'Accent')?.focus());
        expect(accentWorn()).toBe('#f54900');
        await act(async () => {
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await until(() => swatch('Orange', 'Accent') === null);
        expect(accentWorn()).toBe('#155dfc');
        expect(useSettings.getState().accent).toBe('blue');
    });

    test('a click picks the accent', async () => {
        await openAccentWheel();
        await clickOn(swatch('Pink', 'Accent'));
        await until(() => button('Pink') !== null);
        expect(useSettings.getState().accent).toBe('pink');
        expect(accentWorn()).toBe('#e60076');
    });
});
