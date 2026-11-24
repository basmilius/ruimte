import { describe, expect, test } from 'bun:test';
import type { HostProviderMethod } from '@ruimte/contracts';
import { Hosts, type DefinedProvider, type HostCheckout, type HostProviderPort } from './hosts.ts';

const PROJECT = { id: 'p1', name: 'Shop', folder: '/work/shop' };
const SHOP = 'git@code.test:acme/shop.git';
const DOCS = 'https://code.test/acme/docs.git';

function defined(id: string, parts: Partial<DefinedProvider> = {}): DefinedProvider {
    return { extension: `ext.${id}`, id, title: id, matches: false, issues: true, parses: false, changes: false, checks: false, ...parts };
}

type Answers = Partial<Record<HostProviderMethod, (...args: never[]) => unknown>>;

interface World {
    hosts: Hosts;
    asked: Array<[string, HostProviderMethod, ...unknown[]]>;
    notes: string[];
    changed: string[];
    providers: DefinedProvider[];
}

function world(providers: DefinedProvider[], answers: Record<string, Answers>, checkouts: HostCheckout[] = [], cwds: Record<string, string> = {}): World {
    const asked: World['asked'] = [];
    const notes: string[] = [];
    const changed: string[] = [];
    const port: HostProviderPort = {
        list: async () => providers,
        ask: async (_extension, provider, method, args) => {
            asked.push([provider, method, ...args]);

            const answer = answers[provider]?.[method];

            if (answer === undefined) {
                throw new Error(`${provider} has no ${method}`);
            }

            return (answer as (...values: unknown[]) => unknown)(...args);
        },
        note: (extension, line) => void notes.push(`${extension}: ${line}`)
    };
    const hosts = new Hosts({
        providers: port,
        projectOf: async (projectId) => (projectId === PROJECT.id ? PROJECT : null),
        checkouts: {
            repos: async () => checkouts,
            of: async (folder) => checkouts.find((checkout) => checkout.path === folder) ?? null
        },
        cwdOf: async (chatId) => cwds[chatId] ?? null,
        changed: (projectId) => void changed.push(projectId)
    });

    return { hosts, asked, notes, changed, providers };
}

const READY = { status: () => ({ state: 'ready', account: 'mira' }) };
const CODE: Answers = { ...READY, match: (remote: string) => remote.includes('code.test') };

