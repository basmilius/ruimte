import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useChats } from '@adecore/agents-react/state';
import type { ChatInfo, ProjectCanvasView, Task } from '@ruimte/contracts';
import { act } from 'react';
import { useEndpoints } from '@/state/endpoints';
import { useTasks } from '@/state/tasks';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { chatInfoOf } from '../../testing/chat-info';
import { until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [{ kind: 'chat', id: 'lead', title: 'Release plan', x: 0, y: 0, w: 480, h: 520 }],
    texts: [],
    edges: [],
    layouts: []
};

const TASK: Task = {
    id: 'task-changelog',
    projectId: 'project',
    parentId: 'lead',
    childId: 'helper',
    title: 'Draft the changelog',
    prompt: 'Draft the changelog',
    status: 'open',
    result: null,
    createdAt: 1,
    settledAt: null,
    wake: 'pending'
};

const SHELL = { id: 'b1', kind: 'shell' as const, description: 'Run the tests', command: 'bun test', startedAt: 1 };
const MONITOR = { id: 'b2', kind: 'monitor' as const, description: 'Watch CI', command: null, startedAt: 2 };

let canvas: CanvasPage;

function header(): string {
    return canvas.page.host.querySelector('[data-node-id="lead"] [data-node-header]')?.textContent ?? '';
}

/* A chat between turns as its machine reports it, with what the test adds. */
async function setChat(id: string, patch: Partial<ChatInfo> = {}): Promise<void> {
    const key = `${useEndpoints.getState().activeId}:${id}`;

    await act(async () => {
        useChats.setState((state) => ({
            statusByKey: { ...state.statusByKey, [key]: { info: { ...(state.statusByKey[key]?.info ?? chatInfoOf(id)), status: 'idle', ...patch } } }
        }));
    });
}

beforeEach(async () => {
    canvas = await openCanvasPage(new FakeMachine(), [MAIN], 'lead');
});

afterEach(async () => {
    await canvas.close();
    useTasks.setState({ byEndpoint: {} });
});

describe('the line beside a chat node on the canvas', () => {
    test('names the oldest command the chat left running between turns', async () => {
        await setChat('lead', { background: [MONITOR, SHELL] });
        await until(() => header().includes('Run the tests · '));

        expect(header()).not.toContain('Watch CI');

        await setChat('lead', { background: [] });
        await until(() => !header().includes('Run the tests'));
    });

    test('gives way to the label of a child agent that needs you', async () => {
        await setChat('lead', { background: [SHELL] });
        await until(() => header().includes('Run the tests · '));
        await act(async () => useTasks.getState().putTask(useEndpoints.getState().activeId, TASK));
        await setChat('helper', { status: 'needs-you' });
        await until(() => header().includes('sub-agent'));

        expect(header()).not.toContain('Run the tests');
    });
});
