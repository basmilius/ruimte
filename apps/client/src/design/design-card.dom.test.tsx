import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatSubagentItem, FsEntry, ProjectCanvasView, ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { agentDesignDialog } from '@/design/agent-design-dialog';
import { useDesignAgents } from '@/design/design-agent';
import { DESIGN_METHODS } from '@/design/design-protocol';
import { useDesignChat } from '@/state/design-chat';
import { TransportError } from '@/transport-api/transport';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, layOutChat, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const FOLDER = '/work/atlas/.ruimte/private/designs/sign-in';
const LEAD: ProjectView = { kind: 'chat', id: 'lead', name: 'Sign in', node: { provider: 'claude' } };

function page(name: string, mtime: number): FsEntry {
    return { name, path: `${FOLDER}/${name}`, kind: 'file', size: 10, mtime, hidden: false, ignored: false };
}

function taskRow(childId: string, status: ChatSubagentItem['status']): ChatSubagentItem {
    return {
        id: `task-${childId}`,
        kind: 'subagent',
        turnId: null,
        createdAt: 1,
        toolUseId: `task-${childId}`,
        description: 'Design the sign in pages',
        subagentType: null,
        prompt: null,
        background: true,
        status,
        startedAt: 1,
        finishedAt: status === 'running' ? null : 2,
        summary: null,
        result: null,
        usage: null,
        lastTool: null,
        itemsTruncated: false,
        origin: 'ruimte',
        childId
    };
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let mounted: Mounted;
let restoreLayout: () => void;
// What the design agent's folder holds; null is a folder that is not there.
let listing: FsEntry[] | null;

async function open(rows: ChatSubagentItem[]): Promise<void> {
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: chatId === LEAD.id ? rows : [], seq: 0 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [LEAD] }, { activeViewId: LEAD.id, views: {} });
    mounted = mount();
    await mounted.renderApp();
}

function card(): HTMLElement | null {
    return mounted.host.querySelector<HTMLElement>('[data-design-card]');
}

/* Whether a person sees the element: the thread under an open design stays mounted, hidden. */
function inView(element: HTMLElement | null): boolean {
    for (let node = element; node !== null; node = node.parentElement) {
        if (node.style.display === 'none') {
            return false;
        }
    }

    return element !== null;
}

function button(label: string): HTMLElement | null {
    return (
        document.querySelector<HTMLElement>(`[aria-label="${label}"]`) ??
        [...document.querySelectorAll<HTMLElement>('button')].find((each) => each.textContent?.trim() === label) ??
        null
    );
}

function overlay(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="dialog"]');
}

async function openDesign(): Promise<void> {
    await clickOn(button('Open design'));
    await until(() => overlay() !== null);
}

/* The overlay is gone and the keyboard is back on the button it was opened from. */
async function closedOnCard(): Promise<void> {
    await until(() => overlay() === null);
    await until(() => document.activeElement === button('Open design'));
}

const ELEMENT = {
    selector: 'body > h1:nth-of-type(1)',
    option: null,
    name: 'h1',
    html: '<h1>Sign in</h1>',
    text: 'Sign in',
    rect: { x: 10, y: 10, width: 200, height: 40 },
    style: {}
};

/* The real frame waits for a measured width, which this DOM never has; a stand-in in the stage speaks for the page. */
async function standInFrame(): Promise<(method: string, params: object) => Promise<void>> {
    await until(() => overlay()?.querySelector('[aria-label^="Page: "]') != null);

    const frame = { postMessage: () => undefined };
    const stand = document.createElement('iframe');

    Object.defineProperty(stand, 'contentWindow', { value: frame });
    overlay()!.querySelector('[aria-label^="Page: "]')!.parentElement!.nextElementSibling!.prepend(stand);

    return (method, params) =>
        act(async () => {
            window.dispatchEvent(new MessageEvent('message', { source: frame as never, data: { jsonrpc: '2.0', method, params } }));
        });
}

beforeEach(() => {
    localStorage.clear();
    useDesignAgents.setState({ folders: {} });
    useDesignChat.setState({ pages: {}, pickedPages: {} });
    agentDesignDialog.close();
    restoreLayout = layOutChat();
    listing = [];
    machine = new FakeMachine();
    machine.answer('design.agent', ({ agentId }) => ({ folder: agentId === 'designer' ? FOLDER : null }));
    machine.answer('fs.list', ({ path }) => {
        if (path === FOLDER && listing === null) {
            throw new TransportError('not-found', 'No such folder');
        }

        return { path, entries: path === FOLDER ? (listing ?? []) : [], truncated: false };
    });
});

afterEach(async () => {
    await mounted.unmount();
    workspace.close();
    restoreLayout();
});

