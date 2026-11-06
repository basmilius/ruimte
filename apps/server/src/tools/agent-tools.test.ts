import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_PROMPT_LENGTH } from '@ruimte/actions';
import type { ActionOutput, ActionResult } from '@ruimte/actions';
import { type ProjectCanvasView } from '@ruimte/contracts';
import { serverActionCall, voiceActionCall, type VoiceCaller } from '../actions/context.ts';
import { serverActions } from '../actions/server-actions-test-helpers.ts';
import { AGENT_KINDS } from '../canvas/agents.ts';
import { MAX_AGENT_DEPTH, MAX_OPENED_PER_CALLER, MAX_TEAM_DEPTH } from '../canvas/depth.ts';
import { MAX_TITLE_LENGTH, NEW_NODE, type CanvasHost } from '../canvas/host.ts';
import { MAX_LINKS } from '../canvas/links.ts';
import { PLACEMENT_GAP, TEAM_COLUMNS } from '../canvas/placement.ts';
import { projectReach } from '../canvas/reach.ts';
import { MAX_ROLES, ROLES_SHAPE } from './agent-tools.ts';
import {
    canvasFixture,
    knobs,
    root,
    folder,
    outside,
    store,
    projectId,
    held,
    started,
    lineage,
    tasks,
    madeWorktrees,
    removedWorktrees,
    TOKENS,
    content,
    host,
    invoke,
    onDisk,
    canvasOnDisk,
    nodeOnDisk,
    madeId,
    replaceContent,
    viewOnDisk,
    reloadLineage
} from './canvas-test-fixture.ts';

canvasFixture();

describe('agent model selection', () => {
    test('a model alias selects that model for a chat, including its defaults', async () => {
        const result = await invoke('agent_start', { cli: 'codex', model: 'sol', prompt: 'implement' });
        expect(result.status).toBe(200);
        expect(started[0]?.selection).toEqual({ model: 'gpt-6.1-sol', options: { effort: 'medium', serviceTier: false } });
    });

    test('unknown and terminal models refuse before creating nodes, also in a dry run', async () => {
        const before = await onDisk();
        for (const tail of [{}, { dry_run: true }]) {
            const unknown = await invoke('agent_start', { cli: 'codex', model: 'missing', ...tail });
            expect(unknown.lines[0]).toStartWith('refused\tunknown-model\t');
            expect(unknown.lines.some((line) => line.includes('gpt-6.1-sol'))).toBe(true);
            const terminal = await invoke('agent_start', { cli: 'codex', terminal: true, model: 'sol', ...tail });
            expect(terminal.lines[0]).toStartWith('refused\tmodel-needs-chat\t');
        }
        expect((await onDisk()).rev).toBe(before.rev);
        expect(started).toEqual([]);
    });

    test('each team role can choose a model and an invalid role creates nothing', async () => {
        const roles = [
            { title: 'Builder', prompt: 'build', provider: 'codex', model: 'sol' },
            { title: 'Reviewer', prompt: 'review', provider: 'codex', model: 'astra' }
        ];
        const before = await onDisk();
        const invalid = await invoke('agent_team', { label: 'Team', roles: JSON.stringify([...roles, { ...roles[0], model: 'missing' }]) });
        expect(invalid.lines[0]).toStartWith('refused\tunknown-model\trole 2 (model):');
        expect((await onDisk()).rev).toBe(before.rev);
        expect(started).toEqual([]);
        expect((await invoke('agent_team', { label: 'Team', roles: JSON.stringify(roles) })).status).toBe(200);
        expect(started.map((start) => start.selection?.model)).toEqual(['gpt-6.1-sol', 'gpt-6-astra']);
    });

    test('effort with model starts that model at that effort', async () => {
        const result = await invoke('agent_start', { cli: 'codex', model: 'astra', effort: 'high', prompt: 'research' });
        expect(result.status).toBe(200);
        expect(started[0]?.selection).toEqual({ model: 'gpt-6-astra', options: { effort: 'high', serviceTier: false } });
    });

    test("effort without model keeps the person's model and its other options", async () => {
        knobs.preferredSelections = { codex: { model: 'gpt-6.1-sol', options: { effort: 'low', serviceTier: true } } };
        expect((await invoke('agent_start', { cli: 'codex', effort: 'xhigh' })).status).toBe(200);
        expect(started[0]?.selection).toEqual({ model: 'gpt-6.1-sol', options: { effort: 'xhigh', serviceTier: true } });
    });

    test("effort without model or a preference applies to the provider's default model", async () => {
        expect((await invoke('agent_start', { cli: 'codex', effort: 'ultra' })).status).toBe(200);
        expect(started[0]?.selection).toEqual({ model: 'gpt-6-astra', options: { effort: 'ultra', serviceTier: false } });
    });

    test("model without effort carries the person's last effort when the new model offers it, and nothing else", async () => {
        knobs.preferredSelections = { codex: { model: 'gpt-6-astra', options: { effort: 'high', serviceTier: true } } };
        await invoke('agent_start', { cli: 'codex', model: 'sol' });
        knobs.preferredSelections = { codex: { model: 'gpt-6-astra', options: { effort: 'ultra', serviceTier: false } } };
        await invoke('agent_start', { cli: 'codex', model: 'sol' });
        expect(started.map((start) => start.selection)).toEqual([
            { model: 'gpt-6.1-sol', options: { effort: 'high', serviceTier: false } },
            { model: 'gpt-6.1-sol', options: { effort: 'medium', serviceTier: false } }
        ]);
    });

    test('an effort the model lacks, a model without effort and a terminal refuse before creating nodes', async () => {
        const before = await onDisk();
        for (const tail of [{}, { dry_run: true }]) {
            const unknown = await invoke('agent_start', { cli: 'codex', model: 'sol', effort: 'ultra', ...tail });
            expect(unknown.lines[0]).toBe('refused\tunknown-choice\tultra is no reasoning effort of gpt-6.1-sol; it takes low, medium, high, xhigh, max');
            expect(unknown.lines).toContain('model\tcodex\tgpt-6.1-sol\tGPT-6.1 Sol\teffort low, medium, high, xhigh, max, default medium');
            const none = await invoke('agent_start', { cli: 'claude', model: 'claude-haiku-4-5', effort: 'high', ...tail });
            expect(none.lines[0]).toStartWith('refused\tno-effort\t');
            const terminal = await invoke('agent_start', { cli: 'codex', terminal: true, effort: 'high', ...tail });
            expect(terminal.lines[0]).toStartWith('refused\teffort-needs-chat\t');
        }
        expect((await onDisk()).rev).toBe(before.rev);
        expect(started).toEqual([]);
    });

    test('each team role can choose its own effort, and a wrong one names the role', async () => {
        const roles = [
            { title: 'Research', prompt: 'research', provider: 'codex', model: 'astra', effort: 'high' },
            { title: 'Build', prompt: 'build', provider: 'codex', model: 'sol', effort: 'medium' }
        ];
        const invalid = await invoke('agent_team', { label: 'Team', roles: JSON.stringify([...roles, { ...roles[1], effort: 'ultra' }]) });
        expect(invalid.lines[0]).toStartWith('refused\tunknown-choice\trole 2 (effort):');
        expect(started).toEqual([]);
        expect((await invoke('agent_team', { label: 'Team', roles: JSON.stringify(roles) })).status).toBe(200);
        expect(started.map((start) => start.selection?.options.effort)).toEqual(['high', 'medium']);
    });
});

