import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { REQUEST_SCHEMAS, type FsEntry, type ProjectCanvasView, type ProjectNode, type RequestType } from '@ruimte/contracts';
import { useDesignChat } from '@/design/design-chat';
import { canvasOfNode } from '@/state/canvas';
import { TransportError } from '@/transport/transport';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, layOutChat, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const FOLDER = '/work/atlas/.ruimte/private/designs/pricing';

function page(name: string, mtime: number): FsEntry {
    return { name, path: `${FOLDER}/${name}`, kind: 'file', size: 10, mtime, hidden: false, ignored: false };
}

const BOARD: ProjectNode = {
    id: 'board',
    kind: 'design',
    title: 'Pricing',
    titleSource: 'user',
    x: 0,
    y: 0,
    w: 480,
    h: 640,
    provider: 'claude',
    path: 'pricing',
    chats: [{ id: 'board-2', name: 'Dense', node: { provider: 'claude' } }]
};

const PAGES = [page('1a Calm.html', 100), page('2a Dense.html', 300), page('1b Bold.html', 200)];

let machine: FakeMachine;
let workspace: FakeWorkspace;
let mounted: Mounted;
let restoreLayout: () => void;
// What the design folder holds, which a test changes as the chat would write.
let listing: FsEntry[];

/* The window on a canvas with the design node, or with `nodes`, its folder holding `entries`. */
async function start(entries: FsEntry[] = PAGES, nodes: ProjectNode[] = [BOARD]): Promise<void> {
    listing = entries;
    const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes, texts: [], edges: [], layouts: [] };
    workspace = await openFakeWorkspace(machine, { views: [main] }, { activeViewId: main.id, views: {} });
    mounted = mount();
    await mounted.renderApp();
}

