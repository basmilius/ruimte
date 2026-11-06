import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useFiles } from '@/state/files';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const FILE = '/work/atlas/cities.csv';
const CANVAS = { kind: 'canvas', id: 'canvas', name: 'Canvas', nodes: [], edges: [], texts: [], groups: [] };
const TEXT = 'city;population\nUtrecht;374238\n"Zwolle; Overijssel";132000\n';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function button(label: string): HTMLElement | null {
    return ([...document.querySelectorAll('button')] as HTMLElement[]).find((element) => element.getAttribute('aria-label') === label) ?? null;
}

function grid(): HTMLElement | null {
    return page.host.querySelector('[role="grid"]');
}

function texts(role: string): string[] {
    return [...(grid()?.querySelectorAll(`[role="${role}"]`) ?? [])].map((element) => element.textContent?.trim() ?? '');
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'text', text: TEXT, encoding: 'utf-8', size: TEXT.length, mtime: 3 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [CANVAS] } as never, { activeViewId: CANVAS.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useFiles.getState().open(FILE, 10));
    await until(() => texts('gridcell').length > 0);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a CSV opened as a file', () => {
    test('shows its rows as a table, split on the semicolon it was written with', () => {
        expect(texts('columnheader').some((text) => text.includes('city'))).toBe(true);
        expect(texts('columnheader').some((text) => text.includes('population'))).toBe(true);
        expect(texts('gridcell')).toEqual(['Utrecht', '374238', 'Zwolle; Overijssel', '132000']);
        expect(page.host.textContent).toContain('2 rows');
        expect(page.host.textContent).toContain('2 columns');
        expect(page.host.textContent).toContain('Semicolon');
    });

    test('reads the first row as a row once the header is turned off', async () => {
        await clickOn(button('First row is header'));
        await until(() => texts('gridcell').includes('city'));
        expect(texts('gridcell').slice(0, 2)).toEqual(['city', 'population']);
        expect(texts('columnheader').some((text) => text.includes('Column 1'))).toBe(true);
        expect(page.host.textContent).toContain('3 rows');
    });

    test('switches to the source and back', async () => {
        await clickOn(button('Source'));
        await until(() => grid() === null);
        await until(() => page.host.textContent?.includes('"Zwolle; Overijssel";132000') === true);
        await clickOn(button('Table'));
        await until(() => texts('gridcell').includes('Utrecht'));
    });
});
