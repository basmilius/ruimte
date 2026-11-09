import { describe, expect, test } from 'bun:test';
import { createTestHost, type TestMenuItem } from '@ruimte/extension/testing';

const NODES = [
    { id: 'note-1', title: 'Plan' },
    { id: 'chat-1', kind: 'chat', title: 'Review', text: 'Looks good to me.', agent: { status: 'idle' as const } }
];

function titles(items: TestMenuItem[]): string[] {
    return items.map((item) => (item === 'separator' ? '-' : item.title));
}

async function press(items: TestMenuItem[], title: string) {
    const item = items.find((each) => each !== 'separator' && each.title === title);

    if (item === undefined || item === 'separator' || !('run' in item)) {
        throw new Error(`No row ${title}`);
    }

    return item.run();
}

describe('POC workspace', () => {
    test('offers Rename in its menu only on a node', async () => {
        const host = await createTestHost({ project: { nodes: NODES } });
        const menu = host.menu('menu');
        const onCanvas = host.menuItems(menu, 'canvasMenu');
        const onNode = host.menuItems(menu, 'nodeMenu', { node: { id: 'note-1' } });

        expect(onCanvas.ok && titles(onCanvas.value)).not.toContain('Rename, through a dialog');
        expect(onNode.ok && titles(onNode.value).at(-1)).toBe('Rename, through a dialog');
    });

    test('renames a node to what the person typed, from its title', async () => {
        const host = await createTestHost({ project: { nodes: NODES }, answers: { prompt: 'Roadmap' } });
        const items = host.menuItems(host.menu('menu'), 'nodeMenu', { node: { id: 'note-1' } });

        expect(items.ok && (await press(items.value, 'Rename, through a dialog'))).toEqual({ ok: true, value: undefined });
        expect(host.dialogs).toEqual([{ kind: 'prompt', title: 'New title', answer: 'Roadmap' }]);
        expect(host.canvas.nodes().find((node) => node.id === 'note-1')?.title).toBe('Roadmap');
    });

    test('makes a canvas only once the person agrees, and opens it', async () => {
        const refused = await createTestHost({ answers: { confirm: false } });
        const agreed = await createTestHost();
        const make = (host: typeof agreed) => {
            const items = host.menuItems(host.menu('menu'), 'canvasMenu');

            return items.ok ? press(items.value, 'Make a canvas, after asking') : Promise.reject(new Error('No menu'));
        };

        await make(refused);
        await make(agreed);

        expect(refused.views().map((view) => view.name)).toEqual(['Canvas']);
        expect(agreed.views().filter((view) => view.active)).toEqual([{ id: 'view-2', kind: 'canvas', name: 'POC', active: true }]);
    });

    test('refuses a stamp without canvas.write, and shows the person why', async () => {
        const host = await createTestHost({ manifest: { permissions: {} } });
        const items = host.menuItems(host.menu('menu'), 'canvasMenu');

        expect(items.ok && (await press(items.value, 'Add a stamp'))).toEqual({
            ok: false,
            error: { code: 'failed', message: 'POC workspace did not ask for the permission canvas.write in its manifest' }
        });
        expect(host.notifications).toEqual([
            { text: 'Add a stamp', detail: 'POC workspace did not ask for the permission canvas.write in its manifest', tone: 'error' }
        ]);
    });

    test('starts a second opinion beside a chat that is done, and links the two', async () => {
        const host = await createTestHost({ project: { nodes: NODES } });
        const opinion = host.action('second-opinion');

        expect(host.slot(opinion, 'nodeMenu', { node: { id: 'note-1' } })).toBeNull();
        expect(await host.run(opinion, 'nodeMenu', { node: { id: 'chat-1' } })).toEqual({ ok: true, value: undefined });

        const [chat] = host.canvas.created();

        expect(chat).toMatchObject({ kind: 'chat', title: 'Second opinion', linkedTo: ['chat-1'] });
        expect(host.agents.calls[0]?.args).toEqual([
            { title: 'Second opinion', prompt: 'Review this conversation:\n\nLooks good to me.', near: [expect.objectContaining({ id: 'chat-1' })] }
        ]);
    });

    test('opens its panel from the palette with the place it came from, in the language of the person', async () => {
        const host = await createTestHost({ language: 'nl' });

        await host.run(host.action('open-panel'), 'commandPalette');

        const panel = await host.render(host.panel('workspace'), { params: host.panels.workspace?.params });

        expect(panel.text()).toContain('Werkruimte (nl)');
        expect(panel.text()).toContain('Opened from: commandPalette');
    });

    test('keeps a count per project and per machine, and hears events', async () => {
        const host = await createTestHost({ storage: { machine: { opened: 4 } } });
        const panel = await host.render(host.panel('workspace'));

        await panel.click('This project: 0');
        host.fire('selection.changed', { nodes: [] });
        await panel.until(() => panel.find('selection') !== null);

        expect(panel.text()).toContain('This project: 1');
        expect(panel.text()).toContain('This machine: 4');
        expect(panel.text()).toContain('Heard 1 events');
        expect(host.storage).toEqual({ computer: {}, project: { opened: 1 }, machine: { opened: 4 } });
    });
});
