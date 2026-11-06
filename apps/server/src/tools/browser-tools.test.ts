import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasFixture, type CanvasFixture, madeId } from './canvas-fixture-test-helpers.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

describe('browser', () => {
    /* A page of the caller's own: `node_new` draws the line from the agent to it, which is what driving takes. */
    const ownPage = async (): Promise<string> => await madeId(fx.invoke('node_new', { kind: 'browser', url: 'https://example.com' }));

    test('state prints where the page stands, without asking the page to move', async () => {
        const id = await ownPage();
        const { status, lines } = await fx.invoke('browser_state', { id });
        expect(status).toBe(200);
        expect(lines).toEqual(['open\tyes\tThe page answered', `page\t${id}\thttps://example.com/two\tTwo`, 'loading\tno', 'back\tyes', 'forward\tno']);
        expect(fx.driven).toEqual([{ browserId: id, action: { kind: 'state' } }]);
    });

    test('go sends the page to an address and answers where it landed', async () => {
        const id = await ownPage();
        const { lines } = await fx.invoke('browser_go', { id, url: 'https://example.com/two' });
        expect(fx.driven).toEqual([{ browserId: id, action: { kind: 'go', url: 'https://example.com/two' } }]);
        expect(lines[1]).toBe(`page\t${id}\thttps://example.com/two\tTwo`);
    });

    test('go on a node that has no address yet writes that address into the project', async () => {
        // The node a person's splash makes: a browser with no page at all, with a line from the agent to it.
        await fx.store.mutate(fx.projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) =>
                    view.id === 'main' && view.kind === 'canvas'
                        ? {
                              ...view,
                              nodes: [...view.nodes, { id: 'page-blank', kind: 'browser' as const, title: 'Page', x: 900, y: 0, w: 560, h: 360 }],
                              edges: [...view.edges, { id: 'edge-blank', from: 'term-1', to: 'page-blank' }]
                          }
                        : view
                )
            },
            result: undefined
        }));
        const { lines } = await fx.invoke('browser_go', { id: 'page-blank', url: 'https://example.com/start' });
        expect(fx.driven).toEqual([]);
        expect(lines[0]).toBe('open\tno\tThis node had no address yet, so https://example.com/start is now the page it opens with');
        expect((await fx.nodeOnDisk('page-blank'))?.url).toBe('https://example.com/start');
    });

    test('reload hard asks past the cache, and the plain one does not', async () => {
        const id = await ownPage();
        await fx.invoke('browser_history', { action: 'reload', id, hard: true });
        await fx.invoke('browser_history', { action: 'reload', id });
        expect(fx.driven.map((call) => call.action)).toEqual([
            { kind: 'reload', ignoreCache: true },
            { kind: 'reload', ignoreCache: false }
        ]);
    });

    test('back, forward and stop are the page words they say they are', async () => {
        const id = await ownPage();
        await fx.invoke('browser_history', { action: 'back', id });
        await fx.invoke('browser_history', { action: 'forward', id });
        await fx.invoke('browser_history', { action: 'stop', id });
        expect(fx.driven.map((call) => call.action.kind)).toEqual(['back', 'forward', 'stop']);
    });

    test('nobody with the page on screen is an answer and not a failure', async () => {
        const id = await ownPage();
        fx.knobs.pageOpen = false;
        const { status, lines } = await fx.invoke('browser_go', { id, url: 'https://example.com/two' });
        expect(status).toBe(200);
        expect(lines).toEqual(['open\tno\tNobody has this page open right now, so nothing was driving it']);
    });

    test('a shot answers with the file it wrote, and with nothing when no page is open', async () => {
        const id = await ownPage();
        const { lines } = await fx.invoke('browser_shot', { id });
        expect(lines[1]).toBe(`shot\t${fx.shotPath}\tRead it with your own tools`);
        expect(lines[2]).toBe(`page\t${id}\thttps://example.com/two\tTwo`);
        fx.knobs.pageOpen = false;
        expect((await fx.invoke('browser_shot', { id })).lines).toEqual(['open\tno\tNobody has this page open right now, so there was nothing to photograph']);
    });

    test('a page no line runs to is refused, and the pages that do run to one are listed', async () => {
        const stranger = await madeId(fx.invoke('node_new', { kind: 'browser', url: 'https://example.com/far', view: 'board' }));
        const mine = await ownPage();
        const { status, lines } = await fx.invoke('browser_state', { id: stranger });
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\tnot-linked\tNo line runs between you and ${stranger}, and that line is what lets you drive its page`);
        expect(lines.some((line) => line.startsWith(`browser\t${mine}\t`))).toBe(true);
        // Where a page stands is read for the hint, and nothing is driven anywhere.
        expect(fx.driven.filter((call) => call.action.kind !== 'state')).toEqual([]);
    });

    test('a refusal names the address a page is at, and the stored one only when nobody holds it', async () => {
        const mine = await ownPage();
        const far = await madeId(fx.invoke('node_new', { kind: 'browser', url: 'https://example.com/far', view: 'board' }));
        const open = (await fx.invoke('browser_state', { id: far })).lines;
        expect(open).toContain('see\tnode_new browser url https://example.com/two\topens a page of your own on your canvas, with the line to it drawn');
        expect(open.find((line) => line.startsWith(`browser\t${mine}\t`))?.split('\t')[3]).toBe('https://example.com/two');

        fx.knobs.pageOpen = false;
        const closed = (await fx.invoke('browser_state', { id: far })).lines;
        expect(closed).toContain('see\tnode_new browser url https://example.com/far\topens a page of your own on your canvas, with the line to it drawn');
        expect(closed.find((line) => line.startsWith(`browser\t${mine}\t`))?.split('\t')[3]).toBe('https://example.com/');
    });

    test('a line is the hint only for a page on the canvas of the caller', async () => {
        fx.knobs.pageOpen = false;
        const near = await madeId(fx.invoke('node_new', { kind: 'browser', url: 'https://example.com/near', view: 'main', beside: 'note-1' }, 'chat'));
        expect((await fx.invoke('browser_state', { id: near })).lines[1]).toBe(`see\tlink_new to ${near}\tdraws it`);

        const far = await madeId(fx.invoke('node_new', { kind: 'browser', url: 'https://example.com/far', view: 'board' }));
        const across = (await fx.invoke('browser_state', { id: far })).lines;
        expect(across.slice(1, 3)).toEqual([
            `note\t${far} stands on board and you on main, and a line only runs between two nodes of one canvas`,
            'see\tnode_new browser url https://example.com/far\topens a page of your own on your canvas, with the line to it drawn'
        ]);
        expect(across.some((line) => line.includes(`link new to ${far}`))).toBe(false);

        const alone = (await fx.invoke('browser_state', { id: far }, 'chat')).lines;
        expect(alone).toEqual([
            `refused\tview-required\t${far} stands on board; a chat view reads and operates the nodes of a canvas by naming it with view, since no line runs to a view`,
            `see\tbrowser_state ${far} view board\tnames the canvas it stands on`
        ]);
    });

    test('a chat view drives a page of the canvas it names without a line, and only on that canvas', async () => {
        const far = await madeId(fx.invoke('node_new', { kind: 'browser', url: 'https://example.com/far', view: 'board' }));
        const { status, lines } = await fx.invoke('browser_go', { id: far, url: 'https://example.com/two', view: 'board' }, 'chat');
        expect(status).toBe(200);
        expect(lines[1]).toBe(`page\t${far}\thttps://example.com/two\tTwo`);
        expect((await fx.invoke('browser_state', { id: far, view: 'main' }, 'chat')).lines).toEqual([
            `refused\tnot-on-view\t${far} stands on board, not on main`,
            `see\tbrowser_state ${far} view board\tnames the canvas it stands on`
        ]);
        // A node on a canvas keeps to its lines, and view does not stand in for one.
        expect((await fx.invoke('browser_state', { id: far, view: 'board' })).lines[0]).toStartWith('refused\tnot-a-chat-view\t');
        expect(fx.driven).toEqual([{ browserId: far, action: { kind: 'go', url: 'https://example.com/two' } }]);
    });

    test('a node that is not a browser, and an id that is no node at all, are refused by name', async () => {
        expect((await fx.invoke('browser_state', { id: 'note-1' })).lines[0]).toBe(
            'refused\tnot-a-browser\tnote-1 is a note node, and only a browser node has a page to drive'
        );
        expect((await fx.invoke('browser_state', { id: 'nowhere' })).lines[0]).toBe('refused\tunknown-node\tnowhere is not a node of this project');
    });

    test('go takes an http or https address and nothing else', async () => {
        const id = await ownPage();
        expect((await fx.invoke('browser_go', { id, url: 'ftp://example.com' })).lines[0]).toContain('refused\tbad-url');
        expect(fx.driven).toEqual([]);
    });
});

describe('a # in a message', () => {
    test('lets a chat view drive the browser node it points at, with no view', async () => {
        const page = await madeId(fx.invoke('node_new', { kind: 'browser', url: 'https://example.com', view: 'main' }, 'chat'));
        expect((await fx.invoke('browser_go', { id: page, url: 'https://example.com/two' }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        await fx.pointAt('chat-1', [page]);
        expect((await fx.invoke('browser_go', { id: page, url: 'https://example.com/two' }, 'chat')).status).toBe(200);
        expect(fx.driven).toEqual([{ browserId: page, action: { kind: 'go', url: 'https://example.com/two' } }]);
    });
});
