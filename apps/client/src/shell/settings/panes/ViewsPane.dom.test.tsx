import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { searchSettings } from '@/shell/settings/search';
import { ViewsPane } from '@/shell/settings/panes/ViewsPane';
import { SETTINGS_STORAGE_KEY, useSettings } from '@/state/settings';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';

let page: Mounted;

function choice(label: string): HTMLElement | null {
    const group = document.querySelector('[role="radiogroup"][aria-label="Render distance"]');
    return ([...(group?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])] as HTMLElement[]).find((radio) => radio.textContent === label) ?? null;
}

beforeEach(async () => {
    await act(async () => useSettings.getState().update({ canvasRenderDistance: 'standard' }));
});

afterEach(async () => {
    await page.unmount();
    await act(async () => useSettings.getState().update({ canvasRenderDistance: 'standard' }));
});

describe('Settings > Views > Canvas > Render distance', () => {
    test('offers three distances under Canvas, starts on Standard and keeps the one a person picks', async () => {
        page = mount();
        await page.render(<ViewsPane />);
        await until(() => choice('Far') !== null);
        expect(['Standard', 'Far', 'Unlimited'].map((label) => choice(label)?.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);

        await clickOn(choice('Far'));
        expect(choice('Far')?.getAttribute('aria-checked')).toBe('true');
        expect(useSettings.getState().canvasRenderDistance).toBe('far');
        expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}').canvasRenderDistance).toBe('far');
    });

    test('is found by a search for its words', () => {
        expect(searchSettings('render distance')[0]).toMatchObject({ section: 'views', id: 'views.canvas.renderDistance' });
        expect(searchSettings('still picture').map((result) => result.id)).toContain('views.canvas.renderDistance');
    });
});