describe('agent', () => {
    test('request_id answers a retry with the node the first call made, and starts one agent', async () => {
        const first = await invoke('agent_start', { cli: 'claude', prompt: 'x', request_id: 'r1' });
        const second = await invoke('agent_start', { cli: 'claude', prompt: 'x', request_id: 'r1' });

        expect([first.status, second.status]).toEqual([200, 200]);
        expect(second.lines[0]).toBe(first.lines[0]!);
        expect(started).toHaveLength(1);
        const ids = (await canvasOnDisk()).nodes.filter((node) => node.id === first.lines[0]!.split('\t')[0]);
        expect(ids).toHaveLength(1);
    });

    test('request_id with another command is refused and makes nothing', async () => {
        await invoke('agent_start', { cli: 'claude', prompt: 'x', request_id: 'r1' });

        const other = await invoke('agent_start', { cli: 'claude', prompt: 'y', request_id: 'r1' });

        expect(other.lines[0]).toStartWith('refused\trequest-id-reused\t');
        expect(started).toHaveLength(1);
    });

    test('request_id takes only a plain id', async () => {
        const bad = await invoke('agent_start', { cli: 'claude', request_id: 'has space' });

        expect(bad.lines[0]).toBe('refused\tbad-arguments\trequest_id takes 1 to 128 characters of letters, digits and . _ : -');
        expect(started).toHaveLength(0);
    });

    test('terminal opens a terminal agent with an edge from the caller into it, and holds the prompt', async () => {
        const { status, lines } = await invoke('agent_start', { cli: 'claude', terminal: true, prompt: 'say hello' });
        expect(status).toBe(200);
        const [id, kind, viewId, cli, edgeId] = lines[0]!.split('\t');
        expect(id).toMatch(/^terminal-[0-9a-z]{8}$/);
        expect([kind, viewId, cli]).toEqual(['terminal', 'main', 'claude']);

        const canvas = await canvasOnDisk();
        const node = canvas.nodes.find((candidate) => candidate.id === id)!;
        expect([node.kind, node.title, node.provider, node.titleSource]).toEqual(['terminal', 'Claude Code', 'claude', undefined]);
        // Context flows from the edge's `from` into the agent at `to`, so the caller is what the new agent may read.
        expect(canvas.edges).toEqual([{ id: edgeId!, from: 'term-1', to: id!, label: 'context' }]);
        expect(held).toEqual([{ projectId, nodeId: id!, prompt: 'say hello' }]);
        // Started by the daemon, not by whichever client shows it first, where a client would start it.
        expect(started).toEqual([
            { projectId, nodeId: id!, openedBy: 'term-1', node: 'terminal', provider: 'claude', cwd: folder, runtimeMode: 'full-access' }
        ]);
        // The mode is on the node, so a client that starts it again after a reload starts the same line.
        expect(node.runtimeMode).toBe('full-access');
    });

    test('a CLI with a chat backend opens as a chat node fixed to its CLI', async () => {
        const { lines } = await invoke('agent_start', { cli: 'codex', title: 'Reviewer' });
        const [id, kind] = lines[0]!.split('\t');
        expect(kind).toBe('chat');
        const node = (await nodeOnDisk(id))!;
        expect([node.provider, node.providerFixed, node.title, node.titleSource]).toEqual(['codex', true, 'Reviewer', 'user']);
        // Without a prompt it is still started: a chat registers and waits, a terminal runs its CLI at its own prompt.
        expect(started).toEqual([{ projectId, nodeId: id!, openedBy: 'term-1', node: 'chat', provider: 'codex', cwd: folder }]);
    });

    test('Antigravity opens as a chat, and as a terminal with terminal', async () => {
        const plain = await invoke('agent_start', { cli: 'antigravity' });
        const asked = await invoke('agent_start', { cli: 'antigravity', terminal: true });
        expect([plain.status, asked.status]).toEqual([200, 200]);
        expect([plain.lines[0]!.split('\t')[1], asked.lines[0]!.split('\t')[1]]).toEqual(['chat', 'terminal']);
        expect(started.map((start) => start.node)).toEqual(['chat', 'terminal']);
    });

    test('a CLI that is not installed is refused with the ones that are', async () => {
        knobs.installed = ['codex'];
        const { lines } = await invoke('agent_start', { cli: 'claude' });
        expect(lines[0]).toBe('refused\tcli-not-installed\tClaude Code is not installed on this machine');
        expect(lines.slice(1)).toEqual(['cli\tcodex\tCodex']);
        knobs.installed = [];
        expect((await invoke('agent_start', { cli: 'claude' })).lines.slice(1)).toEqual(['note\tNo agent CLI is installed on this machine']);
        expect((await onDisk()).rev).toBe(1);
    });

    test('an empty prompt and a prompt past the cap are refused', async () => {
        expect((await invoke('agent_start', { cli: 'claude', prompt: '   ' })).lines[0]).toStartWith('refused\tempty-prompt\t');
        const long = 'x'.repeat(MAX_PROMPT_LENGTH + 1);
        const refusal = await invoke('agent_start', { cli: 'claude', prompt: long });
        expect(refusal.lines[0]).toStartWith(`refused\tprompt-too-long\tThe prompt is ${MAX_PROMPT_LENGTH + 1} characters`);
        expect(held).toEqual([]);
    });

    test('group puts the node inside the group, and a collapsed one also takes its id', async () => {
        const withGroup = content();
        const canvas = withGroup.views[0] as ProjectCanvasView;
        canvas.nodes.push({ id: 'group-1', kind: 'group', title: 'Work', x: 2000, y: 0, w: 900, h: 800 });
        canvas.nodes.push({ id: 'group-2', kind: 'group', title: 'Folded', x: 5000, y: 0, w: 900, h: 39, collapsed: true, expandedHeight: 800, memberIds: [] });
        await replaceContent(withGroup);

        const open = await invoke('agent_start', { cli: 'claude', group: 'group-1' });
        const openId = open.lines[0]!.split('\t')[0]!;
        const node = (await nodeOnDisk(openId))!;
        expect(node.x).toBe(2000 + 32);
        expect(node.y).toBe(0 + 40 + 32);
        // Its center falls inside the frame, which is what makes it a member of an open group.
        expect(node.x + node.w / 2).toBeLessThan(2000 + 900);

        const folded = await invoke('agent_start', { cli: 'claude', group: 'group-2' });
        const foldedId = folded.lines[0]!.split('\t')[0]!;
        const group = (await nodeOnDisk('group-2'))!;
        expect(group.memberIds).toEqual([foldedId]);
        expect(group.h).toBe(39);
        expect(group.expandedHeight).toBe(800);
    });

    test('a group that is not a group of that canvas is refused with the groups', async () => {
        const withGroup = content();
        (withGroup.views[0] as ProjectCanvasView).nodes.push({ id: 'group-1', kind: 'group', title: 'Work', x: 2000, y: 0, w: 900, h: 800 });
        await replaceContent(withGroup);
        const { lines } = await invoke('agent_start', { cli: 'claude', group: 'note-1' });
        expect(lines[0]).toBe('refused\tunknown-group\tnote-1 is not a group on main');
        expect(lines.slice(1)).toEqual(['group\tgroup-1\tWork']);
        expect((await invoke('agent_start', { cli: 'claude', group: 'group-1', beside: 'note-1' })).lines[0]).toStartWith('refused\ttwo-places\t');
    });

    test('a caller that is not a node on the canvas gets no edge', async () => {
        const { lines } = await invoke('agent_start', { cli: 'claude', view: 'board' }, 'chat');
        expect(lines[0]!.split('\t').slice(1)).toEqual(['chat', 'board', 'claude', '-']);
        expect((await canvasOnDisk('board')).edges).toEqual([]);
    });

    test('cwd has to stay inside the project folder', async () => {
        expect((await invoke('agent_start', { cli: 'claude', cwd: outside })).lines[0]).toStartWith('refused\tcwd-outside-project\t');
        const { lines } = await invoke('agent_start', { cli: 'claude', cwd: 'src' });
        const node = (await nodeOnDisk(lines[0]!.split('\t')[0]!))!;
        expect(node.cwd).toBe('./src');
        expect(started.map((start) => start.cwd)).toEqual([join(folder, 'src')]);
    });

    test('a write the store refuses leaves no held prompt and no lineage, and neither does a dry run', async () => {
        knobs.breakWrites = true;
        const { status, lines } = await invoke('agent_start', { cli: 'claude', prompt: 'say hello' });
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tproject-invalid\t');
        knobs.breakWrites = false;
        expect((await invoke('agent_start', { cli: 'claude', prompt: 'say hello', dry_run: true })).status).toBe(200);
        expect((await onDisk()).rev).toBe(1);
        expect(held).toEqual([]);
        expect(started).toEqual([]);
        expect(lineage.openedCount('term-1')).toBe(0);
    });

    test('reads draws a line from every node it names into the new agent', async () => {
        const { status, lines } = await invoke('agent_start', { cli: 'claude', prompt: 'read the note', reads: 'note-1' });
        expect(status).toBe(200);
        const [id, , , , edgeId] = lines[0]!.split('\t');
        const [row, readEdgeId, from, to] = lines[1]!.split('\t');
        expect([row, from, to]).toEqual(['reads', 'note-1', id!]);
        // Into the new agent, the direction that makes the note readable to it, and labelled like every line that lands in one.
        expect((await canvasOnDisk()).edges).toEqual([
            { id: edgeId!, from: 'term-1', to: id!, label: 'context' },
            { id: readEdgeId!, from: 'note-1', to: id!, label: 'context' }
        ]);
    });

    test('the lines of reads are on the canvas before the agent is started', async () => {
        let drawn: string[][] = [];
        knobs.onStart = async () => {
            drawn = (await canvasOnDisk()).edges.map((edge) => [edge.from, edge.to]);
        };
        const { lines } = await invoke('agent_start', { cli: 'claude', prompt: 'read the note', reads: 'note-1' });
        const id = lines[0]!.split('\t')[0]!;
        // One write for the node, its lines and the start, so no first turn ever runs without them.
        expect(drawn).toEqual([
            ['term-1', id],
            ['note-1', id]
        ]);
    });

    test('reads that names the caller is the line agent draws anyway, once', async () => {
        const { lines } = await invoke('agent_start', { cli: 'claude', reads: 'term-1' });
        const [id, , , , edgeId] = lines[0]!.split('\t');
        expect(lines[1]!.split('\t')).toEqual(['reads', edgeId!, 'term-1', id!]);
        expect((await canvasOnDisk()).edges).toEqual([{ id: edgeId!, from: 'term-1', to: id!, label: 'context' }]);
    });

    test('reads refuses an id that is on no canvas and names the nodes that are', async () => {
        const { status, lines } = await invoke('agent_start', { cli: 'claude', reads: 'note-1,ghost' });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect(lines.slice(1)).toEqual(['node\tterm-1\tterminal\tshell', 'node\tnote-1\tnote\tPlan with a tab']);
        expect((await onDisk()).rev).toBe(1);
        expect(started).toEqual([]);
        expect(held).toEqual([]);
    });

    test('reads refuses more than the cap and an empty id', async () => {
        const many = Array.from({ length: MAX_LINKS + 1 }, (_, i) => `n-${i}`).join(',');
        expect((await invoke('agent_start', { cli: 'claude', reads: many })).lines[0]).toStartWith('refused\ttoo-many-links\t');
        expect((await invoke('agent_start', { cli: 'claude', reads: 'note-1,' })).lines[0]).toStartWith('refused\tbad-arguments\t');
        expect((await onDisk()).rev).toBe(1);
    });
});

