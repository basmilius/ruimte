import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    DIAGRAM_SHAPES,
    DiagramDirectionSchema,
    DiagramEdgeSchema,
    DiagramEdgeStyleSchema,
    DiagramGroupSchema,
    DiagramMetaSchema,
    DiagramNodeSchema,
    DrawingColorSchema,
    PROJECT_ICON_NAMES,
    type ProjectCanvasView
} from '@ruimte/contracts';
import { MAX_PROJECT_VIEWS, VIEW_KINDS } from '../canvas/views.ts';
import { peerCanvasId } from '../projects/peer-links.ts';
import { rawPrivateViews, setPrivateViews } from '../projects/project-file-test-helpers.ts';
import { canvasFixture, type CanvasFixture, content, madeId } from './canvas-test-fixture.ts';
import { DIAGRAM_EXAMPLE, viewToolkit } from './view-tools.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

describe('view list', () => {
    test('lists every view in sidebar order, a separator with an empty name', async () => {
        expect((await fx.invoke('view_list', {})).lines).toEqual([
            'main\tcanvas\tCanvas\tno\tyou are in it\t-\t-',
            'sep-1\tseparator\t\tno\ta person made it\t-\t-',
            'board\tcanvas\tBoard\tno\ta person made it\t-\t-',
            'chat-1\tchat\tPlanner\tno\ta person made it\t-\t-',
            'sketch-1\tdrawing\tSketch\tno\ta person made it\t-\t-',
            // The view the caller stands in, which it can read nowhere else.
            'self\tmain',
            'revision\t1'
        ]);
        expect((await fx.invoke('view_list', {}, 'chat')).lines.at(-2)).toBe('self\tchat-1');
    });

    test('the last column is whether view delete would remove that view for the caller', async () => {
        const mine = await fx.made('Notes');
        expect(await fx.deleteColumn()).toEqual({ main: 'no', 'sep-1': 'no', board: 'no', 'chat-1': 'no', 'sketch-1': 'no', [mine]: 'yes' });
    });

    test('a machine that frees every view says so in the column, except for the one the caller is in', async () => {
        fx.knobs.deleteAnyView = true;
        // The caller is a node on main, so removing main would end the session that is asking.
        expect(await fx.deleteColumn()).toEqual({ main: 'no', 'sep-1': 'yes', board: 'yes', 'chat-1': 'yes', 'sketch-1': 'yes' });
        // And the reason beside it, or a caller that made none of them reads its own yes as a mistake.
        expect(await fx.deleteWhy()).toEqual({
            main: 'you are in it',
            'sep-1': 'this machine frees every view',
            board: 'this machine frees every view',
            'chat-1': 'this machine frees every view',
            'sketch-1': 'this machine frees every view'
        });
    });

    test('the reason names the maker of a view another caller made', async () => {
        const theirs = await fx.made('Theirs', {}, 'chat');
        expect((await fx.deleteWhy())[theirs]).toBe('chat-1 made it');
        expect((await fx.deleteWhy('chat'))[theirs]).toBe('yours');
    });

    test('a caller that is a view of its own may not remove the view it is', async () => {
        fx.knobs.deleteAnyView = true;
        expect((await fx.deleteColumn('chat'))['chat-1']).toBe('no');
    });
});

