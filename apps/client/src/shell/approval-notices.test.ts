import { describe, expect, test } from 'bun:test';
import type { ApprovalRequest } from '@ruimte/contracts';
import { approvalBody, approvalNotices, approvalTitle, expiresIn, nextExpiry, noticeChanges, type ApprovalNotice } from './approval-notices';
import { endpointKey } from '@/state/keys';
import type { SessionsByKey } from '@/state/sessions';

const NOW = 1_700_000_000_000;
const LOCAL = 'local';
const REMOTE = 'Xk3p';

const request = (patch: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
    requestId: 'r1',
    sessionId: 't1',
    toolName: 'Bash',
    summary: 'npm run build',
    choices: [{ id: 'allow', kind: 'allow', label: 'Allow once' }],
    createdAt: NOW,
    expiresAt: NOW + 110_000,
    ...patch
});

const sessionsWith = (endpointId: string, nodeId: string, approvals: ApprovalRequest[]): SessionsByKey => ({
    [endpointKey(endpointId, nodeId)]: { attached: true, approvals }
});

const nodes = [{ id: 't1', title: 'api server' }];

const options = (patch: Partial<Parameters<typeof approvalNotices>[3]> = {}) => ({ machine: null, offered: true, now: NOW, ...patch });

describe('what a permission notification says', () => {
    test('the node, the tool and the command, with the clock in brackets', () => {
        const [notice] = approvalNotices(nodes, sessionsWith(LOCAL, 't1', [request()]), LOCAL, options());
        expect(notice?.title).toBe('api server needs permission');
        expect(notice?.body).toBe('Bash: npm run build (expires in 110s)');
    });

    test('the machine, whenever the work is not on this one', () => {
        expect(approvalTitle({ id: 't1', title: 'api server' }, 'studio')).toBe('api server on studio needs permission');
        expect(approvalTitle({ id: 't1', title: 'api server' }, null)).toBe('api server needs permission');
    });

    test('a terminal nobody named still has a name', () => {
        expect(approvalTitle({ id: 't1', title: '  ' }, null)).toBe('Terminal needs permission');
    });

    test('a tool that carried no readable input is the tool alone', () => {
        expect(approvalBody(request({ summary: '' }), NOW)).toBe('Bash (expires in 110s)');
    });

    test('a command longer than the line is cut, not wrapped', () => {
        const body = approvalBody(request({ summary: 'x'.repeat(400) }), NOW);
        expect(body.length).toBeLessThan(140);
        expect(body).toContain('…');
    });

    test('the clock reads in seconds under two minutes and in whole minutes above', () => {
        expect(expiresIn(110_000)).toBe('expires in 110s');
        expect(expiresIn(600_000)).toBe('expires in 10m');
        expect(expiresIn(-5_000)).toBe('expires in 0s');
    });
});

describe('which permissions deserve one', () => {
    test('the front request of a node, which is the one the strip offers', () => {
        const sessions = sessionsWith(LOCAL, 't1', [request(), request({ requestId: 'r2', toolName: 'Write' })]);
        const notices = approvalNotices(nodes, sessions, LOCAL, options());
        expect(notices).toHaveLength(1);
        expect(notices[0]?.key).toBe('t1:r1');
    });

    test('nothing once the hold has run out', () => {
        const sessions = sessionsWith(LOCAL, 't1', [request({ expiresAt: NOW - 1 })]);
        expect(approvalNotices(nodes, sessions, LOCAL, options())).toEqual([]);
    });

    test('nothing while this client does not offer permissions at all', () => {
        const sessions = sessionsWith(LOCAL, 't1', [request()]);
        expect(approvalNotices(nodes, sessions, LOCAL, options({ offered: false }))).toEqual([]);
    });

    test('nothing from another machine holding a node of the same id', () => {
        const sessions = sessionsWith(REMOTE, 't1', [request()]);
        expect(approvalNotices(nodes, sessions, LOCAL, options())).toEqual([]);
    });

    test('the next request on the same node is a notification of its own', () => {
        const first = approvalNotices(nodes, sessionsWith(LOCAL, 't1', [request()]), LOCAL, options());
        const second = approvalNotices(nodes, sessionsWith(LOCAL, 't1', [request({ requestId: 'r2' })]), LOCAL, options());
        expect(first[0]?.key).not.toBe(second[0]?.key);
    });
});

describe('raising and withdrawing', () => {
    const notice: ApprovalNotice = { key: 't1:r1', nodeId: 't1', title: 'api server needs permission', body: 'Bash (expires in 110s)', expiresAt: NOW };

    const always = (): boolean => true;
    const never = (): boolean => false;

    test('a request nobody has been told about is raised once', () => {
        expect(noticeChanges([], [notice], always).raise.map((entry) => entry.key)).toEqual(['t1:r1']);
        expect(noticeChanges(['t1:r1'], [notice], always).raise).toEqual([]);
    });

    test('a request that is gone is withdrawn, whoever answered it', () => {
        expect(noticeChanges(['t1:r1'], [], always).withdraw).toEqual(['t1:r1']);
    });

    test('a node in front raises nothing and still withdraws what stands', () => {
        expect(noticeChanges([], [notice], never).raise).toEqual([]);
        expect(noticeChanges(['t1:r1'], [], never).withdraw).toEqual(['t1:r1']);
    });

    test('a node a person is looking at is skipped while the one beside it is raised', () => {
        const other: ApprovalNotice = { ...notice, key: 't2:r1', nodeId: 't2' };
        const changes = noticeChanges([], [notice, other], (entry) => entry.nodeId !== 't1');
        expect(changes.raise.map((entry) => entry.key)).toEqual(['t2:r1']);
    });

    test('the watcher looks again at the first hold that runs out', () => {
        expect(nextExpiry([notice, { ...notice, key: 't2:r9', expiresAt: NOW - 1000 }])).toBe(NOW - 1000);
        expect(nextExpiry([])).toBeNull();
    });
});