/* The fields of agent.start a caller may leave out, each of which reads as null when it does. */
const NULLISH_START_FIELDS = [
    'prompt',
    'promptFile',
    'cwd',
    'reads',
    'viewId',
    'beside',
    'group',
    'title',
    'task',
    'model',
    'mode',
    'worktree',
    'branch',
    'requestId',
    'base',
    'machine',
    'effort'
] as const;

/* What a start made, with the ids it minted taken out, so two starts of the same input read the same. */
function startOutcome(result: ActionResult, before: number): unknown {
    const made = started.slice(before).map(({ nodeId: _nodeId, ...start }) => start);
    if (result.status === 'failed') {
        return { failed: result.error.code, made };
    }
    const output = 'output' in result ? (result.output as ActionOutput<'agent.start'>) : null;
    return { status: result.status, kind: output?.kind, viewId: output?.viewId, edge: output?.edge?.from ?? null, made };
}

describe('agent.start takes an absent field as null', () => {
    for (const field of NULLISH_START_FIELDS) {
        test(field, async () => {
            const place = store.locate('term-1')!;
            const base: Record<string, unknown> = {
                ...Object.fromEntries(NULLISH_START_FIELDS.map((name) => [name, null])),
                provider: 'claude',
                terminal: false
            };
            const absent = Object.fromEntries(Object.entries(base).filter(([name]) => name !== field));
            const before = started.length;
            const given = startOutcome(await serverActions.execute('agent.start', base, serverActionCall(host(), place, 'term-1')), before);
            const middle = started.length;
            const left = startOutcome(await serverActions.execute('agent.start', absent, serverActionCall(host(), place, 'term-1')), middle);
            expect(left).toEqual(given);
            expect(given).toMatchObject({ status: 'running', kind: 'chat', viewId: 'main', edge: 'term-1' });
        });
    }
});