describe('view new', () => {
    test('a view and a node of a kind this daemon does not know stay in the file, exactly as they were', async () => {
        const hologram = { kind: 'hologram', id: 'holo', title: 'Hologram', x: 900, y: 0, w: 480, h: 360, beam: { lumens: [1, 2] } };
        const timeline = { name: 'Flow', kind: 'timeline', id: 'timeline-1', tracks: [{ at: 0 }] };
        const file = await fx.onDisk();
        const main = file.views[0] as ProjectCanvasView;
        const views = [{ ...main, nodes: [...main.nodes, hologram] }, timeline, ...file.views.slice(1)];
        await setPrivateViews(fx.folder, views);

        expect((await fx.invoke('view_new', { name: 'Plan' })).status).toBe(200);

        const raw = (await rawPrivateViews(fx.folder)) as unknown as Array<{ id: string; nodes?: Array<{ id: string }> }>;
        expect(JSON.stringify(raw.find((view) => view.id === 'timeline-1'))).toBe(JSON.stringify(timeline));
        expect(JSON.stringify(raw[0]!.nodes!.find((node) => node.id === 'holo'))).toBe(JSON.stringify(hologram));
        expect((await fx.onDisk()).views.at(-1)).toMatchObject({ kind: 'canvas', name: 'Plan' });
    });

    test('adds a canvas last in the sidebar and writes the caller down as its maker', async () => {
        const { status, lines } = await fx.invoke('view_new', { name: 'Plan' });
        expect(status).toBe(200);
        const [id, kind, name] = lines[0]!.split('\t');
        expect([kind, name]).toEqual(['canvas', 'Plan']);
        expect((await fx.onDisk()).views.at(-1)).toMatchObject({ id, kind: 'canvas', name: 'Plan', createdBy: 'term-1', nodes: [], edges: [] });
    });

    test('every kind of the union in contracts is one it makes', async () => {
        const extra: Partial<Record<(typeof VIEW_KINDS)[number], Record<string, unknown>>> = {
            file: { path: 'src/main.ts' },
            browser: { url: 'https://bas.dev' },
            database: { connection: 'shop-1', table: 'orders' }
        };
        for (const kind of VIEW_KINDS) {
            const { status, lines } = await fx.invoke('view_new', { name: `A ${kind}`, kind, ...extra[kind] });
            expect(status).toBe(200);
            const [id, said] = lines[0]!.split('\t');
            expect(said).toBe(kind);
            expect(await fx.viewOnDisk(id!)).toMatchObject({ kind, name: `A ${kind}`, createdBy: 'term-1' });
        }
    });

    test('a file view stores its path folder-relative and a browser view keeps its address', async () => {
        const file = await fx.made('main.ts', { kind: 'file', path: join(fx.folder, 'src', 'main.ts') });
        expect(await fx.viewOnDisk(file)).toMatchObject({ kind: 'file', path: 'src/main.ts' });
        const outsideFile = await fx.made('notes.md', { kind: 'file', path: join(fx.outside, 'notes.md') });
        expect(await fx.viewOnDisk(outsideFile)).toMatchObject({ path: join(fx.outside, 'notes.md') });
        const page = await fx.made('Docs', { kind: 'browser', url: 'https://bas.dev/docs' });
        expect(await fx.viewOnDisk(page)).toMatchObject({ kind: 'browser', url: 'https://bas.dev/docs' });
    });

    test('a database view names a table of a connection of the project, by id or by name', async () => {
        const byId = await fx.made('orders', { kind: 'database', connection: 'shop-1', table: 'orders' });
        expect(await fx.viewOnDisk(byId)).toMatchObject({
            kind: 'database',
            connectionId: 'shop-1',
            schema: 'shop',
            table: 'orders',
            mode: 'data',
            createdBy: 'term-1'
        });
        expect(await fx.viewOnDisk(byId)).not.toHaveProperty('where');
        const byName = await fx.made('items', { kind: 'database', connection: 'local', table: 'items', mode: 'structure' });
        expect(await fx.viewOnDisk(byName)).toMatchObject({ connectionId: 'local-1', schema: 'main', table: 'items', mode: 'structure' });
        const filtered = await fx.made('open orders', { kind: 'database', connection: 'Shop', table: 'orders', schema: 'archive', where: "status = 'open'" });
        expect(await fx.viewOnDisk(filtered)).toMatchObject({ connectionId: 'shop-1', schema: 'archive', where: "status = 'open'" });
    });

    test('a database view is refused without its connection or table, or on a connection the project does not have', async () => {
        expect((await fx.invoke('view_new', { name: 'x', kind: 'database', table: 'orders' })).lines[0]).toBe(
            'refused\tmissing-flag\tA database view needs connection'
        );
        expect((await fx.invoke('view_new', { name: 'x', kind: 'database', connection: 'shop-1' })).lines[0]).toBe(
            'refused\tmissing-flag\tA database view needs table'
        );
        const unknown = await fx.invoke('view_new', { name: 'x', kind: 'database', connection: 'nowhere', table: 'orders' });
        expect(unknown.status).toBe(422);
        expect(unknown.lines[0]).toBe('refused\tunknown-connection\tThis project has no database connection nowhere');
        expect(unknown.lines.slice(1, -1).join('\n')).toContain('shop-1');
        expect((await fx.invoke('view_new', { name: 'x', kind: 'database', connection: 'twin', table: 'orders' })).lines[0]).toStartWith(
            'refused\tambiguous-connection\t'
        );
        expect((await fx.onDisk()).views).toHaveLength(5);
    });

    test('a connection that starts in no database needs a schema, and a filter goes with the rows only', async () => {
        expect((await fx.invoke('view_new', { name: 'x', kind: 'database', connection: 'bare-1', table: 'orders' })).lines[0]).toBe(
            'refused\tschema-required\tBare starts in no database; name one with schema'
        );
        expect(await fx.viewOnDisk(await fx.made('x', { kind: 'database', connection: 'bare-1', table: 'orders', schema: 'shop' }))).toMatchObject({
            schema: 'shop'
        });
        expect(
            (await fx.invoke('view_new', { name: 'x', kind: 'database', connection: 'shop-1', table: 'orders', mode: 'structure', where: 'id > 1' })).lines[0]
        ).toStartWith('refused\tbad-arguments\twhere filters rows');
        expect((await fx.invoke('view_new', { name: 'x', kind: 'database', connection: 'shop-1', table: 'orders', mode: 'sideways' })).lines[0]).toBe(
            'refused\tbad-arguments\tmode takes data or structure'
        );
    });

    test('the table fields belong to a database view alone', async () => {
        expect((await fx.invoke('view_new', { name: 'x', table: 'orders' })).lines[0]).toBe('refused\tflag-not-for-kind\ttable does not go with a canvas view');
        expect((await fx.invoke('view_new', { name: 'x', kind: 'database', connection: 'shop-1', table: 'orders', path: 'src/main.ts' })).lines[0]).toBe(
            'refused\tflag-not-for-kind\tpath does not go with a database view'
        );
    });

    test('a database view is shown with view open like any other', async () => {
        const id = await fx.made('orders', { kind: 'database', connection: 'shop-1', table: 'orders' });
        await fx.store.openProject({ projectId: fx.projectId });
        fx.store.hold('client-1', fx.projectId);
        const shown = await fx.invoke('view_open', { view_id: id });
        expect(shown.status).toBe(200);
        expect(shown.lines[0]).toBe(`showing\t${id}\tdatabase\torders`);
        expect(fx.watching).toEqual([{ projectId: fx.projectId, viewId: id, by: 'term-1' }]);
    });

    test('after puts the row right under the view it names', async () => {
        const id = await fx.made('Plan', { after: 'main' });
        expect((await fx.onDisk()).views.map((view) => view.id)).toEqual(['main', id, 'sep-1', 'board', 'chat-1', 'sketch-1']);
    });

    test('after that names no view of this project is refused with the views', async () => {
        const { status, lines } = await fx.invoke('view_new', { name: 'Plan', after: 'nowhere' });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-view\tnowhere is not a view of this project');
        expect(lines.slice(1, -1)).toEqual([
            'view\tmain\tcanvas\tCanvas',
            'view\tsep-1\tseparator\t',
            'view\tboard\tcanvas\tBoard',
            'view\tchat-1\tchat\tPlanner',
            'view\tsketch-1\tdrawing\tSketch'
        ]);
        expect((await fx.onDisk()).rev).toBe(1);
    });

    test('a kind that needs a field refuses without it, and a field that is not for the kind is refused too', async () => {
        expect((await fx.invoke('view_new', { name: 'Doc', kind: 'file' })).lines[0]).toBe('refused\tmissing-flag\tA file view needs path');
        expect((await fx.invoke('view_new', { name: 'Page', kind: 'browser' })).lines[0]).toBe('refused\tmissing-flag\tA browser view needs url');
        expect((await fx.invoke('view_new', { name: 'Plan', url: 'https://bas.dev' })).lines[0]).toBe(
            'refused\tflag-not-for-kind\turl does not go with a canvas view'
        );
        expect((await fx.invoke('view_new', { name: 'Page', kind: 'browser', url: 'ftp://bas.dev' })).lines[0]).toStartWith('refused\tbad-url\t');
        expect((await fx.invoke('view_new', { name: 'Doc', kind: 'file', path: 'nowhere.ts' })).lines[0]).toStartWith('refused\tbad-path\t');
    });

    test('a kind that is not in the union is refused with the ones that are', async () => {
        const { lines } = await fx.invoke('view_new', { name: 'Plan', kind: 'kanban' });
        expect(lines[0]).toBe(`refused\tbad-arguments\tkind takes one of ${VIEW_KINDS.join(', ')}`);
    });

    test('a name is needed, and only one', async () => {
        expect((await fx.invoke('view_new', {})).lines[0]).toBe('refused\tbad-arguments\tview_new needs a name');
        expect((await fx.invoke('view_new', { name: ['a', 'b'] })).lines[0]).toStartWith('refused\tbad-arguments\t');
    });

    test('a project holds only so many rows', async () => {
        await fx.store.mutate(fx.projectId, (current) => {
            const next = structuredClone(current);
            for (let index = next.views.length; index < MAX_PROJECT_VIEWS - 1; index += 1) {
                next.views.push({ kind: 'canvas', id: `view-${index}`, name: `View ${index}`, nodes: [], texts: [], edges: [], layouts: [] });
            }
            return { content: next, result: null };
        });
        expect((await fx.invoke('view_new', { name: 'The last one' })).status).toBe(200);
        const { status, lines } = await fx.invoke('view_new', { name: 'One too many' });
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\ttoo-many-views\tThis project has ${MAX_PROJECT_VIEWS} views and a project holds at most ${MAX_PROJECT_VIEWS}`);
    });
});

describe('view rename', () => {
    test('renames a view and says nothing it hosts may rename it again', async () => {
        const { status, lines } = await fx.invoke('view_edit', { view_id: 'board', name: 'Roadmap' });
        expect(status).toBe(200);
        expect(lines).toEqual(['board\tcanvas\tRoadmap']);
        expect(await fx.viewOnDisk('board')).toMatchObject({ name: 'Roadmap', titleSource: 'user' });
    });

    test('a rename to the name it already carries writes nothing at all', async () => {
        await fx.invoke('view_edit', { view_id: 'board', name: 'Roadmap' });
        const rev = (await fx.onDisk()).rev;
        expect((await fx.invoke('view_edit', { view_id: 'board', name: 'Roadmap' })).lines).toEqual(['board\tcanvas\tRoadmap']);
        expect((await fx.onDisk()).rev).toBe(rev);
    });

    test('an id that is no view of this project is refused with the views', async () => {
        const { status, lines } = await fx.invoke('view_edit', { view_id: 'Board', name: 'Roadmap' });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-view\tBoard is not a view of this project');
        expect(lines.at(-1)).toBe('note\tview rename takes a view id, never a name');
    });
});

describe('the canvas another machine draws here', () => {
    const PEER_CANVAS = peerCanvasId('machine-a');

    /* The canvas as `peer.placeNodes` leaves it, with its machine linked so the store knows to hide it. */
    async function peerCanvas(): Promise<void> {
        await fx.store.peers.bind('machine-a', 'MacBook Pro', fx.projectId);
        const next = content();
        next.views.push({
            kind: 'canvas',
            id: PEER_CANVAS,
            name: 'MacBook Pro',
            nodes: [{ id: 'remote-term', kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 }],
            texts: [],
            edges: [],
            layouts: []
        });
        await fx.replaceContent(next);
    }

    test('is left out of view list and out of the canvases a refusal offers', async () => {
        await peerCanvas();
        const { lines } = await fx.invoke('view_list', {});
        expect(lines.some((line) => line.includes(PEER_CANVAS))).toBe(false);
        const refused = await fx.invoke('node_new', { kind: 'note', view: PEER_CANVAS });
        expect(refused.lines[0]).toBe(`refused\tnot-a-canvas\t${PEER_CANVAS} is not a canvas of this project`);
        expect(refused.lines.some((line) => line.includes(PEER_CANVAS) && line.startsWith('canvas\t'))).toBe(false);
    });

    test.each([
        ['view rename', 'view_edit', { name: 'Mine' }],
        ['view icon', 'view_edit', { icon: PROJECT_ICON_NAMES[0]! }],
        ['view move', 'view_edit', { after: 'board' }],
        ['view delete', 'view_delete', {}]
    ])('%s answers as if it did not exist', async (_name, tool, input) => {
        await peerCanvas();
        fx.knobs.deleteAnyView = true;
        const { status, lines } = await fx.invoke(tool, { view_id: PEER_CANVAS, ...input });
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\tunknown-view\t${PEER_CANVAS} is not a view of this project`);
        expect(await fx.viewOnDisk(PEER_CANVAS)).toMatchObject({ name: 'MacBook Pro', nodes: [{ id: 'remote-term' }] });
    });

    test('is not a place to move another view behind either', async () => {
        await peerCanvas();
        const { status, lines } = await fx.invoke('view_edit', { view_id: 'board', after: PEER_CANVAS });
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\tunknown-view\t${PEER_CANVAS} is not a view of this project`);
    });
});

describe('view icon', () => {
    test('takes a Lucide name from the closed set', async () => {
        expect((await fx.invoke('view_edit', { view_id: 'board', icon: 'rocket' })).lines).toEqual(['board\tcanvas\tlucide\trocket']);
        expect(await fx.viewOnDisk('board')).toMatchObject({ icon: { kind: 'lucide', value: 'rocket' } });
    });

    test('view list shows the mark in its own column, after every column it had before', async () => {
        await fx.invoke('view_edit', { view_id: 'board', icon: 'rocket' });
        const board = (await fx.invoke('view_list', {})).lines.find((line) => line.startsWith('board\t'));
        expect(board).toBe('board\tcanvas\tBoard\tno\ta person made it\trocket\t-');
        await fx.invoke('view_edit', { view_id: 'board', icon: 'null' });
        expect((await fx.invoke('view_list', {})).lines.find((line) => line.startsWith('board\t'))).toBe('board\tcanvas\tBoard\tno\ta person made it\t-\t-');
    });

    test('null takes a mark away again', async () => {
        await fx.invoke('view_edit', { view_id: 'board', icon: 'rocket' });
        expect((await fx.invoke('view_edit', { view_id: 'board', icon: 'null' })).lines).toEqual(['board\tcanvas\tnull']);
        expect(await fx.viewOnDisk('board')).not.toHaveProperty('icon');
        expect((await fx.invoke('view_edit', { view_id: 'board', icon: 'null' })).lines).toEqual(['board\tcanvas\tnull']);
    });

    test('a mark a person typed is refused with the set, and so is a typo', async () => {
        expect((await fx.invoke('view_edit', { view_id: 'board', icon: '\u{1f680}' })).lines[0]).toBe(
            `refused\tunknown-icon\t\u{1f680} is not one of the ${PROJECT_ICON_NAMES.length} Lucide names a view picks from`
        );
        const { status, lines } = await fx.invoke('view_edit', { view_id: 'board', icon: 'rockett' });
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\tunknown-icon\trockett is not one of the ${PROJECT_ICON_NAMES.length} Lucide names a view picks from`);
        expect(lines.slice(1).every((line) => line.startsWith('icons\t'))).toBe(true);
        expect(lines.slice(1).flatMap((line) => line.split('\t').slice(1))).toEqual([...PROJECT_ICON_NAMES]);
    });

    test('a divider has no room for a mark', async () => {
        expect((await fx.invoke('view_edit', { view_id: 'sep-1', icon: 'rocket' })).lines[0]).toBe(
            'refused\tnot-markable\tsep-1 is a separator, a row that divides the sidebar and has no room for a mark'
        );
        const [made] = (await fx.invoke('view_new', { name: 'Agents', kind: 'subheader' })).lines;
        const id = made!.split('\t')[0]!;
        expect((await fx.invoke('view_edit', { view_id: id, icon: 'rocket' })).lines[0]).toBe(
            `refused\tnot-markable\t${id} is a subheader, a row that divides the sidebar and has no room for a mark`
        );
    });
});

