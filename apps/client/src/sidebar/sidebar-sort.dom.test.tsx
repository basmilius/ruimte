import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { startNodeActivityTouches } from '@/state/node-activity';
import { useSettings } from '@/state/settings';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';

const CLAUDE = fakeProvider('claude', 'Claude Code', { version: '2.1.0', resumeCommand: 'claude --resume {id}' });

function chat(id: string, title: string, x: number): ProjectNode {
    return { id, kind: 'chat', provider: 'claude', title, x, y: 0, w: 480, h: 520 } as ProjectNode;
}

const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [chat('bravo', 'Bravo', 0), chat('alpha', 'Alpha', 600), chat('charlie', 'Charlie', 1200)],
    texts: [],
    edges: [],
    layouts: []
};

// Alpha changed last on the machine, Bravo longest ago.
const ACTIVITY = [
    { projectId: 'project-atlas', nodeId: 'bravo', at: 100 },
    { projectId: 'project-atlas', nodeId: 'alpha', at: 300 },
    { projectId: 'project-atlas', nodeId: 'charlie', at: 200 }
];

const previous = { sort: useSettings.getState().sidebarNodeSort, then: useSettings.getState().sidebarNodeSortThen };

let machine: FakeMachine;
let canvas: CanvasPage;
let stopTouches: () => void;

function rowElements(): HTMLElement[] {
    return [...canvas.page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="node:main:"]')];
}

function rows(): string[] {
    return rowElements().map((row) => row.textContent?.trim().slice(0, 7) ?? '');
}

async function pick(sort: 'canvas' | 'recent' | 'name'): Promise<void> {
    await act(async () => useSettings.getState().update({ sidebarNodeSort: sort }));
}

async function pointer(type: 'pointerover' | 'pointerout'): Promise<void> {
    // On a row, as a pointer that comes into the sidebar comes over what it draws.
    const row = rowElements()[0]!;
    await act(async () => {
        row.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: null }));
    });
}

beforeEach(async () => {
    useSettings.setState({ sidebarNodeSort: 'canvas', sidebarNodeSortThen: 'recent' });
    // As `main.tsx` starts it for the window.
    stopTouches = startNodeActivityTouches();
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('activity.list', () => ({ activity: ACTIVITY }));
    canvas = await openCanvasPage(machine, [MAIN], 'bravo');
    await until(() => rows().length === 3);
});

afterEach(() => {
    stopTouches();
    canvas.close();
    useSettings.setState({ sidebarNodeSort: previous.sort, sidebarNodeSortThen: previous.then });
});

describe('the order of the nodes in the sidebar', () => {
    test('lists them as on the canvas until a person picks another order', () => {
        expect(rows()).toEqual(['Bravo', 'Alpha', 'Charlie']);
    });

    test('follows the activity the machine keeps, and every change it reports', async () => {
        await pick('recent');
        await until(() => rows()[0] === 'Alpha');
        expect(rows()).toEqual(['Alpha', 'Charlie', 'Bravo']);

        await act(async () => machine.emit('activity.changed', { activity: [{ projectId: 'project-atlas', nodeId: 'bravo', at: 400 }] }));
        await until(() => rows()[0] === 'Bravo');
        expect(rows()).toEqual(['Bravo', 'Alpha', 'Charlie']);
    });

    test('moves nothing while the pointer is in the sidebar', async () => {
        await pick('recent');
        await until(() => rows()[0] === 'Alpha');
        await pointer('pointerover');
        await act(async () => machine.emit('activity.changed', { activity: [{ projectId: 'project-atlas', nodeId: 'bravo', at: 400 }] }));
        expect(rows()).toEqual(['Alpha', 'Charlie', 'Bravo']);

        await pointer('pointerout');
        await until(() => rows()[0] === 'Bravo');
    });

    test('tells the machine when a person opens a node that is not already the most recent', async () => {
        await pick('name');
        await until(() => rows()[0] === 'Alpha');
        await clickOn(rowElements()[0]!);
        expect(machine.requests('activity.touch')).toEqual([]);

        await clickOn(rowElements()[1]!);
        await until(() => machine.requests('activity.touch').length === 1);
        expect(machine.requests('activity.touch')).toEqual([{ nodeId: 'bravo' }]);
    });

    test("another order is this client's alone and writes nothing to the project", async () => {
        const saves = machine.requests('project.save').length;
        await pick('name');
        await until(() => rows()[0] === 'Alpha');
        expect(machine.requests('project.save')).toHaveLength(saves);
    });
});
