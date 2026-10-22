import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProviderInfo } from '@ruimte/contracts';
import { useFiles } from '@/state/files';
import { chatInfoOf } from '../../../testing/chat-info';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';

const CLAUDE = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: '2.1.0',
    models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
    defaultModel: 'model',
    capabilities: { chat: true, terminal: true, hooks: true, attachments: true, mentions: true },
    resumeCommand: 'claude --resume {id}'
} as unknown as ProviderInfo;

const REPLY = { id: 'reply', kind: 'assistant', createdAt: 0, turnId: null, text: 'It starts in `index.ts`.', streaming: false };

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

// A view of its own per test, so the thread of one test is never the next one's.
let views = 0;
let chatId: string;
let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function link(): HTMLElement | null {
    return page.host.ownerDocument.querySelector<HTMLElement>('button[data-file-path="index.ts"]');
}

function onScreen(text: string): boolean {
    return page.host.ownerDocument.body.textContent?.includes(text) === true;
}

beforeEach(async () => {
    // happy-dom lays nothing out; without a height of its own the thread's scroller shows no row at all.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get(this: HTMLElement) {
            return this.classList.contains('chat-scroll') ? 800 : (offsetHeight?.get?.call(this) ?? 0);
        }
    });
    views += 1;
    chatId = `chat-link-${views}`;
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId: id }) => ({ info: chatInfoOf(id), items: [REPLY], seq: 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [{ kind: 'chat', id: chatId, name: 'Chat', node: { provider: 'claude' } }] } as never, {
        activeViewId: chatId,
        views: {}
    });
    page = mount();
    await page.renderApp();
    await until(() => link() !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    if (offsetHeight !== undefined) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
    }
});

describe('a file link that names only the file', () => {
    test('asks the machine where it is and opens the one file it found', async () => {
        machine.answer('fs.locate', () => ({ matches: ['/work/atlas/src/index.ts'] }));
        await clickOn(link()!);
        await until(() => useFiles.getState().tabs.some((tab) => tab.key === '/work/atlas/src/index.ts'));
        expect(machine.requests('fs.locate')[0]).toMatchObject({ path: 'index.ts', cwd: '/work/atlas' });
    });

    test('lets a person pick when it fits several files', async () => {
        machine.answer('fs.locate', () => ({ matches: ['/work/atlas/src/index.ts', '/work/atlas/packages/a/index.ts'] }));
        await clickOn(link()!);
        await until(() => onScreen('packages/a/index.ts'));
        expect(onScreen('src/index.ts')).toBe(true);
        // The choice lives outside the page, so a dialog left open shows up in whichever test draws the app next.
        const cancel = [...page.host.ownerDocument.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
            (button) => button.textContent === 'Cancel'
        );
        await clickOn(cancel!);
        await until(() => !onScreen('packages/a/index.ts'));
    });

    test('says so when the machine finds nothing', async () => {
        machine.answer('fs.locate', () => ({ matches: [] }));
        await clickOn(link()!);
        await until(() => onScreen('index.ts is not on this machine'));
    });
});