describe('view move', () => {
    test('first puts the row at the top and after right under the view it names', async () => {
        expect((await fx.invoke('view_edit', { view_id: 'board', first: true })).lines).toEqual(['board\tcanvas\t0']);
        expect((await fx.onDisk()).views.map((view) => view.id)).toEqual(['board', 'main', 'sep-1', 'chat-1', 'sketch-1']);
        expect((await fx.invoke('view_edit', { view_id: 'board', after: 'chat-1' })).lines).toEqual(['board\tcanvas\t3']);
        expect((await fx.onDisk()).views.map((view) => view.id)).toEqual(['main', 'sep-1', 'chat-1', 'board', 'sketch-1']);
    });

    test('exactly one of after and first, and never under itself', async () => {
        const both = await fx.invoke('view_edit', { view_id: 'board', first: true, after: 'main' });
        expect(both.lines).toEqual([
            'refused\ttwo-places\tview_edit moves a view with one of after and first',
            'field\tafter\tright under that view',
            'field\tfirst\tat the top of the list'
        ]);
        expect((await fx.invoke('view_edit', { view_id: 'board' })).lines[0]).toBe(
            'refused\tnothing-to-change\tview_edit needs one of name, icon, after, first'
        );
        expect((await fx.invoke('view_edit', { view_id: 'board', after: 'board' })).lines[0]).toBe(
            'refused\ttwo-places\tview move cannot put a view under itself'
        );
        expect((await fx.onDisk()).rev).toBe(1);
    });

    test('moving a row to where it already stands writes nothing', async () => {
        expect((await fx.invoke('view_edit', { view_id: 'main', first: true })).lines).toEqual(['main\tcanvas\t0']);
        expect((await fx.onDisk()).rev).toBe(1);
    });
});