describe('agent.start from Voice', () => {
    const VOICE: VoiceCaller = {
        sessionId: 'session-1',
        owner: { clientId: 'client-1', sceneId: 'scene-1' },
        projectId: '',
        timeZone: 'Europe/Amsterdam'
    };
    const voiceStart = {
        provider: 'claude',
        terminal: false,
        prompt: 'Run the tests',
        viewId: null,
        beside: null,
        title: null,
        model: null,
        mode: null,
        requestId: null,
        effort: null
    };

    function voiceCall(canvasId: string | null = 'main', untrusted = false) {
        const place = { projectId, folder, canvasId };
        const withUntrusted: CanvasHost = {
            ...host(),
            untrusted: { node: () => false, inFolder: (path) => untrusted && path === folder, fromPeer: () => false }
        };
        return voiceActionCall(withUntrusted, place, { ...VOICE, projectId });
    }

    test('opens a supervised chat at depth 1 on the canvas of the phone, with no line from anyone', async () => {
        const result = await serverActions.execute('agent.start', voiceStart, voiceCall());
        expect(result).toMatchObject({ status: 'running', output: { kind: 'chat', viewId: 'main', edge: null, taskId: null } });
        const nodeId = (result as { output: ActionOutput<'agent.start'> }).output.nodeId;
        expect(started).toEqual([{ projectId, nodeId, openedBy: 'voice:session-1', node: 'chat', provider: 'claude', cwd: folder }]);
        expect(held).toEqual([{ projectId, nodeId, prompt: 'Run the tests' }]);
        expect([lineage.depthOf(nodeId), lineage.ceilingOf(nodeId), lineage.startedBy(nodeId)]).toEqual([1, 'supervised', 'voice:session-1']);
        expect((await canvasOnDisk()).edges).toEqual([]);
    });

    test('never starts a terminal or a CLI without a chat, and never wider than supervised', async () => {
        expect(await serverActions.execute('agent.start', { ...voiceStart, terminal: true }, voiceCall())).toMatchObject({
            error: { code: 'voice-chat-only' }
        });
        expect(await serverActions.execute('agent.start', { ...voiceStart, provider: 'gemini' }, voiceCall())).toMatchObject({
            error: { code: 'voice-chat-only' }
        });
        expect(await serverActions.execute('agent.start', { ...voiceStart, mode: 'auto' }, voiceCall())).toMatchObject({ error: { code: 'mode-above-voice' } });
        expect(started).toEqual([]);
    });

    test('a folder made from the work of another machine starts nothing that would load its configuration', async () => {
        const result = await serverActions.execute('agent.start', { ...voiceStart, provider: 'codex' }, voiceCall('main', true));
        expect(result).toMatchObject({ status: 'failed', error: { code: 'untrusted-folder' } });
        expect(started).toEqual([]);
        // Claude Code is kept from that configuration, so it starts there as it would for an agent.
        expect(await serverActions.execute('agent.start', voiceStart, voiceCall('main', true))).toMatchObject({ status: 'running' });
    });

    test('a project without a canvas gets a chat view of its own', async () => {
        const result = await serverActions.execute('agent.start', { ...voiceStart, title: 'Tests' }, voiceCall(null));
        expect(result).toMatchObject({ status: 'running', output: { kind: 'chat', viewId: null, edge: null } });
        const nodeId = (result as { output: ActionOutput<'agent.start'> }).output.nodeId;
        expect(await viewOnDisk(nodeId)).toMatchObject({ kind: 'chat', id: nodeId, name: 'Tests', node: { provider: 'claude', providerFixed: true } });
        expect(started.map((start) => start.nodeId)).toEqual([nodeId]);
        expect(store.locate(nodeId)).toMatchObject({ projectId, canvasId: null });
        expect(await serverActions.execute('agent.start', { ...voiceStart, beside: 'term-1' }, voiceCall(null))).toMatchObject({
            error: { code: 'no-canvas' }
        });
    });
});

