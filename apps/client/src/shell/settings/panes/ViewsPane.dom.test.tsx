import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { ViewsPane } from '@/shell/settings/panes/ViewsPane';
import { searchSettings } from '@/shell/settings/search';
import { SETTINGS_STORAGE_KEY, useSettings } from '@/state/settings';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';

let page: Mounted;

function choice(label: string): HTMLElement | null {
    const group = document.querySelector('[role="radiogroup"][aria-label="Render distance"]');
    return ([...(group?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])] as HTMLElement[]).find((radio) => radio.textContent === label) ?? null;
}

beforeEach(async () => {
    await act(async () => useSettings.getState().update({ canvasRenderDistance: 'standard', sidebarNodeSort: 'canvas', sidebarNodeSortThen: 'recent' }));
});

afterEach(async () => {
    await page.unmount();
    await act(async () => useSettings.getState().update({ canvasRenderDistance: 'standard', sidebarNodeSort: 'canvas', sidebarNodeSortThen: 'recent' }));
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

describe('Settings > Views > Canvas > Order in the sidebar', () => {
    const row = (label: string) =>
        [...document.querySelectorAll<HTMLElement>('*')].some((element) => element.childElementCount === 0 && element.textContent === label);

    test('sits under Canvas and asks for the order within a kind or status only when there is one', async () => {
        page = mount();
        await page.render(<ViewsPane />);
        await until(() => row('Order in the sidebar'));
        expect(row('Within a kind or status')).toBe(false);

        await act(async () => useSettings.getState().update({ sidebarNodeSort: 'status' }));
        await until(() => row('Within a kind or status'));
        await act(async () => useSettings.getState().update({ sidebarNodeSort: 'name' }));
        await until(() => !row('Within a kind or status'));
    });

    test('is found by a search for its words', () => {
        expect(searchSettings('order in the sidebar')[0]).toMatchObject({ section: 'views', id: 'views.canvas.sidebarSort' });
    });
});
