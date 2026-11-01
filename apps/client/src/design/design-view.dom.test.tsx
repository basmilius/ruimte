import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { act } from 'react';
import type { FsEntry, ProjectView } from '@ruimte/contracts';
import { useDesignChat } from '@/design/design-chat';
import { DESIGN_METHODS } from '@/design/design-protocol';
import { useDocument } from '@/state/document';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, layOutChat, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const FOLDER = '/work/atlas/.ruimte/private/designs/pricing';

function page(name: string, mtime: number): FsEntry {
    return { name, path: `${FOLDER}/${name}`, kind: 'file', size: 10, mtime, hidden: false, ignored: false };
}

const DESIGN: ProjectView = { kind: 'design', id: 'pricing', name: 'Pricing', path: 'pricing', node: { provider: 'claude' } };

const PAGES = [page('1a Calm.html', 100), page('2a Dense.html', 300), page('1b Bold.html', 200)];

let machine: FakeMachine;
let workspace: FakeWorkspace;
let mounted: Mounted;
let restoreLayout: () => void;
// What the design folder holds, which a test changes as a delete or the chat would.
let listing: FsEntry[];

beforeEach(async () => {
    localStorage.clear();
    useDesignChat.setState({ picked: {}, pages: {}, cameras: {} });
    restoreLayout = layOutChat();
    listing = PAGES;
    machine = new FakeMachine();
    machine.answer('fs.list', ({ path }) => ({ path, entries: path === FOLDER ? listing : [], truncated: false }));
    machine.answer('fs.delete', () => ({}) as never);
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [DESIGN] }, { activeViewId: DESIGN.id, views: {} });
    mounted = mount();
    await mounted.renderApp();
});

afterEach(async () => {
    await mounted.unmount();
    workspace.close();
    restoreLayout();
});

/* The name of the page the stage shows, as its switcher reads it. */
function shownPage(): string | null {
    const trigger = mounted.host.querySelector<HTMLButtonElement>('button[aria-label^="Page: "]');

    return trigger?.getAttribute('aria-label')?.slice('Page: '.length) ?? null;
}

function button(label: string): HTMLElement | null {
    return (
        document.querySelector<HTMLElement>(`[aria-label="${label}"]`) ??
        [...document.querySelectorAll<HTMLElement>('button')].find((each) => each.textContent === label) ??
        null
    );
}

