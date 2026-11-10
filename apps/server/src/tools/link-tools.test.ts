import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EDGE_ROLES } from '@ruimte/contracts';
import { MAX_LINKS } from '../canvas/links.ts';
import { canvasFixture, type CanvasFixture, madeId } from './canvas-fixture-test-helpers.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

describe('link list', () => {
    test('lists the lines of a canvas, id, from, to and label', async () => {
        await fx.invoke('link_new', { to: 'note-1', label: 'plan' });
        await fx.invoke('link_new', { to: 'note-1', from: 'note-1' }).catch(() => null);
        const { status, lines } = await fx.invoke('link_list', {});
        expect(status).toBe(200);
        const edges = (await fx.canvasOnDisk()).edges;
        expect(lines).toEqual([...edges.map((edge) => [edge.id, edge.from, edge.to, edge.label ?? ''].join('\t')), 'revision\t2']);
        expect(lines[0]!.split('\t').slice(1)).toEqual(['term-1', 'note-1', 'plan']);
    });

    test('a canvas with no lines on it prints only the revision, and view says which canvas', async () => {
        expect((await fx.invoke('link_list', {})).lines).toEqual(['revision\t1']);
        expect((await fx.invoke('link_list', { view: 'board' })).lines).toEqual(['revision\t1']);
        expect((await fx.invoke('link_list', { view: 'sketch-1' })).lines[0]).toBe('refused\tnot-a-canvas\tsketch-1 is not a canvas of this project');
        expect((await fx.invoke('link_list', { view: 'main' }, 'chat')).lines).toEqual(['revision\t1']);
        expect((await fx.invoke('link_list', {}, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
    });

    test('reads only, so it takes no dry_run', async () => {
        expect((await fx.invoke('link_list', { dry_run: true })).lines[0]).toBe('refused\tbad-arguments\tlink_list takes no dry_run');
    });
});

describe('link new', () => {
    test('draws no line to or from a node that runs on another machine, and writes nothing', async () => {
        fx.elsewhere.add('note-1');
        const rev = await fx.store.revision(fx.projectId);
        const { status, lines } = await fx.invoke('link_new', { to: 'note-1' });
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tnode-on-other-machine\t');
        expect(await fx.store.revision(fx.projectId)).toBe(rev);
    });

    test('draws a line from the caller into a node and prints what it made', async () => {
        const { status, lines } = await fx.invoke('link_new', { to: 'note-1' });
        expect(status).toBe(200);
        const [id, from, to, state, way] = lines[0]!.split('\t');
        expect([from, to, state, way]).toEqual(['term-1', 'note-1', 'new', 'out']);
        expect((await fx.canvasOnDisk()).edges).toEqual([{ id: id!, from: 'term-1', to: 'note-1' }]);
    });

    test('between two agents it draws both ways and labels them context', async () => {
        await fx.seed({ id: 'term-2', kind: 'terminal', title: 'other', x: 2000, y: 0, w: 560, h: 360 });

        const { lines } = await fx.invoke('link_new', { to: 'term-2' });
        // The last column is what tells one to answering in two rows from a mistake.
        expect(lines.map((line) => line.split('\t').slice(1))).toEqual([
            ['term-1', 'term-2', 'new', 'out'],
            ['term-2', 'term-1', 'new', 'back']
        ]);
        expect((await fx.canvasOnDisk()).edges.map((edge) => [edge.from, edge.to, edge.label])).toEqual([
            ['term-1', 'term-2', 'context'],
            ['term-2', 'term-1', 'context']
        ]);
    });

    test('running the same link again changes nothing and says so', async () => {
        await fx.invoke('link_new', { to: 'note-1' });
        const rev = (await fx.onDisk()).rev;
        const { lines } = await fx.invoke('link_new', { to: 'note-1' });
        expect(lines[0]!.split('\t')[3]).toBe('existing');
        expect((await fx.onDisk()).rev).toBe(rev);
    });

    test('refuses ids that are not on the canvas and a line to itself', async () => {
        const missing = await fx.invoke('link_new', { to: 'note-1,ghost,other' });
        expect(missing.lines[0]).toBe('refused\tunknown-node\tghost, other are not a node on main');
        // Never the node the line starts from: to itself is refused as a self-link.
        expect(missing.lines.slice(1)).toEqual(['node\tnote-1\tnote\tPlan with a tab']);
        expect((await fx.invoke('link_new', { to: 'term-1' })).lines[0]).toStartWith('refused\tself-link\t');
        expect((await fx.invoke('link_new', { to: 'note-1', view: 'main' }, 'chat')).lines[0]).toStartWith(
            'refused\tunknown-node\tYou are not a node on main, so a line has nowhere to start'
        );
        expect((await fx.onDisk()).rev).toBe(1);
    });

    test('a chat that is a view of its own is named as one, so nothing goes looking for it on another canvas', async () => {
        const own = await fx.invoke('link_new', { to: 'chat-1' });
        expect(own.status).toBe(422);
        expect(own.lines[0]).toBe(
            'refused\tnot-on-a-canvas\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project, so no line can be drawn into it'
        );
        // The same misunderstanding at the other end of the line.
        expect((await fx.invoke('link_new', { to: 'note-1', from: 'chat-1' })).lines[0]).toBe(
            'refused\tnot-on-a-canvas\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project, so a line has nowhere to start there'
        );
        // Beside an id that names nothing, the sentence about the set stays and the view is named under it.
        const both = await fx.invoke('link_new', { to: 'chat-1,ghost' });
        expect(both.lines[0]).toBe('refused\tunknown-node\tchat-1, ghost are not a node on main');
        expect(both.lines[1]).toBe('note\tchat-1 is a chat that is a view of its own, not a node on any canvas of this project');
        // A node on another canvas of this project is neither case and keeps the sentence it had.
        const elsewhere = await madeId(fx.invoke('node_new', { kind: 'note', view: 'board' }));
        expect((await fx.invoke('link_new', { to: elsewhere })).lines[0]).toBe(`refused\tunknown-node\t${elsewhere} is not a node on main`);
    });

    test('from, label and view say where the line goes and what it is called', async () => {
        const { lines } = await fx.invoke('link_new', { to: 'term-1', from: 'note-1', label: 'plan' });
        expect(lines[0]!.split('\t').slice(1)).toEqual(['note-1', 'term-1', 'new', 'out']);
        expect((await fx.canvasOnDisk()).edges[0]!.label).toBe('plan');
    });

    test('refuses more than the cap and an empty id', async () => {
        const many = Array.from({ length: MAX_LINKS + 1 }, (_, i) => `n-${i}`).join(',');
        expect((await fx.invoke('link_new', { to: many })).lines[0]).toStartWith('refused\ttoo-many-links\t');
        expect((await fx.invoke('link_new', { to: 'note-1,' })).lines[0]).toStartWith('refused\tbad-arguments\t');
    });

    test('role says what the line is for and puts the word on the edge', async () => {
        await fx.invoke('link_new', { to: 'note-1', role: 'target' });
        expect((await fx.canvasOnDisk()).edges.map((edge) => [edge.from, edge.to, edge.role])).toEqual([['term-1', 'note-1', 'target']]);
    });

    test('a target or an origin is one line, and is never named context by itself', async () => {
        await fx.seed({ id: 'term-2', kind: 'terminal', title: 'other', x: 2000, y: 0, w: 560, h: 360 });

        const { lines } = await fx.invoke('link_new', { to: 'term-2', role: 'origin' });
        expect(lines.map((line) => line.split('\t').slice(1))).toEqual([['term-1', 'term-2', 'new', 'out']]);
        expect((await fx.canvasOnDisk()).edges.map((edge) => [edge.label, edge.role])).toEqual([[undefined, 'origin']]);
    });

    test('refuses a role it does not have and says which ones it does', async () => {
        const { status, lines } = await fx.invoke('link_new', { to: 'note-1', role: 'beams' });
        expect(status).toBe(422);
        expect(lines[0]).toBe(`refused\tunknown-role\tbeams is not one of the ${EDGE_ROLES.length} things a line can be for`);
        expect(lines[1]).toBe(['roles', ...EDGE_ROLES].join('\t'));
        expect((await fx.onDisk()).rev).toBe(1);
    });

    test('a role that is not the one on the line is written onto it and says updated', async () => {
        const drawn = await fx.invoke('link_new', { to: 'note-1' });
        const edgeId = drawn.lines[0]!.split('\t')[0]!;
        expect(drawn.lines[0]!.split('\t')[3]).toBe('new');

        const set = await fx.invoke('link_new', { to: 'note-1', role: 'target' });
        expect(set.lines[0]!.split('\t')).toEqual([edgeId, 'term-1', 'note-1', 'updated', 'out']);
        expect((await fx.canvasOnDisk()).edges).toEqual([{ id: edgeId, from: 'term-1', to: 'note-1', role: 'target' }]);
    });

    test('the same role again, or none at all, leaves the line alone and says existing', async () => {
        await fx.invoke('link_new', { to: 'note-1', role: 'target' });
        const rev = (await fx.onDisk()).rev;

        expect((await fx.invoke('link_new', { to: 'note-1', role: 'target' })).lines[0]!.split('\t')[3]).toBe('existing');
        // Nothing changed, so nothing was written and the rev a second call reads is the one it leaves.
        expect((await fx.onDisk()).rev).toBe(rev);
        expect((await fx.invoke('link_new', { to: 'note-1' })).lines[0]!.split('\t')[3]).toBe('existing');
        expect((await fx.canvasOnDisk()).edges[0]!.role).toBe('target');
        expect((await fx.onDisk()).rev).toBe(rev);
    });
});

describe('link delete', () => {
    const newNode = async (kind: string, token = 'term', input: Record<string, string> = {}): Promise<string> =>
        await madeId(fx.invoke('node_new', { kind, ...input }, token));

    const edgeIds = async (id = 'main'): Promise<string[]> => (await fx.canvasOnDisk(id)).edges.map((edge) => edge.id);

    test('removes a line between nodes the caller made, and prints the line that went', async () => {
        const note = await newNode('note');
        const other = await newNode('note');
        const edge = await madeId(fx.invoke('link_new', { from: note, to: other, label: 'plan' }));
        const { status, lines } = await fx.invoke('link_delete', { edge_id: [edge] });
        expect(status).toBe(200);
        expect(lines).toEqual([`deleted\t${edge}\t${note}\t${other}\tplan`]);
        // What node new drew from the caller into each of them stays; only the line this named went.
        expect(await edgeIds()).toHaveLength(2);
        expect((await fx.canvasOnDisk()).nodes.map((node) => node.id)).toContain(note);
    });

    test('between two agents it removes the one direction it is given and leaves the other', async () => {
        const shell = await newNode('terminal');
        const [out, back] = (await fx.invoke('link_new', { to: shell })).lines.map((line) => line.split('\t')[0]!);
        expect((await fx.invoke('link_delete', { edge_id: [out!] })).lines).toEqual([`deleted\t${out}\tterm-1\t${shell}\tcontext`]);
        expect(await edgeIds()).toEqual([back!]);
    });

    // Split by the end a line touches, so no single test makes enough calls to run into a slow runner's limit.
    test('a line into a node a person made stays, and the refusal names the setting that frees it', async () => {
        const into = await madeId(fx.invoke('link_new', { to: 'note-1' }));
        const refused = await fx.invoke('link_delete', { edge_id: [into] });
        expect(refused.status).toBe(422);
        expect(refused.lines).toEqual([
            `refused\tnot-yours\t${into} runs into note-1, which a person made, and link delete only removes a line whose ends are both yours`,
            'made by\tnote-1\ta person',
            'you\tterm-1',
            "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every node, view and line; a person turns it on from the Machines pane"
        ]);
        expect(await edgeIds()).toEqual([into]);
    });

    test('the context a person gave the caller stays, even though the caller is one of its ends', async () => {
        const given = await madeId(fx.invoke('link_new', { from: 'note-1', to: 'term-1' }));
        expect((await fx.invoke('link_delete', { edge_id: [given] })).lines[0]).toStartWith(
            `refused\tnot-yours\t${given} runs from note-1, which a person made,`
        );
        expect(await edgeIds()).toEqual([given]);
    });

    test('a line into a node another agent made stays', async () => {
        const theirs = await newNode('note', 'chat', { view: 'main' });
        const toTheirs = await madeId(fx.invoke('link_new', { to: theirs }));
        expect((await fx.invoke('link_delete', { edge_id: [toTheirs] })).lines[0]).toStartWith(
            `refused\tnot-yours\t${toTheirs} runs into ${theirs}, which chat-1 made,`
        );
        expect(await edgeIds()).toContain(toTheirs);
    });

    test('a machine that frees every line lets a line into a node a person made go, and only that one', async () => {
        const into = await madeId(fx.invoke('link_new', { to: 'note-1' }));
        const given = await madeId(fx.invoke('link_new', { from: 'note-1', to: 'term-1' }));
        fx.knobs.deleteAnyView = true;
        expect((await fx.invoke('link_delete', { edge_id: [into] })).lines).toEqual([`deleted\t${into}\tterm-1\tnote-1\t`]);
        expect(await edgeIds()).toEqual([given]);
    });

    test('an id that is no line is refused with only the lines this call would remove', async () => {
        const empty = await fx.invoke('link_delete', { edge_id: ['nope'] });
        expect(empty.lines).toEqual(['refused\tunknown-edge\tnope is not a line on main', 'note\tmain has no lines on it']);

        await fx.invoke('link_new', { to: 'note-1' });
        expect((await fx.invoke('link_delete', { edge_id: ['nope'] })).lines.slice(1)).toEqual([
            'note\tYou have no line on main to remove; link delete takes a line whose ends are both yours'
        ]);

        const note = await newNode('note');
        const mine = await madeId(fx.invoke('link_new', { to: note }));
        expect((await fx.invoke('link_delete', { edge_id: ['nope'] })).lines.slice(1)).toEqual([`edge\t${mine}\tterm-1\t${note}\t`]);
        expect((await fx.invoke('link_delete', { edge_id: [note] })).lines[0]).toBe(`refused\tunknown-edge\t${note} is not a line on main`);
    });

    test('finds the canvas the way link new does, and takes its ids as an array and nothing that would make it a dry run', async () => {
        const note = await newNode('note', 'term', { view: 'board' });
        const other = await newNode('note', 'term', { view: 'board' });
        const line = await madeId(fx.invoke('link_new', { from: note, to: other, view: 'board' }));
        expect((await fx.invoke('link_delete', { edge_id: [line] })).lines[0]).toBe(`refused\tunknown-edge\t${line} is not a line on main`);
        expect((await fx.invoke('link_delete', { edge_id: [line] }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        expect((await fx.invoke('link_delete', { edge_id: [line], view: 'sketch-1' })).lines[0]).toBe(
            'refused\tnot-a-canvas\tsketch-1 is not a canvas of this project'
        );
        expect((await fx.invoke('link_delete', { edge_id: [line], view: 'board' })).lines).toEqual([`deleted\t${line}\t${note}\t${other}\t`]);
        expect(await edgeIds('board')).toEqual([]);

        expect((await fx.invoke('link_delete', {})).lines[0]).toBe('refused\tbad-arguments\tedge_id needs the ids of the lines to remove');
        expect((await fx.invoke('link_delete', { edge_id: 'a,b' })).lines[0]).toBe('refused\tbad-arguments\tedge_id needs the ids of the lines to remove');
        expect((await fx.invoke('link_delete', { edge_id: ['a'], dry_run: true })).lines[0]).toBe('refused\tbad-arguments\tlink_delete takes no dry_run');
        expect((await fx.invoke('link_delete', { edge_id: ['a'] }, 'stray')).lines[0]).toStartWith('refused\tnot-in-project\t');
    });
});