describe('view delete', () => {
    test('removes a view the caller made and names it', async () => {
        const id = await fx.made('Plan');
        const { status, lines } = await fx.invoke('view_delete', { view_id: id });
        expect(status).toBe(200);
        expect(lines).toEqual([`deleted\t${id}\tcanvas\tPlan`]);
        expect(await fx.viewOnDisk(id)).toBeUndefined();
    });

    test('refuses a view the caller did not make, naming who did and how the machine frees it', async () => {
        const { status, lines } = await fx.invoke('view_delete', { view_id: 'board' });
        expect(status).toBe(422);
        expect(lines).toEqual([
            'refused\tnot-yours\tboard was made by a person and view delete only removes a view you made yourself',
            'made by\ta person',
            'you\tterm-1',
            "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every view; a person turns it on from the Machines pane"
        ]);
        expect(await fx.viewOnDisk('board')).toBeDefined();
    });

    test('a view another agent made is not the caller’s either', async () => {
        const id = await fx.made('Theirs', {}, 'chat');
        const { lines } = await fx.invoke('view_delete', { view_id: id });
        expect(lines[0]).toBe(`refused\tnot-yours\t${id} was made by chat-1 and view delete only removes a view you made yourself`);
        expect(lines[1]).toBe('made by\tchat-1');
    });

    test('the same delete goes through once the machine frees every view', async () => {
        expect((await fx.invoke('view_delete', { view_id: 'board' })).status).toBe(422);
        fx.knobs.deleteAnyView = true;
        expect((await fx.invoke('view_delete', { view_id: 'board' })).lines).toEqual(['deleted\tboard\tcanvas\tBoard']);
        expect(await fx.viewOnDisk('board')).toBeUndefined();
    });

    test('never the view the caller is standing in, however free the machine is', async () => {
        fx.knobs.deleteAnyView = true;
        expect((await fx.invoke('view_delete', { view_id: 'main' })).lines[0]).toBe(
            'refused\tdeletes-caller\tYou are in main, so removing it would end the session asking'
        );
        expect((await fx.invoke('view_delete', { view_id: 'chat-1' }, 'chat')).lines[0]).toBe(
            'refused\tdeletes-caller\tYou are in chat-1, so removing it would end the session asking'
        );
    });

    test('a canvas takes its sessions with it, and the answer names them', async () => {
        const id = await fx.made('Crew');
        const shell = await madeId(fx.invoke('node_new', { kind: 'terminal', view: id }));
        const chat = await madeId(fx.invoke('node_new', { kind: 'chat', view: id }));
        await fx.invoke('node_new', { kind: 'note', text: 'x', view: id });

        const { lines } = await fx.invoke('view_delete', { view_id: id });
        expect(lines.slice(0, 3)).toEqual([`deleted\t${id}\tcanvas\tCrew`, `ended\t${shell}\tterminal`, `ended\t${chat}\tchat`]);
        // What went with it, named the way the sessions are: a bare deleted line leaves the note a mystery.
        expect(lines[3]).toBe('nodes\t3');
        expect(lines.filter((line) => line.startsWith('node\t')).map((line) => line.split('\t')[1])).toEqual([shell, chat, expect.any(String)]);
        // The daemon ends them itself, which is what makes the tool work with no client connected.
        expect(fx.ended).toEqual([`terminal\t${shell}`, `chat\t${chat}`]);
    });

    test('a chat view of its own is the one session it is', async () => {
        const id = await fx.made('Helper', { kind: 'chat' });
        expect((await fx.invoke('view_delete', { view_id: id })).lines).toEqual([`deleted\t${id}\tchat\tHelper`, `ended\t${id}\tchat`]);
    });

    test('what the daemon held for a node goes with the canvas the node stood on', async () => {
        const id = await fx.made('Crew');
        const opened = await madeId(fx.invoke('agent_start', { cli: 'claude', view: id, prompt: 'go' }));
        expect(fx.lineage.openedCount('term-1')).toBe(1);
        // The same hook the daemon wires up, which is what prunes a prompt and a lineage record.
        let pruned: Promise<void> = Promise.resolve();
        fx.store.index.onPlaces = (project, ids) => {
            pruned = fx.lineage.prune(project, ids);
        };

        await fx.invoke('view_delete', { view_id: id });
        await pruned;
        expect(fx.lineage.depthOf(opened)).toBe(0);
        expect(fx.lineage.openedCount('term-1')).toBe(0);
    });

    test('the sidebar can never be emptied, because the caller is always standing in one of the rows', async () => {
        fx.knobs.deleteAnyView = true;
        for (const id of ['main', 'sep-1', 'chat-1', 'board', 'sketch-1']) {
            await fx.invoke('view_delete', { view_id: id }, 'chat');
        }
        // Every other row went; the caller's own view is the one that refused.
        expect((await fx.onDisk()).views).toMatchObject([{ id: 'chat-1', kind: 'chat' }]);
    });

    test('an id that is no view of this project is refused with the views', async () => {
        expect((await fx.invoke('view_delete', { view_id: 'nowhere' })).lines[0]).toBe('refused\tunknown-view\tnowhere is not a view of this project');
    });
});

