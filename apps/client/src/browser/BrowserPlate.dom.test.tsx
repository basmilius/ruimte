import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { BrowserPlate } from '@/browser/BrowserPlate';
import { usePageSnapshots } from '@/browser/page-snapshots';
import { useBrowser } from '@/browser/registry';
import { useEndpoints } from '@/state/endpoints';
import { endpointKey } from '@/state/keys';
import { mount, until, type Mounted } from '../../testing/dom';

const ID = 'page';
let page: Mounted;
let key: string;

function plate(): HTMLElement | null {
    return document.querySelector('[role="img"]');
}

beforeEach(() => {
    key = endpointKey(useEndpoints.getState().activeId, ID);
    useBrowser.getState().patch(key, { url: 'https://example.com/dashboard', title: 'Dashboard' });
    usePageSnapshots.setState({ byKey: { [key]: { far: true, imageUrl: null, takenAt: null, generation: 1, revealing: 0, life: 1 } } });
});

afterEach(async () => {
    await page.unmount();
    useBrowser.getState().forget(key);
    usePageSnapshots.setState({ byKey: {} });
});

describe('the plate of a page past the render distance', () => {
    test('shows the last picture, marked as not live', async () => {
        usePageSnapshots.setState({ byKey: { [key]: { far: true, imageUrl: 'blob:picture', takenAt: 1, generation: 1, revealing: 0, life: 1 } } });
        page = mount();
        await page.render(<BrowserPlate id={ID} />);
        await until(() => plate() !== null);
        expect(plate()?.getAttribute('aria-label')).toBe('Last picture of the page, not live');
        expect(plate()?.querySelector('img')?.getAttribute('src')).toBe('blob:picture');
    });

    test('without a picture shows the title and the address of the page', async () => {
        page = mount();
        await page.render(<BrowserPlate id={ID} />);
        await until(() => plate() !== null);
        expect(plate()?.getAttribute('aria-label')).toBe('The page, not live');
        expect(plate()?.textContent).toContain('Dashboard');
        expect(plate()?.textContent).toContain('example.com/dashboard');
    });

    test('of a page that did not load shows no picture of what it was before', async () => {
        usePageSnapshots.setState({ byKey: { [key]: { far: true, imageUrl: 'blob:picture', takenAt: 1, generation: 1, revealing: 0, life: 1 } } });
        await act(async () =>
            useBrowser.getState().patch(key, { error: { url: 'https://example.com/dashboard', code: -105, description: 'ERR_NAME_NOT_RESOLVED' } })
        );
        page = mount();
        await page.render(<BrowserPlate id={ID} />);
        await until(() => plate() !== null);
        expect(plate()?.querySelector('img')).toBeNull();
        expect(plate()?.querySelector('svg')).not.toBeNull();
    });
});
