import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    REQUEST_SCHEMAS,
    type HostChange,
    type HostIssue,
    type HostIssueSummary,
    type HostLink,
    type HostProviderStatus,
    type ProjectView,
    type RequestType
} from '@ruimte/contracts';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything, typeInto } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const PROJECT_ID = 'project-atlas';
const CRASH = 'trackline:ATL-12';
const TYPO = 'trackline:ATL-15';
const PROMPT = 'Work on this issue.\n| The export crashes on an empty sheet.';

const TRACKLINE: HostProviderStatus = {
    provider: 'trackline',
    extension: 'dev.trackline',
    title: 'Trackline',
    kind: 'tracker',
    issues: true,
    changes: false,
    checks: false,
    state: 'ready',
    account: 'robin'
};

const BOARDWALK: HostProviderStatus = {
    provider: 'boardwalk',
    extension: 'dev.boardwalk',
    title: 'Boardwalk',
    kind: 'code-host',
    remote: 'https://boardwalk.example/atlas/atlas.git',
    repo: 'atlas',
    issues: true,
    changes: true,
    checks: true,
    state: 'signed-out',
    reason: 'Sign in to Boardwalk on this machine to see its issues.'
};

const ISSUES: HostIssueSummary[] = [
    { ref: CRASH, title: 'Export crashes on an empty sheet', state: 'open', assignees: ['robin'], labels: ['bug'] },
    { ref: TYPO, title: 'Typo on the welcome page', state: 'open', assignees: ['robin'], labels: [] }
];

const CRASH_ISSUE: HostIssue = {
    ...ISSUES[0]!,
    author: 'sam',
    body: 'Open an empty sheet and press <b>Export</b>.',
    comments: [],
    changes: [{ ref: 'boardwalk:41', title: 'Guard the empty sheet', state: 'open', checkState: 'failure' }]
};

function linkOf(chatId: string, ref: string): HostLink {
    return { chatId, ref, title: 'Export crashes on an empty sheet', state: 'open', linkedAt: 1, by: 'person' };
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let providers: HostProviderStatus[];

beforeEach(() => {
    machine = new FakeMachine();
    providers = [TRACKLINE, BOARDWALK];
    machine.answer('host.status', () => ({ providers }));
    machine.answer('host.issues', ({ query }) => ({ issues: query === undefined ? ISSUES : [ISSUES[0]!] }));
    machine.answer('host.links', () => ({ links: [linkOf('chat-a', CRASH), linkOf('chat-b', CRASH)] }));
    machine.answer('host.issue', () => ({ issue: CRASH_ISSUE }));
    machine.answer('host.issuePrompt', () => ({ prompt: PROMPT, title: CRASH_ISSUE.title, branch: 'issue/atl-12' }));
    machine.answer('host.link', ({ chatId, ref }) => ({ link: linkOf(chatId, ref) }));
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('chat.send', () => ({ queued: false, turnId: 'turn-1' }));
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

async function openProject(): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
}

function railButton(): Element | null {
    return document.querySelector('button[aria-label="Issues"]');
}

async function openPanel(): Promise<void> {
    await openProject();
    await until(() => railButton() !== null);
    await clickOn(railButton());
    await until(() => everything().includes('Export crashes on an empty sheet'));
}

describe('the issues panel', () => {
    test('lists the open issues assigned to the person, and says why a host that is signed out shows none', async () => {
        await openPanel();

        expect(everything()).toContain('Typo on the welcome page');
        expect(everything()).toContain('ATL-12');
        expect(everything()).toContain('Boardwalk');
        expect(everything()).toContain('Sign in to Boardwalk on this machine to see its issues.');
        expect(machine.requests('host.issues')).toEqual([{ projectId: PROJECT_ID, provider: 'trackline', assigned: true, state: 'open' }]);
        expect(machine.requests('host.watch')).toEqual([{ projectId: PROJECT_ID }]);
    });

    test('counts the chats that work on an issue, and follows a link made elsewhere', async () => {
        await openPanel();

        expect(document.querySelector('[aria-label="2 chats"]')).not.toBeNull();

        machine.answer('host.links', () => ({ links: [linkOf('chat-a', CRASH), linkOf('chat-b', CRASH), linkOf('chat-c', CRASH), linkOf('chat-c', TYPO)] }));
        machine.emit('host.linksChanged', { chatId: 'chat-c' });
        await until(() => document.querySelector('[aria-label="3 chats"]') !== null);

        expect(document.querySelector('[aria-label="1 chat"]')).not.toBeNull();
    });

    test('asks the host for what a person searches, and for everything once the filters are off', async () => {
        await openPanel();
        const search = document.querySelector<HTMLInputElement>('input[aria-label="Search issues"]')!;

        await typeInto(search, 'crash');
        await pressKey(search, 'Enter');
        await until(() => !everything().includes('Typo on the welcome page'));

        expect(machine.requests('host.issues').at(-1)).toEqual({ projectId: PROJECT_ID, provider: 'trackline', assigned: true, state: 'open', query: 'crash' });

        await typeInto(search, '');
        await clickOn(buttonWithText('Assigned to me'));
        await clickOn(buttonWithText('Open'));
        await until(() => machine.requests('host.issues').at(-1)?.state === 'all');

        expect(machine.requests('host.issues').at(-1)).toEqual({ projectId: PROJECT_ID, provider: 'trackline', state: 'all' });
    });

    test('loads the next page from where the host left off', async () => {
        machine.answer('host.issues', ({ cursor }) => (cursor === undefined ? { issues: [ISSUES[0]!], cursor: 'page-2' } : { issues: [ISSUES[1]!] }));
        await openPanel();

        expect(everything()).not.toContain('Typo on the welcome page');

        await clickOn(buttonWithText('Load more'));
        await until(() => everything().includes('Typo on the welcome page'));

        expect(machine.requests('host.issues').at(-1)).toEqual({
            projectId: PROJECT_ID,
            provider: 'trackline',
            assigned: true,
            state: 'open',
            cursor: 'page-2'
        });
        expect(buttonWithText('Load more')).toBeNull();
    });

    test('is not in the rail of a project no host answers for', async () => {
        providers = [];
        await openProject();
        await until(() => machine.requests('host.status').length > 0);
        await until(() => document.querySelector('button[aria-label="Files"]') !== null);

        expect(railButton()).toBeNull();
        expect(machine.requests('host.links')).toEqual([]);
    });

    test('is not in the rail on a machine that knows no hosts, which is never asked', async () => {
        machine.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => !type.startsWith('host.')));
        await openProject();
        await until(() => document.querySelector('button[aria-label="Files"]') !== null);

        expect(railButton()).toBeNull();
        expect(machine.sent.filter((request) => request.type.startsWith('host.'))).toEqual([]);
    });
});