describe('the view tools', () => {
    test('a session that is in no project of this machine changes nothing', async () => {
        expect((await fx.invoke('view_new', { name: 'Plan' }, 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
        expect((await fx.invoke('view_delete', { view_id: 'board' }, 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
    });
});

describe('view open', () => {
    /* What open itself would take: the separator is left out, since open refuses it a line later. */
    const VIEW_LINES = ['view\tmain\tcanvas\tCanvas', 'view\tboard\tcanvas\tBoard', 'view\tchat-1\tchat\tPlanner', 'view\tsketch-1\tdrawing\tSketch'];

    test('tells the clients that have the project on screen, and writes nothing', async () => {
        await fx.store.openProject({ projectId: fx.projectId });
        fx.store.hold('client-1', fx.projectId);
        const { status, lines } = await fx.invoke('view_open', { view_id: 'board' });
        expect(status).toBe(200);
        expect(lines).toEqual(['showing\tboard\tcanvas\tBoard', 'sent\tyes\tEveryone with this project on screen was told']);
        expect(fx.watching).toEqual([{ projectId: fx.projectId, viewId: 'board', by: 'term-1' }]);
        // Showing is personal, so the shared file stands where the last write left it.
        expect((await fx.onDisk()).rev).toBe(1);
    });

    test('a project nobody has on screen is not a failure, and the client is not told', async () => {
        const { status, lines } = await fx.invoke('view_open', { view_id: 'sketch-1' });
        expect(status).toBe(200);
        expect(lines).toEqual(['showing\tsketch-1\tdrawing\tSketch', 'sent\tno\tNobody has this project on screen right now, so nothing was showing it']);
        expect(fx.watching).toEqual([]);
    });

    test('a client that let the project go stops being told', async () => {
        fx.store.hold('client-1', fx.projectId);
        expect((await fx.invoke('view_open', { view_id: 'board' })).lines[1]).toStartWith('sent\tyes\t');
        fx.store.letGo('client-1', fx.projectId);
        expect((await fx.invoke('view_open', { view_id: 'board' })).lines[1]).toStartWith('sent\tno\t');
        expect(fx.watching).toHaveLength(1);
    });

    test('a divider never opens', async () => {
        const { status, lines } = await fx.invoke('view_open', { view_id: 'sep-1' });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tnever-opens\tsep-1 is a separator and has nothing to show');
        expect(lines.slice(1)).toEqual(VIEW_LINES);
        expect(fx.watching).toEqual([]);

        const [made] = (await fx.invoke('view_new', { name: 'Agents', kind: 'subheader' })).lines;
        const id = made!.split('\t')[0]!;
        const heading = await fx.invoke('view_open', { view_id: id });
        expect(heading.status).toBe(422);
        expect(heading.lines[0]).toBe(`refused\tnever-opens\t${id} is a subheader and has nothing to show`);
        expect(fx.watching).toEqual([]);
    });

    test('an id the project does not have is refused with the views it does', async () => {
        const { status, lines } = await fx.invoke('view_open', { view_id: 'Board' });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-view\tBoard is not a view of this project');
        expect(lines.slice(1)).toEqual([...VIEW_LINES, 'note\tview open takes a view id, never a name']);
        expect(fx.watching).toEqual([]);
    });

    test('takes one id, and nothing that would make it a dry run', async () => {
        expect((await fx.invoke('view_open', {})).lines[0]).toBe('refused\tbad-arguments\tview_open needs view_id, the id of a view; view_list lists them');
        expect((await fx.invoke('view_open', { view_id: ['board', 'main'] })).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await fx.invoke('view_open', { view_id: 'board', dry_run: true })).lines[0]).toBe('refused\tbad-arguments\tview_open takes no dry_run');
        expect(fx.watching).toEqual([]);
    });

    test('a session that is in no project of this machine shows nobody anything', async () => {
        expect((await fx.invoke('view_open', { view_id: 'board' }, 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
        expect(fx.watching).toEqual([]);
    });
});

describe('view diagram', () => {
    const doc = (overrides: Record<string, unknown> = {}): string =>
        JSON.stringify({
            meta: { title: 'Wire', direction: 'down' },
            nodes: [
                { id: 'web', label: 'Web' },
                { id: 'api', label: 'API' }
            ],
            groups: [{ id: 'back', label: 'Back', wraps: ['api'] }],
            edges: [{ from: 'web', to: 'api' }],
            ...overrides
        });

    const write = (viewId: string, document: string, token = 'term'): Promise<{ status: number; lines: string[] }> =>
        fx.invoke('view_diagram', { view_id: viewId, document: `${document}` }, token);

    /* Nothing a tool makes is shared, so its diagram sits on the private side of the folder. */
    const diagramOnDisk = async (viewId: string, base = fx.folder): Promise<unknown> =>
        readFile(join(base, '.ruimte', 'private', 'diagrams', `${viewId}.json`), 'utf8')
            .then((text) => JSON.parse(text))
            .catch(() => null);

    test('the diagram guide names every field of the document and every value a closed field takes', () => {
        const lines = viewToolkit.guides.find((guide) => guide.name === 'diagram')!.lines;
        const shapes = {
            'meta.': DiagramMetaSchema.shape,
            'nodes[].': DiagramNodeSchema.shape,
            'groups[].': DiagramGroupSchema.shape,
            'edges[].': DiagramEdgeSchema.shape
        };
        for (const [prefix, shape] of Object.entries(shapes)) {
            for (const key of Object.keys(shape)) {
                expect(lines.some((line) => line.startsWith(`field\t${prefix}${key}\t`))).toBe(true);
            }
        }
        const text = lines.join('\n');
        for (const value of [...DIAGRAM_SHAPES, ...DrawingColorSchema.options, ...DiagramEdgeStyleSchema.options, ...DiagramDirectionSchema.options]) {
            expect(text).toInclude(value);
        }
        expect(lines.find((line) => line.startsWith('field\tnodes[].pos\t'))).toInclude('Only a person');
        expect(text).toInclude('loses a position a person dragged it to');
    });

    test('the example in the help is a document the tool takes', async () => {
        const id = await fx.made('Flow', { kind: 'diagram' });
        expect((await write(id, DIAGRAM_EXAMPLE)).lines).toEqual([`${id}\t1\t3\t1\t2`]);
    });

    test('a valid document lands on disk at rev + 1 in a released project, and every client hears it', async () => {
        const id = await fx.made('Flow', { kind: 'diagram' });
        expect(await write(id, doc())).toEqual({ status: 200, lines: [`${id}\t1\t2\t1\t1`] });
        expect(await diagramOnDisk(id)).toMatchObject({ version: 1, rev: 1, meta: { direction: 'down' }, nodes: [{ id: 'web' }, { id: 'api' }] });
        expect((await write(id, doc({ edges: [] }))).lines).toEqual([`${id}\t2\t2\t1\t0`]);
        expect(fx.diagramEvents.map((event) => event.event)).toEqual(['diagram.changed', 'diagram.changed']);
        expect(fx.diagramEvents[1]).toMatchObject({ payload: { projectId: fx.projectId, viewId: id, document: { rev: 2 } } });
    });

    test('a project a client had open and let go of is written all the same, and the client hears it', async () => {
        const id = await fx.made('Flow', { kind: 'diagram' });
        await fx.store.openProject({ projectId: fx.projectId });
        await fx.diagrams.open(fx.projectId, id);
        fx.store.release(fx.projectId);
        expect((await write(id, doc())).lines).toEqual([`${id}\t1\t2\t1\t1`]);
        expect(fx.diagramEvents).toHaveLength(1);
        expect(fx.diagramEvents[0]).toMatchObject({ event: 'diagram.changed', payload: { projectId: fx.projectId, viewId: id, document: { rev: 1 } } });
    });

    test('version and rev read back from the file are ignored, since the rev is the daemon’s', async () => {
        const id = await fx.made('Flow', { kind: 'diagram' });
        await write(id, doc());
        const fromDisk = { ...((await diagramOnDisk(id)) as object), rev: 40 };
        expect((await write(id, JSON.stringify(fromDisk))).lines).toEqual([`${id}\t2\t2\t1\t1`]);
    });

    test('an edge to an id that is no node is refused with that id, and nothing is written', async () => {
        const id = await fx.made('Flow', { kind: 'diagram' });
        const { status, lines } = await write(id, doc({ edges: [{ from: 'web', to: 'ghost' }] }));
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tdiagram-invalid\tThe edge from "web" to "ghost" names "ghost", which is not a node');
        expect(await diagramOnDisk(id)).toBeNull();
        expect(fx.diagramEvents).toEqual([]);
    });

    test('a document that breaks the schema is refused by path, with the item it is about and what may go there', async () => {
        const id = await fx.made('Flow', { kind: 'diagram' });
        const { lines } = await write(
            id,
            doc({
                nodes: [
                    { id: 'web', label: 'Web' },
                    { id: 'api', lable: 'API', shape: 'hexagon' }
                ],
                edges: [{ from: 'web', to: 'api', style: 'wavy' }]
            })
        );
        expect(lines[0]).toStartWith('refused\tbad-document\tnodes[1]');
        const problems = lines.filter((line) => line.startsWith('problem\t'));
        expect(problems).toContain(`problem\tnodes[1].shape\ttakes one of ${DIAGRAM_SHAPES.join(', ')} (node "api")`);
        expect(problems).toContain('problem\tnodes[1].label\tis missing and needs a string (node "api")');
        expect(problems).toContain('problem\tnodes[1]\thas no field lable (node "api")');
        expect(problems.some((line) => line.startsWith('problem\tedges[0].style\t') && line.endsWith('(the edge from "web" to "api")'))).toBe(true);
        for (const line of lines) {
            expect(line).not.toInclude('Invalid');
            expect(line).not.toInclude('expected');
        }
        expect(await diagramOnDisk(id)).toBeNull();
    });

    test('no document, one that is not JSON, one that is not an object and a dry_run are each refused by name', async () => {
        const id = await fx.made('Flow', { kind: 'diagram' });
        expect((await fx.invoke('view_diagram', { view_id: id })).lines[0]).toStartWith('refused\tno-document\t');
        expect((await write(id, '  \n')).lines[0]).toStartWith('refused\tno-document\t');
        expect((await write(id, '{ nodes: [')).lines[0]).toStartWith('refused\tbad-json\tThe document is not JSON: ');
        expect((await write(id, '[]')).lines[0]).toBe('refused\tbad-document\tdocument needs to be one JSON object with meta, nodes, groups and edges');
        expect((await write(id, JSON.stringify({ nodes: [], groups: [], edges: [] }))).lines[0]).toBe(
            'refused\tbad-document\tmeta is missing and needs an object'
        );
        expect((await fx.invoke('view_diagram', { view_id: id, document: doc(), dry_run: true })).lines[0]).toBe(
            'refused\tbad-arguments\tview_diagram takes no dry_run'
        );
    });

    test('a view that is no diagram, or a diagram of another project, is refused with the diagrams of this one', async () => {
        expect((await write('sketch-1', doc())).lines).toEqual([
            'refused\tnot-a-diagram\tsketch-1 is not a diagram view of this project',
            'note\tThis project has no diagram view; view_new <name> kind diagram makes one'
        ]);
        const id = await fx.made('Flow', { kind: 'diagram' });
        expect((await write('sketch-1', doc())).lines.slice(1)).toEqual([`view\t${id}\tdiagram\tFlow`]);

        const otherFolder = join(fx.root, 'other');
        await mkdir(otherFolder);
        const other = await fx.store.openProject({ folder: otherFolder });
        await fx.store.save(other.summary.projectId, other.document.rev, {
            name: 'other',
            color: '#654321',
            views: [{ kind: 'diagram', id: 'theirs', name: 'Theirs' }]
        });
        fx.store.release(other.summary.projectId);
        expect((await write('theirs', doc())).lines[0]).toBe('refused\tnot-a-diagram\ttheirs is not a diagram view of this project');
        expect(await diagramOnDisk('theirs', otherFolder)).toBeNull();
    });

    test('a session that is in no project of this machine writes nothing', async () => {
        const id = await fx.made('Flow', { kind: 'diagram' });
        expect((await write(id, doc(), 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
        expect(await diagramOnDisk(id)).toBeNull();
    });
});

describe('a drawing an agent writes in', () => {
    const SUN = JSON.stringify({ add: [{ kind: 'ellipse', x: 620, y: 40, w: 90, h: 90, stroke: 'orange', fill: 'solid', fillColor: 'yellow' }] });

    test('takes a # to it, prints the new ids and tells every client', async () => {
        const refused = await fx.invoke('view_drawing', { view_id: 'sketch-1', revision: '0', edit: `${SUN}` }, 'chat');
        expect(refused.lines[0]).toStartWith('refused\tnot-linked\t');
        await fx.pointAt('chat-1', ['sketch-1']);
        const dry = await fx.invoke('view_drawing', { view_id: 'sketch-1', revision: '0', dry_run: true, edit: `${SUN}` }, 'chat');
        expect(dry.lines[0]).toBe('sketch-1\t0\t1');
        expect(fx.drawingEvents).toEqual([]);
        const drawn = await fx.invoke('view_drawing', { view_id: 'sketch-1', revision: '0', edit: `${SUN}` }, 'chat');
        expect(drawn.lines[0]).toBe('sketch-1\t1\t1');
        expect(drawn.lines[1]).toMatch(/^added\tel-[0-9a-f]{10}$/);
        expect(fx.drawingEvents.map((event) => event.event)).toEqual(['drawing.changed']);
        const [element] = (await fx.drawings.read(fx.projectId, 'sketch-1'))!.elements;
        expect(element).toMatchObject({ kind: 'ellipse', stroke: 'orange', fillColor: 'yellow', strokeWidth: 2 });
    });

    test('refuses a field on its path, a hex color and an unknown element', async () => {
        await fx.pointAt('chat-1', ['sketch-1']);
        const odd = await fx.invoke(
            'view_drawing',
            { view_id: 'sketch-1', revision: '0', edit: '{"add":[{"kind":"rect","x":0,"y":0,"w":1,"h":1,"glow":1}]}' },
            'chat'
        );
        expect(odd.lines.slice(0, 2)).toEqual(['refused\tbad-edit\tadd[0] has no field glow', 'problem\tadd[0]\thas no field glow']);
        const hex = await fx.invoke(
            'view_drawing',
            { view_id: 'sketch-1', revision: '0', edit: '{"add":[{"kind":"rect","x":0,"y":0,"w":1,"h":1,"stroke":"#ff0000"}]}' },
            'chat'
        );
        expect(hex.lines[0]).toStartWith('refused\tbad-edit\tadd[0].stroke ');
        const gone = await fx.invoke('view_drawing', { view_id: 'sketch-1', revision: '0', edit: '{"remove":["el-x"]}' }, 'chat');
        expect(gone.lines[0]).toBe('refused\tbad-edit\tremove[0] the drawing has no element el-x');
        expect((await fx.invoke('view_drawing', { view_id: 'sketch-1', edit: `${SUN}` }, 'chat')).lines[0]).toStartWith('refused\tbad-arguments\t');
    });

    test('takes a drawing the agent made itself, and a # to the canvas a drawing stands on is not enough', async () => {
        const mine = await fx.made('Mine', { kind: 'drawing' }, 'chat');
        expect((await fx.invoke('view_drawing', { view_id: mine, revision: '0', edit: `${SUN}` }, 'chat')).lines[0]).toBe(`${mine}\t1\t1`);
        await fx.pointAt('chat-1', ['main']);
        expect((await fx.invoke('view_drawing', { view_id: 'sketch-1', revision: '0', edit: `${SUN}` }, 'chat')).lines[0]).toStartWith('refused\tnot-linked\t');
    });

    test('node color takes a node the person pointed at, with no view', async () => {
        expect((await fx.invoke('node_update', { node_id: 'note-1', color: 'teal' }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        await fx.pointAt('chat-1', ['note-1']);
        expect((await fx.invoke('node_update', { node_id: 'note-1', color: 'teal' }, 'chat')).lines).toEqual(['colored\tnote-1\tnote\tteal']);
    });
});