describe('the mode ceiling', () => {
    test("mode wider than the caller is refused with a code and the caller's mode", async () => {
        knobs.modes = { 'chat-1': 'supervised' };
        const { status, lines } = await invoke('agent_start', { cli: 'claude', mode: 'full-access', view: 'board' }, 'chat');
        expect(status).toBe(422);
        expect(lines[0]).toBe(
            'refused\tmode-above-parent\tYou run in supervised and mode full-access is wider; an agent you open runs in your mode or a narrower one'
        );
        expect(lines.slice(1)).toEqual(['mode\tyou\tsupervised', 'mode\tsupervised\tallowed']);
        const team = await invoke(
            'agent_team',
            { label: 'Crew', mode: 'auto', view: 'board', roles: JSON.stringify([{ provider: 'claude', title: 'One', prompt: 'a' }]) },
            'chat'
        );
        expect(team.lines[0]).toStartWith('refused\tmode-above-parent\t');
        expect((await onDisk()).rev).toBe(1);
        expect((await invoke('agent_start', { cli: 'claude', mode: 'everything' })).lines[0]).toStartWith('refused\tbad-arguments\tmode is one of supervised');
    });

    test('mode at or under the caller is what the agent starts in', async () => {
        knobs.modes = { 'term-1': 'auto' };
        const chat = await invoke('agent_start', { cli: 'claude', mode: 'auto-accept-edits' });
        const terminal = await invoke('agent_start', { cli: 'codex', terminal: true, mode: 'auto' });
        expect(started.map((start) => [start.node, start.runtimeMode])).toEqual([
            ['chat', 'auto-accept-edits'],
            ['terminal', 'auto']
        ]);
        const nodes = (await canvasOnDisk()).nodes;
        expect(nodes.find((node) => node.id === terminal.lines[0]!.split('\t')[0])?.runtimeMode).toBe('auto');
        // A chat keeps its mode in its own thread, not on the node.
        expect(nodes.find((node) => node.id === chat.lines[0]!.split('\t')[0])?.runtimeMode).toBeUndefined();
    });

    test("a terminal agent takes the person's terminal mode narrowed to the caller, and a chat is left to the daemon", async () => {
        knobs.modes = { 'term-1': 'auto-accept-edits' };
        knobs.terminalPreference = 'full-access';
        await invoke('agent_start', { cli: 'claude', terminal: true });
        knobs.terminalPreference = 'supervised';
        await invoke('agent_start', { cli: 'claude', terminal: true });
        await invoke('agent_start', { cli: 'claude' });
        expect(started.map((start) => start.runtimeMode)).toEqual(['auto-accept-edits', 'supervised', undefined]);
        const roles = JSON.stringify([
            { provider: 'claude', title: 'One', prompt: 'a', terminal: true },
            { provider: 'claude', title: 'Two', prompt: 'b' }
        ]);
        started.length = 0;
        await invoke('agent_team', { label: 'Crew', mode: 'supervised', roles });
        expect(started.map((start) => [start.node, start.runtimeMode])).toEqual([
            ['terminal', 'supervised'],
            ['chat', 'supervised']
        ]);
    });
});

describe('worktree', () => {
    test('outside a repository is refused, and so is worktree beside cwd or branch without it', async () => {
        expect((await invoke('agent_start', { cli: 'claude', worktree: true })).lines[0]).toStartWith('refused\tnot-a-repository\t');
        expect((await invoke('agent_start', { cli: 'claude', worktree: true, cwd: 'src' })).lines[0]).toStartWith('refused\tworktree-and-cwd\t');
        expect((await invoke('agent_start', { cli: 'claude', branch: 'x' })).lines[0]).toStartWith('refused\tbranch-needs-worktree\t');
        expect((await invoke('agent_start', { cli: 'claude', base: 'main' })).lines[0]).toStartWith('refused\tbase-needs-worktree\t');
        expect(
            (await invoke('agent_team', { label: 'Crew', worktree: true, roles: JSON.stringify([{ provider: 'claude', title: 'One', prompt: 'a' }]) })).lines[0]
        ).toStartWith('refused\tnot-a-repository\t');
        expect(madeWorktrees).toEqual([]);
    });

    test('every role gets a branch of its own named after it, clear of the branches there are', async () => {
        knobs.branches = ['main', 'lexer'];
        const roles = JSON.stringify([
            { provider: 'claude', title: 'Lexer', prompt: 'a' },
            { provider: 'claude', title: 'Lexer', prompt: 'b' },
            { provider: 'codex', title: 'Parser!', prompt: 'c' }
        ]);
        const { lines } = await invoke('agent_team', { label: 'Crew', worktree: true, roles });
        expect(madeWorktrees.map((made) => made.branch)).toEqual(['lexer-2', 'lexer-3', 'parser']);
        const nodes = (await canvasOnDisk()).nodes;
        const ids = lines.slice(1).map((line) => line.split('\t')[0]);
        expect(ids.map((id) => nodes.find((node) => node.id === id)?.cwd)).toEqual(madeWorktrees.map((made) => made.path));
        expect(started.map((start) => start.cwd)).toEqual(madeWorktrees.map((made) => made.path));
        // The group means "every node made inside it starts here", which a team of worktrees is not.
        expect(nodes.find((node) => node.kind === 'group')?.worktree).toBeUndefined();
    });

    test('a single agent is named after its task, or takes the branch it is given', async () => {
        knobs.branches = ['main'];
        knobs.modes = { 'chat-1': 'full-access' };
        await invoke('agent_start', { cli: 'claude', worktree: true, task: 'Fix the lexer', prompt: 'go', view: 'board' }, 'chat');
        await invoke('agent_start', { cli: 'claude', worktree: true, branch: 'feature/own' });
        expect(madeWorktrees.map((made) => made.branch)).toEqual(['fix-the-lexer', 'feature/own']);
    });

    test('a dry run makes no worktree, and a write the store refuses takes back the ones it made', async () => {
        knobs.branches = ['main'];
        expect((await invoke('agent_start', { cli: 'claude', worktree: true, dry_run: true })).status).toBe(200);
        expect(madeWorktrees).toEqual([]);
        knobs.breakWrites = true;
        expect((await invoke('agent_start', { cli: 'claude', worktree: true })).status).toBe(422);
        expect(removedWorktrees).toEqual(madeWorktrees.map((made) => made.path));
        expect(removedWorktrees).toHaveLength(1);
    });
});

