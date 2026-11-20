import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { refuseDesignStart } from '../canvas/design-agent.ts';
import { canvasFixture, type CanvasFixture, TOKENS } from './canvas-fixture-test-helpers.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

const DESIGN_START = { cli: 'claude', design: true, task: 'Onboarding screens', prompt: 'Three onboarding screens for the phone app' };

describe('a design agent', () => {
    test('works in a free private design folder that its brief, the answer and its hidden record name', async () => {
        await mkdir(join(fx.folder, '.ruimte', 'private', 'designs', 'onboarding-screens'), { recursive: true });

        const { status, lines } = await fx.invoke('agent_start', DESIGN_START, 'chat');

        expect(status).toBe(200);
        const nodeId = lines[0]!.split('\t')[0]!;
        const folder = '.ruimte/private/designs/onboarding-screens-2';
        expect(lines).toContain(`design\t${folder}\tthe folder its pages go in; its result names them`);
        expect(fx.store.hiddenAgents.get(nodeId)).toMatchObject({ openedBy: 'chat-1', design: folder });
        expect(fx.held).toHaveLength(1);
        expect(fx.held[0]!.prompt).toBe(DESIGN_START.prompt);
        expect(fx.held[0]!.brief).toContain(`\`${folder}\``);
        expect(fx.held[0]!.brief).toContain('a descriptive name, such as `Onboarding.html`');
        expect(fx.held[0]!.brief).not.toContain('index.html');
    });

    test('hears the craft of a Design view in its board form, and nothing about a person beside it', async () => {
        await fx.invoke('agent_start', DESIGN_START, 'chat');

        const brief = fx.held[0]!.brief!;
        expect(brief).toContain('<meta name="ruimte-design" content="canvas">');
        expect(brief).toContain('id="ruimte-tweaks"');
        expect(brief).toContain('ask nothing');
        expect(brief).not.toContain('question tool');
        expect(brief).not.toContain('beside this chat');
    });

    test('of a second start gets a folder of its own while the first has not written any', async () => {
        const first = await fx.invoke('agent_start', DESIGN_START, 'chat');
        const second = await fx.invoke('agent_start', DESIGN_START, 'chat');

        expect(first.lines).toContain('design\t.ruimte/private/designs/onboarding-screens\tthe folder its pages go in; its result names them');
        expect(second.lines).toContain('design\t.ruimte/private/designs/onboarding-screens-2\tthe folder its pages go in; its result names them');
    });

    test('never runs in a wider mode than the chat that opened it', async () => {
        fx.knobs.modes = { 'chat-1': 'supervised' };

        const wider = await fx.invoke('agent_start', { ...DESIGN_START, mode: 'full-access' }, 'chat');
        const own = await fx.invoke('agent_start', DESIGN_START, 'chat');

        expect(wider.lines[0]).toStartWith('refused\tmode-above-parent\t');
        expect(fx.lineage.ceilingOf(own.lines[0]!.split('\t')[0]!)).toBe('supervised');
    });

    test('is refused anywhere but a hidden chat agent with a task, saying what the call would take', async () => {
        const refusals = await Promise.all([
            fx.invoke('agent_start', { ...DESIGN_START, terminal: true }, 'chat'),
            fx.invoke('agent_start', { ...DESIGN_START, view: 'board' }, 'chat'),
            fx.invoke('agent_start', { ...DESIGN_START, view: 'board', beside: 'term-1' }, 'chat'),
            fx.invoke('agent_start', { ...DESIGN_START, reads: 'note-1' }, 'chat'),
            fx.invoke('agent_start', { cli: 'claude', design: true, prompt: 'a design' }, 'chat')
        ]);

        expect(refusals.map((refusal) => refusal.lines[0])).toEqual([
            'refused\tdesign-needs-chat\tdesign makes a chat agent the designer, whose last answer names its pages; leave out terminal and pick a cli with a chat',
            'refused\tdesign-off-canvas\tdesign starts a hidden agent, which stands on no canvas and opens from the card in your thread; leave out view',
            'refused\tdesign-off-canvas\tdesign starts a hidden agent, which stands on no canvas and opens from the card in your thread; leave out view and beside',
            'refused\tdesign-off-canvas\tdesign starts a hidden agent, which stands on no canvas and opens from the card in your thread; leave out reads',
            'refused\tdesign-needs-task\tdesign gives the agent a task, whose result names its pages; add task and prompt'
        ]);
        expect(fx.started).toEqual([]);
        expect(fx.store.hiddenAgents.all()).toEqual([]);
    });

    test('is refused from a terminal on a canvas, which gives no task', async () => {
        const { lines } = await fx.invoke('agent_start', DESIGN_START, 'term');

        expect(lines[0]).toStartWith('refused\tnot-a-chat-parent\t');
        expect(fx.store.hiddenAgents.all()).toEqual([]);
    });
});