beforeEach(() => {
    localStorage.clear();
    useDesignChat.setState({ picked: {}, pages: {} });
    restoreLayout = layOutChat();
    machine = new FakeMachine();
    machine.answer('fs.list', ({ path }) => ({ path, entries: path === FOLDER ? listing : [], truncated: false }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
});

afterEach(async () => {
    await mounted.unmount();
    workspace.close();
    restoreLayout();
});

function cards(): HTMLElement[] {
    return [...mounted.host.querySelectorAll<HTMLElement>('[data-derived-of="board"]')];
}

function labels(): (string | null)[] {
    return cards().map((card) => card.getAttribute('aria-label'));
}

/* The card that is open: the one that is not a line. */
function openCard(): HTMLElement | undefined {
    return cards().find((card) => card.querySelector('button[aria-expanded="false"]') === null);
}

/* The frame the open page is drawn in, the first thing in the box under the stage's bar; a new one is the page opened again. */
function pageFrame(): Element | null {
    return openCard()?.querySelector('div.relative.grow.overflow-hidden')?.firstElementChild ?? null;
}

function listingsOfFolder(): number {
    return machine.requests('fs.list').filter((request) => request.path === FOLDER).length;
}

/* The chat writing in the folder: the machine reports the folder of every file it wrote. */
async function written(entries: FsEntry[]): Promise<void> {
    listing = entries;
    const before = listingsOfFolder();
    await act(async () => machine.emit('fs.changed', { root: '/work/atlas', paths: [FOLDER] }));
    await until(() => listingsOfFolder() > before);
}

function exportButton(): HTMLButtonElement | null {
    return mounted.host.querySelector<HTMLButtonElement>('[data-node-id="board"] button[aria-label="Save this page as one HTML file"]');
}

function disabled(button: HTMLButtonElement | null): boolean {
    return button !== null && (button.disabled || button.getAttribute('aria-disabled') === 'true');
}

describe('a design node', () => {
    test('stands its pages beside it, the most recently changed first, with the newest open and the others a line each', async () => {
        await start();
        await until(() => cards().length === 3);
        expect(labels()).toEqual(['2a Dense', '1b Bold', '1a Calm']);
        // Only the open page has a stage; every other page is a line that opens it.
        expect(cards()[0]!.querySelector('button[aria-expanded="false"]')).toBeNull();
        expect(cards()[1]!.querySelector('button[aria-expanded="false"]')?.textContent).toContain('1b Bold');

        await clickOn(cards()[2]!.querySelector('button[aria-expanded="false"]'));
        await until(() => cards()[0]!.querySelector('button[aria-expanded="false"]') !== null);
        expect(cards()[2]!.querySelector('button[aria-expanded="false"]')).toBeNull();
    });

    test('works on its design in its newest chat, with every chat of the design at the top of the composer', async () => {
        await start();
        await until(() => machine.requests('chat.attach').some((request) => request.chatId === 'board-2'));
        const frame = mounted.host.querySelector<HTMLElement>('[data-node-id="board"]')!;
        expect(frame.querySelector('[aria-label="Chat: Dense"]')).not.toBeNull();
    });

    test('keeps the open page where it stands, and open, while the chat writes others', async () => {
        await start();
        await until(() => cards().length === 3);
        await clickOn(cards()[1]!.querySelector('button[aria-expanded="false"]'));
        await until(() => openCard()?.getAttribute('aria-label') === '1b Bold');

        // A page written anew and one written for the first time, both after the open one.
        await written([page('1a Calm.html', 600), page('2a Dense.html', 300), page('1b Bold.html', 200), page('3a Wide.html', 500)]);
        await until(() => cards().length === 4);

        expect(labels()).toEqual(['3a Wide', '2a Dense', '1b Bold', '1a Calm']);
        expect(openCard()?.getAttribute('aria-label')).toBe('1b Bold');
    });

    test('keeps the page it opened first open when the chat writes a newer one', async () => {
        await start();
        await until(() => openCard()?.getAttribute('aria-label') === '2a Dense');

        await written([...PAGES, page('3a Wide.html', 500)]);
        await until(() => cards().length === 4);

        expect(labels()[0]).toBe('3a Wide');
        expect(openCard()?.getAttribute('aria-label')).toBe('2a Dense');
    });

    test('keeps the frame of its open page through a save of the project, and opens it again once the page is written', async () => {
        await start();
        await until(() => pageFrame() !== null);
        const frame = pageFrame();
        const listed = listingsOfFolder();

        // Every save writes the private project file, in a parent of the design's folder.
        await act(async () => machine.emit('fs.changed', { root: '/work/atlas', paths: ['/work/atlas/.ruimte/private'] }));
        expect(listingsOfFolder()).toBe(listed);

        // Another file of the folder written leaves the page as it was.
        await written([...PAGES, page('notes.md', 900)]);
        expect(pageFrame()).toBe(frame);

        await written([page('1a Calm.html', 100), page('2a Dense.html', 700), page('1b Bold.html', 200)]);
        await until(() => pageFrame() !== frame);
    });

    test('exports and implements the page its open card shows, and none once it closed', async () => {
        await start();
        await until(() => openCard()?.getAttribute('aria-label') === '2a Dense');
        await until(() => useDesignChat.getState().pages.board === '2a Dense.html');
        expect(disabled(exportButton())).toBe(false);

        await clickOn(openCard()!.querySelector('[aria-label="Close page"]'));
        await until(() => openCard() === undefined);

        expect(useDesignChat.getState().pages.board).toBeNull();
        expect(disabled(exportButton())).toBe(true);
    });

    test('opens its page at the size a person gave it on this canvas before', async () => {
        localStorage.setItem('ruimte.designPage.main.board', JSON.stringify({ w: 840, h: 600 }));
        await start();
        await until(() => openCard() !== undefined);

        expect(openCard()!.style.width).toBe('840px');
        expect(openCard()!.style.height).toBe('600px');
    });

    test('says where the chat will write while the folder holds no page yet', async () => {
        await start([]);
        await until(() => cards().length === 1);

        expect(cards()[0]!.textContent).toContain('No pages yet.');
        expect(cards()[0]!.querySelector('button')).toBeNull();
    });

    test('says where the chat will write while its folder is not there yet', async () => {
        machine.answer('fs.list', ({ path }) => {
            if (path === FOLDER) {
                throw new TransportError('not-found', 'That folder is not there');
            }
            return { path, entries: [], truncated: false };
        });
        await start();
        await until(() => cards().length === 1);

        expect(cards()[0]!.textContent).toContain('No pages yet.');
    });

    test('keeps the frame of its open page while a pan takes it far out of sight', async () => {
        await start();
        await until(() => pageFrame() !== null);
        const frame = pageFrame();
        const store = canvasOfNode('board')!;

        await act(async () => {
            store.getState().setViewport({ w: 1280, h: 800 });
            store.getState().setCamera({ x: -20000, y: 0, zoom: 1 });
        });
        expect(openCard()).toBeDefined();

        await act(async () => store.getState().setCamera({ x: 0, y: 0, zoom: 1 }));
        expect(pageFrame()).toBe(frame);
    });
});

describe('adding a design', () => {
    async function canvasMenuLabels(): Promise<string[]> {
        const surface = mounted.host.querySelector('[data-canvas-surface]')!;
        await act(async () => {
            surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 900, clientY: 300, button: 2 }));
        });
        await until(() => document.querySelector('[role="menu"]') !== null);
        return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) => item.textContent?.trim() ?? '');
    }

    test('is offered on a machine that knows designs', async () => {
        await start();

        expect(await canvasMenuLabels()).toContain('Design');
    });

    test('is not offered on a machine older than designs', async () => {
        await start();
        await act(async () => machine.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'artifact.saveFolder')));

        const offered = await canvasMenuLabels();
        expect(offered.length).toBeGreaterThan(0);
        expect(offered).not.toContain('Design');
    });

    function emptyCanvasTitles(): string[] {
        return [...mounted.host.querySelectorAll('section button')].map((tile) => tile.querySelector('.font-medium')?.textContent ?? '');
    }

    test('is offered on an empty canvas beside the chat, and asks there for the CLI', async () => {
        await start([], []);
        await until(() => emptyCanvasTitles().includes('Chat'));
        expect(emptyCanvasTitles()).toContain('Design');

        await clickOn([...mounted.host.querySelectorAll('section button')].find((tile) => tile.textContent?.includes('Pages an agent designs')) ?? null);
        await until(() => document.querySelector('[role="menu"]') !== null);
    });

    test('is not offered on an empty canvas of a machine older than designs', async () => {
        await start([], []);
        await act(async () => machine.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'artifact.saveFolder')));
        await until(() => emptyCanvasTitles().includes('Chat'));

        expect(emptyCanvasTitles()).not.toContain('Design');
    });
});