describe('team', () => {
    test('a write the store refuses leaves no held prompt and no lineage for any role', async () => {
        knobs.breakWrites = true;
        const roles = JSON.stringify([
            { provider: 'claude', title: 'One', prompt: 'a' },
            { provider: 'codex', title: 'Two', prompt: 'b' }
        ]);
        const { status, lines } = await invoke('agent_team', { label: 'Crew', roles });
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tproject-invalid\t');
        expect((await onDisk()).rev).toBe(1);
        expect(held).toEqual([]);
        expect(started).toEqual([]);
        expect(lineage.openedCount('term-1')).toBe(0);
    });

    const THREE = [
        { title: 'Lexer', prompt: 'fix the tokenizer', provider: 'claude', terminal: true },
        { title: 'Parser', prompt: 'fix the parser', provider: 'codex' },
        { title: 'Docs', prompt: 'write the docs', provider: 'antigravity', terminal: true }
    ];

    const args = (roles: unknown, label = 'Crew') => ({ label, roles: JSON.stringify(roles) });

    const many = (count: number): unknown[] => Array.from({ length: count }, (_, index) => ({ title: `R${index}`, prompt: 'go', provider: 'claude' }));

    test('opens an agent per role in a group, with an edge into each and every prompt held', async () => {
        const { status, lines } = await invoke('agent_team', args(THREE));
        expect(status).toBe(200);
        expect(lines).toHaveLength(4);

        const [groupId, ...group] = lines[0]!.split('\t');
        expect(groupId).toMatch(/^group-[0-9a-z]{8}$/);
        expect(group).toEqual(['group', 'Crew', 'main', '-', '-']);
        const members = lines.slice(1).map((line) => line.split('\t'));
        // The title is the column that tells two roles of one CLI apart, which the order alone cannot.
        expect(members.map((fields) => fields.slice(1, 5))).toEqual([
            ['terminal', 'Lexer', 'main', 'claude'],
            ['chat', 'Parser', 'main', 'codex'],
            ['terminal', 'Docs', 'main', 'antigravity']
        ]);

        const ids = members.map((fields) => fields[0]!);
        const canvas = await canvasOnDisk();
        const frame = canvas.nodes.find((node) => node.id === groupId)!;
        expect([frame.kind, frame.title]).toEqual(['group', 'Crew']);
        expect(frame.memberIds).toEqual(ids);
        for (const id of ids) {
            const node = canvas.nodes.find((candidate) => candidate.id === id)!;
            expect(node.x + node.w / 2).toBeWithin(frame.x, frame.x + frame.w);
            expect(node.y + node.h / 2).toBeWithin(frame.y, frame.y + frame.h);
        }
        const chat = canvas.nodes.find((node) => node.id === ids[1])!;
        expect([chat.title, chat.titleSource, chat.provider, chat.providerFixed]).toEqual(['Parser', 'user', 'codex', true]);

        expect(canvas.edges.map((edge) => [edge.id, edge.from, edge.to, edge.label])).toEqual(
            ids.map((id, index) => [members[index]![5], 'term-1', id, 'context'])
        );
        expect(held).toEqual(ids.map((id, index) => ({ projectId, nodeId: id, prompt: THREE[index]!.prompt })));
        expect(started.map((start) => [start.nodeId, start.node, start.provider, start.openedBy, start.cwd])).toEqual([
            [ids[0], 'terminal', 'claude', 'term-1', folder],
            [ids[1], 'chat', 'codex', 'term-1', folder],
            [ids[2], 'terminal', 'antigravity', 'term-1', folder]
        ]);
    });

    test('the agents stand beside each other inside the frame, never on top of one another', async () => {
        const { lines } = await invoke('agent_team', args(many(MAX_ROLES)));
        const canvas = await canvasOnDisk();
        const placed = lines.slice(1).map((line) => canvas.nodes.find((node) => node.id === line.split('\t')[0])!);
        for (const node of placed) {
            for (const other of placed) {
                if (node === other) {
                    continue;
                }
                const over = node.x < other.x + other.w && other.x < node.x + node.w && node.y < other.y + other.h && other.y < node.y + node.h;
                expect(over).toBe(false);
            }
        }
        // Four to a row, so a full team stands in as many rows as it has fours.
        expect(new Set(placed.map((node) => node.y)).size).toBe(Math.ceil(MAX_ROLES / TEAM_COLUMNS));
        // The group went beside the caller rather than over the note below it.
        const frame = canvas.nodes.find((node) => node.id === lines[0]!.split('\t')[0])!;
        expect(frame.x).toBe(560 + PLACEMENT_GAP);
    });

    test('roles that are not JSON, too few or too many are refused with the shape', async () => {
        const broken = await invoke('agent_team', { label: 'Crew', roles: '[{"title":]' });
        expect(broken.status).toBe(422);
        expect(broken.lines[0]).toStartWith('refused\tbad-roles-json\troles is not JSON: ');
        expect(broken.lines[1]).toBe(`roles\tshape\t${ROLES_SHAPE}`);

        // The number that came in, not only the one that fits: a refusal that counts is one a caller can act on.
        expect((await invoke('agent_team', args(many(MAX_ROLES + 1)))).lines[0]).toBe(
            `refused\tbad-roles\troles has ${MAX_ROLES + 1} roles and a team takes at most ${MAX_ROLES}`
        );
        expect((await invoke('agent_team', args([]))).lines[0]).toBe(
            `refused\tbad-roles\troles has no roles in it; a team is between 1 and ${MAX_ROLES} of them`
        );
        expect((await invoke('agent_team', args('claude'))).lines[0]).toBe('refused\tbad-roles\troles is a JSON array of roles');
        expect((await onDisk()).rev).toBe(1);
    });

    test('a role that is wrong is named by its place in the array', async () => {
        const cases: Array<[unknown, string]> = [
            [[THREE[0], { title: 'Parser', provider: 'codex' }], 'role 1 (prompt): prompt says what this agent starts working on'],
            [[{ title: 'Lexer', prompt: 'go', provider: 'kimi' }], `role 0 (provider): provider needs a CLI: ${AGENT_KINDS.join(', ')}`],
            [[{ prompt: 'go', provider: 'claude' }], 'role 0 (title): title needs a name for the node'],
            [[THREE[0], { title: 'Parser', prompt: 'go', provider: 'codex', terminal: 'yes' }], 'role 1 (terminal): terminal is true or false'],
            [[{ title: 'Lexer', prompt: 'go', provider: 'claude', chat: true }], 'role 0: Unrecognized key: "chat"'],
            [[{ title: 'Lexer', prompt: 'go', provider: 'claude', cwd: 'src' }], 'role 0: Unrecognized key: "cwd"'],
            [
                [{ title: 'Lexer', prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1), provider: 'claude' }],
                `role 0 (prompt): prompt is ${MAX_PROMPT_LENGTH + 1} characters and at most ${MAX_PROMPT_LENGTH} fit on the line a CLI is started with`
            ],
            [
                [{ title: 'L'.repeat(MAX_TITLE_LENGTH + 1), prompt: 'go', provider: 'claude' }],
                `role 0 (title): title is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
            ]
        ];
        for (const [roles, message] of cases) {
            expect((await invoke('agent_team', args(roles))).lines[0]).toBe(`refused\tbad-roles\t${message}`);
        }
        expect(held).toEqual([]);
        expect((await onDisk()).rev).toBe(1);
    });

    test('a role for a CLI that is not here is refused by index', async () => {
        knobs.installed = ['claude'];
        const gone = await invoke('agent_team', args(THREE));
        expect(gone.lines[0]).toBe('refused\tcli-not-installed\trole 1 (codex): Codex is not installed on this machine');
        expect(gone.lines.slice(1)).toEqual(['cli\tclaude\tClaude Code']);
        expect((await onDisk()).rev).toBe(1);
    });

    test('cwd goes to every role and has to stay inside the project folder', async () => {
        expect((await invoke('agent_team', { ...args(THREE), cwd: outside })).lines[0]).toStartWith('refused\tcwd-outside-project\t');
        const { lines } = await invoke('agent_team', { ...args(THREE), cwd: 'src' });
        const canvas = await canvasOnDisk();
        for (const line of lines.slice(1)) {
            expect(canvas.nodes.find((node) => node.id === line.split('\t')[0])!.cwd).toBe('./src');
        }
    });

    test('a caller that is not a node on the canvas gets a team without edges', async () => {
        const { lines } = await invoke('agent_team', { ...args(THREE), view: 'board' }, 'chat');
        expect(lines.every((line) => line.split('\t')[3] === 'board')).toBe(true);
        // No caller on that canvas, so no edge to name in the last column either.
        expect(lines.every((line) => line.split('\t')[5] === '-')).toBe(true);
        expect((await canvasOnDisk('board')).edges).toEqual([]);
        expect(held).toHaveLength(3);
    });

    test('dry_run names every role it would open and writes nothing', async () => {
        const { status, lines } = await invoke('agent_team', { ...args(THREE), dry_run: true });
        expect(status).toBe(200);
        expect(lines).toEqual([
            'dry-run\tgroup\tCrew\tmain\t-\t-',
            'dry-run\tterminal\tLexer\tmain\tclaude\tterm-1 -> <Lexer>',
            'dry-run\tchat\tParser\tmain\tcodex\tterm-1 -> <Parser>',
            'dry-run\tterminal\tDocs\tmain\tantigravity\tterm-1 -> <Docs>'
        ]);
        expect((await onDisk()).rev).toBe(1);
        expect(held).toEqual([]);
        expect(lineage.openedCount('term-1')).toBe(0);
    });

    test('two roles of one CLI are two rows a reader can tell apart', async () => {
        const pair = [
            { title: 'Lexer', prompt: 'fix the tokenizer', provider: 'claude' },
            { title: 'Reviewer', prompt: 'review the Lexer', provider: 'claude' }
        ];
        const dry = await invoke('agent_team', { ...args(pair), dry_run: true });
        expect(dry.lines.slice(1)).toEqual([
            'dry-run\tchat\tLexer\tmain\tclaude\tterm-1 -> <Lexer>',
            'dry-run\tchat\tReviewer\tmain\tclaude\tterm-1 -> <Reviewer>'
        ]);
        const { lines } = await invoke('agent_team', args(pair));
        expect(lines.slice(1).map((line) => line.split('\t')[2])).toEqual(['Lexer', 'Reviewer']);
    });

    test('a label is not unique and a label or a title past the cap is refused', async () => {
        const first = await invoke('agent_team', args(THREE, 'Crew'));
        const again = await invoke('agent_team', args(THREE, 'Crew'));
        expect([first.status, again.status]).toEqual([200, 200]);
        expect((await canvasOnDisk()).nodes.filter((node) => node.kind === 'group' && node.title === 'Crew')).toHaveLength(2);

        const long = 'L'.repeat(MAX_TITLE_LENGTH + 1);
        expect((await invoke('agent_team', args(THREE, long))).lines[0]).toBe(
            `refused\tbad-arguments\tlabel is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        );
        expect((await invoke('agent_start', { cli: 'claude', title: long })).lines[0]).toBe(
            `refused\tbad-arguments\ttitle is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        );
        expect((await invoke('node_new', { kind: 'note', title: long })).lines[0]).toBe(
            `refused\tbad-arguments\ttitle is ${MAX_TITLE_LENGTH + 1} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        );
        expect((await invoke('link_new', { to: 'note-1', label: long })).lines[0]).toStartWith(
            `refused\tbad-arguments\tlabel is ${MAX_TITLE_LENGTH + 1} characters`
        );
        // A name of exactly the cap is a name, not a refusal.
        expect((await invoke('node_new', { kind: 'note', title: 'L'.repeat(MAX_TITLE_LENGTH) })).status).toBe(200);
    });

    test('reads draws a line from every node it names into every role', async () => {
        const { lines } = await invoke('agent_team', { ...args(THREE.slice(0, 2)), reads: 'note-1' });
        const ids = lines.slice(1, 3).map((line) => line.split('\t')[0]!);
        expect(lines.slice(3).map((line) => line.split('\t'))).toEqual([
            ['reads', expect.any(String), 'note-1', ids[0]!],
            ['reads', expect.any(String), 'note-1', ids[1]!]
        ]);
        const canvas = await canvasOnDisk();
        expect(canvas.edges.filter((edge) => edge.from === 'note-1')).toEqual(
            ids.map((id) => ({ id: expect.any(String), from: 'note-1', to: id, label: 'context' }))
        );
    });

    test('reads is refused for a team the same way it is for one agent', async () => {
        const { status, lines } = await invoke('agent_team', { ...args(THREE), reads: 'ghost' });
        expect(status).toBe(422);
        expect(lines[0]).toBe('refused\tunknown-node\tghost is not a node on main');
        expect((await onDisk()).rev).toBe(1);
        expect(started).toEqual([]);
    });
});

