import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { FsEntry, ProjectView } from '@ruimte/contracts';
import { useDesignChat } from '@/design/design-chat';
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
    useDesignChat.setState({ picked: {}, pages: {} });
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
