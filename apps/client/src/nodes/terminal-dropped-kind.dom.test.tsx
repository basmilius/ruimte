import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

// Antigravity replaced Gemini as a terminal agent, and a project may still hold a Gemini node.
const DROPPED: ProjectNode = { id: 'old-agent', kind: 'terminal', title: 'Gemini', provider: 'gemini', x: 0, y: 0, w: 560, h: 360 } as ProjectNode;
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [DROPPED], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a terminal node of a CLI the machine no longer offers', () => {
    test('still opens its terminal and asks the machine for its own kind, leaving the stored provider alone', async () => {
        await until(() => page.host.querySelector(`[data-node-id="${DROPPED.id}"] textarea`) !== null);
        await until(() => machine.requests('session.create').length > 0);
        expect(machine.requests('session.create')[0]).toMatchObject({ sessionId: DROPPED.id, agent: { kind: 'gemini' } });
        const stored = useDocument
            .getState()
            .exportViews()
            .find((view) => view.id === MAIN.id) as ProjectCanvasView;
        expect(stored.nodes.find((node) => node.id === DROPPED.id)).toEqual(DROPPED);
        for (const save of machine.requests('project.save')) {
            expect(JSON.stringify(save)).not.toContain('"provider":"antigravity"');
        }
    });
});
