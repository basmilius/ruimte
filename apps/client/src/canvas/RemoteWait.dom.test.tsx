import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode, RemoteStatusEvent, Task } from '@ruimte/contracts';
import { act } from 'react';
import { startRemoteStatusWatch } from '@/controllers/remote-status';
import { useAttention } from '@/state/attention';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useTasks } from '@/state/tasks';
import { startTaskWatch } from '@/tasks/watch';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const WORKSPACE = 'fake-machine';
const REMOTE = 'machine-b';
const PARENT: ProjectNode = { id: 'parent', kind: 'terminal', title: 'Parent', x: 0, y: 0, w: 560, h: 360 };
const CHILD: ProjectNode = { id: 'child', kind: 'terminal', title: 'Child', x: 700, y: 0, w: 560, h: 360, machine: REMOTE };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [PARENT, CHILD], texts: [], edges: [], layouts: [] };

const TASK: Task = {
    id: 'task-1',
    projectId: 'project-atlas',
    parentId: PARENT.id,
    childId: CHILD.id,
    title: 'Run the tests',
    prompt: 'Run the tests',
    status: 'open',
    result: null,
    createdAt: 1,
    settledAt: null,
    wake: 'pending'
};

let here: FakeMachine;
let there: FakeMachine;
let disconnectThere: () => void;
let workspace: FakeWorkspace;
let page: Mounted;
let stopWatching: () => void;
let stopTasks: () => void;

/* `unstarted` is the nodes whose task the machine has not been asked to start yet; a task it took leaves that out and only its result is owed. */
function status(state: RemoteStatusEvent['state'], unstarted: string[] = state === 'waiting' ? [CHILD.id] : []): RemoteStatusEvent {
    return {
        machineId: REMOTE,
        state,
        owed: 1,
        ...(state === 'waiting' ? { nextAttemptAt: 60_000 } : {}),
        ...(unstarted.length === 0 ? {} : { unstartedNodeIds: unstarted })
    };
}

function bodyOf(nodeId: string): string {
    return page.host.querySelector(`[data-node-id="${nodeId}"]`)?.textContent ?? '';
}

function pillOf(nodeId: string): string {
    return page.host.querySelector(`[data-node-id="${nodeId}"] header`)?.textContent ?? '';
}

