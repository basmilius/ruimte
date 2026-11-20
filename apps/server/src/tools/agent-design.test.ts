import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canvasFixture, type CanvasFixture } from './canvas-fixture-test-helpers.ts';

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
            fx.invoke('agent_start', { cli: 'claude', design: true, prompt: 'a design' }, 'chat')
        ]);

        expect(refusals.map((refusal) => refusal.lines[0])).toEqual([
            'refused\tdesign-needs-chat\tdesign makes a chat agent the designer, whose last answer names its pages; leave out terminal and pick a cli with a chat',
            'refused\tdesign-off-canvas\tdesign starts a hidden agent, which stands on no canvas; leave out view',
            'refused\tdesign-off-canvas\tdesign starts a hidden agent, which stands on no canvas; leave out view and beside',
            'refused\tdesign-needs-task\tdesign gives the agent a task, whose result names its pages; add task and prompt'
        ]);
        expect(fx.started).toEqual([]);
        expect(fx.store.hiddenAgents.all()).toEqual([]);
    });

    test('is refused from a node on a canvas, which opens no hidden agent', async () => {
        const { lines } = await fx.invoke('agent_start', DESIGN_START, 'term');

        expect(lines[0]).toBe(
            'refused\tdesign-off-canvas\tdesign starts a hidden agent, which only a chat view opens; from a canvas, start the agent without design'
        );
    });
});
