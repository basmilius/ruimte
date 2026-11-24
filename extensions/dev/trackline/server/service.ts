/*
 * The Trackline service, as this extension would reach it over the network: here it is fixed data in memory, so a test
 * and `bun dev` read the same account. Its shape is the one a code host has (issues, the changes that close them and
 * the checks on a change), so a host provider can stand on the same data.
 */

export interface TracklineIssue {
    key: string;
    title: string;
    state: 'open' | 'closed';
    assignee: string;
    labels: string[];
    body: string;
}

export interface TracklineComment {
    id: string;
    issue: string;
    author: string;
    body: string;
    at: string;
}

export interface TracklineChange {
    id: string;
    issue: string;
    title: string;
    branch: string;
    state: 'open' | 'merged';
    author: string;
    body: string;
    head: string;
    lines: { added: number; removed: number; files: number };
}

/* A remark of a reviewer on a line of a change that nobody answered yet. */
export interface TracklineThread {
    id: string;
    change: string;
    author: string;
    body: string;
    path: string;
    line: number;
}

export interface TracklineCheck {
    id: string;
    change: string;
    name: string;
    state: 'passed' | 'failed' | 'running';
    log: string;
}

export interface TracklineService {
    /* Who the key belongs to. */
    account: string;
    issues(): TracklineIssue[];
    issue(key: string): TracklineIssue | null;
    comments(issue: string): TracklineComment[];
    /* The changes that close an issue, or every change without one. */
    changes(issue?: string): TracklineChange[];
    change(id: string): TracklineChange | null;
    checks(change: string): TracklineCheck[];
    threads(change: string): TracklineThread[];
}

/* Where the service keeps its pages, which is also the remote of a repository it hosts. */
export const TRACKLINE_HOST = 'trackline.test';

export function issueUrl(key: string): string {
    return `https://${TRACKLINE_HOST}/issues/${key}`;
}

export function changeUrl(id: string): string {
    return `https://${TRACKLINE_HOST}/changes/${id}`;
}

const ACCOUNT = 'mira';
const KEY_SHAPE = /^trk_[a-z0-9]{8,}$/;

const ISSUES: readonly TracklineIssue[] = [
    {
        key: 'TRK-101',
        title: 'Sign-in loops back to the start',
        state: 'open',
        assignee: 'mira',
        labels: ['bug', 'auth'],
        body: 'After the second factor the page returns to the sign-in form. It happens when the session cookie is older than a day.'
    },
    {
        key: 'TRK-102',
        title: 'Export a report as a spreadsheet',
        state: 'open',
        assignee: 'joss',
        labels: ['feature'],
        body: 'Finance wants the monthly report as a file they can open in a spreadsheet, with one row per invoice.'
    },
    {
        key: 'TRK-103',
        title: 'Search is slow on large accounts',
        state: 'open',
        assignee: 'mira',
        labels: ['performance'],
        body: 'A search in an account with more than ten thousand invoices takes over four seconds. The query reads every row.'
    },
    {
        key: 'TRK-98',
        title: 'Dates show in the wrong time zone',
        state: 'closed',
        assignee: 'mira',
        labels: ['bug'],
        body: 'An invoice made late in the evening showed the next day. Fixed by formatting in the time zone of the account.'
    }
];

const CHANGES: readonly TracklineChange[] = [
    {
        id: 'C-41',
        issue: 'TRK-101',
        title: 'Renew the session before the second factor',
        branch: 'fix/sign-in-loop',
        state: 'open',
        author: 'mira',
        body: 'Renews the session cookie when the first factor passes, so the second factor never meets an old one.',
        head: '4f1c2aa9d0e3b7c6a5f4e3d2c1b0a9f8e7d6c5b4',
        lines: { added: 42, removed: 7, files: 3 }
    },
    {
        id: 'C-39',
        issue: 'TRK-103',
        title: 'Index invoices by account and date',
        branch: 'perf/search-index',
        state: 'open',
        author: 'joss',
        body: 'Adds an index on account and date, and has the search use it.',
        head: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
        lines: { added: 18, removed: 2, files: 2 }
    },
    {
        id: 'C-35',
        issue: 'TRK-98',
        title: 'Format dates in the time zone of the account',
        branch: 'fix/time-zone',
        state: 'merged',
        author: 'mira',
        body: 'Formats every date of an invoice in the time zone the account chose.',
        head: '1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c',
        lines: { added: 11, removed: 11, files: 4 }
    }
];

const COMMENTS: readonly TracklineComment[] = [
    { id: 'N-1', issue: 'TRK-101', author: 'joss', body: 'I see it too, only on the second day after signing in.', at: '2026-11-02T09:14:00Z' },
    {
        id: 'N-2',
        issue: 'TRK-101',
        author: 'mira',
        body: 'The cookie is not renewed before the second factor. Working on it in C-41.',
        at: '2026-11-02T10:02:00Z'
    },
    { id: 'N-3', issue: 'TRK-103', author: 'mira', body: 'An index on account and date should be enough.', at: '2026-11-05T15:30:00Z' }
];

const THREADS: readonly TracklineThread[] = [
    { id: 'R-7', change: 'C-41', author: 'joss', body: 'Should this also renew when the first factor is a passkey?', path: 'src/session.ts', line: 48 }
];

const CHECKS: readonly TracklineCheck[] = [
    {
        id: 'K-1',
        change: 'C-41',
        name: 'Tests',
        state: 'failed',
        log: ['Running 212 tests', 'session.test.ts: renews before the second factor', '  expected 1 cookie, got 2', '211 passed, 1 failed'].join('\n')
    },
    { id: 'K-2', change: 'C-41', name: 'Lint', state: 'passed', log: 'No problems in 148 files' },
    { id: 'K-3', change: 'C-39', name: 'Tests', state: 'running', log: 'Running 212 tests' },
    { id: 'K-4', change: 'C-35', name: 'Tests', state: 'passed', log: '208 passed' }
];

/* The account behind a key, or a throw in the words the service answers a key it does not know. */
export function openService(key: string): TracklineService {
    if (!KEY_SHAPE.test(key)) {
        throw new Error('Trackline does not know this key');
    }

    return {
        account: ACCOUNT,
        issues: () => [...ISSUES],
        issue: (issueKey) => ISSUES.find((issue) => issue.key === issueKey.toUpperCase()) ?? null,
        comments: (issue) => COMMENTS.filter((comment) => comment.issue === issue),
        changes: (issue) => CHANGES.filter((change) => issue === undefined || change.issue === issue),
        change: (id) => CHANGES.find((change) => change.id === id.toUpperCase()) ?? null,
        checks: (change) => CHECKS.filter((check) => check.change === change),
        threads: (change) => THREADS.filter((thread) => thread.change === change)
    };
}

/* An issue as an agent reads it: what it asks, and how far the work on it is. */
export function issueText(service: TracklineService, issue: TracklineIssue): string {
    const changes = service.changes(issue.key).map((change) => {
        const checks = service
            .checks(change.id)
            .map((check) => `${check.name} ${check.state}`)
            .join(', ');

        return `- ${change.id} ${change.title} (${change.state}, branch ${change.branch})${checks === '' ? '' : `: ${checks}`}`;
    });

    return [
        `${issue.key}: ${issue.title}`,
        `State: ${issue.state}. Assigned to ${issue.assignee}. Labels: ${issue.labels.join(', ')}.`,
        '',
        issue.body,
        ...(changes.length === 0 ? [] : ['', 'Changes:', ...changes])
    ].join('\n');
}