describe('the depth limit', () => {
    const args = (label: string) => ({ label, roles: JSON.stringify([{ title: 'Lexer', prompt: 'go', provider: 'claude' }]) });

    /* The team a person's own agent opens, and a token for the first of its members. */
    const openTeam = async (label = 'Crew', token = 'term'): Promise<string> => {
        const { lines } = await invoke('agent_team', args(label), token);
        const member = lines[1]!.split('\t')[0]!;
        TOKENS.member = member;
        return member;
    };

    test('a person opens a team, its members open none, and a restart does not forget that', async () => {
        const member = await openTeam();
        expect(lineage.depthOf(member)).toBe(MAX_TEAM_DEPTH);

        const refused = await invoke('agent_team', args('Subcrew'), 'member');
        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe(
            `refused\ttoo-deep\tYou sit at depth ${MAX_TEAM_DEPTH} and agent_team would open agents at depth ${MAX_TEAM_DEPTH + 1}; agent_team opens up to depth ${MAX_TEAM_DEPTH}`
        );
        expect(refused.lines.slice(1)).toEqual([
            `depth\tyou\t${MAX_TEAM_DEPTH}`,
            'depth\t0\ta node a person opened',
            `depth\tagent_start\topens up to depth ${MAX_AGENT_DEPTH}`,
            `depth\tagent_team\topens up to depth ${MAX_TEAM_DEPTH}`
        ]);

        // The depths are on disk, which is the moment a loop would otherwise start counting over.
        await reloadLineage();
        expect(lineage.depthOf(member)).toBe(MAX_TEAM_DEPTH);
        expect((await invoke('agent_team', args('Subcrew'), 'member')).lines[0]).toStartWith('refused\ttoo-deep\t');
    });

    test('a member may still open one agent, and that one may open none', async () => {
        await openTeam();
        const opened = await madeId(invoke('agent_start', { cli: 'claude' }, 'member'));
        expect(lineage.depthOf(opened)).toBe(MAX_AGENT_DEPTH);

        TOKENS.deep = opened;
        const refused = await invoke('agent_start', { cli: 'claude' }, 'deep');
        expect(refused.lines[0]).toBe(
            `refused\ttoo-deep\tYou sit at depth ${MAX_AGENT_DEPTH} and agent_start would open agents at depth ${MAX_AGENT_DEPTH + 1}; agent_start opens up to depth ${MAX_AGENT_DEPTH}`
        );
        expect(lineage.openedCount(opened)).toBe(0);
    });

    test('one caller may not run away with a canvas, however deep it sits', async () => {
        for (let index = 0; index < MAX_OPENED_PER_CALLER; index += 1) {
            await lineage.put({ projectId, nodeId: `stub-${index}`, openedBy: 'term-1', depth: 1, agent: true });
        }
        const refused = await invoke('agent_start', { cli: 'claude' });
        expect(refused.lines[0]).toBe(
            `refused\ttoo-many-agents\tYou have ${MAX_OPENED_PER_CALLER} agents open and this would open 1 more; one caller may have ${MAX_OPENED_PER_CALLER} open at a time. Removing a canvas node or finishing a hidden agent frees the count`
        );
        expect((await invoke('agent_team', args('Crew'))).lines[0]).toStartWith('refused\ttoo-many-agents\t');
        expect((await onDisk()).rev).toBe(1);

        // The nodes a person removed free the count again.
        await lineage.prune(projectId, new Set(['stub-0', 'stub-1']));
        expect((await invoke('agent_team', args('Crew'))).status).toBe(200);
        expect((await onDisk()).rev).toBe(2);
    });

    test('calls at the same moment are counted one after the other', async () => {
        const answers = await Promise.all(Array.from({ length: MAX_OPENED_PER_CALLER + 4 }, () => invoke('agent_start', { cli: 'claude' })));
        expect(answers.filter((answer) => answer.status === 200)).toHaveLength(MAX_OPENED_PER_CALLER);
        expect(answers.filter((answer) => answer.lines[0]?.startsWith('refused\ttoo-many-agents\t'))).toHaveLength(4);
        expect(lineage.openedCount('term-1')).toBe(MAX_OPENED_PER_CALLER);
    });
});

