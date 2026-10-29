import { describe, expect, test } from 'bun:test';
import type { ProjectAccounts, ProjectContent, UsageLimitsSnapshot } from '@ruimte/contracts';
import { passedOverNote, projectAccountChooser, setProjectAccounts, unusableReason } from './project-accounts.ts';

type Snapshot = Parameters<typeof unusableReason>[0];

const snapshot: Snapshot = {
    accounts: {
        claude: { kind: 'claude', order: 2 },
        work: { kind: 'claude', label: 'Work', order: 0 },
        client: { kind: 'claude', label: 'Client', order: 1 },
        off: { kind: 'claude', enabled: false }
    },
    statuses: [
        { id: 'client', kind: 'claude', state: 'signed-out', email: null, plan: null, organization: null, home: '', message: null, checkedAt: 1 },
        { id: 'work', kind: 'claude', state: 'ready', email: null, plan: null, organization: null, home: '', message: null, checkedAt: 1 }
    ]
};

function chooser(accounts: ProjectAccounts | undefined, limits: UsageLimitsSnapshot | null = null) {
    return projectAccountChooser({
        projectOf: (id) => (id.startsWith('node') ? 'project' : null),
        accountsOf: () => accounts,
        providerAccounts: { snapshot: () => snapshot },
        limits: () => limits
    });
}

describe('the account of a start in a project', () => {
    test('says nothing outside a project or for a kind the project leaves alone', () => {
        expect(chooser({ claude: { default: 'work' } })('elsewhere', 'claude', undefined)).toBeNull();
        expect(chooser({ claude: { default: 'work' } })('node', 'codex', undefined)).toBeNull();
        expect(chooser(undefined)('node', 'claude', undefined)).toBeNull();
    });

    test("takes the project's default, and passes over one that is signed out with the reason", () => {
        expect(chooser({ claude: { default: 'work' } })('node', 'claude', undefined)).toEqual({ account: 'work' });
        expect(chooser({ claude: { default: 'client' } })('node', 'claude', undefined)).toEqual({
            account: 'work',
            passedOver: { account: 'client', reason: 'signed out' }
        });
    });

    test('refuses a named account the project turned off and starts any other as named', () => {
        expect(() => chooser({ claude: { off: ['work'] } })('node', 'claude', 'work')).toThrow('turned off in this project');
        expect(chooser({ claude: { off: ['work'] } })('node', 'claude', 'client')).toEqual({ account: 'client' });
    });

    test('passes over a default that is at its usage limit', () => {
        const limits = {
            providers: [
                {
                    kind: 'claude',
                    account: { id: 'work', label: 'Work' },
                    plan: null,
                    checkedAt: 1,
                    source: 'probe',
                    windows: [{ used: 1 }],
                    cost: null,
                    unavailable: null
                }
            ]
        };
        expect(chooser({ claude: { default: 'work' } }, limits as unknown as UsageLimitsSnapshot)('node', 'claude', undefined)).toEqual({
            account: 'claude',
            passedOver: { account: 'work', reason: 'at its usage limit' }
        });
    });
});

describe('why an account cannot take a start', () => {
    test('from what the machine last heard', () => {
        expect(unusableReason(snapshot, null, 'off')).toBe('turned off on this machine');
        expect(unusableReason(snapshot, null, 'client')).toBe('signed out');
        expect(unusableReason(snapshot, null, 'work')).toBeNull();
        expect(unusableReason(snapshot, null, 'claude')).toBeNull();
    });

    test('says so in the words a chat shows', () => {
        expect(passedOverNote('Work', 'Client', 'signed out')).toBe('Started on Work: Client is signed out.');
    });
});

describe("a person's accounts for a project", () => {
    function store(initial: ProjectContent) {
        let content = initial;

        return {
            content: () => content,
            mutate: async <T>(
                _projectId: string,
                apply: (content: ProjectContent) => { content: ProjectContent | null; result: T } | Promise<{ content: ProjectContent | null; result: T }>
            ) => {
                const mutation = await apply(content);
                content = mutation.content ?? content;

                return mutation.result;
            }
        };
    }

    const base: ProjectContent = { name: 'Site', color: '', views: [] };

    test('writes one kind and leaves the others, and drops the key once nothing is left', async () => {
        const project = store({ ...base, accounts: { codex: { default: 'codex_client' } } });
        expect(await setProjectAccounts(project as never, { projectId: 'p', kind: 'claude', default: 'work', off: ['private', 'private'] })).toEqual({
            codex: { default: 'codex_client' },
            claude: { default: 'work', off: ['private'] }
        });
        await setProjectAccounts(project as never, { projectId: 'p', kind: 'claude', default: null, off: [] });
        await setProjectAccounts(project as never, { projectId: 'p', kind: 'codex', default: null, off: [] });
        expect('accounts' in project.content()).toBe(false);
    });

    test('refuses a default that is also turned off', async () => {
        const project = store(base);
        expect(setProjectAccounts(project as never, { projectId: 'p', kind: 'claude', default: 'work', off: ['work'] })).rejects.toThrow('cannot be');
    });
});
