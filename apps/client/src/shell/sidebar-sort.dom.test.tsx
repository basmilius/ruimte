import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { useSettings } from '@/state/settings';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { chatInfoOf } from '../../testing/chat-info';
import { until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';

const CLAUDE = fakeProvider('claude', 'Claude Code', { version: '2.1.0', resumeCommand: 'claude --resume {id}' });

function chat(id: string, title: string, x: number): ProjectNode {
    return { id, kind: 'chat', provider: 'claude', title, x, y: 0, w: 480, h: 520 } as ProjectNode;
}

// In the order they were made, which is the order of the canvas.
const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [chat('bravo', 'Bravo', 0), chat('alpha', 'Alpha', 600), chat('charlie', 'Charlie', 1200)],
    texts: [],
    edges: [],
    layouts: []
};

const previous = { sort: useSettings.getState().sidebarNodeSort, then: useSettings.getState().sidebarNodeSortThen };

let machine: FakeMachine;
let canvas: CanvasPage;

/* The titles of the node rows under the open canvas, top to bottom. */
function rows(): string[] {
    return [...canvas.page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="node:main:"]')].map((row) => row.textContent?.trim() ?? '');
}

beforeEach(async () => {
    useSettings.setState({ sidebarNodeSort: 'canvas', sidebarNodeSortThen: 'newest' });
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    canvas = await openCanvasPage(machine, [MAIN], 'bravo');
    await until(() => rows().length === 3);
});

afterEach(() => {
    canvas.close();
    useSettings.setState({ sidebarNodeSort: previous.sort, sidebarNodeSortThen: previous.then });
});

describe('the order of the nodes in the sidebar', () => {
    test('lists them as on the canvas until a person picks another order', () => {
        expect(rows().map((row) => row.slice(0, 7))).toEqual(['Bravo', 'Alpha', 'Charlie']);
    });

    test('follows the order picked in Settings, newest first within a kind', async () => {
        await act(async () => useSettings.getState().update({ sidebarNodeSort: 'name' }));
        await until(() => rows()[0]?.startsWith('Alpha') === true);
        expect(rows().map((row) => row.slice(0, 7))).toEqual(['Alpha', 'Bravo', 'Charlie']);
        await act(async () => useSettings.getState().update({ sidebarNodeSort: 'kind' }));
        await until(() => rows()[0]?.startsWith('Charlie') === true);
        expect(rows().map((row) => row.slice(0, 7))).toEqual(['Charlie', 'Alpha', 'Bravo']);
    });

    test("another order is this client's alone and writes nothing to the project", async () => {
        const saves = machine.requests('project.save').length;
        await act(async () => useSettings.getState().update({ sidebarNodeSort: 'name' }));
        await until(() => rows()[0]?.startsWith('Alpha') === true);
        expect(machine.requests('project.save')).toHaveLength(saves);
    });
});
