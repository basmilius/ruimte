import { describe, expect, test } from 'bun:test';
import {
    providedChange,
    providedChangePage,
    providedCheckLog,
    providedHostStatus,
    providedIssue,
    providedIssuePage,
    providedLocator
} from './extension-hosts.ts';
import { HOST_LIMITS, HostChangeSchema, HostIssueSchema, hostChecksState, hostCheckState, hostRef, parseHostRef } from './host.ts';

describe('a ref', () => {
    test('names a provider and what that provider calls the issue, which may hold a colon itself', () => {
        expect(hostRef('tracker', 'ENG-12')).toBe('tracker:ENG-12');
        expect(parseHostRef('code-host:owner/repo#61')).toEqual({ provider: 'code-host', locator: 'owner/repo#61' });
        expect(parseHostRef('tracker:site:8080/ENG-12')).toEqual({ provider: 'tracker', locator: 'site:8080/ENG-12' });
    });

    test('is none without a provider, without a locator or with a provider that is no id', () => {
        expect(parseHostRef('ENG-12')).toBeNull();
        expect(parseHostRef(':ENG-12')).toBeNull();
        expect(parseHostRef('tracker:')).toBeNull();
        expect(parseHostRef('Tracker:ENG-12')).toBeNull();
        expect(parseHostRef(`tracker:${'x'.repeat(HOST_LIMITS.locator + 1)}`)).toBeNull();
    });
});

describe('the state of a check', () => {
    test('is one of the five, and failure for a word Ruimte does not know', () => {
        expect(['pending', 'success', 'failure', 'neutral', 'skipped'].map(hostCheckState)).toEqual(['pending', 'success', 'failure', 'neutral', 'skipped']);
        expect([hostCheckState('passed'), hostCheckState('SUCCESS'), hostCheckState(undefined), hostCheckState(1)]).toEqual([
            'failure',
            'failure',
            'failure',
            'failure'
        ]);
    });

    test('of a change is failed once one failed, pending while one runs, and none without checks', () => {
        expect(hostChecksState([{ state: 'success' }, { state: 'failure' }, { state: 'pending' }])).toBe('failure');
        expect(hostChecksState([{ state: 'success' }, { state: 'pending' }])).toBe('pending');
        expect(hostChecksState([{ state: 'success' }, { state: 'skipped' }, { state: 'neutral' }])).toBe('success');
        expect(hostChecksState([{ state: 'skipped' }])).toBe('skipped');
        expect(hostChecksState([])).toBeUndefined();
    });
});

