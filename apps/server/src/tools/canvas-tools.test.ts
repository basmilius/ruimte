import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withViewAsNode, type ProjectCanvasView } from '@ruimte/contracts';
import { NEW_NODE, type CanvasHost } from '../canvas/host.ts';
import { projectReach, SETTING_LINE } from '../canvas/reach.ts';
import { projectOverlays } from '../projects/overlays.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import type { SessionEvent } from '../wire.ts';
import { CANVAS_LINES, canvasFixture, type CanvasFixture, content, madeId, revisionOf } from './canvas-fixture-test-helpers.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

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
            const { status, lines } = await fx.invoke(tool, input);
            expect({ input, status, line: lines[0] }).toEqual({ input, status: 422, line: `refused\t${code}\t${message}` });
        }
        const ignored = await fx.invoke('project_ignored', { view: 'main' });
        expect(ignored.lines[0]).toBe('refused\tbad-arguments\tproject_ignored takes no view');
    });

    test('name what can be picked instead wherever the set is closed', async () => {
        const missing = await fx.invoke('node_new', { kind: 'browser' });
        expect(missing.lines).toEqual([
            'refused\tmissing-flag\tA browser node needs url',
            'kind\tbrowser\turl (required)\tcalled "Browser" without title',
            'kind\tevery kind\ttitle, view, beside'
        ]);
        expect((await fx.invoke('node_new', { kind: 'note', url: 'https://example.com' })).lines.slice(1)).toEqual([
            'kind\tnote\ttext\tcalled "Note" without title',
            'kind\tevery kind\ttitle, view, beside'
        ]);
        expect((await fx.invoke('node_new', { kind: 'note', beside: 'nope' })).lines).toEqual([
            'refused\tunknown-node\tnope is not a node on main',
            'node\tterm-1\tterminal\tshell',
            'node\tnote-1\tnote\tPlan with a tab'
        ]);
    });

    test('a canvas too full to list points at the tool that lists it', async () => {
        const full = content();
        const board = full.views[2] as ProjectCanvasView;
        board.nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n-${i}`, kind: 'note' as const, title: 'n', x: i * 400, y: 0, w: 320, h: 240 }));
        await fx.replaceContent(full);
        expect((await fx.invoke('node_new', { kind: 'note', view: 'board', beside: 'nope' })).lines).toEqual([
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
            const { lines } = await fx.invoke('node_new', input);
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
                messages.push((await fx.invoke(tool, input)).lines[0]!.split('\t')[2]!);
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
        const noGroups = await fx.invoke('agent_start', { cli: 'claude', group: 'note-1' });
        expect(noGroups.lines[0]).toBe('refused\tunknown-group\tnote-1 is not a group on main');
        expect(noGroups.lines.slice(1)).toEqual(['note\tmain has no groups on it yet; team opens one of its own, and a person groups nodes on the canvas']);

        const noNodes = await fx.invoke('node_new', { kind: 'note', text: 'x', view: 'board', beside: 'ghost' });
        expect(noNodes.lines).toEqual(['refused\tunknown-node\tghost is not a node on board', 'note\tboard has no nodes on it yet']);

        const empty = content();
        empty.views = [{ kind: 'chat', id: 'chat-1', name: 'Planner', node: {} }];
        await fx.replaceContent(empty);
        const noCanvas = await fx.invoke('node_new', { kind: 'note', text: 'x' }, 'chat');
        expect(noCanvas.lines).toEqual([
            'refused\tview-required\tA node opens on a canvas; name which one with view (view_list lists them). A line only joins two nodes of one canvas, so the edge column shows -',
            'note\tThis project has no canvas; a node only ever lands on one'
        ]);
    });

    test('a source with no drawing view in the project says that too', async () => {
        const noDrawings = content();
        noDrawings.views = noDrawings.views.filter((view) => view.kind !== 'drawing');
        await fx.replaceContent(noDrawings);
        const { lines } = await fx.invoke('node_new', { kind: 'drawing', source: 'nowhere' });
        expect(lines).toEqual([
            'refused\tnot-a-drawing\tnowhere is not a drawing view of this project',
            'note\tThis project has no drawing views; a person makes one in the sidebar'
        ]);
    });
});

describe('scoping', () => {
    test('a caller no project places is refused', async () => {
        expect((await fx.invoke('view_list', {}, 'stray')).lines).toEqual([
            'refused\tnot-in-project\tThis session is not a node or a view of any project on this machine'
        ]);
    });

    test('a node on a canvas works on that canvas by default', async () => {
        const { status, lines } = await fx.invoke('node_list', {});
        expect(status).toBe(200);
        expect(lines).toEqual([
            'term-1\tterminal\tshell\t0\t0\t560\t360\t\t-\t-',
            'note-1\tnote\tPlan with a tab\t0\t601\t320\t240\t\t-\t-',
            'self\tterm-1',
            'revision\t1'
        ]);
    });

    test('a node a person snoozed says until when, in UTC', async () => {
        fx.snoozed['term-1'] = Date.UTC(2026, 9, 13, 15, 30);
        const { lines } = await fx.invoke('node_list', {});
        expect(lines[0]).toBe('term-1\tterminal\tshell\t0\t0\t560\t360\t\t-\t2026-10-13T15:30:00.000Z');
        expect(lines[1]).toEndWith('\t-\t-');
    });

    test('view picks another canvas, where the caller is nobody', async () => {
        expect(await fx.invoke('node_list', { view: 'board' })).toEqual({ status: 200, lines: ['self\t-\tnone of these nodes is you', 'revision\t1'] });
    });

    test('a chat that is a view of its own needs view, and hears which canvases there are', async () => {
        const { status, lines } = await fx.invoke('node_list', {}, 'chat');
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tview-required\t');
        expect(lines.slice(1)).toEqual(CANVAS_LINES);
        expect((await fx.invoke('node_new', { kind: 'note' }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        expect((await fx.invoke('node_new', { kind: 'note', view: 'board' }, 'chat')).status).toBe(200);
    });

    test('a view that is not a canvas is refused with the canvases listed', async () => {
        for (const view of ['chat-1', 'sketch-1', 'missing']) {
            const { status, lines } = await fx.invoke('node_list', { view: view });
            expect(status).toBe(422);
            expect(lines[0]).toStartWith('refused\tnot-a-canvas\t');
            expect(lines.slice(1)).toEqual(CANVAS_LINES);
        }
    });
});

describe('revision', () => {
    test('a write decided on the revision a list printed goes through, and one decided before a change refuses and writes nothing', async () => {
        const decided = revisionOf((await fx.invoke('node_list', {})).lines);
        const first = await fx.invoke('node_new', { kind: 'note', text: 'one', revision: decided });
        expect(first.status).toBe(200);
        const stale = await fx.invoke('node_new', { kind: 'note', text: 'two', revision: decided });
        expect(stale.lines[0]).toBe(
            `refused\trev-conflict\tThe project is at revision ${decided + 1}, and this call was decided on ${decided}; read it again and decide anew.`
        );
        expect((await fx.canvasOnDisk()).nodes.filter((node) => node.kind === 'note')).toHaveLength(2);
        expect((await fx.onDisk()).rev).toBe(decided + 1);
    });

    test('a dry run checks it too, and a start refuses before it makes anything', async () => {
        const decided = revisionOf((await fx.invoke('view_list', {})).lines);
        await fx.invoke('node_new', { kind: 'note' });
        expect((await fx.invoke('node_new', { kind: 'note', dry_run: true, revision: decided })).lines[0]).toStartWith('refused\trev-conflict\t');
        expect((await fx.invoke('agent_start', { cli: 'claude', worktree: true, revision: decided })).lines[0]).toStartWith('refused\trev-conflict\t');
        expect(fx.madeWorktrees).toEqual([]);
    });

    test('takes only a whole number, and only on a tool that writes the project file', async () => {
        expect((await fx.invoke('node_update', { node_id: 'note-1', title: 'Plan', revision: Number('latest') })).lines[0]).toStartWith(
            'refused\tbad-arguments\trevision is'
        );
        expect((await fx.invoke('node_update', { node_id: 'note-1', title: 'Plan', revision: 1.5 })).lines[0]).toBe(
            'refused\tbad-arguments\trevision is a whole number'
        );
        expect((await fx.invoke('node_list', { revision: 1 })).lines[0]).toBe('refused\tbad-arguments\tnode_list takes no revision');
        expect((await fx.invoke('plan_read', { revision: 1 })).lines[0]).toBe('refused\tbad-arguments\tplan_read takes no revision');
    });
});

describe('worktree', () => {
    test('worktree list names a design node whose later chat works in the worktree', async () => {
        const lexer = join(fx.worktree, 'lexer');
        const current = await fx.store.read(fx.projectId);
        await fx.replaceContent({
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
            ...fx.host(),
            worktrees: {
                list: async () => [{ path: lexer, branch: 'lexer' }],
                diff: () => Promise.reject(new Error('no diffs here')),
                merge: () => Promise.reject(new Error('no merges here'))
            }
        };
        const { lines } = await fx.invoke('worktree_list', {}, 'term', listing);
        expect(lines).toEqual([`lexer\t${lexer}\tdesign-1\t-\t0\t0\t0`]);
    });
});

describe('dry_run', () => {
    test('node says which kind it would have made', async () => {
        expect((await fx.invoke('node_new', { kind: 'note', text: 'x', dry_run: true })).lines).toEqual([`dry-run\tnote\tmain\tterm-1 -> ${NEW_NODE}`]);
        // A caller that is a node on no canvas names one, and the edge column says no line would be drawn.
        expect((await fx.invoke('node_new', { kind: 'note', view: 'board', dry_run: true }, 'chat')).lines).toEqual(['dry-run\tnote\tboard\t-']);
        expect((await fx.onDisk()).rev).toBe(1);
    });

    test('a tool that makes nothing refuses dry_run as a field it does not take', async () => {
        const { status, lines } = await fx.invoke('task_list', { dry_run: true });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tbad-arguments\ttask_list takes no dry_run');
        expect((await fx.invoke('link_new', { to: 'note-1', dry_run: true })).lines[0]).toBe('refused\tbad-arguments\tlink_new takes no dry_run');
    });

    test('a tool that takes dry_run refuses an unknown field beside it, not as a dry run it would do', async () => {
        const { status, lines } = await fx.invoke('agent_start', { cli: 'claude', bogus: 'y', dry_run: true });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tbad-arguments\tagent_start takes no bogus');
        expect((await fx.invoke('node_new', { kind: 'note', bogus: 'y', dry_run: true })).lines[0]).toBe('refused\tbad-arguments\tnode_new takes no bogus');
        expect((await fx.onDisk()).rev).toBe(1);
    });
});

describe('several at once', () => {
    async function newNotes(count: number, input: Record<string, string> = {}): Promise<string[]> {
        const nodes = Array.from({ length: count }, (_, i) => ({ kind: 'note', title: `Note ${i + 1}` }));
        return (await fx.invoke('node_new', { json: JSON.stringify(nodes), ...input })).lines.map((line) => line.split('\t')[0]!);
    }

    const tooMany = (prefix: string): string[] => Array.from({ length: 101 }, (_, i) => `${prefix}-${i}`);

    test('node delete removes every node it names in one write, with their sessions and lines, in the order given', async () => {
        const [first, second] = await newNotes(2);
        const shell = await madeId(fx.invoke('node_new', { kind: 'terminal', title: 'runner' }));
        const { rev, changed } = await fx.watchWrites();
        const { status, lines } = await fx.invoke('node_delete', { node_id: [shell, first, second, first] });
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
        expect((await fx.onDisk()).rev).toBe(rev + 1);
        expect(changed).toEqual([rev + 1]);
        expect(fx.ended).toEqual([`terminal\t${shell}`]);
        const canvas = await fx.canvasOnDisk();
        expect(canvas.nodes.map((node) => node.id)).toEqual(['term-1', 'note-1']);
        expect(canvas.edges).toEqual([]);
    });

    test('node delete removes none when one of them may not go, and names that one', async () => {
        const [mine] = await newNotes(1);
        const rev = (await fx.onDisk()).rev;
        const refused = await fx.invoke('node_delete', { node_id: [mine, 'note-1'] });
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe('refused\tnot-yours\tnote-1 was made by a person and node delete only removes a node you made yourself');
        expect((await fx.invoke('node_delete', { node_id: [mine, 'term-1'] })).lines[0]).toBe(
            'refused\tdeletes-caller\tYou are term-1, so removing it would end the session asking'
        );
        expect((await fx.invoke('node_delete', { node_id: [mine, 'nope'] })).lines[0]).toBe(
            'refused\tunknown-node\tnope is not a node on any canvas of this project'
        );
        expect((await fx.onDisk()).rev).toBe(rev);
        expect((await fx.canvasOnDisk()).nodes.map((node) => node.id)).toContain(mine);
        expect(fx.ended).toEqual([]);
    });

    test('node delete takes the nodes of one canvas, at most a hundred, as an array', async () => {
        const [onMain] = await newNotes(1);
        const [onBoard] = await newNotes(1, { view: 'board' });
        expect((await fx.invoke('node_delete', { node_id: [onMain, onBoard] })).lines[0]).toBe(
            `refused\tbad-arguments\tnode_delete takes the nodes of one canvas per call, and ${onMain} is on main while ${onBoard} is on board`
        );
        expect((await fx.invoke('node_delete', { node_id: tooMany('note') })).lines[0]).toBe(
            'refused\tbad-arguments\tnode_id takes at most 100 ids at once; split the rest over another call'
        );
        expect((await fx.invoke('node_delete', { node_id: [onMain, ''] })).lines[0]).toBe('refused\tbad-arguments\tnode_id has an empty id in it');
        expect((await fx.invoke('node_delete', { node_id: `${onMain},${onBoard}` })).lines[0]).toBe(
            'refused\tbad-arguments\tnode_id needs the ids of the nodes to remove'
        );
        expect((await fx.canvasOnDisk()).nodes.map((node) => node.id)).toContain(onMain);
    });

    test('link delete removes every line it names in one write, and none when one of them is not the caller’s', async () => {
        const notes = await newNotes(3);
        const mine = (await fx.canvasOnDisk()).edges.map((edge) => edge.id);
        const into = await madeId(fx.invoke('link_new', { to: 'note-1' }));
        const refused = await fx.invoke('link_delete', { edge_id: [mine[0], into] });
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe(
            `refused\tnot-yours\t${into} runs into note-1, which a person made, and link delete only removes a line whose ends are both yours`
        );
        expect((await fx.invoke('link_delete', { edge_id: [mine[0], 'nope'] })).lines[0]).toBe('refused\tunknown-edge\tnope is not a line on main');
        expect((await fx.canvasOnDisk()).edges).toHaveLength(4);

        const { rev, changed } = await fx.watchWrites();
        const { status, lines } = await fx.invoke('link_delete', { edge_id: mine });
        expect(status).toBe(200);
        expect(lines).toEqual(mine.map((edge, i) => `deleted\t${edge}\tterm-1\t${notes[i]}\t`));
        expect((await fx.onDisk()).rev).toBe(rev + 1);
        expect(changed).toEqual([rev + 1]);
        expect((await fx.canvasOnDisk()).edges.map((edge) => edge.id)).toEqual([into]);
        expect((await fx.invoke('link_delete', { edge_id: tooMany('edge') })).lines[0]).toBe(
            'refused\tbad-arguments\tedge_id takes at most 100 ids at once; split the rest over another call'
        );
    });

    test('node edit json writes every note in one write, in the order given, with the text as sent', async () => {
        const [first, second] = await newNotes(2);
        await fx.invoke('link_new', { to: 'note-1' });
        const { rev, changed } = await fx.watchWrites();
        const edits = [
            { id: first, text: 'one\ntwo' },
            { id: 'note-1', text: 'mine', append: true },
            { id: second, text: 'a "quote" \\n stays' }
        ];
        const { status, lines } = await fx.invoke('node_edit', { json: JSON.stringify(edits) });
        expect(status).toBe(200);
        expect(lines).toEqual([`edited\t${first}\t2\t7`, 'edited\tnote-1\t2\t6', `edited\t${second}\t1\t18`]);
        expect((await fx.onDisk()).rev).toBe(rev + 1);
        expect(changed).toEqual([rev + 1]);
        expect((await fx.nodeOnDisk('note-1'))?.body).toBe('x\nmine');
        expect((await fx.nodeOnDisk(second!))?.body).toBe('a "quote" \\n stays');
    });

    test('node edit json writes none when one note is refused, and names it', async () => {
        const [mine] = await newNotes(1);
        const rev = (await fx.onDisk()).rev;
        const edit = (nodes: unknown[]) => fx.invoke('node_edit', { json: JSON.stringify(nodes) });
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
        expect((await fx.onDisk()).rev).toBe(rev);
        expect((await fx.nodeOnDisk(mine!))?.body).toBeUndefined();

        expect((await edit(Array.from({ length: 101 }, () => ({ id: mine, text: 'x' })))).lines[0]).toBe(
            'refused\tbad-json\tjson takes at most 100 notes; split the rest over another call'
        );
        expect((await edit([{ id: mine }])).lines[0]).toBe('refused\tbad-json\tNote 1: text needs the body to write');
        expect((await fx.invoke('node_edit', { node_id: mine!, json: '[]' })).lines[0]).toBe(
            'refused\tbad-arguments\tjson carries every note with its own fields; leave out node_id'
        );
        expect((await fx.invoke('node_edit', { text: 'x', append: true, json: '[]' })).lines[0]).toBe(
            'refused\tbad-arguments\tjson carries every note with its own fields; leave out text, append'
        );
    });

    test('view and revision hold for a batch as they do for one', async () => {
        const json = '[{"id":"note-1","text":"from the chat"}]';
        expect((await fx.invoke('node_edit', { json: json }, 'chat')).lines[0]).toStartWith('refused\tview-required\t');
        const decided = revisionOf((await fx.invoke('node_list', { view: 'main' }, 'chat')).lines);
        expect((await fx.invoke('node_edit', { json: json, view: 'main', revision: decided }, 'chat')).lines).toEqual(['edited\tnote-1\t1\t13']);
        const stale = await fx.invoke('node_update', { node_id: 'note-1', title: 'Plan', view: 'main', revision: decided }, 'chat');
        expect(stale.lines[0]).toStartWith('refused\trev-conflict\t');
        expect((await fx.nodeOnDisk('note-1'))?.title).toBe('Plan\twith a tab');
    });
});

describe('reaching another open project', () => {
    let other: string;
    let otherId: string;
    let reachOn: boolean;

    beforeEach(async () => {
        reachOn = true;
        other = join(fx.root, 'other');
        await mkdir(other);
        const opened = await fx.store.openProject({ folder: other });
        otherId = opened.summary.projectId;
        await fx.store.save(otherId, opened.document.rev, {
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
        fx.store.hold('client-1', otherId);
        fx.store.letGo('client-1', otherId);
    });

    function reaching(): CanvasHost {
        return {
            ...fx.host(),
            reach: projectReach(fx.store, () => reachOn)
        };
    }

    test.each(['canvas', 'chat view'])('a %s reaches a project after switching away, until it is closed', async (surface) => {
        if (surface === 'canvas') {
            const current = await fx.store.read(fx.projectId);
            const moved = withViewAsNode(current.views, 'chat-1', 'main', { x: 600, y: 0 });

            if (moved === null) {
                throw new Error('The caller chat could not move onto its canvas');
            }

            await fx.replaceContent({ ...current, views: moved.views });
        }

        const through = reaching();
        expect((await fx.invoke('project_list', {}, 'chat', through)).lines).toEqual([`project\t${otherId}\tother`]);
        expect((await fx.invoke('view_list', { project: otherId }, 'chat', through)).status).toBe(200);

        await fx.store.closeProject(otherId, 'client-1');

        expect((await fx.invoke('project_list', {}, 'chat', through)).lines).toEqual([`recent\t${otherId}\tother`]);
        expect((await fx.invoke('view_list', { project: otherId }, 'chat', through)).lines[0]).toStartWith('refused\tproject-not-open\t');

        await fx.store.openProject({ projectId: otherId });

        expect((await fx.invoke('project_list', {}, 'chat', through)).lines).toEqual([`project\t${otherId}\tother`]);

        reachOn = false;

        expect((await fx.invoke('project_list', {}, 'chat', through)).lines).toEqual([SETTING_LINE]);
        expect((await fx.invoke('view_list', { project: otherId }, 'chat', through)).lines[0]).toStartWith('refused\tprojects-not-reachable\t');
    });

    test('Chats stays out of reach even while a client holds it', async () => {
        const scratch = await fx.store.ensureProject(fx.store.scratchFolder, { name: 'Chats', icon: { kind: 'lucide', value: 'messages-square' } });
        fx.store.hold('client-2', scratch.projectId);

        expect((await fx.invoke('project_list', {}, 'chat', reaching())).lines).toEqual([`project\t${otherId}\tother`]);
        expect((await fx.invoke('view_list', { project: scratch.projectId }, 'chat', reaching())).lines[0]).toStartWith('refused\tproject-not-open\t');
    });

    test('project refuses while the switch is off, for the own project and for a closed project', async () => {
        reachOn = false;
        expect((await fx.invoke('view_list', { project: otherId }, 'term', reaching())).lines[0]).toStartWith('refused\tprojects-not-reachable\t');
        reachOn = true;
        expect((await fx.invoke('view_list', { project: fx.projectId }, 'term', reaching())).lines).toEqual([
            `refused\town-project\t${fx.projectId} is your own project; leave project out to work in it`,
            `project\t${otherId}\tother`
        ]);
        await fx.store.closeProject(otherId, 'client-1');
        expect((await fx.invoke('view_list', { project: otherId }, 'term', reaching())).lines[0]).toStartWith('refused\tproject-not-open\t');
    });

    test('project open takes a project back out of Recent without anyone holding it, and only behind the switch', async () => {
        await fx.store.closeProject(otherId, 'client-1');
        reachOn = false;

        expect((await fx.invoke('project_open', { project_id: otherId }, 'chat', reaching())).lines[0]).toStartWith('refused\tprojects-not-reachable\t');
        expect(await fx.store.isClosed(otherId)).toBe(true);

        reachOn = true;

        expect((await fx.invoke('project_open', { project_id: fx.projectId }, 'chat', reaching())).lines).toEqual([
            `refused\town-project\t${fx.projectId} is your own project; project_id names another one`,
            `recent\t${otherId}\tother`
        ]);
        expect((await fx.invoke('project_open', { project_id: otherId }, 'chat', reaching())).lines).toEqual([`project\t${otherId}\tother\topened`]);
        expect(await fx.store.isClosed(otherId)).toBe(false);
        expect(fx.store.holdersOf(otherId)).toEqual([]);
        expect((await fx.invoke('project_list', {}, 'chat', reaching())).lines).toEqual([`project\t${otherId}\tother`]);
        expect((await fx.invoke('project_open', { project_id: otherId }, 'chat', reaching())).lines).toEqual([`project\t${otherId}\tother\talready open`]);
    });

    test('project activate and project close only ask the clients with the caller project on screen', async () => {
        const asked: SessionEvent[] = [];
        fx.store.subscribe('client-2', (event) => asked.push(event));

        expect((await fx.invoke('project_activate', { project_id: otherId }, 'chat', reaching())).lines).toEqual([
            `showing\t${otherId}\tother`,
            'sent\tno\tNobody has your project on screen right now, so nothing was shown'
        ]);

        fx.store.hold('client-2', fx.projectId, { startsLaunches: false });

        expect((await fx.invoke('project_activate', { project_id: otherId }, 'chat', reaching())).lines[1]).toStartWith('sent\tyes\t');
        expect((await fx.invoke('project_close', { project_id: otherId }, 'chat', reaching())).lines).toEqual([
            `asked\t${otherId}\tother`,
            'sent\tyes\tIt closes only once a person confirms; project_list shows whether it did'
        ]);
        expect(asked).toEqual([
            { event: 'project.activate', payload: { projectId: otherId, fromProjectId: fx.projectId, by: 'chat-1' } },
            { event: 'project.askClose', payload: { projectId: otherId, fromProjectId: fx.projectId, by: 'chat-1' } }
        ]);
        expect(await fx.store.isClosed(otherId)).toBe(false);
    });

    test('project activate and project close refuse a project under Recent and the caller own project', async () => {
        await fx.store.closeProject(otherId, 'client-1');

        for (const tool of ['project_activate', 'project_close']) {
            expect((await fx.invoke(tool, { project_id: otherId }, 'chat', reaching())).lines).toEqual([
                `refused\tproject-not-open\t${otherId} is no project open on this machine; project_open takes one back out of Recent`
            ]);
            expect((await fx.invoke(tool, { project_id: fx.projectId }, 'chat', reaching())).lines[0]).toStartWith('refused\town-project\t');
        }
    });

    test('project open takes a folder with a project file of its own at once, without anyone holding it', async () => {
        const cloned = join(fx.root, 'cloned');
        await mkdir(cloned);
        const elsewhere = new ProjectStore(join(fx.root, 'elsewhere'), projectLinks(), projectOverlays(join(fx.root, 'elsewhere')));
        await elsewhere.openProject({ folder: cloned, name: 'Cloned' });
        elsewhere.closeAll();
        const asked: SessionEvent[] = [];
        fx.store.hold('client-2', fx.projectId, { startsLaunches: false });
        fx.store.subscribe('client-2', (event) => asked.push(event));

        const lines = (await fx.invoke('project_open', { folder: cloned }, 'chat', reaching())).lines;
        const real = await realpath(cloned);
        const opened = (await fx.store.list()).find((project) => project.folder === real);

        expect(opened?.closedAt ?? null).toBeNull();
        expect(lines).toEqual([`project\t${opened?.projectId}\tCloned\topened`]);
        expect(fx.store.holdersOf(opened?.projectId ?? '')).toEqual([]);
        expect(asked.filter((event) => event.event === 'project.askOpen')).toEqual([]);
        expect((await fx.invoke('project_list', {}, 'chat', reaching())).lines).toContain(`project\t${opened?.projectId}\tCloned`);
        expect((await fx.invoke('project_open', { folder: cloned }, 'chat', reaching())).lines).toEqual([
            `refused\tfolder-is-project\tfolder ${cloned} is the folder of ${opened?.projectId}; open it with project_id instead`,
            `project\t${opened?.projectId}\tCloned`
        ]);
    });

    test('project open asks the clients with the caller project on screen before a folder without a project becomes one', async () => {
        const fresh = join(fx.root, 'fresh');
        await mkdir(fresh);
        const real = await realpath(fresh);
        const asked: SessionEvent[] = [];
        fx.store.subscribe('client-2', (event) => asked.push(event));

        expect((await fx.invoke('project_open', { folder: fresh }, 'chat', reaching())).lines).toEqual([
            `asked\t${real}`,
            'sent\tno\tNobody has your project on screen right now, so nobody was asked and nothing was made'
        ]);

        fx.store.hold('client-2', fx.projectId, { startsLaunches: false });

        expect((await fx.invoke('project_open', { folder: fresh }, 'chat', reaching())).lines).toEqual([
            `asked\t${real}`,
            'sent\tyes\tIt becomes a project only once a person confirms; project_list shows whether it did'
        ]);
        expect(asked).toEqual([{ event: 'project.askOpen', payload: { folder: real, fromProjectId: fx.projectId, by: 'chat-1' } }]);
        expect((await fx.store.list()).some((project) => project.folder === real)).toBe(false);
        expect(await Bun.file(join(fresh, '.ruimte', 'project.json')).exists()).toBe(false);
    });

    test('project open refuses a folder outside what it may open, and both or neither of its fields', async () => {
        const file = join(fx.root, 'notes.txt');
        await writeFile(file, 'x');
        const chosenRoot = join(fx.root, 'checkouts');
        await mkdir(join(chosenRoot, 'one'), { recursive: true });
        await mkdir(join(fx.root, 'home', 'worktrees', 'two'), { recursive: true });
        await mkdir(fx.store.scratchFolder, { recursive: true });
        await symlink(join(fx.root, 'home'), join(fx.root, 'home-link'));
        await symlink(join(fx.root, 'repo'), join(fx.root, 'repo-link'));
        const through: CanvasHost = {
            ...fx.host(),
            reach: projectReach(
                fx.store,
                () => reachOn,
                () => chosenRoot
            )
        };

        const codeOf = async (input: Record<string, unknown>): Promise<string | undefined> =>
            (await fx.invoke('project_open', input, 'chat', through)).lines[0]?.split('\t').slice(0, 2).join('\t');

        expect(await codeOf({})).toBe('refused\tbad-arguments');
        expect(await codeOf({ project_id: otherId, folder: other })).toBe('refused\tbad-arguments');
        expect(await codeOf({ folder: 'relative/path' })).toBe('refused\tfolder-not-absolute');
        expect(await codeOf({ folder: join(fx.root, 'missing') })).toBe('refused\tfolder-not-found');
        expect(await codeOf({ folder: file })).toBe('refused\tfolder-not-found');
        expect(await codeOf({ folder: join(fx.root, 'home') })).toBe('refused\tmachine-folder');
        expect(await codeOf({ folder: fx.store.scratchFolder })).toBe('refused\tmachine-folder');
        expect(await codeOf({ folder: join(fx.root, 'home', 'worktrees', 'two') })).toBe('refused\tmachine-folder');
        expect(await codeOf({ folder: join(fx.root, 'home-link') })).toBe('refused\tmachine-folder');
        expect(await codeOf({ folder: join(chosenRoot, 'one') })).toBe('refused\tmachine-folder');
        expect(await codeOf({ folder: join(fx.root, 'repo') })).toBe('refused\town-project');
        expect(await codeOf({ folder: join(fx.root, 'repo-link') })).toBe('refused\town-project');
        expect((await fx.invoke('project_open', { folder: other }, 'chat', through)).lines).toEqual([
            `refused\tfolder-is-project\tfolder ${other} is the folder of ${otherId}; open it with project_id instead`,
            `project\t${otherId}\tother`
        ]);

        await fx.store.closeProject(otherId, 'client-1');

        expect((await fx.invoke('project_open', { folder: other }, 'chat', through)).lines[1]).toBe(`recent\t${otherId}\tother`);

        reachOn = false;

        expect(await codeOf({ folder: join(fx.root, 'repo') })).toBe('refused\tprojects-not-reachable');
    });

    test('a tool that does not cross refuses project as a field it does not take, before it does anything', async () => {
        const refused = await fx.invoke('node_new', { kind: 'note', title: 'x', project: otherId }, 'term', reaching());
        expect(refused.lines[0]).toBe('refused\tbad-arguments\tnode_new takes no project');
        expect((await fx.invoke('launch_list', { project: otherId }, 'term', reaching())).lines[0]).toBe(
            'refused\tbad-arguments\tlaunch_list takes no project'
        );
        expect((await fx.store.read(otherId)).views).toHaveLength(2);
    });

    test('view list and node list read the other project, a canvas there named with view', async () => {
        const views = await fx.invoke('view_list', { project: otherId }, 'term', reaching());
        expect(views.lines.slice(0, 2).map((line) => line.split('\t').slice(0, 3))).toEqual([
            ['work', 'canvas', 'Work'],
            ['chat-b', 'chat', 'Their chat']
        ]);
        expect((await fx.invoke('node_list', { project: otherId }, 'term', reaching())).lines[0]).toStartWith('refused\tview-required\t');
        const nodes = await fx.invoke('node_list', { project: otherId, view: 'work' }, 'term', reaching());
        expect(nodes.lines[0]!.split('\t').slice(0, 3)).toEqual(['note-b', 'note', 'Their plan']);
        expect(nodes.lines[1]).toBe('self\t-\tnone of these nodes is you');
    });
});
