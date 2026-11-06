import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { CANVAS_GRID, GROUP_HEADER, GROUP_PADDING, NODE_ACCENT_NAMES, NODE_SIZE, type ProjectCanvasView, type ProjectEdge } from '@ruimte/contracts';
import { MAX_TITLE_LENGTH, NEW_NODE } from '../canvas/host.ts';
import { MAX_CANVAS_NODES } from '../canvas/nodes.ts';
import { PLACEMENT_GAP } from '../canvas/placement.ts';
import { SIMULATOR } from '../devices/device-test-helpers.ts';
import { rawPrivateViews, setPrivateViews } from '../projects/project-file-test-helpers.ts';
import { box, canvasFixture, type CanvasFixture, content, madeId } from './canvas-fixture-test-helpers.ts';
import { nodeToolkit } from './node-tools.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

describe('node new', () => {
    test('adds a note beside the caller on a released project and prints its id', async () => {
        const { status, lines } = await fx.invoke('node_new', { kind: 'note', text: 'hello' });
        expect(status).toBe(200);
        const [id, kind, viewId] = lines[0]!.split('\t');
        expect(id).toMatch(/^note-[0-9a-z]{8}$/);
        expect([kind, viewId]).toEqual(['note', 'main']);
        const document = await fx.onDisk();
        expect(document.rev).toBe(2);
        const node = await fx.nodeOnDisk(id);
        expect(node).toEqual({ id: id!, kind: 'note', title: 'Note', x: 560 + PLACEMENT_GAP, y: 0, ...NODE_SIZE.note, body: 'hello' });
        expect(fx.store.index.locate(id!)).toEqual({ projectId: fx.projectId, folder: fx.folder, canvasId: 'main' });
    });

    test('a node placed inside a frame that spells out its members joins it, as a drop would', async () => {
        await fx.seed(box('inside', 1100, 1100), box('frame', 1000, 1000, { kind: 'group', w: 1200, h: 800, memberIds: ['inside'] }));
        const id = await madeId(fx.invoke('node_new', { kind: 'note', text: 'hello', beside: 'inside' }));
        expect((await fx.nodeOnDisk('frame'))!.memberIds).toEqual(['inside', id]);
    });

    test('takes the size a person on this machine gave the kind, and the built-in size of every other kind', async () => {
        fx.knobs.nodeSizes = { note: { w: 400, h: 320 }, chat: { w: 640, h: 720 } };
        const note = await madeId(fx.invoke('node_new', { kind: 'note', text: 'hello' }));
        const browser = await madeId(fx.invoke('node_new', { kind: 'browser', url: 'https://example.com' }));
        const chat = await madeId(fx.invoke('agent_start', { cli: 'claude' }));
        const nodes = (await fx.canvasOnDisk()).nodes;
        const sizeOf = (id: string) => {
            const node = nodes.find((candidate) => candidate.id === id)!;
            return { w: node.w, h: node.h };
        };
        expect(sizeOf(note)).toEqual({ w: 400, h: 320 });
        expect(sizeOf(browser)).toEqual(NODE_SIZE.browser);
        expect(sizeOf(chat)).toEqual({ w: 640, h: 720 });
    });

    test('draws a line from the caller into what it made, context into an agent node and origin into anything else', async () => {
        const withFlow = content();
        withFlow.views.push({ kind: 'diagram', id: 'flow-1', name: 'Flow' });
        await fx.replaceContent(withFlow);

        const cases: Array<{ input: Record<string, string>; label?: string; role?: string }> = [
            { input: { kind: 'note' }, role: 'origin' },
            { input: { kind: 'browser', url: 'https://example.com' }, role: 'origin' },
            { input: { kind: 'file', path: 'src/main.ts' }, role: 'origin' },
            { input: { kind: 'drawing', source: 'sketch-1' }, role: 'origin' },
            { input: { kind: 'diagram', source: 'flow-1' }, role: 'origin' },
            { input: { kind: 'terminal' }, label: 'context' },
            { input: { kind: 'chat' }, label: 'context' }
        ];
        for (const { input, label, role } of cases) {
            const [id, kind, view, edgeId] = (await fx.invoke('node_new', input)).lines[0]!.split('\t');
            expect({ input, kind, view }).toEqual({ input, kind: input.kind!, view: 'main' });
            const edge = (await fx.canvasOnDisk()).edges.find((candidate) => candidate.id === edgeId);
            // A line into a terminal or a chat is the one agent draws, label and all and no role of its own.
            expect({ input, edge }).toEqual({
                input,
                edge: {
                    id: edgeId!,
                    from: 'term-1',
                    to: id!,
                    ...(label === undefined ? {} : { label }),
                    ...(role === undefined ? {} : { role })
                }
            });
        }
    });

    test('a device of this machine becomes a node under its own name, and the line from the caller lets it operate the device', async () => {
        expect((await fx.invoke('device_list', {})).lines).toEqual(['device\tsim-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0\tbooted']);
        const [id, kind, view, edgeId] = (await fx.invoke('node_new', { kind: 'device', device: 'sim-1' })).lines[0]!.split('\t');
        expect([kind, view]).toEqual(['device', 'main']);
        const canvas = await fx.canvasOnDisk();
        expect(canvas.nodes.find((node) => node.id === id)).toMatchObject({
            kind: 'device',
            title: SIMULATOR.name,
            ...NODE_SIZE.device,
            device: { platform: 'ios', kind: 'simulator', name: SIMULATOR.name, runtime: SIMULATOR.runtime }
        });
        expect(canvas.edges.find((edge) => edge.id === edgeId)).toEqual({ id: edgeId!, from: 'term-1', to: id!, role: 'origin' });
        expect((await fx.invoke('device_state', { device: id! })).lines.slice(0, 2)).toEqual([
            'device\tsim-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0',
            'state\tbooted'
        ]);
    });

    test('a chat view puts a device on the canvas it names with no line, and every agent operates a device node with no line or view', async () => {
        const [id, kind, view, edge] = (await fx.invoke('node_new', { kind: 'device', device: 'sim-1', view: 'main' }, 'chat')).lines[0]!.split('\t');
        expect([kind, view, edge]).toEqual(['device', 'main', '-']);
        expect((await fx.canvasOnDisk()).edges).toEqual([]);
        expect((await fx.invoke('device_state', { device: id! }, 'chat')).lines.slice(0, 2)).toEqual([
            'device\tsim-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0',
            'state\tbooted'
        ]);
        expect((await fx.invoke('device_open', { device: id!, url: 'https://ruimte.app' }, 'chat')).lines[0]).toBe(`done\topen\t${id}\tiPhone 18 Pro`);
        // The chat claimed the device, so the terminal beside it waits for it.
        expect((await fx.invoke('device_state', { device: 'sim-1' })).lines[0]).toStartWith('refused\tdevice-in-use\t');
    });

    test('a device node needs a device this machine has, and only a device node takes one', async () => {
        expect((await fx.invoke('node_new', { kind: 'device' })).lines[0]).toStartWith('refused\tmissing-flag\tA device node needs device');
        expect((await fx.invoke('node_new', { kind: 'device', device: 'pixel-9' })).lines).toEqual([
            'refused\tunknown-device\tpixel-9 is not a device of this machine right now',
            'device\tsim-1\tiPhone 18 Pro\tios\tsimulator\tiOS 27.0\tbooted'
        ]);
        expect((await fx.invoke('node_new', { kind: 'note', device: 'sim-1' })).lines[0]).toStartWith(
            'refused\tflag-not-for-kind\tdevice does not go with a note node'
        );
        expect((await fx.canvasOnDisk()).nodes.some((node) => node.kind === 'device')).toBe(false);
    });

    test('a caller that is not a node on that canvas gets no line, and the edge column says so', async () => {
        const elsewhere = await fx.invoke('node_new', { kind: 'note', view: 'board' });
        expect(elsewhere.lines[0]!.split('\t').slice(1)).toEqual(['note', 'board', '-']);

        // A chat that is a view of its own is a node on no canvas at all.
        const ofItsOwn = await fx.invoke('node_new', { kind: 'note', view: 'board' }, 'chat');
        expect(ofItsOwn.status).toBe(200);
        expect(ofItsOwn.lines[0]!.split('\t').slice(1)).toEqual(['note', 'board', '-']);
        expect((await fx.canvasOnDisk('board')).edges).toEqual([]);
    });

    test('dry_run names the line it would draw and leaves the canvas alone', async () => {
        expect((await fx.invoke('node_new', { kind: 'terminal', dry_run: true })).lines).toEqual([`dry-run\tterminal\tmain\tterm-1 -> ${NEW_NODE}`]);
        const canvas = await fx.canvasOnDisk();
        expect(canvas.edges).toEqual([]);
        expect(canvas.nodes.map((node) => node.id)).toEqual(['term-1', 'note-1']);
    });

    test('beside places right of a named node, and refuses one that is not on the canvas', async () => {
        const { lines } = await fx.invoke('node_new', { kind: 'terminal', beside: 'note-1', title: 'Build' });
        const id = lines[0]!.split('\t')[0];
        const node = (await fx.nodeOnDisk(id))!;
        expect([node.x, node.y, node.title, node.titleSource]).toEqual([320 + PLACEMENT_GAP, 601, 'Build', 'user']);
        // chat-1 is a view of its own, which the refusal says rather than leaving it to be looked for.
        expect((await fx.invoke('node_new', { kind: 'note', beside: 'chat-1' })).lines[0]).toBe(
            'refused\tnot-on-a-canvas\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project, so the new node has nothing there to stand beside'
        );
        expect((await fx.invoke('node_new', { kind: 'note', beside: 'ghost' })).lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
    });

    test('beside wins over the row beside the caller, wherever the anchor sits', async () => {
        // Far left of everything and well below the caller: the first free spot on the caller's row is nowhere near it.
        const moved = content();
        (moved.views[0] as ProjectCanvasView).nodes[1]!.x = -4000;
        (moved.views[0] as ProjectCanvasView).nodes[1]!.y = 2400;
        await fx.replaceContent(moved);

        const { lines } = await fx.invoke('node_new', { kind: 'note', beside: 'note-1' });
        const node = (await fx.nodeOnDisk(lines[0]!.split('\t')[0]!))!;
        expect([node.x, node.y]).toEqual([-4000 + 320 + PLACEMENT_GAP, 2400]);
    });

    test('text is written as sent, a backslash and all', async () => {
        const { lines } = await fx.invoke('node_new', { kind: 'note', text: 'Line one\nLine two\tend\\n\\d' });
        const node = (await fx.nodeOnDisk(lines[0]!.split('\t')[0]!))!;
        expect(node.body).toBe('Line one\nLine two\tend\\n\\d');
    });

    test('refuses a flag that does not belong to the kind', async () => {
        const cases: Array<Record<string, string>> = [
            { kind: 'note', url: 'https://example.com' },
            { kind: 'browser', url: 'https://example.com', text: 'x' },
            { kind: 'terminal', path: 'src/main.ts' },
            { kind: 'file', path: 'src/main.ts', cwd: 'src' },
            { kind: 'chat', source: 'sketch-1' }
        ];
        for (const input of cases) {
            expect((await fx.invoke('node_new', input)).lines[0]).toStartWith('refused\tflag-not-for-kind\t');
        }
    });

    test('a browser keeps the address it was given', async () => {
        const id = await madeId(fx.invoke('node_new', { kind: 'browser', url: 'https://example.com/docs' }));
        expect((await fx.nodeOnDisk(id))?.url).toBe('https://example.com/docs');
    });

    test('a file stores its path relative to the folder, and an outside one absolute', async () => {
        expect((await fx.invoke('node_new', { kind: 'file' })).lines[0]).toStartWith('refused\tmissing-flag\t');
        expect((await fx.invoke('node_new', { kind: 'file', path: 'src' })).lines[0]).toStartWith('refused\tbad-path\t');
        const inside = await madeId(fx.invoke('node_new', { kind: 'file', path: 'src/main.ts' }));
        const absolute = await madeId(fx.invoke('node_new', { kind: 'file', path: join(fx.outside, 'notes.md') }));
        expect(await fx.nodeOnDisk(inside)).toMatchObject({ path: 'src/main.ts', title: 'main.ts' });
        expect(await fx.nodeOnDisk(absolute)).toMatchObject({ path: join(fx.outside, 'notes.md'), title: 'notes.md' });
    });

    test('an artifact node names an artifact of this project, follows the latest without a version and reads as its report', async () => {
        expect((await fx.invoke('node_new', { kind: 'artifact' })).lines[0]).toStartWith('refused\tmissing-flag\t');
        expect((await fx.invoke('node_new', { kind: 'artifact', artifact: 'art-9' })).lines[0]).toStartWith('refused\tnot-found\t');
        expect((await fx.invoke('node_new', { kind: 'artifact', artifact: 'art-1', version: 'ver-9' })).lines[0]).toStartWith('refused\tnot-found\t');
        expect((await fx.invoke('node_new', { kind: 'note', artifact: 'art-1' })).lines[0]).toStartWith('refused\tflag-not-for-kind\t');
        const latest = await madeId(fx.invoke('node_new', { kind: 'artifact', artifact: 'art-1' }));
        const pinned = await madeId(fx.invoke('node_new', { kind: 'artifact', artifact: 'art-1', version: 'ver-1' }));
        const nodes = (await fx.canvasOnDisk()).nodes;
        expect(nodes.find((node) => node.id === latest)).toMatchObject({ kind: 'artifact', title: 'Morning summary', artifact: { id: 'art-1' } });
        expect(nodes.find((node) => node.id === pinned)).toMatchObject({ artifact: { id: 'art-1', version: 'ver-1' } });
    });

    test("a routine node names a routine of this project and takes the routine's title", async () => {
        expect((await fx.invoke('node_new', { kind: 'routine' })).lines[0]).toStartWith('refused\tmissing-flag\t');
        expect((await fx.invoke('node_new', { kind: 'routine', routine: 'nightly' })).lines).toEqual([
            'refused\troutine-not-found\tThis project has no routine nightly',
            'routine\tmorning-summary\tMorning summary'
        ]);
        expect((await fx.invoke('node_new', { kind: 'note', routine: 'morning-summary' })).lines[0]).toStartWith('refused\tflag-not-for-kind\t');
        expect((await fx.invoke('node_new', { json: '[{"kind":"routine"}]' })).lines[0]).toStartWith('refused\t');
        const made = await madeId(fx.invoke('node_new', { kind: 'routine', routine: 'morning-summary' }));
        const node = await fx.nodeOnDisk(made);
        expect(node).toMatchObject({ kind: 'routine', title: 'Morning summary', routine: 'morning-summary' });
    });

    test('a drawing needs a drawing view of the same project as its source', async () => {
        expect((await fx.invoke('node_new', { kind: 'drawing' })).lines[0]).toStartWith('refused\tmissing-flag\t');
        const wrong = await fx.invoke('node_new', { kind: 'drawing', source: 'board' });
        expect(wrong.lines).toEqual(['refused\tnot-a-drawing\tboard is not a drawing view of this project', 'drawing\tsketch-1\tSketch']);
        const { lines } = await fx.invoke('node_new', { kind: 'drawing', source: 'sketch-1' });
        const node = (await fx.nodeOnDisk(lines[0]!.split('\t')[0]!))!;
        expect(node).toMatchObject({ viewId: 'sketch-1', title: 'Sketch' });
    });

    test('a diagram needs a diagram view of the same project as its source', async () => {
        const withFlow = content();
        withFlow.views.push({ kind: 'diagram', id: 'flow-1', name: 'Flow' });
        await fx.replaceContent(withFlow);

        expect((await fx.invoke('node_new', { kind: 'diagram' })).lines[0]).toStartWith('refused\tmissing-flag\t');
        // A drawing is not a diagram, even though both take source.
        const wrongKind = await fx.invoke('node_new', { kind: 'diagram', source: 'sketch-1' });
        expect(wrongKind.lines).toEqual(['refused\tnot-a-diagram\tsketch-1 is not a diagram view of this project', 'diagram\tflow-1\tFlow']);
        const unknown = await fx.invoke('node_new', { kind: 'diagram', source: 'nowhere' });
        expect(unknown.lines[0]).toBe('refused\tnot-a-diagram\tnowhere is not a diagram view of this project');
        expect((await fx.invoke('node_new', { kind: 'drawing', source: 'flow-1' })).lines[0]).toStartWith('refused\tnot-a-drawing\t');

        const { lines } = await fx.invoke('node_new', { kind: 'diagram', source: 'flow-1' });
        const [id, kind] = lines[0]!.split('\t');
        expect(kind).toBe('diagram');
        const node = (await fx.nodeOnDisk(id))!;
        expect(node).toMatchObject({ kind: 'diagram', viewId: 'flow-1', title: 'Flow', w: 480, h: 360 });
    });

    test('a source with no diagram view in the project says how to make one', async () => {
        const { lines } = await fx.invoke('node_new', { kind: 'diagram', source: 'nowhere' });
        expect(lines).toEqual([
            'refused\tnot-a-diagram\tnowhere is not a diagram view of this project',
            'note\tThis project has no diagram views; view_new kind diagram makes one'
        ]);
    });

    test('a cwd lies inside the folder or a worktree of it', async () => {
        const { lines } = await fx.invoke('node_new', { kind: 'chat', cwd: 'src' });
        expect(lines[0]).not.toStartWith('refused');
        const node = (await fx.nodeOnDisk(lines[0]!.split('\t')[0]!))!;
        // Stored portable, like every cwd the client saves.
        expect(node.cwd).toBe('./src');

        expect((await fx.invoke('node_new', { kind: 'terminal', cwd: fx.outside })).lines[0]).toStartWith('refused\tcwd-outside-project\t');
        expect((await fx.invoke('node_new', { kind: 'terminal', cwd: '../elsewhere' })).lines[0]).toStartWith('refused\tcwd-outside-project\t');
        expect((await fx.invoke('node_new', { kind: 'terminal', cwd: 'nope' })).lines[0]).toStartWith('refused\tbad-cwd\t');

        await symlink(fx.outside, join(fx.folder, 'escape'));
        expect((await fx.invoke('node_new', { kind: 'terminal', cwd: 'escape' })).lines[0]).toStartWith('refused\tcwd-outside-project\t');

        fx.knobs.worktrees = [fx.worktree];
        expect((await fx.invoke('node_new', { kind: 'terminal', cwd: fx.worktree })).status).toBe(200);
    });

    test('a cwd outside names the folder and every worktree, so the next try needs no guessing', async () => {
        const bare = await fx.invoke('node_new', { kind: 'terminal', cwd: fx.outside });
        expect(bare.lines).toEqual([
            `refused\tcwd-outside-project\t${fx.outside} is outside ${fx.folder} and the worktrees of its repository`,
            `folder\t${fx.folder}`
        ]);

        // git lists the checkout itself among the worktrees; the folder line already said that one.
        fx.knobs.worktrees = [fx.folder, fx.worktree];
        const listed = await fx.invoke('node_new', { kind: 'terminal', cwd: fx.outside });
        expect(listed.lines).toEqual([listed.lines[0]!, `folder\t${fx.folder}`, `worktree\t${fx.worktree}`]);
    });

    test('an id is unique across the whole project', async () => {
        const ids = new Set<string>();
        for (let i = 0; i < 20; i++) {
            ids.add(await madeId(fx.invoke('node_new', { kind: 'note' })));
        }
        expect(ids.size).toBe(20);
    });

    test('a full canvas is refused with what is on it and what was asked, and nothing is written', async () => {
        const full = content();
        const board = full.views[2] as ProjectCanvasView;
        board.nodes = Array.from({ length: MAX_CANVAS_NODES }, (_, i) => ({ id: `n-${i}`, kind: 'note' as const, title: 'n', x: i * 10, y: 0, w: 10, h: 10 }));
        await fx.replaceContent(full);
        const before = await fx.onDisk();
        for (const answer of [fx.invoke('node_new', { kind: 'note', view: 'board' }), fx.invoke('agent_start', { cli: 'claude', view: 'board' })]) {
            expect((await answer).lines[0]).toBe(
                `refused\tcanvas-full\tBoard holds ${MAX_CANVAS_NODES} nodes and this would add 1 more; a canvas holds at most ${MAX_CANVAS_NODES}`
            );
        }
        // A team counts its group in with its roles, so the number it names is what it would really add.
        const roles = JSON.stringify([{ title: 'Lexer', prompt: 'go', provider: 'claude' }]);
        expect((await fx.invoke('agent_team', { label: 'Crew', roles, view: 'board' })).lines[0]).toBe(
            `refused\tcanvas-full\tBoard holds ${MAX_CANVAS_NODES} nodes and this would add 2 more; a canvas holds at most ${MAX_CANVAS_NODES}`
        );
        expect((await fx.onDisk()).rev).toBe(before.rev);
    });
});

describe('node group', () => {
    test('draws the frame a person grouping the same selection would have drawn', async () => {
        await fx.seed(box('a', 400, 400), box('b', 800, 600));
        const { status, lines } = await fx.invoke('node_group', { nodes: 'a,b' });
        expect(status).toBe(200);
        const [id, kind, title, view, members] = lines[0]!.split('\t');
        expect([kind, title, view, members]).toEqual(['group', 'Group', 'main', '2']);
        // The client's own arithmetic (`groupSelection` in apps/client/src/state/canvas.ts), written out.
        const snap = (value: number): number => Math.round(value / CANVAS_GRID) * CANVAS_GRID;
        expect(await fx.nodeOnDisk(id!)).toEqual({
            id: id!,
            kind: 'group',
            title: 'Group',
            x: snap(400 - GROUP_PADDING),
            y: snap(400 - GROUP_PADDING - GROUP_HEADER),
            w: snap(600 + GROUP_PADDING * 2),
            h: snap(300 + GROUP_PADDING * 2 + GROUP_HEADER),
            memberIds: ['a', 'b']
        });
    });

    test('holds the texts and lines inside its frame, so they move with it', async () => {
        const next = content();
        const board = next.views[0] as ProjectCanvasView;
        board.nodes.push(box('a', 400, 400), box('b', 800, 600));
        board.texts.push({ id: 'text-in', x: 700, y: 500, text: 'inside', size: 16 });
        board.lines = [
            { id: 'line-in', x: 450, y: 450, endX: 850, endY: 650, stroke: 'red', strokeWidth: 2, strokeStyle: 'solid' },
            { id: 'line-out', x: 3000, y: 3000, endX: 3200, endY: 3000, stroke: 'red', strokeWidth: 2, strokeStyle: 'solid' }
        ];
        await fx.replaceContent(next);

        const { lines } = await fx.invoke('node_group', { nodes: 'a,b' });

        expect((await fx.nodeOnDisk(lines[0]!.split('\t')[0]!))?.memberIds).toEqual(['a', 'b', 'text-in', 'line-in']);
    });

    test('label and color are the ones the client offers', async () => {
        await fx.seed(box('a', 400, 400), box('b', 800, 600));
        const { lines } = await fx.invoke('node_group', { nodes: 'a,b', label: 'Parser work', color: 'violet' });
        expect(lines[0]!.split('\t')[2]).toBe('Parser work');
        expect(await fx.nodeOnDisk(lines[0]!.split('\t')[0]!)).toMatchObject({ title: 'Parser work', accent: 'violet' });

        const bad = await fx.invoke('node_group', { nodes: 'a', color: '#ff0000' });
        expect(bad.status).toBe(422);
        expect(bad.lines[0]).toBe(`refused\tunknown-color\t#ff0000 is not one of the ${NODE_ACCENT_NAMES.length} colors a frame takes`);
        expect(bad.lines[1]).toBe(['colors', ...NODE_ACCENT_NAMES].join('\t'));
    });

    test('says which nodes it caught that were not named', async () => {
        await fx.seed(box('a', 400, 400), box('b', 800, 600), box('between', 600, 500));
        const { lines } = await fx.invoke('node_group', { nodes: 'a,b' });
        expect(lines[0]!.split('\t')[4]).toBe('3');
        expect(lines.slice(1)).toEqual(['also\tbetween\tnote\tbetween']);
    });

    test('refuses a group, since the client leaves one out of a selection too', async () => {
        await fx.seed(box('a', 400, 400), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        const { status, lines } = await fx.invoke('node_group', { nodes: 'a,frame' });
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tnot-groupable\tframe is a group');
        expect((await fx.canvasOnDisk()).nodes.filter((node) => node.kind === 'group')).toHaveLength(1);
    });

    test('a refusal over an id never offers the frame this tool refuses a line later', async () => {
        await fx.seed(box('a', 400, 400), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        for (const tool of ['node_group', 'node_arrange']) {
            const { lines } = await fx.invoke(tool, { nodes: 'a,ghost' });
            expect(lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
            expect(lines.slice(1)).not.toContain('node\tframe\tgroup\tframe');
            expect(lines.slice(1)).toContain('node\ta\tnote\ta');
        }
    });

    test('refuses nodes that do not stand in the same place already', async () => {
        await fx.seed(box('inside', 400, 400), box('outside', 4000, 4000), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        const { status, lines } = await fx.invoke('node_group', { nodes: 'inside,outside' });
        expect(status).toBe(422);
        expect(lines[0]).toBe(
            'refused\tdifferent-groups\tinside stands in group frame and outside stands on the canvas itself; a frame goes around nodes that are already in the same place'
        );
    });

    test('inside a group that spells out its members the new frame takes the place of what it frames', async () => {
        await fx.seed(
            box('one', 400, 400),
            box('two', 700, 400),
            box('free', 400, 800),
            box('frame', 300, 300, { kind: 'group', w: 800, h: 800, memberIds: ['one', 'two', 'free'] })
        );
        const { lines } = await fx.invoke('node_group', { nodes: 'one,two' });
        const id = lines[0]!.split('\t')[0]!;
        expect((await fx.nodeOnDisk('frame'))!.memberIds).toEqual(['free', id]);
        expect((await fx.nodeOnDisk(id))!.memberIds).toEqual(['one', 'two']);
    });

    test('refuses an id that is not on the canvas, and says nothing about titles', async () => {
        await fx.seed(box('a', 400, 400));
        const missing = await fx.invoke('node_group', { nodes: 'a,ghost' });
        expect(missing.lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect(missing.lines.slice(1)).toContain('node\ta\tnote\ta');
        expect((await fx.invoke('node_group', { nodes: 'a,' })).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await fx.invoke('node_group', {})).lines[0]).toBe('refused\tbad-arguments\tnodes needs one or more node ids, separated by commas');
        expect((await fx.invoke('node_group', { nodes: 'a', dry_run: true })).lines[0]).toBe('refused\tbad-arguments\tnode_group takes no dry_run');
    });

    test('works on another canvas than the caller is on, and only through view', async () => {
        await fx.store.mutate(fx.projectId, (current) => {
            const next = structuredClone(current);
            (next.views[2] as ProjectCanvasView).nodes.push(box('far', 0, 0));
            return { content: next, result: null };
        });
        expect((await fx.invoke('node_group', { nodes: 'far' })).lines[0]).toBe('refused\tunknown-node\tfar is not a node on main');
        const { lines } = await fx.invoke('node_group', { nodes: 'far', view: 'board' });
        expect(lines[0]!.split('\t')[3]).toBe('board');
    });

    /* A note the caller opened, which is what node new draws a line from the caller into. */
    const newNote = async (token = 'term', input: Record<string, string> = {}): Promise<string> =>
        await madeId(fx.invoke('node_new', { kind: 'note', ...input }, token));

    const edgesOnDisk = async (): Promise<ProjectEdge[]> => (await fx.canvasOnDisk()).edges;

    test('the lines it had into the nodes become one line into the group', async () => {
        const notes = [await newNote(), await newNote(), await newNote()];
        expect(await edgesOnDisk()).toHaveLength(3);

        const { lines } = await fx.invoke('node_group', { nodes: notes.join(','), label: 'Roles' });
        const edges = await edgesOnDisk();
        expect(edges).toHaveLength(1);
        // The line node new draws into a note, drawn into the group that stands for all three.
        expect(edges[0]).toMatchObject({ from: 'term-1', to: lines[0]!.split('\t')[0]!, role: 'origin' });
        expect(lines.at(-1)).toBe(`edges\t3\t${edges[0]!.id}`);
    });

    test('a line a person drew stays, because that is the context they gave', async () => {
        await fx.seed(box('theirs', 2000, 2000));
        const mine = await newNote('term', { beside: 'theirs' });
        const drawn = await madeId(fx.invoke('link_new', { to: 'theirs' }));

        const { lines } = await fx.invoke('node_group', { nodes: `${mine},theirs` });
        const edges = await edgesOnDisk();
        expect(edges).toHaveLength(2);
        expect(edges[0]!.id).toBe(drawn);
        expect(edges[1]).toMatchObject({ from: 'term-1', to: lines[0]!.split('\t')[0]! });
        expect(lines.at(-1)).toBe(`edges\t1\t${edges[1]!.id}`);
    });

    test('nodes it had no line into get no line into their frame either', async () => {
        await fx.seed(box('a', 400, 400), box('b', 800, 600));
        const { lines } = await fx.invoke('node_group', { nodes: 'a,b' });
        expect(await edgesOnDisk()).toEqual([]);
        expect(lines.some((line) => line.startsWith('edges\t'))).toBe(false);
    });

    test('the line another agent drew into the same node stays where it is', async () => {
        const shared = await newNote();
        // A chat that is a view of its own gets no line into what it adds, so it draws one itself.
        const theirs = await newNote('chat', { view: 'main' });
        const drawn = await madeId(fx.invoke('link_new', { from: theirs, to: shared, view: 'main' }, 'chat'));

        const { lines } = await fx.invoke('node_group', { nodes: shared });
        const edges = await edgesOnDisk();
        expect(edges).toHaveLength(2);
        expect(edges[0]!.id).toBe(drawn);
        expect(edges[1]).toMatchObject({ from: 'term-1', to: lines[0]!.split('\t')[0]! });
        expect(lines.at(-1)).toBe(`edges\t1\t${edges[1]!.id}`);
    });

    test('a frame inside a frame leaves the line into the frame around it alone', async () => {
        await fx.seed(box('far', 4000, 0));
        const one = await newNote();
        const two = await newNote('term', { beside: 'far' });
        const outer = await madeId(fx.invoke('node_group', { nodes: `${one},${two}` }));
        const around = (await edgesOnDisk())[0]!.id;

        // A line drawn again into a node that stands in a frame, which the frame inside it replaces.
        const again = await madeId(fx.invoke('link_new', { to: one }));
        const { lines } = await fx.invoke('node_group', { nodes: one });
        const inner = lines[0]!.split('\t')[0]!;
        const edges = await edgesOnDisk();
        expect(edges.map((edge) => edge.id)).not.toContain(again);
        expect(edges[0]!.id).toBe(around);
        expect(edges[1]).toMatchObject({ from: 'term-1', to: inner });
        expect(lines.at(-1)).toBe(`edges\t1\t${edges[1]!.id}`);
        // The new frame stands in the old one, whose own line says nothing about what is inside it.
        const row = (await fx.invoke('node_list', {})).lines.find((line) => line.startsWith(`${inner}\t`))!;
        expect(row.split('\t').at(-3)).toBe(outer);
    });
});

describe('node arrange', () => {
    test('lays the nodes out from the corner they already occupied and prints where each one went', async () => {
        await fx.seed(box('a', 1000, 1000), box('b', 4000, 2000), box('c', 2000, 3000));
        expect((await fx.invoke('node_list', {})).lines).toContain('b\tnote\tb\t4000\t2000\t200\t100\t\t-\t-');

        const { status, lines } = await fx.invoke('node_arrange', { nodes: 'a,b,c' });
        expect(status).toBe(200);
        // Two columns for three nodes, 40 px apart, starting at the top left of the box they filled.
        expect(lines).toEqual(['a\t1000\t1000', `b\t${1000 + 200 + PLACEMENT_GAP}\t1000`, `c\t1000\t${1000 + 100 + PLACEMENT_GAP}`]);
        expect(await fx.nodeOnDisk('b')).toMatchObject({ x: 1240, y: 1000, w: 200, h: 100 });
    });

    test('layout row and column are one row and one column', async () => {
        await fx.seed(box('a', 0, 0), box('b', 500, 500));
        expect((await fx.invoke('node_arrange', { nodes: 'a,b', layout: 'row' })).lines).toEqual(['a\t0\t0', 'b\t240\t0']);
        expect((await fx.invoke('node_arrange', { nodes: 'a,b', layout: 'column' })).lines).toEqual(['a\t0\t0', 'b\t0\t140']);
    });

    test('cols is the grid and nothing else', async () => {
        await fx.seed(box('a', 0, 0), box('b', 500, 500), box('c', 900, 100));
        expect((await fx.invoke('node_arrange', { nodes: 'a,b,c', cols: '3' })).lines).toEqual(['a\t0\t0', 'b\t240\t0', 'c\t480\t0']);

        const wrongLayout = await fx.invoke('node_arrange', { nodes: 'a,b,c', layout: 'row', cols: '2' });
        expect(wrongLayout.status).toBe(422);
        expect(wrongLayout.lines[0]).toBe('refused\tflag-not-for-layout\tcols does not go with row; a row is one row and a column is one column');

        const tooMany = await fx.invoke('node_arrange', { nodes: 'a,b', cols: '5' });
        expect(tooMany.lines[0]).toBe('refused\ttoo-many-columns\tcols is 5 and you named 2 nodes; a grid holds at most one column per node');
        expect((await fx.invoke('node_arrange', { nodes: 'a', cols: 'two' })).lines[0]).toStartWith('refused\tbad-arguments\tcols needs a whole number');
        expect((await fx.invoke('node_arrange', { nodes: 'a', layout: 'circle' })).lines[0]).toStartWith('refused\tbad-arguments\tlayout takes one of');
    });

    test('keeps the sizes and never lets two of them touch', async () => {
        await fx.seed(box('wide', 0, 0, { w: 560, h: 360 }), box('tall', 100, 100, { w: 200, h: 520 }), box('small', 50, 50));
        await fx.invoke('node_arrange', { nodes: 'wide,tall,small', layout: 'row' });
        const nodes = await Promise.all(['wide', 'tall', 'small'].map((id) => fx.nodeOnDisk(id)));
        expect(nodes.map((node) => [node!.w, node!.h])).toEqual([
            [560, 360],
            [200, 520],
            [200, 100]
        ]);
        const gaps = nodes.slice(1).map((node, index) => node!.x - (nodes[index]!.x + nodes[index]!.w));
        expect(gaps).toEqual([PLACEMENT_GAP, PLACEMENT_GAP]);
    });

    test('a group carries what stands in it, so it is not something to arrange', async () => {
        await fx.seed(box('a', 0, 0), box('frame', 300, 300, { kind: 'group', w: 800, h: 800 }));
        const { status, lines } = await fx.invoke('node_arrange', { nodes: 'a,frame' });
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tnot-arrangeable\tframe is a group and carries whatever stands inside it');
        expect(await fx.nodeOnDisk('a')).toMatchObject({ x: 0, y: 0 });
    });

    test('a node it moves leaves the group it stood in and joins the one it lands in, as a drop does', async () => {
        await fx.seed(
            box('frame', 0, 0, { kind: 'group', w: 600, h: 600, memberIds: ['a'] }),
            box('far', 3000, 0, { kind: 'group', w: 1000, h: 1000, memberIds: ['b', 'c'] }),
            box('a', 50, 50),
            box('b', 3100, 100),
            box('c', 3100, 500)
        );

        await fx.invoke('node_arrange', { nodes: 'a,b', layout: 'row' });

        expect((await fx.nodeOnDisk('b'))!.x).toBeLessThan(600);
        expect((await fx.nodeOnDisk('frame'))!.memberIds).toEqual(['a', 'b']);
        expect((await fx.nodeOnDisk('far'))!.memberIds).toEqual(['c']);
    });

    test('nodes that already stand where this would put them are reported and nothing is written', async () => {
        await fx.seed(box('a', 0, 0), box('b', 240, 0));
        await fx.invoke('node_arrange', { nodes: 'a,b', layout: 'row' });
        const rev = (await fx.onDisk()).rev;
        const { lines } = await fx.invoke('node_arrange', { nodes: 'a,b', layout: 'row' });
        expect(lines).toEqual(['a\t0\t0', 'b\t240\t0']);
        expect((await fx.onDisk()).rev).toBe(rev);
    });

    test('refuses an id that is not on the canvas and takes no dry run', async () => {
        expect((await fx.invoke('node_arrange', { nodes: 'ghost' })).lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect((await fx.invoke('node_arrange', { nodes: 'note-1', dry_run: true })).lines[0]).toBe('refused\tbad-arguments\tnode_arrange takes no dry_run');
        expect((await fx.invoke('node_arrange', {})).lines[0]).toBe('refused\tbad-arguments\tnodes needs one or more node ids, separated by commas');
    });
});

describe('node edit', () => {
    test('writes the body of a note the caller made, as sent', async () => {
        const id = await madeId(fx.invoke('node_new', { kind: 'note', text: 'first' }));
        const { status, lines } = await fx.invoke('node_edit', { node_id: id, text: 'one\ntwo' });
        expect(status).toBe(200);
        expect(lines).toEqual([`edited\t${id}\t2\t7`]);
        expect((await fx.nodeOnDisk(id))?.body).toBe('one\ntwo');
    });

    test('append writes a line under what is there and leaves the rest standing', async () => {
        await fx.invoke('link_new', { to: 'note-1' });
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: 'mine', append: true })).lines).toEqual(['edited\tnote-1\t2\t6']);
        expect((await fx.nodeOnDisk('note-1'))?.body).toBe('x\nmine');
        const empty = await madeId(fx.invoke('node_new', { kind: 'note' }));
        expect((await fx.invoke('node_edit', { node_id: empty, text: 'first', append: true })).lines).toEqual([`edited\t${empty}\t1\t5`]);
        expect((await fx.nodeOnDisk(empty))?.body).toBe('first');
    });

    test('two appends at the same moment both land, neither over the other', async () => {
        await fx.invoke('link_new', { to: 'note-1' });
        const answers = await Promise.all(
            ['from the chat', 'from the shell', 'from a third'].map((text) => fx.invoke('node_edit', { node_id: 'note-1', text: text, append: true }))
        );
        // Each call counted a note one line longer than the one before it, so none of them wrote against a body that was already stale.
        expect(answers.map(({ lines }) => Number(lines[0]!.split('\t')[2])).sort()).toEqual([2, 3, 4]);
        expect((await fx.nodeOnDisk('note-1'))?.body?.split('\n').sort()).toEqual(['from a third', 'from the chat', 'from the shell', 'x']);
    });

    test('a note the caller did not make takes a line, whichever way it runs', async () => {
        const refused = await fx.invoke('node_edit', { node_id: 'note-1', text: 'mine' });
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe(
            'refused\tnot-linked\tnote-1 is a note you did not make and no line joins you to it: draw that line and you can write in it'
        );
        expect(refused.lines).toContain('note\tmain has no note you may write in; node_new note text B adds one of your own');
        expect(refused.lines).toContain('see\tlink_new to note-1\tdraws the line this needs');
        // The line a person drew from the note into this session says the same thing as one the other way.
        await fx.invoke('link_new', { from: 'note-1', to: 'term-1' });
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: 'mine' })).status).toBe(200);
        expect((await fx.nodeOnDisk('note-1'))?.body).toBe('mine');
    });

    test('a chat view writes in any note of the canvas it names, with no line to it', async () => {
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: 'from the chat' }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: 'from the chat', view: 'main' }, 'chat')).lines).toEqual(['edited\tnote-1\t1\t13']);
        expect((await fx.nodeOnDisk('note-1'))?.body).toBe('from the chat');
    });

    test('only a note, and only one that is on the canvas', async () => {
        const wrong = await fx.invoke('node_edit', { node_id: 'term-1', text: 'x' });
        expect(wrong.status).toBe(422);
        expect(wrong.lines[0]).toBe(
            'refused\tnot-a-note\tterm-1 is a terminal node and only a note holds a body to write; what a file, a browser, a terminal or a chat shows is not yours to set'
        );
        expect((await fx.invoke('node_edit', { node_id: 'ghost', text: 'x' })).lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect((await fx.onDisk()).rev).toBe(1);
    });

    test('one id beside text, and the body it already carries writes nothing', async () => {
        await fx.invoke('link_new', { to: 'note-1' });
        const rev = (await fx.onDisk()).rev;
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: 'x' })).lines).toEqual(['edited\tnote-1\t1\t1']);
        expect((await fx.onDisk()).rev).toBe(rev);
        expect((await fx.invoke('node_edit', { node_id: 'note-1' })).lines[0]).toBe('refused\tbad-arguments\tnode_edit needs text, the body to write');
        expect((await fx.invoke('node_edit', { node_id: ['note-1', 'note-2'], text: 'x' })).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await fx.invoke('node_edit', { text: 'x' })).lines[0]).toBe(
            'refused\tbad-arguments\tnode_edit needs node_id, the id of a note, or json for several'
        );
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: '', append: true })).lines[0]).toBe(
            'refused\tbad-arguments\tappend has nothing to add: text is empty; leave append off to empty the note'
        );
        // Without append an empty text is what empties a note again.
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: '' })).lines).toEqual(['edited\tnote-1\t0\t0']);
        expect((await fx.nodeOnDisk('note-1'))?.body).toBe('');
    });
});

