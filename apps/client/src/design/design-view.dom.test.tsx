import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { REQUEST_SCHEMAS, type FsEntry, type ProjectView, type RequestType } from '@ruimte/contracts';
import { act } from 'react';
import { DESIGN_METHODS } from '@/design/design-protocol';
import { useDesignChat } from '@/state/design-chat';
import { useDocument } from '@/state/document';
import { TransportError } from '@/transport-api/transport';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, layOutChat, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const FOLDER = '/work/atlas/.ruimte/private/designs/pricing';

function page(name: string, mtime: number): FsEntry {
    return { name, path: `${FOLDER}/${name}`, kind: 'file', size: 10, mtime, hidden: false, ignored: false };
}

const DESIGN: ProjectView = { kind: 'design', id: 'pricing', name: 'Pricing', path: 'pricing', node: { provider: 'claude' } };

const EVERY_REQUEST = Object.keys(REQUEST_SCHEMAS) as RequestType[];

const PAGES = [page('1a Calm.html', 100), page('2a Dense.html', 300), page('1b Bold.html', 200)];

let machine: FakeMachine;
let workspace: FakeWorkspace;
let mounted: Mounted;
let restoreLayout: () => void;
// What the design folder holds, which a test changes as a delete or the chat would.
let listing: FsEntry[];
// The error the machine answers the folder's listing with, as an unreadable or missing folder does.
let listError: TransportError | null;