describe('the hosts of a project', () => {
    test('are a code host for every checkout whose remote it takes, and a tracker that says the project is its own', async () => {
        const { hosts } = world(
            [defined('code', { matches: true, changes: true, checks: true }), defined('tracker'), defined('elsewhere')],
            { code: CODE, tracker: READY, elsewhere: { status: () => ({ state: 'not-configured' }) } },
            [
                { path: '/work/shop', label: 'shop', remotes: ['https://mirror.test/shop.git', SHOP], branch: 'main' },
                { path: '/work/shop/docs', label: 'docs', remotes: [DOCS], branch: 'main' },
                { path: '/work/shop/vendor', label: 'vendor', remotes: ['https://other.test/vendor.git'], branch: 'main' }
            ]
        );

        expect(await hosts.status(PROJECT.id)).toEqual([
            {
                provider: 'code',
                extension: 'ext.code',
                title: 'code',
                kind: 'code-host',
                remote: SHOP,
                repo: 'shop',
                issues: true,
                changes: true,
                checks: true,
                state: 'ready',
                account: 'mira'
            },
            {
                provider: 'code',
                extension: 'ext.code',
                title: 'code',
                kind: 'code-host',
                remote: DOCS,
                repo: 'docs',
                issues: true,
                changes: true,
                checks: true,
                state: 'ready',
                account: 'mira'
            },
            {
                provider: 'tracker',
                extension: 'ext.tracker',
                title: 'tracker',
                kind: 'tracker',
                issues: true,
                changes: false,
                checks: false,
                state: 'ready',
                account: 'mira'
            }
        ]);
        expect(await hosts.has(PROJECT.id)).toBe(true);
        expect(await hosts.has('another')).toBe(false);
    });

    test('keep a provider that is signed out or fails in sight with its reason, and never read a checkout for trackers alone', async () => {
        const { hosts, asked } = world([defined('tracker'), defined('broken'), defined('odd')], {
            tracker: { status: () => ({ state: 'signed-out', reason: 'Sign in to the tracker first.' }) },
            broken: {
                status: () => {
                    throw new Error('The service timed out');
                }
            },
            odd: { status: () => 'fine' }
        });

        expect((await hosts.status(PROJECT.id)).map((status) => [status.provider, status.state, status.reason])).toEqual([
            ['tracker', 'signed-out', 'Sign in to the tracker first.'],
            ['broken', 'unreachable', 'The service timed out'],
            ['odd', 'unreachable', 'It gave no answer Ruimte can read.']
        ]);
        expect(asked.map(([, method]) => method)).toEqual(['status', 'status', 'status']);
    });

    test('take a provider id from the first extension that supplies it, and tell the second', async () => {
        const { hosts, notes } = world([defined('tracker'), { ...defined('tracker'), extension: 'ext.copy' }], { tracker: READY });

        expect((await hosts.status(PROJECT.id)).map((status) => status.extension)).toEqual(['ext.tracker']);
        expect(notes).toEqual(["ext.copy: The host provider tracker is ext.tracker's already, so this one is left out"]);
    });

    test('are found once and looked at again when a client asks or an extension changed', async () => {
        const found = world([defined('tracker')], { tracker: READY });
        const { hosts, asked, changed } = found;

        await hosts.has(PROJECT.id);
        await hosts.has(PROJECT.id);

        expect(asked).toHaveLength(1);

        await hosts.status(PROJECT.id);

        expect(asked).toHaveLength(2);

        found.providers.length = 0;
        hosts.extensionChanged();

        expect(changed).toEqual([PROJECT.id]);
        expect(await hosts.has(PROJECT.id)).toBe(false);
    });
});

