import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { isCanvasView, type ProjectCanvasView, type ProjectNode, type ProjectSavePayload, type ProjectView } from '@ruimte/contracts';
import { moveNodeToViewAction } from '@/actions/client-actions';
import { setViewShared } from '@/project/views';
import { useToasts } from '@/state/toasts';
import { windowWorkspace } from '@/state/window';
import { TransportError } from '@/transport/transport';
import { chatInfoOf } from '../../testing/chat-info';
import { layOutChat, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const TAKEN = '"Pricing" cannot move its pages to .ruimte/designs/pricing, because another design already has a folder there. Nothing was saved.';

function design(id: string, path: string): ProjectNode {
    return { id, kind: 'design', title: 'Pricing', titleSource: 'user', x: 0, y: 0, w: 480, h: 640, provider: 'claude', path };
}

function canvas(id: string, nodes: ProjectNode[]): ProjectCanvasView {
    return { kind: 'canvas', id, name: id, nodes, texts: [], edges: [], layouts: [] };
}

// One person's canvas and the team's, each with a design in a folder named `pricing`, and the same for two design views.
const VIEWS: ProjectView[] = [
    canvas('main', [design('board', 'pricing')]),
    canvas('team', [design('team-board', 'pricing')]),
    { kind: 'design', id: 'landing', name: 'Landing', path: 'landing', node: { provider: 'claude' } },
    { kind: 'design', id: 'team-landing', name: 'Team landing', path: 'landing', node: { provider: 'claude' } }
];

let machine: FakeMachine;
let workspace: FakeWorkspace;
let mounted: Mounted;
let restoreLayout: () => void;

beforeEach(async () => {
    localStorage.clear();
    useToasts.setState({ toasts: [] });
    restoreLayout = layOutChat();
    machine = new FakeMachine();
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    let refused = false;
    // Refuses the first save, the way a machine refuses a folder another design has, and takes every one after.
    machine.answer('project.save', ({ baseRev }) => {
        if (!refused) {
            refused = true;
            throw new TransportError('design-folder-taken', TAKEN);
        }

        return { rev: baseRev + 1 } as never;
    });
    workspace = await openFakeWorkspace(machine, { views: VIEWS, shared: ['team', 'team-landing'] }, { activeViewId: 'main', views: {} });
    mounted = mount();
    await mounted.renderApp();
});

afterEach(async () => {
    await mounted.unmount();
    workspace.close();
    restoreLayout();
});

/* Saves what is on screen, refused or not, and answers the payload of the last save. */
async function saved(): Promise<ProjectSavePayload> {
    await act(async () =>
        windowWorkspace()!
            .connection.projects.flush()
            .catch(() => undefined)
    );
    await until(() => machine.requests('project.save').length > 0);

    return machine.requests('project.save').at(-1)!;
}

function nodesOn(payload: ProjectSavePayload, canvasId: string): string[] {
    const view = payload.content.views.find((candidate) => candidate.id === canvasId);

    return view !== undefined && isCanvasView(view) ? view.nodes.map((node) => node.id) : [];
}

describe('a save refused because a design folder is taken', () => {
    test('puts a shared design view back in the private file, says why, and the next save goes through', async () => {
        await act(async () => setViewShared('landing', true));
        const refused = await saved();
        expect(refused.shared).toContain('landing');

        const next = await saved();

        expect(machine.requests('project.save')).toHaveLength(2);
        expect(next.shared).not.toContain('landing');
        expect(next.shared).toContain('team-landing');
        expect(useToasts.getState().toasts.some((toast) => toast.kind === 'error' && toast.description === TAKEN)).toBe(true);
    });

    test('moves a design node back to the canvas it came from', async () => {
        await act(async () => moveNodeToViewAction('board', 'team'));
        const refused = await saved();
        expect(nodesOn(refused, 'team')).toContain('board');

        const next = await saved();

        expect(nodesOn(next, 'main')).toEqual(['board']);
        expect(nodesOn(next, 'team')).toEqual(['team-board']);
        expect(next.shared).toEqual(['team', 'team-landing']);
    });
});
