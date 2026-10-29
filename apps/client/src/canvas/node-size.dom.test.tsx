import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { act } from 'react';
import type { EndpointInfo, NodeSizes, ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { startEndpointWatch } from '@/endpoint/watch';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { windowWorkspace } from '@/state/window';
import { pool } from '@/transport';
import { startServerInfo } from '@/transport/server-info';
import { FakeMachine } from '../../testing/fake-machine';
import { typeInto } from '../../testing/dom-helpers';
import { clickOn, openSubmenu, pressKey, until } from '../../testing/dom';
import { menuItem, openCanvasPage, openContextMenu, savedNodes, type CanvasPage } from '../../testing/canvas-page';

const MACHINE = 'fake-machine';
const PLAN: ProjectNode = { id: 'plan', kind: 'note', title: 'Plan', body: 'Ship it', x: 0, y: 0, w: 400, h: 320 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [PLAN], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let canvas: CanvasPage;
let sizes: NodeSizes;
let stops: Array<() => void>;

function info(): EndpointInfo {
    return {
        id: MACHINE,
        label: 'Fake machine',
        platform: 'darwin',
        version: '1',
        reachability: 'lan',
        authenticated: true,
        nodeSizes: sizes
    };
}

async function open(): Promise<void> {
    machine.answer('endpoint.info', () => info());
    machine.answer('endpoint.setNodeSize', ({ kind, size }) => {
        const { [kind]: _replaced, ...others } = sizes;
        sizes = size === null ? others : { ...others, [kind]: size };
        return info();
    });
    stops = [startServerInfo(), startEndpointWatch()];
    canvas = await openCanvasPage(
        machine,
        [MAIN],
        (host) => useServers.getState().byEndpoint[MACHINE] !== undefined && host.querySelector(`[data-node-id="${PLAN.id}"]`) !== null
    );
}

async function pasteText(text: string): Promise<void> {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    await act(async () => {
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
}

function settingsSection(): HTMLElement | null {
    return (
        ([...document.querySelectorAll('section, [data-settings-section]')] as HTMLElement[]).find((section) => section.textContent?.includes('New nodes')) ??
        null
    );
}

async function openSettings(): Promise<void> {
    await open();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'views' }));
    await until(() => settingsSection() !== null);
}

/* The row is the card's child that holds the kind's fields. */
function rowOf(kind: string): HTMLElement {
    let row: HTMLElement = sideField('Width', kind);
    while (!row.parentElement!.classList.contains('divide-y')) {
        row = row.parentElement!;
    }
    return row;
}

function sideField(side: 'Width' | 'Height', kind: string): HTMLInputElement {
    return settingsSection()!.querySelector(`input[aria-label="${side} of ${kind} nodes on Fake machine"]`)!;
}

function sizeOf(kind: string): string[] {
    return [sideField('Width', kind).value, sideField('Height', kind).value];
}

function resetButton(kind: string): HTMLButtonElement | null {
    return settingsSection()!.querySelector(`button[aria-label="Reset the size of ${kind} nodes on Fake machine"]`);
}

beforeEach(() => {
    machine = new FakeMachine();
    sizes = {};
    stops = [];
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await canvas.close();
    stops.forEach((stop) => stop());
    useServers.getState().forget(MACHINE);
});

describe('a default size per node kind', () => {
    test('a node’s menu makes its frame the size of its kind on the machine, says so, and the next node of that kind takes it', async () => {
        await open();
        await openContextMenu(canvas.page.host.querySelector(`[data-node-id="${PLAN.id}"]`)!);
        await openSubmenu('Size and position');
        const item = menuItem('Set as default size');
        expect(item?.textContent).toContain('400 × 320');
        await clickOn(item);

        await until(() => machine.requests('endpoint.setNodeSize').length === 1);
        expect(machine.requests('endpoint.setNodeSize')).toEqual([{ kind: 'note', size: { w: 400, h: 320 } }]);
        await until(() => document.body.textContent?.includes('Note nodes now start at 400 × 320') === true);

        await pasteText('Call the printer');
        await act(async () => windowWorkspace()!.connection.projects.flush());
        const pasted = savedNodes(machine).find((node) => node.id !== PLAN.id);
        expect(pasted).toMatchObject({ kind: 'note', w: 400, h: 320 });
    });

    test('settings list every kind on its size, and Reset puts a custom one back to the built-in size', async () => {
        sizes = { terminal: { w: 640, h: 400 } };
        await openSettings();

        expect(sizeOf('Terminal')).toEqual(['640', '400']);
        expect(rowOf('Terminal').textContent).toContain('Custom, built in 560 × 360');
        expect(sizeOf('Chat')).toEqual(['480', '520']);
        expect(rowOf('Chat').textContent).toContain('Built in');
        expect(resetButton('Chat')).toBeNull();

        await clickOn(resetButton('Terminal'));
        await until(() => resetButton('Terminal') === null);
        expect(machine.requests('endpoint.setNodeSize')).toEqual([{ kind: 'terminal', size: null }]);
        expect(sizeOf('Terminal')).toEqual(['560', '360']);
        expect(rowOf('Terminal').textContent).toContain('Built in');
    });

    test('a width typed and confirmed with Enter becomes the size of its kind', async () => {
        await openSettings();

        await typeInto(sideField('Width', 'Terminal'), '640');
        await pressKey(sideField('Width', 'Terminal'), 'Enter');

        await until(() => machine.requests('endpoint.setNodeSize').length === 1);
        expect(machine.requests('endpoint.setNodeSize')).toEqual([{ kind: 'terminal', size: { w: 640, h: 360 } }]);
        await until(() => resetButton('Terminal') !== null);
        expect(sizeOf('Terminal')).toEqual(['640', '360']);
    });

    test('a height typed back to the built-in size on leaving the field puts the kind back to it', async () => {
        sizes = { note: { w: 320, h: 400 } };
        await openSettings();

        const height = sideField('Height', 'Note');
        await typeInto(height, '240');
        await act(async () => height.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

        await until(() => machine.requests('endpoint.setNodeSize').length === 1);
        expect(machine.requests('endpoint.setNodeSize')).toEqual([{ kind: 'note', size: null }]);
        await until(() => resetButton('Note') === null);
    });

    test('a size out of bounds is not sent, says why, and goes back to the kept size on leaving the field', async () => {
        await openSettings();

        const width = sideField('Width', 'Browser');
        await typeInto(width, '100');
        expect(rowOf('Browser').textContent).toContain('Width is at least 240 pixels');
        expect(width.getAttribute('aria-invalid')).toBe('true');
        await pressKey(width, 'Enter');

        await typeInto(width, '12.5');
        expect(rowOf('Browser').textContent).toContain('Width takes a whole number of pixels');

        await act(async () => width.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
        await until(() => sizeOf('Browser')[0] === '720');
        expect(rowOf('Browser').textContent).not.toContain('Width takes a whole number of pixels');
        expect(width.getAttribute('aria-invalid')).toBeNull();
        expect(machine.requests('endpoint.setNodeSize')).toEqual([]);
    });

    test('Escape takes a typed size back', async () => {
        await openSettings();

        const height = sideField('Height', 'Group');
        await typeInto(height, '9000');
        expect(rowOf('Group').textContent).toContain('Height is at most 4,000 pixels');
        await pressKey(height, 'Escape');

        expect(sizeOf('Group')).toEqual(['800', '600']);
        expect(rowOf('Group').textContent).not.toContain('at most');
        expect(settingsSection()).not.toBeNull();
        expect(machine.requests('endpoint.setNodeSize')).toEqual([]);
    });

    test('a machine that is not connected shows its sizes but takes none', async () => {
        sizes = { terminal: { w: 640, h: 400 } };
        await open();
        const statusOf = pool.statusOf.bind(pool);
        // One object, since a snapshot that changes on every read never settles.
        const gone = { status: 'closed', attempts: 1, retryAt: null } as const;
        const closed = spyOn(pool, 'statusOf').mockImplementation((endpointId) => (endpointId === MACHINE ? gone : statusOf(endpointId)));
        try {
            await act(async () => useUi.getState().setSettings({ open: true, section: 'views' }));
            await until(() => settingsSection() !== null);

            expect(sizeOf('Terminal')).toEqual(['640', '400']);
            expect(sideField('Width', 'Terminal').disabled).toBe(true);
            expect(sideField('Height', 'Chat').disabled).toBe(true);
            expect(resetButton('Terminal')!.disabled).toBe(true);
        } finally {
            closed.mockRestore();
        }
    });
});