describe('dry_run', () => {
    test('agent checks everything, prints what it would make and writes nothing', async () => {
        const { status, lines } = await invoke('agent_start', { cli: 'claude', prompt: 'hi', dry_run: true });
        expect(status).toBe(200);
        expect(lines).toEqual([`dry-run\tchat\tmain\tclaude\tterm-1 -> ${NEW_NODE}`]);
        expect((await onDisk()).rev).toBe(1);
        expect(held).toEqual([]);
    });

    test('agent names the lines reads would draw and draws none of them', async () => {
        const { lines } = await invoke('agent_start', { cli: 'claude', reads: 'note-1', dry_run: true });
        expect(lines).toEqual([`dry-run\tchat\tmain\tclaude\tterm-1 -> ${NEW_NODE}`, `dry-run\treads\tnote-1 -> ${NEW_NODE}`]);
        expect((await onDisk()).rev).toBe(1);
        // A dry run refuses what a real one would, so an id that names nothing never prints a plan.
        expect((await invoke('agent_start', { cli: 'claude', reads: 'ghost', dry_run: true })).lines[0]).toStartWith('refused\tunknown-node\t');
    });

    test('a dry run still refuses what a real one would', async () => {
        knobs.installed = ['codex'];
        expect((await invoke('agent_start', { cli: 'claude', dry_run: true })).lines[0]).toStartWith('refused\tcli-not-installed\t');
        knobs.installed = ['claude'];
        expect((await invoke('agent_start', { cli: 'claude', group: 'note-1', dry_run: true })).lines[0]).toStartWith('refused\tunknown-group\t');
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

    test('agent opens on a canvas of the other project, in its folder, never wider than its caller', async () => {
        knobs.modes = { 'term-1': 'supervised' };
        expect((await invoke('agent_start', { cli: 'claude', project: otherId }, 'term', reaching())).lines[0]).toStartWith('refused\tview-required\t');
        const made = await invoke('agent_start', { cli: 'claude', project: otherId, view: 'work', mode: 'full-access' }, 'term', reaching());
        expect(made.lines[0]).toStartWith('refused\tmode-above-parent\t');
        const id = await madeId(invoke('agent_start', { cli: 'claude', project: otherId, view: 'work' }, 'term', reaching()));
        const placed = (await store.read(otherId)).views.find((view): view is ProjectCanvasView => view.id === 'work')!;
        expect(placed.nodes.map((node) => node.id)).toContain(id);
        expect(placed.edges).toEqual([]);
        expect(started.at(-1)).toMatchObject({ projectId: otherId, nodeId: id, openedBy: 'term-1', cwd: other });
        expect(lineage.madeBy(id)).toBe('term-1');
        expect(lineage.ceilingOf(id)).toBe('supervised');
        expect((await canvasOnDisk()).nodes.map((node) => node.id)).not.toContain(id);
    });

    test('cwd stays inside the other project and machine works only from the own one', async () => {
        const outsideCwd = await invoke('agent_start', { cli: 'claude', project: otherId, view: 'work', cwd: folder }, 'term', reaching());
        expect(outsideCwd.lines[0]).toStartWith('refused\tcwd-outside-project\t');
        const remote = await invoke('agent_start', { cli: 'claude', project: otherId, view: 'work', machine: 'm', task: 't', prompt: 'p' }, 'term', reaching());
        expect(remote.lines[0]).toStartWith('refused\tcross-project-refused\t');
    });

    test('a chat gives a task in the other project, judged a chat in its own', async () => {
        const made = await invoke('agent_start', { cli: 'claude', project: otherId, view: 'work', task: 'Look', prompt: 'look around' }, 'chat', reaching());
        expect(made.status).toBe(200);
        const [id, , , , , taskId] = made.lines[0]!.split('\t');
        expect(tasks.get(taskId!)).toMatchObject({ parentId: 'chat-1', childId: id, projectId: otherId });
        const terminal = await invoke('agent_start', { cli: 'claude', project: otherId, view: 'work', task: 'Look', prompt: 'p' }, 'term', reaching());
        expect(terminal.lines[0]).toStartWith('refused\tnot-a-chat-parent\t');
    });
});
