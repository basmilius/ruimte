import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { withViewAsNode, type ProjectCanvasView } from '@ruimte/contracts';
import {
    canvasFixture,
    root,
    worktree,
    store,
    projectId,
    ended,
    madeWorktrees,
    snoozed,
    content,
    host,
    invoke,
    onDisk,
    canvasOnDisk,
    nodeOnDisk,
    madeId,
    replaceContent,
    revisionOf,
    watchWrites,
    CANVAS_LINES
} from './canvas-test-fixture.ts';
import { NEW_NODE, type CanvasHost } from './host.ts';
import { projectReach } from './reach.ts';

canvasFixture();

describe('refusals', () => {
    test('say what is missing and, for a closed set, what may go there', async () => {
        const kinds = 'node_new needs a kind: note, browser, drawing, diagram, file, device, terminal, chat, artifact, routine';
        const cases: Array<{ tool: string; input: Record<string, unknown>; code: string; message: string }> = [
            { tool: 'node_new', input: {}, code: 'bad-arguments', message: kinds },
            { tool: 'node_new', input: { kind: 'group' }, code: 'bad-arguments', message: kinds },
            { tool: 'node_new', input: { kind: 'note', title: '' }, code: 'bad-arguments', message: 'title needs a title' },
            { tool: 'node_new', input: { kind: 'note', view: '' }, code: 'bad-arguments', message: 'view needs the id of a canvas' },
            { tool: 'node_new', input: { kind: 'note', beside: '' }, code: 'bad-arguments', message: 'beside needs the id of a node on that canvas' },
            { tool: 'node_list', input: { main: true }, code: 'bad-arguments', message: 'node_list takes no main' },
            { tool: 'view_list', input: { all: true }, code: 'bad-arguments', message: 'view_list takes no all' },
            { tool: 'node_new', input: { kind: 'note', cmd: 'ls' }, code: 'bad-arguments', message: 'node_new takes no cmd' }
        ];
        for (const { tool, input, code, message } of cases) {
            const { status, lines } = await invoke(tool, input);
            expect({ input, status, line: lines[0] }).toEqual({ input, status: 422, line: `refused\t${code}\t${message}` });
        }
        const ignored = await invoke('project_ignored', { view: 'main' });
        expect(ignored.lines[0]).toBe('refused\tbad-arguments\tproject_ignored takes no view');
    });

    test('name what can be picked instead wherever the set is closed', async () => {
        const missing = await invoke('node_new', { kind: 'browser' });
        expect(missing.lines).toEqual([
            'refused\tmissing-flag\tA browser node needs url',
            'kind\tbrowser\turl (required)\tcalled "Browser" without title',
            'kind\tevery kind\ttitle, view, beside'
        ]);
        expect((await invoke('node_new', { kind: 'note', url: 'https://example.com' })).lines.slice(1)).toEqual([
            'kind\tnote\ttext\tcalled "Note" without title',
            'kind\tevery kind\ttitle, view, beside'
        ]);
        expect((await invoke('node_new', { kind: 'note', beside: 'nope' })).lines).toEqual([
            'refused\tunknown-node\tnope is not a node on main',
            'node\tterm-1\tterminal\tshell',
            'node\tnote-1\tnote\tPlan with a tab'
        ]);
    });

    test('a canvas too full to list points at the tool that lists it', async () => {
        const full = content();
        const board = full.views[2] as ProjectCanvasView;
        board.nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n-${i}`, kind: 'note' as const, title: 'n', x: i * 400, y: 0, w: 320, h: 240 }));
        await replaceContent(full);
        expect((await invoke('node_new', { kind: 'note', view: 'board', beside: 'nope' })).lines).toEqual([
            'refused\tunknown-node\tnope is not a node on board',
            'detail\tnode_list\tthe 30 nodes of board'
        ]);
    });

    test('say what is allowed where no set can be listed', async () => {
        const cases: Array<{ input: Record<string, unknown>; code: string; says: string }> = [
            { input: { kind: 'browser', url: 'not a url' }, code: 'bad-url', says: 'http or https address' },
            { input: { kind: 'browser', url: 'file:///etc/passwd' }, code: 'bad-url', says: 'browser node opens nothing else' },
            { input: { kind: 'file', path: 'src/missing.ts' }, code: 'bad-path', says: 'resolved against the project folder' },
            { input: { kind: 'terminal', cwd: 'nope' }, code: 'bad-cwd', says: 'resolved against the project folder' }
        ];
        for (const { input, code, says } of cases) {
            const { lines } = await invoke('node_new', input);
            expect(lines[0]).toStartWith(`refused\t${code}\t`);
            expect(lines[0]).toInclude(says);
            // Nothing is invented: a path or an address has no list to pick from.
            expect(lines).toHaveLength(1);
        }
    });

    test('never leak a message out of zod', async () => {
        const inputPerTool: Record<string, Array<Record<string, unknown>>> = {
            node_list: [{ x: 1 }, { view: '' }],
            view_list: [{ x: 1 }],
            node_new: [{}, { kind: 'x' }, { kind: 'note', title: 3 }, { kind: 'note', path: '' }]
        };
        const messages: string[] = [];
        for (const [tool, cases] of Object.entries(inputPerTool)) {
            for (const input of cases) {
                messages.push((await invoke(tool, input)).lines[0]!.split('\t')[2]!);
            }
        }
        for (const message of messages) {
            expect(message).not.toStartWith('Too ');
            expect(message).not.toStartWith('Invalid ');
            expect(message).not.toInclude('expected');
        }
    });
});

describe('a closed set that is empty', () => {
    test('says so instead of listing nothing', async () => {
        const noGroups = await invoke('agent_start', { cli: 'claude', group: 'note-1' });
        expect(noGroups.lines[0]).toBe('refused\tunknown-group\tnote-1 is not a group on main');
        expect(noGroups.lines.slice(1)).toEqual(['note\tmain has no groups on it yet; team opens one of its own, and a person groups nodes on the canvas']);

        const noNodes = await invoke('node_new', { kind: 'note', text: 'x', view: 'board', beside: 'ghost' });
        expect(noNodes.lines).toEqual(['refused\tunknown-node\tghost is not a node on board', 'note\tboard has no nodes on it yet']);

        const empty = content();
        empty.views = [{ kind: 'chat', id: 'chat-1', name: 'Planner', node: {} }];
        await replaceContent(empty);
        const noCanvas = await invoke('node_new', { kind: 'note', text: 'x' }, 'chat');
        expect(noCanvas.lines).toEqual([
            'refused\tview-required\tA node opens on a canvas; name which one with view (view_list lists them). A line only joins two nodes of one canvas, so the edge column shows -',
            'note\tThis project has no canvas; a node only ever lands on one'
        ]);
    });

    test('a source with no drawing view in the project says that too', async () => {
        const noDrawings = content();
        noDrawings.views = noDrawings.views.filter((view) => view.kind !== 'drawing');
        await replaceContent(noDrawings);
        const { lines } = await invoke('node_new', { kind: 'drawing', source: 'nowhere' });
        expect(lines).toEqual([
            'refused\tnot-a-drawing\tnowhere is not a drawing view of this project',
            'note\tThis project has no drawing views; a person makes one in the sidebar'
        ]);
    });
});

describe('scoping', () => {
    test('a caller no project places is refused', async () => {
        expect((await invoke('view_list', {}, 'stray')).lines).toEqual([
            'refused\tnot-in-project\tThis session is not a node or a view of any project on this machine'
        ]);
    });

    test('a node on a canvas works on that canvas by default', async () => {
        const { status, lines } = await invoke('node_list', {});
        expect(status).toBe(200);
        expect(lines).toEqual([
            'term-1\tterminal\tshell\t0\t0\t560\t360\t\t-\t-',
            'note-1\tnote\tPlan with a tab\t0\t601\t320\t240\t\t-\t-',
            'self\tterm-1',
            'revision\t1'
        ]);
    });

    test('a node a person snoozed says until when, in UTC', async () => {
        snoozed['term-1'] = Date.UTC(2026, 9, 13, 15, 30);
        const { lines } = await invoke('node_list', {});
        expect(lines[0]).toBe('term-1\tterminal\tshell\t0\t0\t560\t360\t\t-\t2026-10-13T15:30:00.000Z');
        expect(lines[1]).toEndWith('\t-\t-');
    });

    test('view picks another canvas, where the caller is nobody', async () => {
        expect(await invoke('node_list', { view: 'board' })).toEqual({ status: 200, lines: ['self\t-\tnone of these nodes is you', 'revision\t1'] });
    });

    test('a chat that is a view of its own needs view, and hears which canvases there are', async () => {
        const { status, lines } = await invoke('node_list', {}, 'chat');
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tview-required\t');
        expect(lines.slice(1)).toEqual(CANVAS_LINES);
        expect((await invoke('node_new', { kind: 'note' }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        expect((await invoke('node_new', { kind: 'note', view: 'board' }, 'chat')).status).toBe(200);
    });

    test('a view that is not a canvas is refused with the canvases listed', async () => {
        for (const view of ['chat-1', 'sketch-1', 'missing']) {
            const { status, lines } = await invoke('node_list', { view: view });
            expect(status).toBe(422);
            expect(lines[0]).toStartWith('refused\tnot-a-canvas\t');
            expect(lines.slice(1)).toEqual(CANVAS_LINES);
        }
    });
});

describe('revision', () => {
    test('a write decided on the revision a list printed goes through, and one decided before a change refuses and writes nothing', async () => {
        const decided = revisionOf((await invoke('node_list', {})).lines);
        const first = await invoke('node_new', { kind: 'note', text: 'one', revision: decided });
        expect(first.status).toBe(200);
        const stale = await invoke('node_new', { kind: 'note', text: 'two', revision: decided });
        expect(stale.lines[0]).toBe(
            `refused\trev-conflict\tThe project is at revision ${decided + 1}, and this call was decided on ${decided}; read it again and decide anew.`
        );
        expect((await canvasOnDisk()).nodes.filter((node) => node.kind === 'note')).toHaveLength(2);
        expect((await onDisk()).rev).toBe(decided + 1);
    });

    test('a dry run checks it too, and a start refuses before it makes anything', async () => {
        const decided = revisionOf((await invoke('view_list', {})).lines);
        await invoke('node_new', { kind: 'note' });
        expect((await invoke('node_new', { kind: 'note', dry_run: true, revision: decided })).lines[0]).toStartWith('refused\trev-conflict\t');
        expect((await invoke('agent_start', { cli: 'claude', worktree: true, revision: decided })).lines[0]).toStartWith('refused\trev-conflict\t');
        expect(madeWorktrees).toEqual([]);
    });

    test('takes only a whole number, and only on a tool that writes the project file', async () => {
        expect((await invoke('node_update', { node_id: 'note-1', title: 'Plan', revision: Number('latest') })).lines[0]).toStartWith(
            'refused\tbad-arguments\trevision is'
        );
        expect((await invoke('node_update', { node_id: 'note-1', title: 'Plan', revision: 1.5 })).lines[0]).toBe(
            'refused\tbad-arguments\trevision is a whole number'
        );
        expect((await invoke('node_list', { revision: 1 })).lines[0]).toBe('refused\tbad-arguments\tnode_list takes no revision');
        expect((await invoke('plan_read', { revision: 1 })).lines[0]).toBe('refused\tbad-arguments\tplan_read takes no revision');
    });
});

describe('worktree', () => {
    test('worktree list names a design node whose later chat works in the worktree', async () => {
        const lexer = join(worktree, 'lexer');
        const current = await store.read(projectId);
        await replaceContent({
            ...current,
            views: current.views.map((view) =>
                view.id === 'main' && view.kind === 'canvas'
                    ? {
                          ...view,
                          nodes: [
                              ...view.nodes,
                              {
                                  id: 'design-1',
                                  kind: 'design',
                                  title: 'Site',
                                  path: 'site',
                                  x: 0,
                                  y: 900,
                                  w: 480,
                                  h: 640,
                                  chats: [{ id: 'later-1', name: 'Header', node: { cwd: lexer } }]
                              }
                          ]
                      }
                    : view
            )
        });
        const listing: CanvasHost = {
            ...host(),
            worktrees: {
                list: async () => [{ path: lexer, branch: 'lexer' }],
                diff: () => Promise.reject(new Error('no diffs here')),
                merge: () => Promise.reject(new Error('no merges here'))
            }
        };
        const { lines } = await invoke('worktree_list', {}, 'term', listing);
        expect(lines).toEqual([`lexer\t${lexer}\tdesign-1\t-\t0\t0\t0`]);
    });
});

describe('dry_run', () => {
    test('node says which kind it would have made', async () => {
        expect((await invoke('node_new', { kind: 'note', text: 'x', dry_run: true })).lines).toEqual([`dry-run\tnote\tmain\tterm-1 -> ${NEW_NODE}`]);
        // A caller that is a node on no canvas names one, and the edge column says no line would be drawn.
        expect((await invoke('node_new', { kind: 'note', view: 'board', dry_run: true }, 'chat')).lines).toEqual(['dry-run\tnote\tboard\t-']);
        expect((await onDisk()).rev).toBe(1);
    });

    test('a tool that makes nothing refuses dry_run as a field it does not take', async () => {
        const { status, lines } = await invoke('task_list', { dry_run: true });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tbad-arguments\ttask_list takes no dry_run');
        expect((await invoke('link_new', { to: 'note-1', dry_run: true })).lines[0]).toBe('refused\tbad-arguments\tlink_new takes no dry_run');
    });

    test('a tool that takes dry_run refuses an unknown field beside it, not as a dry run it would do', async () => {
        const { status, lines } = await invoke('agent_start', { cli: 'claude', bogus: 'y', dry_run: true });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tbad-arguments\tagent_start takes no bogus');
        expect((await invoke('node_new', { kind: 'note', bogus: 'y', dry_run: true })).lines[0]).toBe('refused\tbad-arguments\tnode_new takes no bogus');
        expect((await onDisk()).rev).toBe(1);
    });
});

describe('several at once', () => {
    async function newNotes(count: number, input: Record<string, string> = {}): Promise<string[]> {
        const nodes = Array.from({ length: count }, (_, i) => ({ kind: 'note', title: `Note ${i + 1}` }));
        return (await invoke('node_new', { json: JSON.stringify(nodes), ...input })).lines.map((line) => line.split('\t')[0]!);
    }

    const tooMany = (prefix: string): string[] => Array.from({ length: 101 }, (_, i) => `${prefix}-${i}`);

    test('node delete removes every node it names in one write, with their sessions and lines, in the order given', async () => {
        const [first, second] = await newNotes(2);
        const shell = await madeId(invoke('node_new', { kind: 'terminal', title: 'runner' }));
        const { rev, changed } = await watchWrites();
        const { status, lines } = await invoke('node_delete', { node_id: [shell, first, second, first] });
        expect(status).toBe(200);
        expect(lines).toEqual([
            `deleted\t${shell}\tterminal\trunner`,
            `ended\t${shell}\tterminal`,
            'edges\t1',
            `deleted\t${first}\tnote\tNote 1`,
            'edges\t1',
            `deleted\t${second}\tnote\tNote 2`,
            'edges\t1'
        ]);
        expect((await onDisk()).rev).toBe(rev + 1);
        expect(changed).toEqual([rev + 1]);
        expect(ended).toEqual([`terminal\t${shell}`]);
        const canvas = await canvasOnDisk();
        expect(canvas.nodes.map((node) => node.id)).toEqual(['term-1', 'note-1']);
        expect(canvas.edges).toEqual([]);
    });

    test('node delete removes none when one of them may not go, and names that one', async () => {
        const [mine] = await newNotes(1);
        const rev = (await onDisk()).rev;
        const refused = await invoke('node_delete', { node_id: [mine, 'note-1'] });
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe('refused\tnot-yours\tnote-1 was made by a person and node delete only removes a node you made yourself');
        expect((await invoke('node_delete', { node_id: [mine, 'term-1'] })).lines[0]).toBe(
            'refused\tdeletes-caller\tYou are term-1, so removing it would end the session asking'
        );
        expect((await invoke('node_delete', { node_id: [mine, 'nope'] })).lines[0]).toBe(
            'refused\tunknown-node\tnope is not a node on any canvas of this project'
        );
        expect((await onDisk()).rev).toBe(rev);
        expect((await canvasOnDisk()).nodes.map((node) => node.id)).toContain(mine);
        expect(ended).toEqual([]);
    });

    test('node delete takes the nodes of one canvas, at most a hundred, as an array', async () => {
        const [onMain] = await newNotes(1);
        const [onBoard] = await newNotes(1, { view: 'board' });
        expect((await invoke('node_delete', { node_id: [onMain, onBoard] })).lines[0]).toBe(
            `refused\tbad-arguments\tnode_delete takes the nodes of one canvas per call, and ${onMain} is on main while ${onBoard} is on board`
        );
        expect((await invoke('node_delete', { node_id: tooMany('note') })).lines[0]).toBe(
            'refused\tbad-arguments\tnode_id takes at most 100 ids at once; split the rest over another call'
        );
        expect((await invoke('node_delete', { node_id: [onMain, ''] })).lines[0]).toBe('refused\tbad-arguments\tnode_id has an empty id in it');
        expect((await invoke('node_delete', { node_id: `${onMain},${onBoard}` })).lines[0]).toBe(
            'refused\tbad-arguments\tnode_id needs the ids of the nodes to remove'
        );
        expect((await canvasOnDisk()).nodes.map((node) => node.id)).toContain(onMain);
    });

    test('link delete removes every line it names in one write, and none when one of them is not the caller’s', async () => {
        const notes = await newNotes(3);
        const mine = (await canvasOnDisk()).edges.map((edge) => edge.id);
        const into = await madeId(invoke('link_new', { to: 'note-1' }));
        const refused = await invoke('link_delete', { edge_id: [mine[0], into] });
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe(
            `refused\tnot-yours\t${into} runs into note-1, which a person made, and link delete only removes a line whose ends are both yours`
        );
        expect((await invoke('link_delete', { edge_id: [mine[0], 'nope'] })).lines[0]).toBe('refused\tunknown-edge\tnope is not a line on main');
        expect((await canvasOnDisk()).edges).toHaveLength(4);

        const { rev, changed } = await watchWrites();
        const { status, lines } = await invoke('link_delete', { edge_id: mine });
        expect(status).toBe(200);
        expect(lines).toEqual(mine.map((edge, i) => `deleted\t${edge}\tterm-1\t${notes[i]}\t`));
        expect((await onDisk()).rev).toBe(rev + 1);
        expect(changed).toEqual([rev + 1]);
        expect((await canvasOnDisk()).edges.map((edge) => edge.id)).toEqual([into]);
        expect((await invoke('link_delete', { edge_id: tooMany('edge') })).lines[0]).toBe(
            'refused\tbad-arguments\tedge_id takes at most 100 ids at once; split the rest over another call'
        );
    });

    test('node edit json writes every note in one write, in the order given, with the text as sent', async () => {
        const [first, second] = await newNotes(2);
        await invoke('link_new', { to: 'note-1' });
        const { rev, changed } = await watchWrites();
        const edits = [
            { id: first, text: 'one\ntwo' },
            { id: 'note-1', text: 'mine', append: true },
            { id: second, text: 'a "quote" \\n stays' }
        ];
        const { status, lines } = await invoke('node_edit', { json: JSON.stringify(edits) });
        expect(status).toBe(200);
        expect(lines).toEqual([`edited\t${first}\t2\t7`, 'edited\tnote-1\t2\t6', `edited\t${second}\t1\t18`]);
        expect((await onDisk()).rev).toBe(rev + 1);
        expect(changed).toEqual([rev + 1]);
        expect((await nodeOnDisk('note-1'))?.body).toBe('x\nmine');
        expect((await nodeOnDisk(second!))?.body).toBe('a "quote" \\n stays');
    });

    test('node edit json writes none when one note is refused, and names it', async () => {
        const [mine] = await newNotes(1);
        const rev = (await onDisk()).rev;
        const edit = (nodes: unknown[]) => invoke('node_edit', { json: JSON.stringify(nodes) });
        expect(
            (
                await edit([
                    { id: mine, text: 'x' },
                    { id: 'note-1', text: 'y' }
                ])
            ).lines[0]
        ).toBe('refused\tnot-linked\tnote-1 is a note you did not make and no line joins you to it: draw that line and you can write in it');
        expect(
            (
                await edit([
                    { id: mine, text: 'x' },
                    { id: 'term-1', text: 'y' }
                ])
            ).lines[0]
        ).toStartWith('refused\tnot-a-note\tterm-1 is a terminal node');
        expect(
            (
                await edit([
                    { id: mine, text: 'x' },
                    { id: 'ghost', text: 'y' }
                ])
            ).lines[0]
        ).toBe('refused\tunknown-node\tghost is not a node on main');
        expect((await edit([{ id: mine, text: '', append: true }])).lines[0]).toBe(
            `refused\tbad-arguments\t${mine} has append and nothing to add, since its text is empty; leave append off to empty the note`
        );
        expect((await onDisk()).rev).toBe(rev);
        expect((await nodeOnDisk(mine!))?.body).toBeUndefined();

        expect((await edit(Array.from({ length: 101 }, () => ({ id: mine, text: 'x' })))).lines[0]).toBe(
            'refused\tbad-json\tjson takes at most 100 notes; split the rest over another call'
        );
        expect((await edit([{ id: mine }])).lines[0]).toBe('refused\tbad-json\tNote 1: text needs the body to write');
        expect((await invoke('node_edit', { node_id: mine!, json: '[]' })).lines[0]).toBe(
            'refused\tbad-arguments\tjson carries every note with its own fields; leave out node_id'
        );
        expect((await invoke('node_edit', { text: 'x', append: true, json: '[]' })).lines[0]).toBe(
            'refused\tbad-arguments\tjson carries every note with its own fields; leave out text, append'
        );
    });

    test('view and revision hold for a batch as they do for one', async () => {
        const json = '[{"id":"note-1","text":"from the chat"}]';
        expect((await invoke('node_edit', { json: json }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        const decided = revisionOf((await invoke('node_list', { view: 'main' }, 'chat')).lines);
        expect((await invoke('node_edit', { json: json, view: 'main', revision: decided }, 'chat')).lines).toEqual(['edited\tnote-1\t1\t13']);
        const stale = await invoke('node_update', { node_id: 'note-1', title: 'Plan', view: 'main', revision: decided }, 'chat');
        expect(stale.lines[0]).toStartWith('refused\trev-conflict\t');
        expect((await nodeOnDisk('note-1'))?.title).toBe('Plan\twith a tab');
    });
});

describe('reaching another open project', () => {
    let other: string;
    let otherId: string;
    let reachOn: boolean;

    beforeEach(async () => {
        reachOn = true;
        other = join(root, 'other');
        await mkdir(other);
        const opened = await store.openProject({ folder: other });
        otherId = opened.summary.projectId;
        await store.save(otherId, opened.document.rev, {
            name: 'other',
            color: '#654321',
            views: [
                {
                    kind: 'canvas',
                    id: 'work',
                    name: 'Work',
                    nodes: [{ id: 'note-b', kind: 'note', title: 'Their plan', x: 0, y: 0, w: 320, h: 240, body: 'ship it' }],
                    texts: [],
                    edges: [],
                    layouts: []
                },
                { kind: 'chat', id: 'chat-b', name: 'Their chat', node: {} }
            ]
        });
        store.hold('client-1', otherId);
        store.letGo('client-1', otherId);
    });

    function reaching(): CanvasHost {
        return {
            ...host(),
            reach: projectReach(store, () => reachOn)
        };
    }

    test.each(['canvas', 'chat view'])('a %s reaches a project after switching away, until it is closed', async (surface) => {
        if (surface === 'canvas') {
            const current = await store.read(projectId);
            const moved = withViewAsNode(current.views, 'chat-1', 'main', { x: 600, y: 0 });

            if (moved === null) {
                throw new Error('The caller chat could not move onto its canvas');
            }

            await replaceContent({ ...current, views: moved.views });
        }

        const through = reaching();
        expect((await invoke('project_list', {}, 'chat', through)).lines).toEqual([`project\t${otherId}\tother`]);
        expect((await invoke('view_list', { project: otherId }, 'chat', through)).status).toBe(200);

        await store.closeProject(otherId, 'client-1');

        expect((await invoke('project_list', {}, 'chat', through)).lines).toEqual([]);
        expect((await invoke('view_list', { project: otherId }, 'chat', through)).lines[0]).toStartWith('refused\tproject-not-open\t');

        await store.openProject({ projectId: otherId });

        expect((await invoke('project_list', {}, 'chat', through)).lines).toEqual([`project\t${otherId}\tother`]);

        reachOn = false;

        expect((await invoke('project_list', {}, 'chat', through)).lines).toEqual([]);
        expect((await invoke('view_list', { project: otherId }, 'chat', through)).lines[0]).toStartWith('refused\tprojects-not-reachable\t');
    });

    test('Chats stays out of reach even while a client holds it', async () => {
        const scratch = await store.ensureProject(store.scratchFolder, { name: 'Chats', icon: { kind: 'lucide', value: 'messages-square' } });
        store.hold('client-2', scratch.projectId);

        expect((await invoke('project_list', {}, 'chat', reaching())).lines).toEqual([`project\t${otherId}\tother`]);
        expect((await invoke('view_list', { project: scratch.projectId }, 'chat', reaching())).lines[0]).toStartWith('refused\tproject-not-open\t');
    });

    test('project refuses while the switch is off, for the own project and for a closed project', async () => {
        reachOn = false;
        expect((await invoke('view_list', { project: otherId }, 'term', reaching())).lines[0]).toStartWith('refused\tprojects-not-reachable\t');
        reachOn = true;
        expect((await invoke('view_list', { project: projectId }, 'term', reaching())).lines).toEqual([
            `refused\town-project\t${projectId} is your own project; leave project out to work in it`,
            `project\t${otherId}\tother`
        ]);
        await store.closeProject(otherId, 'client-1');
        expect((await invoke('view_list', { project: otherId }, 'term', reaching())).lines[0]).toStartWith('refused\tproject-not-open\t');
    });

    test('a tool that does not cross refuses project as a field it does not take, before it does anything', async () => {
        const refused = await invoke('node_new', { kind: 'note', title: 'x', project: otherId }, 'term', reaching());
        expect(refused.lines[0]).toBe('refused\tbad-arguments\tnode_new takes no project');
        expect((await invoke('launch_list', { project: otherId }, 'term', reaching())).lines[0]).toBe('refused\tbad-arguments\tlaunch_list takes no project');
        expect((await store.read(otherId)).views).toHaveLength(2);
    });

    test('view list and node list read the other project, a canvas there named with view', async () => {
        const views = await invoke('view_list', { project: otherId }, 'term', reaching());
        expect(views.lines.slice(0, 2).map((line) => line.split('\t').slice(0, 3))).toEqual([
            ['work', 'canvas', 'Work'],
            ['chat-b', 'chat', 'Their chat']
        ]);
        expect((await invoke('node_list', { project: otherId }, 'term', reaching())).lines[0]).toStartWith('refused\tview-required\t');
        const nodes = await invoke('node_list', { project: otherId, view: 'work' }, 'term', reaching());
        expect(nodes.lines[0]!.split('\t').slice(0, 3)).toEqual(['note-b', 'note', 'Their plan']);
        expect(nodes.lines[1]).toBe('self\t-\tnone of these nodes is you');
    });
});