describe('a design agent of a chat node on a canvas', () => {
    beforeEach(async () => {
        await fx.store.mutate(fx.projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) =>
                    view.id === 'main' && view.kind === 'canvas'
                        ? { ...view, nodes: [...view.nodes, { id: 'chat-node', kind: 'chat' as const, title: 'Lead', x: 900, y: 0, w: 560, h: 360 }] }
                        : view
                )
            },
            result: undefined
        }));
        TOKENS.node = 'chat-node';
    });

    afterEach(() => {
        delete TOKENS.node;
    });

    test("stays hidden: no node or line on the canvas, and its task is the chat node's", async () => {
        const before = await fx.canvasOnDisk();

        const { status, lines } = await fx.invoke('agent_start', DESIGN_START, 'node');

        expect(status).toBe(200);
        const [nodeId, kind, viewId, , edge, taskId] = lines[0]!.split('\t');
        expect([kind, viewId, edge]).toEqual(['chat', '-', '-']);
        expect(lines).toContain('design\t.ruimte/private/designs/onboarding-screens\tthe folder its pages go in; its result names them');
        expect(await fx.canvasOnDisk()).toEqual(before);
        expect(fx.store.index.locate(nodeId!)).toMatchObject({ canvasId: null });
        expect(fx.store.hiddenAgents.get(nodeId!)).toMatchObject({ openedBy: 'chat-node', design: '.ruimte/private/designs/onboarding-screens' });
        expect(fx.tasks.get(taskId!)).toMatchObject({ parentId: 'chat-node', childId: nodeId });
        expect(fx.lineage.startedBy(nodeId!)).toBe('chat-node');
    });

    test('never runs in a wider mode than the chat node that opened it', async () => {
        fx.knobs.modes = { 'chat-node': 'supervised' };

        const wider = await fx.invoke('agent_start', { ...DESIGN_START, mode: 'full-access' }, 'node');
        const own = await fx.invoke('agent_start', DESIGN_START, 'node');

        expect(wider.lines[0]).toStartWith('refused\tmode-above-parent\t');
        expect(fx.lineage.ceilingOf(own.lines[0]!.split('\t')[0]!)).toBe('supervised');
    });

    test('is refused where it would stand on the canvas', async () => {
        const refusals = await Promise.all([
            fx.invoke('agent_start', { ...DESIGN_START, beside: 'term-1' }, 'node'),
            fx.invoke('agent_start', { ...DESIGN_START, view: 'main' }, 'node')
        ]);

        expect(refusals.map((refusal) => refusal.lines[0])).toEqual([
            'refused\tdesign-off-canvas\tdesign starts a hidden agent, which stands on no canvas and opens from the card in your thread; leave out beside',
            'refused\tdesign-off-canvas\tdesign starts a hidden agent, which stands on no canvas and opens from the card in your thread; leave out view'
        ]);
        expect(fx.store.hiddenAgents.all()).toEqual([]);
    });
});

describe('refusing design', () => {
    test('from Voice or an extension, which have no thread to show its card in', () => {
        const start = { terminal: false, view: false, beside: false, group: false, reads: false, machine: false, task: true, bounded: true, chat: true };

        expect(() => refuseDesignStart(start)).toThrow(
            'design shows its pages in the thread of the chat that starts it, and you have none; start the agent without design'
        );
    });
});