describe("a design agent's card in its parent's thread", () => {
    test('holds the frame with a placeholder while no page is written, and offers nothing to open', async () => {
        await open([taskRow('designer', 'running')]);
        await until(() => card() !== null);

        expect(card()!.textContent).toContain('Design the sign in pages');
        expect(card()!.textContent).toContain('The design shows here once its first page is written.');
        expect(card()!.querySelector('[role="img"][aria-label^="Preview of"]')).toBeNull();
        expect(button('Open design')).toBeNull();
    });

    test('shows the one page written so far by its name, with the page itself in the frame', async () => {
        listing = [page('Sign in.html', 100)];
        await open([taskRow('designer', 'running')]);
        await until(() => card()?.textContent?.includes('Wrote Sign in') === true);

        expect(card()!.querySelector('[role="img"][aria-label="Preview of Sign in"]')).not.toBeNull();
        expect(card()!.querySelector('[aria-label="In progress"]')).not.toBeNull();
        expect(button('Open design')).not.toBeNull();
    });

    test('picks among several pages in a list that marks the page in progress, and shows the one picked', async () => {
        listing = [page('Sign in.html', 100), page('Sign up.html', 200)];
        await open([taskRow('designer', 'running')]);
        await until(() => button('Pages of the design: Sign up') !== null);

        expect(card()!.querySelector('[role="img"][aria-label="Preview of Sign up"]')).not.toBeNull();

        await clickOn(button('Pages of the design: Sign up'));
        await until(() => document.querySelectorAll('[role="menuitemradio"]').length === 2);
        const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];

        expect(items.map((item) => item.textContent)).toEqual(['Sign in', 'Sign up']);
        expect(items[1]!.querySelector('[aria-label="In progress"]')).not.toBeNull();
        expect(items[0]!.querySelector('[aria-label="In progress"]')).toBeNull();

        await clickOn(items[0]!);
        await until(() => card()!.querySelector('[role="img"][aria-label="Preview of Sign in"]') !== null);
    });

    test('says how many pages it made once done', async () => {
        listing = [page('Sign in.html', 100), page('Sign up.html', 200)];
        await open([taskRow('designer', 'done')]);
        await until(() => card()?.textContent?.includes('Done · 2 pages') === true);

        expect(card()!.querySelector('[aria-label="In progress"]')).toBeNull();
    });

    test('shows the page its result names first once done, and the page a person picks over it, which Open design opens', async () => {
        listing = [page('Pricing.html', 100), page('Checkout.html', 200)];
        const result = 'Made two pages:\n- `.ruimte/private/designs/sign-in/Pricing.html`, the board\n- `.ruimte/private/designs/sign-in/Checkout.html`';
        await open([{ ...taskRow('designer', 'done'), result }]);
        await until(() => button('Pages of the design: Pricing') !== null);

        expect(card()!.querySelector('[role="img"][aria-label="Preview of Pricing"]')).not.toBeNull();

        await clickOn(button('Pages of the design: Pricing'));
        await until(() => document.querySelectorAll('[role="menuitemradio"]').length === 2);
        await clickOn([...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent === 'Checkout')!);
        await until(() => card()!.querySelector('[role="img"][aria-label="Preview of Checkout"]') !== null);

        await clickOn(button('Open design'));
        await until(() => button('Page: Checkout') !== null);
    });

    test('says plainly that an agent stopped before it wrote a page', async () => {
        await open([taskRow('designer', 'failed')]);
        await until(() => card()?.textContent?.includes('The agent stopped before it wrote a page.') === true);
    });

    test('leaves the row of any other task as it is', async () => {
        await open([taskRow('reviewer', 'running')]);
        await until(() => mounted.host.textContent?.includes('Design the sign in pages') === true);
        await until(() => machine.requests('design.agent').length === 1);

        expect(card()).toBeNull();
    });
});

