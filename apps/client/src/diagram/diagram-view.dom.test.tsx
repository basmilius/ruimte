import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DiagramDocument, ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const FLOW: ProjectView = { kind: 'diagram', id: 'diagram-flow', name: 'Flow' };
const EMPTY: DiagramDocument = { version: 1, rev: 2, meta: { title: 'Flow', direction: 'right' }, nodes: [], groups: [], edges: [] };
const EMPTY_HINT = 'Empty diagram. An agent can fill it for you.';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function labels(): string[] {
    return [...page.host.querySelectorAll('svg[role="img"] text')].map((text) => text.textContent ?? '');
}

function tile(title: string): HTMLElement | null {
    return ([...page.host.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.includes(title)) ?? null;
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('diagram.open', () => ({ document: EMPTY }));
    machine.answer('diagram.save', ({ baseRev }) => ({ rev: baseRev + 1 }));
    workspace = await openFakeWorkspace(machine, { views: [FLOW] }, { activeViewId: FLOW.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => machine.requests('diagram.open').length > 0 && page.host.textContent?.includes(EMPTY_HINT) === true);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a diagram view', () => {
    test('opens the diagram it names and offers a start for an empty one', () => {
        expect(machine.requests('diagram.open')[0]).toEqual({ projectId: 'project-atlas', viewId: FLOW.id });
        expect(page.host.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Flow');
        expect(tile('Ask an agent')).not.toBeNull();
        expect(tile('Insert example')).not.toBeNull();
    });

    test('the example draws its nodes and is saved over the rev it read', async () => {
        await clickOn(tile('Insert example'));
        await until(() => labels().includes('Idea'));
        expect(labels()).toEqual(expect.arrayContaining(['The work', 'Idea', 'Plan', 'Build', 'Review', 'Ship']));
        expect(page.host.textContent).not.toContain(EMPTY_HINT);

        // Leaving the window writes what is pending at once, instead of after the save delay.
        await act(async () => {
            window.dispatchEvent(new Event('beforeunload'));
        });
        await until(() => machine.requests('diagram.save').length > 0);
        const [saved] = machine.requests('diagram.save');
        expect(saved).toMatchObject({ projectId: 'project-atlas', viewId: FLOW.id, baseRev: 2 });
        expect(saved!.content.nodes.map((node) => node.id)).toEqual(['idea', 'plan', 'build', 'review', 'ship']);
        expect(saved!.content.meta.title).toBe('Flow');
    });

    test('a diagram the machine announces is drawn in place of the empty one', async () => {
        await act(async () => {
            machine.emit('diagram.changed', {
                projectId: 'project-atlas',
                viewId: FLOW.id,
                document: { ...EMPTY, rev: 3, nodes: [{ id: 'only', label: 'From the agent' }] }
            });
        });
        await until(() => labels().includes('From the agent'));
        expect(page.host.textContent).not.toContain(EMPTY_HINT);
        expect(machine.requests('diagram.save')).toEqual([]);
    });
});
