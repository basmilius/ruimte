import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
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

function sortOption(label: string): HTMLElement | null {
    return canvas.page.host.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="Order of the nodes"] [role="radio"][aria-label="${label}"]`);
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
        expect(sortOption('As on the canvas')?.getAttribute('aria-checked')).toBe('true');
    });

    test('the sort bar in the footer orders them by name, and Settings keeps the choice', async () => {
        await clickOn(sortOption('By name')!);
        await until(() => rows()[0]?.startsWith('Alpha') === true);
        expect(rows().map((row) => row.slice(0, 7))).toEqual(['Alpha', 'Bravo', 'Charlie']);
        expect(useSettings.getState().sidebarNodeSort).toBe('name');
        expect(sortOption('By name')?.getAttribute('aria-checked')).toBe('true');
    });

    test("another order is this client's alone and writes nothing to the project", async () => {
        const saves = machine.requests('project.save').length;
        await clickOn(sortOption('By name')!);
        await until(() => rows()[0]?.startsWith('Alpha') === true);
        expect(machine.requests('project.save')).toHaveLength(saves);
    });
});