describe('a design view', () => {
    test('gives a page the camera a person left it at when the view opens again', async () => {
        const camera = { x: -120, y: 40, zoom: 0.5 };
        const posted: { method: string; params?: unknown }[] = [];
        const frame = { postMessage: (message: { method: string; params?: unknown }) => posted.push(message) };

        // The real frame waits for a measured width, which this DOM never has; a stand-in beside it speaks for the page.
        const openPage = async (): Promise<void> => {
            await until(() => shownPage() !== null);

            const stand = document.createElement('iframe');
            const box = mounted.host.querySelector('button[aria-label^="Page: "]')?.parentElement?.nextElementSibling;

            Object.defineProperty(stand, 'contentWindow', { value: frame });
            box?.prepend(stand);
        };

        const say = (method: string, params: object): Promise<void> =>
            act(async () => {
                window.dispatchEvent(new MessageEvent('message', { source: frame as never, data: { jsonrpc: '2.0', method, params } }));
            });

        await openPage();
        await say(DESIGN_METHODS.camera, camera);
        await mounted.unmount();

        mounted = mount();
        await mounted.renderApp();
        await openPage();
        await say(DESIGN_METHODS.ready, { canvas: true, tweaks: null });

        expect(posted.find((message) => message.method === DESIGN_METHODS.camera)?.params).toEqual(camera);
    });

    test('a press in the page focuses its cell and leaves the keyboard in the page', async () => {
        await until(() => shownPage() !== null);

        const frame = { postMessage: () => undefined };
        const stand = document.createElement('iframe');

        Object.defineProperty(stand, 'contentWindow', { value: frame });
        mounted.host.querySelector('button[aria-label^="Page: "]')?.parentElement?.nextElementSibling?.prepend(stand);
        act(() => useDocument.getState().setBodyFocused(false));

        await act(async () => {
            window.dispatchEvent(new MessageEvent('message', { source: frame as never, data: { jsonrpc: '2.0', method: DESIGN_METHODS.press, params: {} } }));
        });

        expect(useDocument.getState().bodyFocused).toBe(true);
        expect(document.activeElement).toBe(stand);
    });

    test('says why a page larger than a page may be does not show', async () => {
        machine.answer('fs.read', () => ({ kind: 'too-large' as const, size: 17 * 1024 * 1024, mtime: 300 }));
        await mounted.unmount();
        mounted = mount();
        await mounted.renderApp();

        await until(() => mounted.host.textContent?.includes('a page holds at most') === true);

        expect(mounted.host.textContent).toContain('Could not show 2a Dense.html');
    });

    test('reads a page past what one frame carries as bytes', async () => {
        const html = `<!doctype html><title>Large</title>${'x'.repeat(16)}`;
        const fetched = spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(html)) as unknown as typeof fetch);

        machine.answer('fs.read', () => ({ kind: 'too-large' as const, size: 3 * 1024 * 1024, mtime: 300 }));
        await mounted.unmount();
        mounted = mount();
        await mounted.renderApp();

        await until(() => fetched.mock.calls.length > 0 && mounted.host.querySelector('[role="progressbar"]') === null);

        expect(mounted.host.textContent).not.toContain('Could not show');
        fetched.mockRestore();
    });

    test('reads a page again after it failed, from the button that says so', async () => {
        let reads = 0;

        machine.answer('fs.read', () => {
            reads += 1;

            if (reads === 1) {
                throw new Error('The line dropped');
            }

            return { kind: 'text' as const, text: '<p>a page</p>', encoding: 'utf-8' as const, size: 13, mtime: 300 };
        });
        await mounted.unmount();
        mounted = mount();
        await mounted.renderApp();

        await until(() => mounted.host.textContent?.includes('The line dropped') === true);
        await clickOn(button('Read again')!);
        await until(() => reads === 2 && mounted.host.textContent?.includes('The line dropped') === false);

        expect(reads).toBe(2);
    });

    test('opens the page last worked on', async () => {
        await until(() => shownPage() !== null);

        expect(shownPage()).toBe('2a Dense');
    });

    test('lists the pages in its menu the most recently changed first', async () => {
        await until(() => shownPage() === '2a Dense');

        await clickOn(mounted.host.querySelector('button[aria-label="Page: 2a Dense"]'));
        await until(() => button('Delete 2a Dense') !== null);

        const rows = [...document.querySelectorAll<HTMLElement>('[role="menu"] [aria-label]:has([role="menuitem"])')];

        expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['2a Dense', '1b Bold', '1a Calm']);
        expect(rows[0]?.textContent).toContain('Changed');
    });

    test('moves a page to the trash from its row in the menu, and then shows the page worked on before it', async () => {
        await until(() => shownPage() === '2a Dense');

        await clickOn(mounted.host.querySelector('button[aria-label="Page: 2a Dense"]'));
        await until(() => button('Delete 2a Dense') !== null);
        await clickOn(button('Delete 2a Dense'));
        await until(() => button('Move to trash') !== null);
        await clickOn(button('Move to trash'));
        await until(() => machine.requests('fs.delete').length > 0);

        expect(machine.requests('fs.delete').map((request) => request.path)).toEqual([`${FOLDER}/2a Dense.html`]);

        listing = PAGES.filter((entry) => entry.name !== '2a Dense.html');
        await act(async () => machine.emit('fs.changed', { root: '/work/atlas', paths: [FOLDER] }));
        await until(() => shownPage() === '1b Bold');
    });
});