beforeEach(async () => {
    localStorage.clear();
    useDesignChat.setState({ picked: {}, pages: {}, cameras: {} });
    restoreLayout = layOutChat();
    listing = PAGES;
    machine = new FakeMachine();
    // A machine from before `design.page`, so the page is built here from the files it reads; the tests of that request turn it on.
    machine.answersOnly(EVERY_REQUEST.filter((type) => type !== 'design.page'));
    listError = null;
    machine.answer('fs.list', ({ path }) => {
        if (path === FOLDER && listError !== null) {
            throw listError;
        }

        return { path, entries: path === FOLDER ? listing : [], truncated: false };
    });
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
        expect(machine.requests('design.page')).toEqual([]);
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

    test('says a folder that cannot be read could not be read, not that the design has no pages', async () => {
        listError = new TransportError('not-readable', 'That folder cannot be read');
        await mounted.unmount();
        mounted = mount();
        await mounted.renderApp();

        await until(() => mounted.host.textContent?.includes('The pages could not be read') === true);

        expect(mounted.host.textContent).toContain('That folder cannot be read');
        expect(mounted.host.textContent).not.toContain('No pages yet');

        listError = null;
        await clickOn(button('Read again'));
        await until(() => shownPage() === '2a Dense');

        expect(mounted.host.textContent).not.toContain('The pages could not be read');
    });

    test('keeps the pages shown when a refresh fails, with the failure and a way to try again', async () => {
        await until(() => shownPage() === '2a Dense');

        listError = new TransportError('not-readable', 'That folder cannot be read');
        await act(async () => machine.emit('fs.changed', { root: '/work/atlas', paths: [FOLDER] }));
        await until(() => mounted.host.textContent?.includes('The pages could not be read') === true);

        expect(shownPage()).toBe('2a Dense');
        expect(mounted.host.textContent).not.toContain('No pages yet');

        listError = null;
        await clickOn(button('Try again'));
        await until(() => mounted.host.textContent?.includes('The pages could not be read') === false);

        expect(shownPage()).toBe('2a Dense');
    });

    test('shows an empty design for a folder that is not there yet', async () => {
        listError = new TransportError('not-found', 'That folder is not there');
        await mounted.unmount();
        mounted = mount();
        await mounted.renderApp();

        await until(() => mounted.host.textContent?.includes('No pages yet') === true);

        expect(mounted.host.textContent).not.toContain('The pages could not be read');
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

    test('shows a page the chat makes, also over a page a person picked', async () => {
        await until(() => shownPage() === '2a Dense');
        await clickOn(mounted.host.querySelector('button[aria-label="Page: 2a Dense"]'));
        await until(() => button('1a Calm') !== null);
        await clickOn(document.querySelector('[aria-label="1a Calm"] [role="menuitem"]'));
        await until(() => shownPage() === '1a Calm');

        listing = [...PAGES, page('3a Airy.html', 400)];
        await act(async () => machine.emit('fs.changed', { root: '/work/atlas', paths: [FOLDER] }));
        await until(() => shownPage() === '3a Airy');
    });

    test('stays on the page while a comment on it waits to be sent', async () => {
        await until(() => shownPage() === '2a Dense');

        const frame = { postMessage: () => undefined };
        const stand = document.createElement('iframe');
        const element = {
            selector: 'h1',
            option: null,
            name: 'h1',
            html: '<h1>Pricing</h1>',
            text: 'Pricing',
            rect: { x: 0, y: 0, width: 100, height: 20 },
            style: {}
        };

        Object.defineProperty(stand, 'contentWindow', { value: frame });
        mounted.host.querySelector('button[aria-label^="Page: "]')?.parentElement?.nextElementSibling?.prepend(stand);
        await clickOn(button('Comment'));
        await act(async () => {
            window.dispatchEvent(
                new MessageEvent('message', {
                    source: frame as never,
                    data: { jsonrpc: '2.0', method: DESIGN_METHODS.pick, params: { tool: 'comment', element } }
                })
            );
        });
        await until(() => document.querySelector('textarea') !== null);
        await act(async () => {
            const area = document.querySelector('textarea')!;

            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'Make it larger');
            area.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await clickOn(button('Add comment'));
        await until(() => button('Send 1 comment') !== null);

        listing = [...PAGES, page('3a Airy.html', 400)];
        await act(async () => machine.emit('fs.changed', { root: '/work/atlas', paths: [FOLDER] }));
        await clickOn(mounted.host.querySelector('button[aria-label="Page: 2a Dense"]'));
        await until(() => button('3a Airy') !== null);

        expect(shownPage()).toBe('2a Dense');
    });
});

describe('a design view on a machine that builds its pages', () => {
    async function showAgain(): Promise<void> {
        machine.answersOnly(EVERY_REQUEST);
        await mounted.unmount();
        mounted = mount();
        await mounted.renderApp();
    }

    test('asks the machine for the page and reads it as bytes', async () => {
        const html = '<!doctype html><title>Built</title>';

        machine.answer('design.page', () => ({ kind: 'page' as const, pageId: 'page-1', size: html.length }));
        machine.answer('bytes.read', ({ offset }) => ({
            mime: 'text/html; charset=utf-8',
            size: html.length,
            version: 'page-1',
            offset,
            data: btoa(html.slice(offset))
        }));
        await showAgain();

        await until(() => machine.requests('bytes.read').length > 0 && mounted.host.querySelector('[role="progressbar"]') === null);

        expect(machine.requests('design.page')).toEqual([{ projectId: expect.any(String), designId: 'pricing', file: '2a Dense.html' }]);
        expect(machine.requests('bytes.read')[0]!.resource).toEqual({ kind: 'designPage', pageId: 'page-1' });
        expect(mounted.host.textContent).not.toContain('Could not show');
    });

    test('says in its own words why the machine built no page', async () => {
        machine.answer('design.page', ({ file }) => ({ kind: 'too-large' as const, name: file, size: 17 * 1024 * 1024, limit: 16 * 1024 * 1024 }));
        await showAgain();

        await until(() => mounted.host.textContent?.includes('a page holds at most') === true);

        expect(mounted.host.textContent).toContain('Could not show 2a Dense.html');
        expect(machine.requests('bytes.read')).toEqual([]);
    });

    test.each([
        ['a kind it does not know', { kind: 'locked', name: '2a Dense.html' }],
        ['a held page it cannot read', { kind: 'page', pageId: 'page-1', size: 'large' }]
    ])('asks to update Ruimte for a result of a newer machine with %s, and reads no page', async (_name, result) => {
        machine.answerFromNewer('design.page', () => result);
        await showAgain();

        await until(() => mounted.host.textContent?.includes('Update Ruimte to see this.') === true);

        expect(machine.requests('bytes.read')).toEqual([]);
    });
});