describe('opening the design from the card', () => {
    test("opens over the window on the card's page beside the agent's thread, keeps the thread underneath, and closes with its button", async () => {
        listing = [page('Sign in.html', 100), page('Sign up.html', 200)];
        await open([taskRow('designer', 'done')]);
        await until(() => button('Open design') !== null);

        await openDesign();

        await until(() => machine.requests('chat.attach').some((request) => request.chatId === 'designer'));
        await until(() => overlay()?.querySelector('[aria-label="Page: Sign up"]') != null);
        expect(overlay()!.textContent).toContain('Design the sign in pages');
        expect(overlay()!.querySelector('[data-chat-body="designer"]')).not.toBeNull();
        expect(inView(card())).toBe(true);

        await clickOn([...overlay()!.querySelectorAll<HTMLElement>('button')].find((each) => each.textContent?.trim() === 'Close') ?? null);
        await closedOnCard();

        expect(machine.requests('project.save')).toEqual([]);
    });

    test("closes on Escape from the agent's composer, after the composer let go of what it held", async () => {
        listing = [page('Sign in.html', 100)];
        await open([taskRow('designer', 'done')]);
        await until(() => button('Open design') !== null);
        await openDesign();
        await until(() => overlay()?.querySelector('[data-chat-body="designer"] .cm-content') != null);

        await pressKey(overlay()!.querySelector('[data-chat-body="designer"] .cm-content')!, 'Escape');
        await closedOnCard();

        expect(machine.requests('project.save')).toEqual([]);
    });

    test('closes on Escape the page frame hands over, which first lets go of an element picked with Comment', async () => {
        listing = [page('Sign in.html', 100)];
        await open([taskRow('designer', 'done')]);
        await until(() => button('Open design') !== null);
        await openDesign();
        const say = await standInFrame();

        await clickOn(overlay()!.querySelector('[aria-label="Comment"]'));
        await say(DESIGN_METHODS.pick, { tool: 'comment', element: ELEMENT });
        await until(() => overlay()?.querySelector('textarea') != null);

        await say(DESIGN_METHODS.escape, {});
        await until(() => overlay()?.querySelector('textarea') == null);
        expect(overlay()).not.toBeNull();

        await say(DESIGN_METHODS.escape, {});
        await closedOnCard();
    });

    test('leaves the first Escape to a menu open inside it', async () => {
        listing = [page('Sign in.html', 100), page('Sign up.html', 200)];
        await open([taskRow('designer', 'done')]);
        await until(() => button('Open design') !== null);
        await openDesign();
        await until(() => overlay()?.querySelector('[aria-label="Page: Sign up"]') != null);

        await clickOn(overlay()!.querySelector('[aria-label="Page: Sign up"]'));
        await until(() => document.querySelector('[role="menu"]') !== null);
        await pressKey(document.querySelector('[role="menu"]')!, 'Escape');
        await until(() => document.querySelector('[role="menu"]') === null);
        expect(overlay()).not.toBeNull();

        await pressKey(overlay()!, 'Escape');
        await closedOnCard();
    });

    test('follows a page the agent writes until a person picks one, then keeps theirs, and never lists a file the agent keeps for itself', async () => {
        listing = [page('Sign in.html', 100), page('Sign up.html', 200)];
        await open([taskRow('designer', 'running')]);
        await until(() => button('Open design') !== null);
        await clickOn(button('Open design'));
        await until(() => button('Page: Sign up') !== null);

        listing = [...listing, page('Reset.html', 300)];
        await act(async () => machine.emit('fs.changed', { root: '/work/atlas', paths: [FOLDER] }));
        await until(() => button('Page: Reset') !== null);

        await clickOn(button('Page: Reset'));
        await until(() => document.querySelector('[aria-label="Sign in"] [role="menuitem"]') !== null);
        await clickOn(document.querySelector('[aria-label="Sign in"] [role="menuitem"]'));
        await until(() => button('Page: Sign in') !== null);

        listing = [...listing, page('_tmp-check.html', 400), page('Checkout.html', 500)];
        await act(async () => machine.emit('fs.changed', { root: '/work/atlas', paths: [FOLDER] }));
        await clickOn(button('Page: Sign in'));
        await until(() => document.querySelector('[aria-label="Checkout"] [role="menuitem"]') !== null);

        expect(button('Page: Sign in')).not.toBeNull();
        expect(document.querySelector('[aria-label="_tmp-check"]')).toBeNull();
    });

    test('says so in a toast when the folder is gone, and opens nothing', async () => {
        listing = [page('Sign in.html', 100)];
        await open([taskRow('designer', 'done')]);
        await until(() => button('Open design') !== null);

        listing = null;
        await clickOn(button('Open design'));
        await until(() => document.body.textContent?.includes("The design's folder is gone.") === true);

        expect(overlay()).toBeNull();
        expect(card()).not.toBeNull();
    });
});

describe('opening the design from the card of a chat node on a canvas', () => {
    test('opens the same overlay, and Escape from the page frame puts the focus back on the card in the node', async () => {
        listing = [page('Sign in.html', 100)];
        const main: ProjectCanvasView = {
            kind: 'canvas',
            id: 'main',
            name: 'Main',
            nodes: [{ id: 'lead-node', kind: 'chat', title: 'Lead', provider: 'claude', x: 0, y: 0, w: 560, h: 360 }],
            texts: [],
            edges: [],
            layouts: []
        };
        machine.answer(
            'chat.attach',
            ({ chatId }) => ({ info: chatInfoOf(chatId), items: chatId === 'lead-node' ? [taskRow('designer', 'done')] : [], seq: 0 }) as never
        );
        workspace = await openFakeWorkspace(machine, { views: [main] }, { activeViewId: main.id, views: {} });
        mounted = mount();
        await mounted.renderApp();
        await until(() => button('Open design') !== null);
        expect(card()!.closest('[data-chat-body="lead-node"]')).not.toBeNull();

        await openDesign();
        await until(() => overlay()?.querySelector('[data-chat-body="designer"]') != null);
        const say = await standInFrame();

        await say(DESIGN_METHODS.escape, {});
        await closedOnCard();

        expect(machine.requests('project.save')).toEqual([]);
    });
});
