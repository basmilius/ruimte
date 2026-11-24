import { describe, expect, test } from 'bun:test';
import { createTestHost, createTestServer, type TestHostOptions, type TestMenuItem } from '@ruimte/extension/testing';
import { boardText, cardChanges, parseBoard } from '../client/board';
import type { BoardwalkServer } from '../server';

const CARD = { title: 'Ship the import', column: 'Doing', points: 3 };
const CARDS = [
    { id: 'card-1', title: 'Search by invoice number', extension: { type: 'card', data: CARD } },
    { id: 'card-2', title: 'Empty state', extension: { type: 'card', data: CARD }, linkedTo: [] },
    { id: 'note-1', title: 'Ask finance about the columns' }
];
const BOARD = '# Sprint 12\nTodo: Import invoices from a file (5), Empty state\nDoing: Search by invoice number (3)\n';

async function hostWith(options: TestHostOptions = {}) {
    const server = await createTestServer<BoardwalkServer>();

    return createTestHost({ ...options, answers: { server, ...options.answers } });
}

function defined(host: Awaited<ReturnType<typeof createTestHost>>, kind: string) {
    const found = host.definitions.find((each) => each.kind === kind);

    if (found === undefined) {
        throw new Error(`No ${kind}`);
    }

    return found.definition;
}

async function press(items: TestMenuItem[], title: string) {
    const item = items.find((each) => each !== 'separator' && each.title === title);

    if (item === undefined || item === 'separator' || !('run' in item)) {
        throw new Error(`No row ${title}`);
    }

    return item.run();
}

async function menuOf(host: Awaited<ReturnType<typeof createTestHost>>): Promise<TestMenuItem[]> {
    const items = host.menuItems(host.menu('menu'), 'canvasMenu');

    if (!items.ok) {
        throw new Error(items.error.message);
    }

    return items.value;
}

