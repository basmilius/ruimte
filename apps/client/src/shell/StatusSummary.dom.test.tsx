import { afterEach, describe, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectView } from '@ruimte/contracts';
import { useChats } from '@adecore/agents-react/state';
import { useDocument } from '@/state/document';
import { endpointKey, splitKey } from '@/state/keys';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [{ id: 'asking', kind: 'chat', title: 'Asking', x: 0, y: 0, w: 560, h: 360 }],
    texts: [],
    edges: [],
    layouts: []
};
const LATER: ProjectView = { kind: 'chat', id: 'later', name: 'Later', node: {} };

let workspace: FakeWorkspace;
let page: Mounted;

function waitingCount(): string | null {
    return page.host.querySelector('button[aria-label="Next node that needs you, in any view"]')?.textContent ?? null;
}

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the count of what needs you in the dock', () => {
    test('counts a node that comes into the project while no chat changed', async () => {
        workspace = await openFakeWorkspace(new FakeMachine(), { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
        page = mount();
        await page.renderApp();
        await until(() => Object.keys(useChats.getState().statusByKey).some((key) => splitKey(key).id === 'asking'));
        await act(async () => {
            useChats.setState((state) => {
                const [key, row] = Object.entries(state.statusByKey).find(([each]) => splitKey(each).id === 'asking')!;
                const waiting = { ...row, info: { ...row.info, status: 'needs-you' as const } };
                return { statusByKey: { ...state.statusByKey, [key]: waiting, [endpointKey(splitKey(key).endpointId, LATER.id)]: waiting } };
            });
        });
        await until(() => waitingCount() === '1');

        await act(async () => useDocument.setState((state) => ({ views: [...state.views, LATER] })));
        await until(() => waitingCount() === '2');
    });
});