describe('what a provider answers', () => {
    const issue = { id: 'ENG-12', title: 'Search is slow', state: 'open' };

    test('reads an issue into the shape of the wire, under the id of its provider', () => {
        const read = providedIssue('tracker', {
            ...issue,
            url: 'https://tracker.test/ENG-12',
            assignees: ['mira'],
            body: 'It takes four seconds.',
            comments: [{ id: 'c1', author: 'joss', body: 'Same here.', createdAt: '2026-11-02T09:14:00Z' }],
            changes: [{ id: '7', title: 'Add an index', state: 'open', checkState: 'success' }]
        });

        expect(read).toEqual({
            ref: 'tracker:ENG-12',
            title: 'Search is slow',
            state: 'open',
            url: 'https://tracker.test/ENG-12',
            assignees: ['mira'],
            labels: [],
            body: 'It takes four seconds.',
            comments: [{ id: 'c1', author: 'joss', body: 'Same here.', createdAt: '2026-11-02T09:14:00Z' }],
            changes: [{ ref: 'tracker:7', title: 'Add an index', state: 'open', checkState: 'success' }]
        });
        expect(HostIssueSchema.safeParse(read).success).toBe(true);
    });

    test('cuts a text that is too long, takes the line breaks out of a title and drops an address that is no web page', () => {
        const read = providedIssue('tracker', {
            ...issue,
            title: 'Search\nis\tslow\u0007',
            url: 'javascript:alert(1)',
            updatedAt: 'yesterday',
            labels: ['bug', '', 7, 'x'.repeat(200)],
            body: `Hello\u001b[31m\r\n${'y'.repeat(HOST_LIMITS.body)}`,
            comments: Array.from({ length: HOST_LIMITS.comments + 5 }, (_, index) => ({ id: `c${index}`, author: 'joss', body: 'Hi' }))
        });

        expect(read?.title).toBe('Search is slow');
        expect(read?.url).toBeUndefined();
        expect(read?.updatedAt).toBeUndefined();
        expect(read?.labels).toEqual(['bug', 'x'.repeat(HOST_LIMITS.label)]);
        expect(read?.body.startsWith('Hello[31m\ny')).toBe(true);
        expect(read?.body).toHaveLength(HOST_LIMITS.body);
        // The newest are kept.
        expect(read?.comments).toHaveLength(HOST_LIMITS.comments);
        expect(read?.comments.at(-1)?.id).toBe(`c${HOST_LIMITS.comments + 4}`);
        expect(HostIssueSchema.safeParse(read).success).toBe(true);
    });

    test('reads nothing as an issue the host does not have, and throws for an answer that is no issue', () => {
        expect(providedIssue('tracker', null)).toBeNull();
        expect(providedIssue('tracker', undefined)).toBeNull();
        expect(() => providedIssue('tracker', { ...issue, state: 'triage', body: '' })).toThrow('It answered an issue that is none: state');
        expect(() => providedIssue('tracker', 'ENG-12')).toThrow('It answered an issue that is none');
    });

    test('lists a page without the entries that are none, and says why of each', () => {
        const refused: string[] = [];
        const page = providedIssuePage(
            'tracker',
            { items: [issue, { id: '', title: 'Nameless', state: 'open' }, { ...issue, id: 'ENG-13' }], cursor: 'next' },
            (reason) => refused.push(reason)
        );

        expect(page.items.map((listed) => listed.ref)).toEqual(['tracker:ENG-12', 'tracker:ENG-13']);
        expect(page.cursor).toBe('next');
        expect(refused).toEqual([expect.stringMatching(/^listed an issue that is none: id /)]);
        expect(() => providedIssuePage('tracker', [issue], () => undefined)).toThrow('It listed no issues');
        expect(
            providedChangePage(
                'tracker',
                { items: Array.from({ length: 150 }, (_, index) => ({ id: String(index), title: 'T', state: 'merged' })) },
                () => undefined
            ).items
        ).toHaveLength(HOST_LIMITS.page);
    });

    test('never reads a check as green on a conclusion Ruimte does not know, whatever the provider summed them up as', () => {
        const change = providedChange('code', {
            id: '7',
            title: 'Add an index',
            state: 'open',
            checkState: 'success',
            body: '',
            headSha: 'abc123',
            checks: [{ name: 'Tests', state: 'success' }, { name: 'Deploy', state: 'action_required' }, { state: 'success' }],
            closes: ['ENG-12']
        });

        expect(change?.checks).toEqual([
            { name: 'Tests', state: 'success' },
            { name: 'Deploy', state: 'failure' }
        ]);
        expect(change?.checkState).toBe('failure');
        expect(change?.closes).toEqual(['code:ENG-12']);
        expect(change?.size).toEqual({ additions: 0, deletions: 0, files: 0 });
        expect(HostChangeSchema.safeParse(change).success).toBe(true);
        expect(() => providedChange('code', { id: '7', title: 'Add an index', state: 'open', body: '' })).toThrow('It answered a change that is none: headSha');
    });

    test('reads a status of another shape as unreachable, and keeps not-configured for a tracker that has no such project', () => {
        expect(providedHostStatus({ state: 'ready', account: 'mira' })).toEqual({ state: 'ready', account: 'mira' });
        expect(providedHostStatus({ state: 'not-configured' })).toEqual({ state: 'not-configured' });
        expect(providedHostStatus({ state: 'signed-out', reason: 'Run\nthe sign-in.' })).toEqual({ state: 'signed-out', reason: 'Run the sign-in.' });
        expect(providedHostStatus({ state: 'fine' })).toEqual({ state: 'unreachable', reason: 'It gave no answer Ruimte can read.' });
        expect(providedHostStatus(undefined).state).toBe('unreachable');
    });

    test('keeps the end of a log, and reads a locator only from a string', () => {
        const long = `start\n${'z'.repeat(HOST_LIMITS.log)}`;

        expect(providedCheckLog({ text: 'ok\u001b[0m' })).toEqual({ text: 'ok[0m', truncated: false });
        expect(providedCheckLog({ text: long })).toEqual({ text: 'z'.repeat(HOST_LIMITS.log), truncated: true });
        expect(providedCheckLog(null)).toBeNull();
        expect(() => providedCheckLog('a log')).toThrow('It answered a log that is none');
        expect([providedLocator('ENG-12'), providedLocator(null), providedLocator(''), providedLocator({ id: 'ENG-12' })]).toEqual([
            'ENG-12',
            null,
            null,
            null
        ]);
    });
});