describe('node rename', () => {
    test('names a node for good, so the session never renames over it', async () => {
        const { status, lines } = await fx.invoke('node_update', { node_id: 'term-1', title: 'Build the parser' });
        expect(status).toBe(200);
        expect(lines).toEqual(['term-1\tterminal\tBuild the parser']);
        expect(await fx.nodeOnDisk('term-1')).toMatchObject({ title: 'Build the parser', titleSource: 'user' });
    });

    test('the title it already carries writes nothing', async () => {
        await fx.invoke('node_update', { node_id: 'note-1', title: 'Plan' });
        const rev = (await fx.onDisk()).rev;
        const { lines } = await fx.invoke('node_update', { node_id: 'note-1', title: 'Plan' });
        expect(lines).toEqual(['note-1\tnote\tPlan']);
        expect((await fx.onDisk()).rev).toBe(rev);
    });

    test('one id beside title, with the same cap on a name as everywhere else', async () => {
        const missing = await fx.invoke('node_update', { node_id: 'shell', title: 'x' });
        expect(missing.status).toBe(422);
        expect(missing.lines[0]).toBe('refused\tunknown-node\tshell is not a node on main');
        expect(missing.lines.slice(1)).toContain('node\tterm-1\tterminal\tshell');
        expect((await fx.invoke('node_update', { node_id: 'term-1', title: 'x'.repeat(MAX_TITLE_LENGTH + 1) })).lines[0]).toBe(
            `refused\tbad-arguments\ttitle is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        );
        expect((await fx.invoke('node_update', { node_id: 'term-1', title: '' })).lines[0]).toBe('refused\tbad-arguments\ttitle needs a title');
        expect((await fx.invoke('node_update', { title: 'x' })).lines[0]).toBe('refused\tbad-arguments\tnode_update needs node_id, the id of a node');
        expect((await fx.invoke('node_update', { node_id: ['term-1', 'note-1'], title: 'x' })).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await fx.onDisk()).rev).toBe(1);
    });
});

describe('node color', () => {
    test("colors the caller's own node, and none takes the color off", async () => {
        expect((await fx.invoke('node_update', { node_id: 'term-1', color: 'teal' })).lines).toEqual(['colored\tterm-1\tterminal\tteal']);
        expect((await fx.nodeOnDisk('term-1'))?.accent).toBe('teal');
        expect((await fx.invoke('node_update', { node_id: 'term-1', color: 'none' })).lines).toEqual(['colored\tterm-1\tterminal\t-']);
        expect(await fx.nodeOnDisk('term-1')).not.toHaveProperty('accent');
    });

    test('a note takes its paper from the color and loses the paper it had before', async () => {
        await fx.seed(box('old', 400, 400, { color: 'green', accent: 'red' }));
        await fx.invoke('link_new', { to: 'old' });
        expect((await fx.invoke('node_update', { node_id: 'old', color: 'violet' })).lines).toEqual(['colored\told\tnote\tviolet']);
        const old = await fx.nodeOnDisk('old');
        expect(old?.accent).toBe('violet');
        expect(old).not.toHaveProperty('color');
    });

    test('a node the caller did not make takes a line, whichever way it runs, and a chat view names its canvas', async () => {
        const refused = await fx.invoke('node_update', { node_id: 'note-1', color: 'teal' });
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe(
            'refused\tnot-linked\tnote-1 is a node you did not make and no line joins you to it: draw that line and you can color it'
        );
        expect(refused.lines).toContain('node\tterm-1\tterminal\tshell');
        expect(refused.lines).toContain('see\tlink_new to note-1\tdraws the line this needs');
        expect((await fx.onDisk()).rev).toBe(1);
        await fx.invoke('link_new', { from: 'note-1', to: 'term-1' });
        expect((await fx.invoke('node_update', { node_id: 'note-1', color: 'teal' })).status).toBe(200);
        expect((await fx.invoke('node_update', { node_id: 'term-1', color: 'red' }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        expect((await fx.invoke('node_update', { node_id: 'term-1', color: 'red', view: 'main' }, 'chat')).lines).toEqual(['colored\tterm-1\tterminal\tred']);
    });

    test('only the colors of the set, one node per call, and nothing changed without a title or a color', async () => {
        const off = await fx.invoke('node_update', { node_id: 'term-1', color: 'gray' });
        expect(off.lines[0]).toBe('refused\tunknown-color\tgray is not one of the 17 colors a node takes, nor none');
        expect(off.lines).toContain(['colors', ...NODE_ACCENT_NAMES].join('\t'));
        expect((await fx.invoke('node_update', { node_id: 'term-1', color: '' })).lines[0]).toBe(
            'refused\tbad-arguments\tcolor needs one of the colors, or none'
        );
        expect((await fx.invoke('node_update', { node_id: 'term-1' })).lines[0]).toBe('refused\tnothing-to-change\tnode_update needs one of title, color');
        expect((await fx.invoke('node_update', { node_id: ['term-1', 'note-1'], color: 'red' })).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await fx.invoke('node_update', { node_id: 'ghost', color: 'red' })).lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect((await fx.invoke('node_update', { node_id: 'term-1', color: 'red', dry_run: true })).lines).toEqual([
            'refused\tbad-arguments\tnode_update takes no dry_run',
            'fields\tnode_id\tview\trevision\ttitle\tcolor'
        ]);
        expect((await fx.onDisk()).rev).toBe(1);
    });

    test('a node of a kind a newer Ruimte made is refused by name and stays as it was read', async () => {
        const hologram = { kind: 'hologram', id: 'holo', title: 'Hologram', x: 900, y: 0, w: 480, h: 360, beam: { lumens: [1, 2] } };
        const file = await fx.onDisk();
        const main = file.views[0] as ProjectCanvasView;
        await setPrivateViews(fx.folder, [{ ...main, nodes: [...main.nodes, hologram] }, ...file.views.slice(1)]);
        const chatView = await fx.invoke('node_update', { node_id: 'holo', color: 'teal', view: 'main' }, 'chat');
        expect(chatView.lines[0]).toBe('refused\tunknown-node\tholo is a node of a kind this machine does not know, so it cannot color it');
        const raw = (await rawPrivateViews(fx.folder)) as unknown as Array<{ nodes?: Array<{ id: string }> }>;
        expect(JSON.stringify(raw[0]!.nodes!.find((node) => node.id === 'holo'))).toBe(JSON.stringify(hologram));
    });

    test('the color it already has writes nothing', async () => {
        await fx.invoke('node_update', { node_id: 'term-1', color: 'amber' });
        const rev = (await fx.onDisk()).rev;
        expect((await fx.invoke('node_update', { node_id: 'term-1', color: 'amber' })).lines).toEqual(['colored\tterm-1\tterminal\tamber']);
        expect((await fx.onDisk()).rev).toBe(rev);
    });

    test('node new color gives the new node its color in the same write', async () => {
        const rev = (await fx.onDisk()).rev;
        const id = await madeId(fx.invoke('node_new', { kind: 'note', text: 'hi', color: 'teal' }));
        expect(await fx.nodeOnDisk(id)).toMatchObject({ kind: 'note', body: 'hi', accent: 'teal' });
        expect((await fx.onDisk()).rev).toBe(rev + 1);
        expect((await fx.invoke('node_new', { kind: 'note', color: 'paper' })).lines[0]).toBe(
            'refused\tunknown-color\tpaper is not one of the 17 colors a node takes'
        );
    });
});

describe('node delete', () => {
    test('deleting the last member also removes its group and the line into the frame', async () => {
        const member = await madeId(fx.invoke('node_new', { kind: 'note', title: 'Member' }));
        const group = await madeId(fx.invoke('node_group', { nodes: member, label: 'Work' }));

        const result = await fx.invoke('node_delete', { node_id: [member] });
        const canvas = await fx.canvasOnDisk();

        expect(result.status).toBe(200);
        expect(canvas.nodes.some((node) => node.id === member || node.id === group)).toBe(false);
        expect(canvas.edges.some((edge) => edge.from === group || edge.to === group)).toBe(false);
    });

    test('removes a node the caller made, with the lines that ran into it', async () => {
        const note = await madeId(fx.invoke('node_new', { kind: 'note', title: 'Scratch' }));
        await fx.invoke('link_new', { to: note });
        const { status, lines } = await fx.invoke('node_delete', { node_id: [note] });
        expect(status).toBe(200);
        expect(lines).toEqual([`deleted\t${note}\tnote\tScratch`, 'edges\t1']);
        const canvas = await fx.canvasOnDisk();
        expect(canvas.nodes.some((node) => node.id === note)).toBe(false);
        expect(canvas.edges).toEqual([]);
    });

    test('a terminal node it made stops before the canvas lets go of it', async () => {
        const made = await madeId(fx.invoke('node_new', { kind: 'terminal', title: 'runner' }));
        const { lines } = await fx.invoke('node_delete', { node_id: [made] });
        // The line node new drew from the caller goes with it.
        expect(lines).toEqual([`deleted\t${made}\tterminal\trunner`, `ended\t${made}\tterminal`, 'edges\t1']);
        expect(fx.ended).toEqual([`terminal\t${made}`]);
    });

    test('a design node ends every chat it holds, its later ones too, before the canvas lets go of it', async () => {
        await fx.withDesignNode([]);
        fx.knobs.deleteAnyView = true;
        const { lines } = await fx.invoke('node_delete', { node_id: ['design-1'] });
        expect(lines[0]).toBe('deleted\tdesign-1\tdesign\tSite');
        expect(fx.ended).toEqual(['chat\tdesign-1', 'chat\tlater-1']);
        expect(await fx.nodeOnDisk('design-1')).toBeUndefined();
    });

    test('a node the caller did not make stays, unless the machine frees every one', async () => {
        const refused = await fx.invoke('node_delete', { node_id: ['note-1'] });
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe('refused\tnot-yours\tnote-1 was made by a person and node delete only removes a node you made yourself');
        expect(refused.lines).toContain('made by\ta person');
        expect(refused.lines[3]).toStartWith("setting\tagentsDeleteAnyView in this machine's endpoint.json frees every node and view");
        expect((await fx.canvasOnDisk()).nodes.some((node) => node.id === 'note-1')).toBe(true);

        fx.knobs.deleteAnyView = true;
        expect((await fx.invoke('node_delete', { node_id: ['note-1'] })).lines[0]).toBe('deleted\tnote-1\tnote\tPlan with a tab');
    });

    test('never the caller itself, and never an id no canvas has', async () => {
        const self = await fx.invoke('node_delete', { node_id: ['term-1'] });
        expect(self.lines[0]).toBe('refused\tdeletes-caller\tYou are term-1, so removing it would end the session asking');
        const nowhere = await fx.invoke('node_delete', { node_id: ['nope'] });
        expect(nowhere.lines[0]).toBe('refused\tunknown-node\tnope is not a node on any canvas of this project');
        // Nothing it could not delete anyway: the caller's own node and a person's note are both out.
        expect(nowhere.lines.slice(1)).toEqual(['note\tYou have no node on main to remove; node delete takes a node you made yourself']);
        // A chat the sidebar holds is no node either, and the refusal says which of the two it is.
        const own = await fx.invoke('node_delete', { node_id: ['chat-1'] });
        expect(own.lines[0]).toBe(
            'refused\tnot-on-a-canvas\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project, so there is no node to remove'
        );
        expect(own.lines.at(-1)).toBe('see\tview_delete chat-1\tremoves a view you made, with the session it holds');
        const mine = await madeId(fx.invoke('node_new', { kind: 'note', title: 'Mine' }));
        expect((await fx.invoke('node_delete', { node_id: ['nope'] })).lines.slice(1)).toEqual([`node\t${mine}\tnote\tMine`]);
    });

    test('a group loses its frame and keeps its nodes where they stand', async () => {
        const first = await madeId(fx.invoke('node_new', { kind: 'note', title: 'One' }));
        const second = await madeId(fx.invoke('node_new', { kind: 'note', title: 'Two' }));
        const group = await madeId(fx.invoke('node_group', { nodes: `${first},${second}`, label: 'Work' }));
        const { lines } = await fx.invoke('node_delete', { node_id: [group] });
        // The one line node group drew in place of the two into the notes goes with the frame.
        expect(lines).toEqual([`deleted\t${group}\tgroup\tWork`, 'edges\t1', 'members\t2\tleft where they stand']);
        const nodes = (await fx.canvasOnDisk()).nodes.map((node) => node.id);
        expect(nodes).toContain(first);
        expect(nodes).toContain(second);
        expect(nodes).not.toContain(group);
    });
});

describe('node new json', () => {
    test('makes every node in one write, each with its line from the caller, in the order given', async () => {
        const { rev, changed } = await fx.watchWrites();
        const nodes = [
            { kind: 'note', title: 'First', text: 'one\ntwo', color: 'teal' },
            { kind: 'note', title: 'Second' },
            { kind: 'browser', url: 'https://example.com' }
        ];
        const { status, lines } = await fx.invoke('node_new', { json: JSON.stringify(nodes) });
        expect(status).toBe(200);
        expect(lines.map((line) => line.split('\t').slice(1, 3))).toEqual([
            ['note', 'main'],
            ['note', 'main'],
            ['browser', 'main']
        ]);
        expect((await fx.onDisk()).rev).toBe(rev + 1);
        expect(changed).toEqual([rev + 1]);
        const canvas = await fx.canvasOnDisk();
        const made = lines.map((line) => canvas.nodes.find((node) => node.id === line.split('\t')[0])!);
        expect(made.map((node) => node.title)).toEqual(['First', 'Second', 'Browser']);
        expect(made[0]).toMatchObject({ body: 'one\ntwo', accent: 'teal', titleSource: 'user' });
        // Placed one after the other, so no two land on the same spot.
        expect(new Set(made.map((node) => `${node.x},${node.y}`)).size).toBe(3);
        expect(lines.map((line) => canvas.edges.find((edge) => edge.id === line.split('\t')[3])).map((edge) => [edge?.from, edge?.to])).toEqual(
            made.map((node) => ['term-1', node.id])
        );
        expect(made.map((node) => fx.lineage.madeBy(node.id))).toEqual(['term-1', 'term-1', 'term-1']);
    });

    test('makes none when one is refused, and says which one', async () => {
        const before = await fx.onDisk();
        const nodes = [{ kind: 'note', title: 'Fine' }, { kind: 'browser' }];
        const { status, lines } = await fx.invoke('node_new', { json: JSON.stringify(nodes) });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tmissing-flag\tNode 2: A browser node needs url');
        expect((await fx.onDisk()).rev).toBe(before.rev);
        expect((await fx.canvasOnDisk()).nodes).toHaveLength((before.views[0] as ProjectCanvasView).nodes.length);
    });

    test('previews with dry_run and writes nothing', async () => {
        const rev = (await fx.onDisk()).rev;
        const { lines } = await fx.invoke('node_new', { json: '[{"kind":"note"},{"kind":"note"}]', dry_run: true });
        expect(lines).toEqual(['dry-run\tnote\tmain\tterm-1 -> (new)', 'dry-run\tnote\tmain\tterm-1 -> (new)'].map((line) => line.replace('(new)', NEW_NODE)));
        expect((await fx.onDisk()).rev).toBe(rev);
    });

    test('refuses what it cannot read, by the place of the node in the array', async () => {
        const refused = async (input: Record<string, unknown>): Promise<string> => (await fx.invoke('node_new', input)).lines[0]!;
        expect(await refused({ json: 'not json' })).toBe('refused\tbad-json\tjson is not JSON; it takes an array of nodes');
        expect(await refused({ json: '{"kind":"note"}' })).toBe('refused\tbad-json\tjson needs an array of nodes');
        expect(await refused({ json: '[]' })).toBe('refused\tbad-json\tjson needs at least one node');
        expect(await refused({ json: '[{"kind":"note"},{"kind":"group"}]' })).toBe(
            'refused\tbad-json\tNode 2: node_new needs a kind: note, browser, drawing, diagram, file, device, terminal, chat'
        );
        expect(await refused({ json: '[{"kind":"note","colour":"teal"}]' })).toStartWith('refused\tbad-json\tNode 1: ');
        expect(await refused({ kind: 'note', json: '[{"kind":"note"}]' })).toBe(
            'refused\tbad-arguments\tjson carries every node with its own fields; leave out kind'
        );
        expect(await refused({ title: 'T', json: '[{"kind":"note"}]' })).toBe(
            'refused\tbad-arguments\tjson carries every node with its own fields; leave out title'
        );
        expect(await refused({ json: JSON.stringify(Array.from({ length: 101 }, () => ({ kind: 'note' }))) })).toBe(
            'refused\tbad-json\tjson takes at most 100 nodes; split the rest over another call'
        );
    });

    test('the nodes guide says that several nodes go in one call', () => {
        const lines = nodeToolkit.guides.find((guide) => guide.name === 'nodes')!.lines;
        expect(lines.some((line) => line.startsWith('many\tTo add several nodes, give them all to one call in json'))).toBe(true);
        expect(lines.some((line) => line.startsWith('example\t[{"kind":"note"'))).toBe(true);
    });
});

describe('a # in a message', () => {
    test('lets a chat view write in the note it points at, with no view, until the note is gone', async () => {
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: 'from the chat' }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        await fx.pointAt('chat-1', ['note-1']);
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: 'from the chat' }, 'chat')).lines).toEqual(['edited\tnote-1\t1\t13']);
        expect((await fx.invoke('node_edit', { json: '[{"id":"note-1","text":"twice","append":true}]' }, 'chat')).lines).toEqual(['edited\tnote-1\t2\t19']);
        expect((await fx.nodeOnDisk('note-1'))?.body).toBe('from the chat\ntwice');
        // A person removes the note: the message still names it, and it resolves to nothing.
        await fx.store.mutate(fx.projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) => (view.kind === 'canvas' ? { ...view, nodes: view.nodes.filter((node) => node.id !== 'note-1') } : view))
            },
            result: null
        }));
        await fx.pointAt('chat-1', ['note-1']);
        expect(fx.pointed['chat-1']).toEqual([]);
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: 'again' }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
    });

    test('lets a node write in a note without a line, but a # to its canvas alone does not', async () => {
        await fx.pointAt('term-1', ['main']);
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: 'mine' })).lines[0]).toStartWith('refused\tnot-linked\t');
        await fx.pointAt('term-1', ['note-1']);
        expect((await fx.invoke('node_edit', { node_id: 'note-1', text: 'mine' })).lines).toEqual(['edited\tnote-1\t1\t4']);
    });
});