describe('a chat', () => {
    const LEAD: ProjectView = { kind: 'chat', id: 'chat-a', name: 'Lead', node: {} };
    const CHANGE: HostChange = {
        ref: 'boardwalk:41',
        title: 'Guard the empty sheet',
        state: 'open',
        url: 'https://boardwalk.example/atlas/atlas/changes/41',
        checkState: 'failure',
        body: '',
        headSha: 'abc1234',
        checks: [{ name: 'test', state: 'failure' }],
        threads: [],
        size: { additions: 4, deletions: 1, files: 1 },
        closes: [CRASH]
    };

    async function openChat(): Promise<void> {
        workspace = await openFakeWorkspace(machine, { views: [LEAD] }, { activeViewId: LEAD.id, views: {} });
        page = mount();
        await page.renderApp();
    }

    test('shows the issue it works on and the change of its branch with the state of its checks', async () => {
        providers = [TRACKLINE, { ...BOARDWALK, state: 'ready', reason: undefined }];
        machine.answer('host.change', () => ({ change: CHANGE }));
        await openChat();
        await until(() => document.querySelector('a[aria-label="Guard the empty sheet. Open. Checks failed."]') !== null);

        expect(buttonWithText('ATL-12')).not.toBeNull();
        expect(machine.requests('host.change')).toEqual([{ projectId: PROJECT_ID, chatId: LEAD.id }]);

        await clickOn(buttonWithText('ATL-12'));
        await until(() => everything().includes('Opened by sam'));
    });

    test('is asked about no change where no host reads changes', async () => {
        providers = [TRACKLINE];
        await openChat();
        await until(() => buttonWithText('ATL-12') !== null);

        expect(machine.requests('host.change')).toEqual([]);
    });
});

describe('an issue', () => {
    async function openIssue(): Promise<void> {
        await openPanel();
        await clickOn([...document.querySelectorAll('button')].find((row) => row.textContent?.includes('Export crashes')) ?? null);
        await until(() => everything().includes('Opened by sam'));
    }

    test('shows its text as text, its changes with their checks and the chats on it', async () => {
        await openIssue();

        expect(everything()).toContain('Open an empty sheet and press <b>Export</b>.');
        expect(document.querySelector('[role="dialog"] b')).toBeNull();
        expect(everything()).toContain('Guard the empty sheet');
        expect(document.querySelector('[role="dialog"] [aria-label="Checks failed"]')).not.toBeNull();
        expect(machine.requests('host.issue')).toEqual([{ projectId: PROJECT_ID, ref: CRASH }]);
        expect(machine.requests('host.watch')).toContainEqual({ projectId: PROJECT_ID, ref: CRASH });
    });

    test('starts a chat that is linked to it and opens with what the machine worded', async () => {
        await openIssue();
        await clickOn(buttonWithText('Start a chat'));
        await until(() => machine.requests('chat.send').length > 0);

        const made = machine.chatsMade();
        const chatId = made[0]!.chatId;

        expect(made).toHaveLength(1);
        expect(machine.requests('host.issuePrompt')).toEqual([{ projectId: PROJECT_ID, ref: CRASH }]);
        expect(machine.requests('host.link')).toEqual([{ projectId: PROJECT_ID, chatId, ref: CRASH }]);
        expect(machine.requests('chat.send')).toEqual([expect.objectContaining({ chatId, text: PROMPT })]);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(everything()).toContain('Export crashes on an empty sheet');
    });
});
