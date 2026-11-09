import { afterEach, beforeEach, describe, test } from 'bun:test';
import { useChats } from '@adecore/agents-react/state';
import type { ChatInfo, ProjectView, Task } from '@ruimte/contracts';
import { act } from 'react';
import { useEndpoints } from '@/state/endpoints';
import { useTasks } from '@/state/tasks';
import { chatInfoOf } from '../../testing/chat-info';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const LEAD: ProjectView = { kind: 'chat', id: 'lead', name: 'Release plan', node: {} };
const HELPER: ProjectView = { kind: 'chat', id: 'helper', name: 'Changelog draft', node: {} };

const TASK: Task = {
    id: 'task-changelog',
    projectId: 'project',
    parentId: LEAD.id,
    childId: HELPER.id,
    title: 'Draft the changelog',
    prompt: 'Draft the changelog',
    status: 'open',
    result: null,
    createdAt: 1,
    settledAt: null,
    wake: 'pending'
};

let workspace: FakeWorkspace;
let page: Mounted;

function leadRow(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`[data-sidebar-row="view:${LEAD.id}"]`);
}

/* A chat between turns as its machine reports it, with what the test adds; a chat in a closed view is in the store as well. */
async function setChat(id: string, patch: Partial<ChatInfo> = {}): Promise<void> {
    const key = `${useEndpoints.getState().activeId}:${id}`;

    await act(async () => {
        useChats.setState((state) => ({
            statusByKey: { ...state.statusByKey, [key]: { info: { ...(state.statusByKey[key]?.info ?? chatInfoOf(id)), status: 'idle', ...patch } } }
        }));
    });
}

async function putTask(task: Task): Promise<void> {
    await act(async () => {
        useTasks.getState().putTask(useEndpoints.getState().activeId, task);
    });
}

beforeEach(async () => {
    workspace = await openFakeWorkspace(new FakeMachine(), { views: [LEAD, HELPER] }, { activeViewId: LEAD.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => leadRow() !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    useTasks.setState({ byEndpoint: {} });
});

describe('a chat between turns that still has work going on', () => {
    test('reads as working while a command it started runs in the background', async () => {
        await setChat(LEAD.id, { background: [{ id: 'b1', kind: 'shell', description: 'Run the tests', command: 'bun test', startedAt: 1 }] });
        await until(() => leadRow()!.querySelector('[aria-label="Working in the background"]') !== null);
    });

    test('reads as working while a child agent it gave a task is not done', async () => {
        await setChat(LEAD.id);
        await putTask(TASK);
        await until(() => leadRow()!.querySelector('[aria-label="Working in the background"]') !== null);

        await putTask({ ...TASK, status: 'done', settledAt: 2 });
        await until(() => leadRow()!.querySelector('[aria-label="Working in the background"]') === null);
    });

    test('says on its own row that its child agent needs you', async () => {
        await setChat(LEAD.id);
        await putTask(TASK);
        await setChat(HELPER.id, { status: 'needs-you' });
        await until(() => leadRow()!.textContent!.includes('sub-agent'));
    });

    test('says on its own row that its child agent is paused on a limit', async () => {
        await putTask({ ...TASK, paused: { kind: 'usage' } });
        await until(() => leadRow()!.textContent!.includes('paused'));
    });
});