describe('Boardwalk', () => {
    test('adds the card a person wrote in its overlay, and shows it', async () => {
        const host = await hostWith({ answers: { overlays: { 'new-card': () => CARD } } });

        expect(await host.run(host.action('add-card'), 'emptyCanvas')).toEqual({ ok: true, value: undefined });

        const [card] = host.canvas.created();

        expect(host.opened).toEqual([{ kind: 'overlay', id: 'new-card', params: { after: null } }]);
        expect(card).toMatchObject({ kind: 'extension', title: 'Ship the import', extension: { type: 'card' } });
        expect(host.canvas.revealed()).toEqual([card?.id]);
    });

    test('adds nothing when a person closes the overlay', async () => {
        const host = await hostWith();

        await host.run(host.action('add-card'), 'emptyCanvas');

        expect(host.canvas.created()).toEqual([]);
    });

    test('refuses a card without canvas.write, and shows the person why', async () => {
        const host = await hostWith({ manifest: { permissions: {} }, answers: { overlays: { 'new-card': () => CARD } } });

        expect(await host.run(host.action('add-card'), 'emptyCanvas')).toEqual({
            ok: false,
            error: { code: 'failed', message: 'Boardwalk did not ask for the permission canvas.write in its manifest' }
        });
    });

    test('draws a card, moves it a column on a click, and reads one an older version stored', async () => {
        const host = await hostWith({
            project: { nodes: [...CARDS, { id: 'old', extension: { type: 'card', data: 'Written before columns', dataVersion: 1 } }] }
        });
        const card = await host.render(host.node('card'), { node: 'card-1' });

        expect(card.text()).toBe('Ship the import3 pointsDoing');

        await card.click('Doing');

        expect(card.text()).toBe('Ship the import3 pointsDone');
        card.unmount();

        expect((await host.render(host.node('card'), { node: 'old' })).text()).toBe('Written before columns1 pointTodo');
    });

    test('adds a follow-up beside a card on a line from it, only on a card', async () => {
        const host = await hostWith({ project: { nodes: CARDS }, answers: { overlays: { 'new-card': () => CARD } } });
        const follow = host.action('follow-up');

        expect(host.slot(follow, 'nodeHeader', { node: { id: 'note-1' } })).toBeNull();
        expect(host.slot(follow, 'nodeHeader', { node: { id: 'card-1' } })).toMatchObject({ title: 'Follow-up' });

        await host.run(follow, 'nodeMenu', { node: { id: 'card-1' } });

        expect(host.opened[0]?.params).toEqual({ after: 'Search by invoice number' });
        expect(host.canvas.links()).toEqual([{ from: 'card-1', to: host.canvas.created()[0]?.id }]);
    });

    test('stacks a selection of cards as a column in a group, and offers that for cards alone', async () => {
        const host = await hostWith({ project: { nodes: CARDS }, selection: ['card-1', 'note-1'] });
        const stack = host.action('stack');

        expect(host.slot(stack, 'selectionBar')).toBeNull();

        host.select(['card-1', 'card-2']);

        expect(await host.run(stack, 'selectionBar')).toEqual({ ok: true, value: undefined });
        expect(host.calls.map((call) => call.method)).toEqual(['canvas.arrange', 'canvas.group']);
        expect(host.canvas.created()).toMatchObject([{ kind: 'group' }]);
    });

    test('takes the line between two cards away from its menu', async () => {
        const [first, second, note] = CARDS;
        const host = await hostWith({
            project: {
                nodes: [
                    { ...first, id: 'card-1', linkedTo: ['card-2'] },
                    { ...second, id: 'card-2' },
                    { ...note, id: 'note-1' }
                ]
            }
        });
        const unblock = host.action('unblock');

        expect(host.slot(unblock, 'lineMenu', { from: { id: 'card-1' }, to: { id: 'note-1' } })).toBeNull();
        expect(await host.run(unblock, 'lineMenu', { from: { id: 'card-1' }, to: { id: 'card-2' } })).toEqual({ ok: true, value: undefined });
        expect(host.canvas.links()).toEqual([]);
    });

    test('turns a note into a card beside it, under the title of the note', async () => {
        const host = await hostWith({ project: { nodes: CARDS } });

        await host.run(host.action('to-card'), 'noteToolbar', { node: { id: 'note-1' } });

        expect(host.canvas.created()).toMatchObject([{ title: 'Ask finance about the columns', extension: { type: 'card' } }]);
    });

    test('lays out the sprint of the account as a grid of cards from the spot a person clicked', async () => {
        const host = await hostWith();
        expect(await host.run(defined(host, 'template'), 'canvasMenu', { at: { x: 400, y: 200 } })).toEqual({ ok: true, value: undefined });

        const cards = host.canvas.created();

        expect(cards.map((card) => card.title)).toEqual([
            'Import invoices from a file',
            'Empty state for the report',
            'Search by invoice number',
            'Time zone of the account'
        ]);
        expect(cards[0]?.bounds).toMatchObject({ x: 400, y: 200, width: 240, height: 120 });
        expect(cards[3]?.bounds.x).toBeGreaterThan(400);
        expect(cards[3]?.bounds.y).toBeGreaterThan(200);
    });

    test('makes a canvas for a board under the name a person gave, and none when they gave none', async () => {
        const named = await hostWith({ answers: { prompt: ' Sprint 13 ' } });
        const dismissed = await hostWith();

        await press(await menuOf(named), 'New board on a canvas of its own');
        await press(await menuOf(dismissed), 'New board on a canvas of its own');

        expect(named.dialogs).toEqual([{ kind: 'prompt', title: 'Name the board', answer: ' Sprint 13 ' }]);
        expect(named.views().filter((view) => view.active)).toMatchObject([{ kind: 'canvas', name: 'Sprint 13' }]);
        expect(dismissed.views()).toHaveLength(1);
    });

    test('renames a canvas from its menu', async () => {
        const host = await hostWith({ project: { views: [{ id: 'board', kind: 'canvas', name: 'Board' }] }, answers: { prompt: 'Sprint 13' } });

        await host.run(host.action('rename-board'), 'viewMenu', { target: { id: 'board', kind: 'canvas' } });

        expect(host.views()).toMatchObject([{ id: 'board', name: 'Sprint 13' }]);
    });

    test('writes the board to a file once a person agrees, and opens it', async () => {
        const written: [string, string][] = [];
        const answers = { 'files.write': (path: string, text: string) => void written.push([path, text]) };
        const agreed = await hostWith({ answers });
        const refused = await hostWith({ answers: { ...answers, confirm: false } });

        await press(await menuOf(refused), 'Write the board to boardwalk.board');
        await press(await menuOf(agreed), 'Write the board to boardwalk.board');

        expect(written).toEqual([
            [
                'boardwalk.board',
                '# Sprint 12\nTodo: Import invoices from a file (5), Empty state for the report (2)\nDoing: Search by invoice number (3)\nDone: Time zone of the account (1)\n'
            ]
        ]);
        expect(agreed.opened).toEqual([{ kind: 'file', id: 'boardwalk.board' }]);
        expect(refused.opened).toEqual([]);
    });

    test('opens the board of the account as a view, in its columns with their points', async () => {
        const host = await hostWith();

        await host.run(host.action('open-board'), 'viewToolbar');

        expect(host.opened).toEqual([{ kind: 'view', id: 'board', params: undefined }]);

        const view = await host.render(host.view('board'));
        const other = await host.render(host.view('board'), { params: { board: 'launch' } });

        expect(view.text()).toContain('Sprint 12Todo (7)Import invoices from a fileEmpty state for the reportDoing (3)');
        expect(other.text()).toContain('LaunchTodo (2)Write the announcement');
    });

    test('counts the cards on the canvas in its overlay, and draws nothing without one', async () => {
        const empty = await hostWith();
        const host = await hostWith({ project: { nodes: CARDS } });

        expect((await empty.render(defined(empty, 'canvasOverlay'))).text()).toBe('');
        expect((await host.render(defined(host, 'canvasOverlay'))).text()).toBe('2 cards');
    });

    test('draws a board block and a board file in columns', async () => {
        const host = await hostWith();
        const block = await host.render(defined(host, 'markdownBlock'), { props: { source: BOARD } });
        const file = await host.render(defined(host, 'fileViewer'), {
            props: { file: { path: 'plan.board', name: 'plan.board', extension: 'board', text: BOARD } }
        });

        expect(block.text()).toBe('Sprint 12Todo (6)Import invoices from a fileEmpty stateDoing (3)Search by invoice number');
        expect(file.text()).toBe(block.text());
    });

    test('names the cards a change of a board file adds and removes', async () => {
        const host = await hostWith();
        const diff = '--- a/plan.board\n+++ b/plan.board\n-Todo: Import invoices (5), Empty state\n+Todo: Import invoices (5)\n+Doing: Write the export (2)\n';
        const drawn = await host.render(defined(host, 'diffViewer'), { props: { file: { path: 'plan.board', name: 'plan.board', extension: 'board' }, diff } });

        expect(cardChanges(diff)).toEqual({ added: ['Write the export'], removed: ['Empty state'] });
        expect(drawn.text()).toBe('Added: Write the exportRemoved: Empty state');
    });

    test('reads a board file back as it wrote it', () => {
        expect(boardText(parseBoard(BOARD))).toBe('# Sprint 12\nTodo: Import invoices from a file (5), Empty state (1)\nDoing: Search by invoice number (3)\n');
    });
});