describe('reading through a provider', () => {
    const issue = { id: 'ENG-12', title: 'Search is slow', state: 'open' };

    test('lists issues in the scope of the provider, cut and named as the wire has them', async () => {
        const { hosts, asked, notes } = world(
            [defined('code', { matches: true })],
            { code: { ...CODE, 'issues.list': () => ({ items: [issue, { id: 'broken' }], cursor: '2' }) } },
            [{ path: '/work/shop', label: 'shop', remotes: [SHOP], branch: 'main' }]
        );

        expect(await hosts.issues({ projectId: PROJECT.id, provider: 'code', assigned: true, query: 'slow' })).toEqual({
            issues: [{ ref: 'code:ENG-12', title: 'Search is slow', state: 'open', assignees: [], labels: [] }],
            cursor: '2'
        });
        expect(asked.at(-1)).toEqual(['code', 'issues.list', { project: PROJECT, remote: SHOP }, { assigned: true, query: 'slow' }]);
        expect(notes).toEqual([expect.stringMatching(/^ext\.code: code listed an issue that is none: title /)]);
    });

    test('refuses a provider the project does not have, a part a provider left out and something the host does not have', async () => {
        const { hosts, notes } = world([defined('tracker')], {
            tracker: {
                ...READY,
                'issues.read': (_scope: object, id: string) => (id === 'ENG-12' ? { ...issue, body: 'Slow.' } : id === 'ENG-13' ? { id } : null)
            }
        });

        expect((await hosts.issue(PROJECT.id, 'tracker:ENG-12')).body).toBe('Slow.');
        await expect(hosts.issue(PROJECT.id, 'other:ENG-12')).rejects.toMatchObject({ code: 'no-provider', message: 'This project has no other' });
        await expect(hosts.issue(PROJECT.id, 'tracker:ENG-99')).rejects.toMatchObject({ code: 'not-found', message: 'tracker has no issue ENG-99' });
        await expect(hosts.changes({ projectId: PROJECT.id, provider: 'tracker' })).rejects.toMatchObject({
            code: 'unsupported',
            message: 'tracker has no changes'
        });
        await expect(hosts.issue(PROJECT.id, 'tracker:ENG-13')).rejects.toMatchObject({
            code: 'host-failed',
            message: 'tracker gave an answer Ruimte cannot read'
        });
        await expect(hosts.issues({ projectId: PROJECT.id, provider: 'tracker' })).rejects.toMatchObject({
            code: 'host-failed',
            message: 'tracker did not answer: tracker has no issues.list'
        });
        expect(notes).toEqual([expect.stringMatching(/^ext\.tracker: tracker It answered an issue that is none: title /)]);
    });

    test('finds the change of a chat from the branch of the checkout it works in, against the host of that repository alone', async () => {
        const change = { id: '7', title: 'Add an index', state: 'open', body: '', headSha: 'abc', checks: [{ name: 'Tests', state: 'success' }] };
        const { hosts, asked } = world(
            [defined('code', { matches: true, changes: true }), defined('tracker', { changes: true })],
            {
                code: {
                    ...CODE,
                    'changes.forBranch': (_scope: object, branch: string) => (branch === 'perf/index' ? '7' : null),
                    'changes.read': () => change
                },
                tracker: READY
            },
            [
                { path: '/work/shop', label: 'shop', remotes: [SHOP], branch: 'main' },
                { path: '/work/trees/index', label: 'index', remotes: [SHOP], branch: 'perf/index' },
                { path: '/work/trees/detached', label: 'detached', remotes: [SHOP], branch: null },
                { path: '/work/elsewhere', label: 'elsewhere', remotes: ['https://other.test/x.git'], branch: 'perf/index' }
            ],
            {
                'chat-1': '/work/trees/index',
                'chat-2': '/work/shop',
                'chat-3': '/work/trees/detached',
                'chat-4': '/work/elsewhere',
                'chat-5': '/not/a/checkout'
            }
        );

        expect(await hosts.changeOfChat(PROJECT.id, 'chat-1')).toMatchObject({ ref: 'code:7', checkState: 'success' });
        expect(asked.at(-2)).toEqual(['code', 'changes.forBranch', { project: PROJECT, remote: SHOP }, 'perf/index']);
        expect(await hosts.changeOfChat(PROJECT.id, 'chat-2')).toBeNull();

        const before = asked.length;

        expect(await hosts.changeOfChat(PROJECT.id, 'chat-3')).toBeNull();
        expect(await hosts.changeOfChat(PROJECT.id, 'chat-4')).toBeNull();
        expect(await hosts.changeOfChat(PROJECT.id, 'chat-5')).toBeNull();
        expect(await hosts.changeOfChat(PROJECT.id, 'gone')).toBeNull();
        // No provider was asked for a detached HEAD, another host's repository or a folder outside a checkout.
        expect(asked).toHaveLength(before);
    });

    test('takes a ref of one of its providers as it stands, and asks the providers that parse for anything else', async () => {
        const { hosts } = world([defined('tracker', { parses: true }), defined('plain')], {
            tracker: { ...READY, 'issues.parse': (_scope: object, text: string) => (text === '#12' ? 'ENG-12' : null) },
            plain: READY
        });

        expect(await hosts.resolve(PROJECT.id, 'plain:whatever')).toBe('plain:whatever');
        expect(await hosts.resolve(PROJECT.id, '#12')).toBe('tracker:ENG-12');
        expect(await hosts.resolve(PROJECT.id, 'other:12')).toBeNull();
        expect(await hosts.resolve(PROJECT.id, 'nothing')).toBeNull();
    });

    test('gives the end of a check log, and says so when the change has no such check', async () => {
        const { hosts } = world([defined('code', { checks: true })], {
            code: { ...READY, 'checks.log': (_scope: object, _change: string, check: string) => (check === 'Tests' ? { text: '1 failed' } : null) }
        });

        expect(await hosts.checkLog(PROJECT.id, 'code:7', 'Tests')).toEqual({ text: '1 failed', truncated: false });
        await expect(hosts.checkLog(PROJECT.id, 'code:7', 'Deploy')).rejects.toMatchObject({ code: 'not-found' });
    });
});
