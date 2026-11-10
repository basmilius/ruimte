import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

const SHELL = { id: 'b1', kind: 'shell' as const, description: 'Run the tests', command: 'bun test', startedAt: 1 };
const MONITOR = { id: 'b2', kind: 'monitor' as const, description: 'Watch CI', command: null, startedAt: 2 };

/* The mark of commands left running, named by what the chat waits on. */
function backgroundMark(): Element | null {
    return leadRow()!.querySelector('[role="img"][aria-label^="Run the tests · "], [role="img"][aria-label^="Watch CI · "]');
}

describe('a chat between turns that still has work going on', () => {
    test('marks a shell it left running with the terminal icon, named by the command and its age', async () => {
        await setChat(LEAD.id, { background: [SHELL] });
        await until(() => backgroundMark()?.querySelector('.lucide-square-terminal') != null);
        expect(leadRow()!.querySelector('[aria-label="Working in the background"]')).toBeNull();
    });

    test('marks only a monitor with the activity icon, and a shell beside it with the terminal icon', async () => {
        await setChat(LEAD.id, { background: [MONITOR] });
        await until(() => backgroundMark()?.querySelector('.lucide-activity') != null);

        await setChat(LEAD.id, { background: [MONITOR, SHELL] });
        await until(() => backgroundMark()?.querySelector('.lucide-square-terminal') != null);
    });

    test('gives the mark up while a turn runs or the chat needs you', async () => {
        await setChat(LEAD.id, { background: [SHELL] });
        await until(() => backgroundMark() !== null);

        await setChat(LEAD.id, { status: 'running', background: [SHELL] });
        await until(() => backgroundMark() === null);

        await setChat(LEAD.id, { status: 'needs-you', background: [SHELL] });
        await until(() => leadRow()!.textContent!.length > 0 && backgroundMark() === null);

        await setChat(LEAD.id, { background: [] });
        await until(() => backgroundMark() === null);
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
