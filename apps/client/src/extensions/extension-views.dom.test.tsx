import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { emptyCanvasView, ProjectViewSchema, type ExtensionManifest, type ProjectView } from '@ruimte/contracts';
import { clientApiFor } from '@/extensions/host/client-api';
import { forgetExtension, registerExtension } from '@/extensions/host/runtime';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const MAIN = emptyCanvasView('main', 'Main');

// Read the way a project file is: an extension's view, one of an extension this window lacks, and a kind from a newer Ruimte.
const PROBE_VIEW = ProjectViewSchema.parse({ kind: 'extension', id: 'probe-view', name: 'Board', extension: 'acme.views', type: 'board', params: { lane: 2 } });
const ABSENT_VIEW = ProjectViewSchema.parse({ kind: 'extension', id: 'absent-view', name: 'Elsewhere', extension: 'acme.absent', type: 'board' });
const NEWER_VIEW = ProjectViewSchema.parse({ kind: 'hologram', id: 'newer-view', name: 'Hologram' });

function BoardBody({ params }: { params: unknown }) {
    return <p>{`Board with ${JSON.stringify(params ?? null)}`}</p>;
}

// A chat this machine started in another project's folder, which the view draws.
const CHAT_VIEW = ProjectViewSchema.parse({ kind: 'extension', id: 'chat-view', name: 'Write it down', extension: 'acme.views', type: 'chat' });

let machine = new FakeMachine();
let workspace: FakeWorkspace | null = null;
let page: Mounted | null = null;

beforeAll(() => {
    const manifest: ExtensionManifest = { id: 'acme.views', name: 'Views', version: '0.1.0', api: 1, permissions: { 'chats.read': 'Draws a chat' } };
    const extension = { manifest, base: '/', disposers: [], settings: null };
    const api = clientApiFor(extension);

    registerExtension(extension);
    api.defineView({ id: 'board', title: 'Board view', component: async () => ({ default: BoardBody }) });
    api.defineView({ id: 'chat', title: 'Chat view', component: async () => ({ default: () => <api.Chat id="plans-chat" folder="/work/plans" /> }) });
});
afterAll(() => forgetExtension('acme.views'));
afterEach(async () => {
    await page?.unmount();
    workspace?.close();
    page = null;
    workspace = null;
});

async function openWith(views: ProjectView[]): Promise<void> {
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [MAIN, ...views] }, { activeViewId: 'main', views: {} });
    page = mount();
    await page.renderApp();
    await until(() => sidebarRow('Main') !== null);
}

function sidebarRow(name: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[data-sidebar-row]')].find((row) => row.textContent?.trim() === name) ?? null;
}

function button(name: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('button')].find((each) => each.textContent?.trim() === name) ?? null;
}

function menuRow(name: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((row) => row.textContent?.trim() === name) ?? null;
}

describe('views of an extension', () => {
    test('open from the sidebar with what the view keeps', async () => {
        await openWith([PROBE_VIEW]);
        await clickOn(sidebarRow('Board'));
        await until(() => document.body.textContent?.includes('Board with {"lane":2}') ?? false);

        expect(sidebarRow('Board')?.getAttribute('aria-disabled')).toBeNull();
    });

    test('open without their extension and name the one they need', async () => {
        await openWith([ABSENT_VIEW]);
        await clickOn(sidebarRow('Elsewhere'));
        await until(() => document.body.textContent?.includes('This needs an extension') ?? false);

        expect(document.body.textContent).toContain('acme.absent');
    });

    test('stay closed when a newer Ruimte made their kind', async () => {
        await openWith([NEWER_VIEW]);

        expect(sidebarRow('Hologram')?.getAttribute('aria-disabled')).toBe('true');
    });

    test('are offered under New view, which adds one and opens it', async () => {
        await openWith([]);
        await clickOn(button('New view'));
        await until(() => menuRow('Board view') !== null);
        await clickOn(menuRow('Board view'));
        await until(() => sidebarRow('Board view') !== null && (document.body.textContent?.includes('Board with null') ?? false));
    });

    test("draw a chat of another project's folder, which opens there", async () => {
        await openWith([CHAT_VIEW]);
        await clickOn(sidebarRow('Write it down'));
        await until(() => machine.requests('chat.create').length > 0);

        expect(machine.requests('chat.create')[0]).toMatchObject({ chatId: 'plans-chat', cwd: '/work/plans' });
    });
});