beforeEach(async () => {
    here = new FakeMachine();
    here.answer('task.list', () => ({ tasks: [TASK] }));
    there = new FakeMachine();
    useEndpoints.getState().add({
        id: REMOTE,
        label: 'MacBook Pro',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    disconnectThere = connectFakeMachine(there, REMOTE);
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    stopWatching = startRemoteStatusWatch();
    stopTasks = startTaskWatch();
    useTasks.getState().putTask(WORKSPACE, TASK);
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${CHILD.id}"]`) !== null);
});

afterEach(async () => {
    stopWatching();
    stopTasks();
    useTasks.getState().forget(WORKSPACE);
    await page.unmount();
    workspace.close();
    disconnectThere();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(REMOTE);
});

describe('a task that waits for another machine', () => {
    test('shows a pill on the parent while the machine does not answer, and takes it away when the link opens', async () => {
        expect(pillOf(PARENT.id)).not.toContain('Waiting for');
        await act(async () => here.emit('remote.status', status('waiting')));
        await until(() => pillOf(PARENT.id).includes('Waiting for MacBook Pro'));
        expect(pillOf(CHILD.id)).not.toContain('Waiting for');

        await act(async () => here.emit('remote.status', status('open')));
        await until(() => !pillOf(PARENT.id).includes('Waiting for'));
    });

    test('says on the node that its task has not started, and takes that away when the machine took the task', async () => {
        await act(async () => here.emit('remote.status', status('waiting')));
        await until(() => bodyOf(CHILD.id).includes('Task: Run the tests · not started'));
        expect(there.requests('session.create').filter((request) => request.sessionId === CHILD.id)).toEqual([]);
        expect(there.requests('session.attach').filter((request) => request.sessionId === CHILD.id)).toEqual([]);

        // The machine took the task; the link may still be down, but only its result is owed now.
        await act(async () => here.emit('remote.status', status('waiting', [])));
        await until(() => !bodyOf(CHILD.id).includes('not started'));
        await until(() => there.requests('session.attach').some((request) => request.sessionId === CHILD.id));
        expect(pillOf(PARENT.id)).not.toContain('Waiting for');
    });

    test('shows no pill once the task has settled, and counts nothing as needing a person', async () => {
        await act(async () => here.emit('remote.status', status('waiting')));
        await until(() => pillOf(PARENT.id).includes('Waiting for MacBook Pro'));
        expect(Object.keys(useAttention.getState().unseen)).toEqual([]);

        await act(async () => useTasks.getState().putTask(WORKSPACE, { ...TASK, status: 'done', settledAt: 2 }));
        await until(() => !pillOf(PARENT.id).includes('Waiting for'));
    });

    test('offers Stop waiting on the node that waits, asks first, and has the machine stop the task for real', async () => {
        // The machine closes the task the way the daemon does when its agent is stopped: it cancels the task and tells every socket.
        here.answer('chat.stopSubagent', () => {
            queueMicrotask(() => here.emit('task.changed', { task: { ...TASK, status: 'cancelled', settledAt: 2, wake: 'none' } }));
            return {};
        });
        await act(async () => here.emit('remote.status', status('waiting')));
        await until(() => pillOf(PARENT.id).includes('Waiting for MacBook Pro'));
        const frame = page.host.querySelector(`[data-node-id="${CHILD.id}"]`)!;
        await act(async () => {
            frame.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 800, clientY: 100, button: 2 }));
        });
        await until(() => document.querySelector('[role="menu"]') !== null);
        const item = ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((entry) => entry.textContent?.includes('Stop waiting'));
        expect(item).toBeDefined();
        await clickOn(item ?? null);

        // Stopping asks first: nothing is sent until the person agrees.
        await until(() => document.querySelector('[role="dialog"]') !== null);
        expect(here.requests('chat.stopSubagent')).toEqual([]);
        await clickOn(([...document.querySelectorAll('[role="dialog"] button')] as HTMLElement[]).find((entry) => entry.textContent?.includes('Stop')) ?? null);
        await until(() => here.requests('chat.stopSubagent').length > 0);
        expect(here.requests('chat.stopSubagent')[0]).toEqual({ chatId: PARENT.id, toolUseId: `task-${TASK.id}` });
        expect(here.requests('chat.stopTask')).toEqual([]);

        // The task is closed once the machine says so, and with it the pill and the card go.
        await until(() => useTasks.getState().byEndpoint[WORKSPACE]?.[TASK.id]?.status === 'cancelled');
        await until(() => !pillOf(PARENT.id).includes('Waiting for') && !bodyOf(CHILD.id).includes('not started'));
    });

    test('does not mount the node of a task the machine has not taken yet, though the link is open', async () => {
        await act(async () => here.emit('remote.status', status('open', [CHILD.id])));
        await until(() => bodyOf(CHILD.id).includes('Task: Run the tests · not started'));
        expect(there.requests('session.create').filter((request) => request.sessionId === CHILD.id)).toEqual([]);
        expect(there.requests('session.attach').filter((request) => request.sessionId === CHILD.id)).toEqual([]);
        await act(async () => here.emit('remote.status', status('open', [])));
        await until(() => !bodyOf(CHILD.id).includes('not started'));
        await until(() => there.requests('session.attach').some((request) => request.sessionId === CHILD.id));
    });

    test('does not mount the node of an open task before any standing came, and mounts it once the machine took the task', async () => {
        await until(() => bodyOf(CHILD.id).includes('Task: Run the tests · not started'));
        expect(there.requests('session.create').filter((request) => request.sessionId === CHILD.id)).toEqual([]);
        expect(there.requests('session.attach').filter((request) => request.sessionId === CHILD.id)).toEqual([]);
        await act(async () => here.emit('remote.status', status('open', [])));
        await until(() => !bodyOf(CHILD.id).includes('not started'));
        await until(() => there.requests('session.attach').some((request) => request.sessionId === CHILD.id));
    });

    test('offers no Stop waiting while the link is open', async () => {
        await act(async () => here.emit('remote.status', status('open')));
        const frame = page.host.querySelector(`[data-node-id="${CHILD.id}"]`)!;
        await act(async () => {
            frame.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 800, clientY: 100, button: 2 }));
        });
        await until(() => document.querySelector('[role="menu"]') !== null);
        expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('Stop waiting');
    });
});
