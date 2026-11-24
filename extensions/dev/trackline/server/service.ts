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

export interface TracklineChange {
    id: string;
    issue: string;
    title: string;
    branch: string;
    state: 'open' | 'merged';
}

export interface TracklineCheck {
    id: string;
    change: string;
    name: string;
    state: 'passed' | 'failed' | 'running';
}

export interface TracklineService {
    /* Who the key belongs to. */
    account: string;
    issues(): TracklineIssue[];
    issue(key: string): TracklineIssue | null;
    changes(issue: string): TracklineChange[];
    checks(change: string): TracklineCheck[];
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
    { id: 'C-41', issue: 'TRK-101', title: 'Renew the session before the second factor', branch: 'fix/sign-in-loop', state: 'open' },
    { id: 'C-39', issue: 'TRK-103', title: 'Index invoices by account and date', branch: 'perf/search-index', state: 'open' },
    { id: 'C-35', issue: 'TRK-98', title: 'Format dates in the time zone of the account', branch: 'fix/time-zone', state: 'merged' }
];

const CHECKS: readonly TracklineCheck[] = [
    { id: 'K-1', change: 'C-41', name: 'Tests', state: 'failed' },
    { id: 'K-2', change: 'C-41', name: 'Lint', state: 'passed' },
    { id: 'K-3', change: 'C-39', name: 'Tests', state: 'running' },
    { id: 'K-4', change: 'C-35', name: 'Tests', state: 'passed' }
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
        changes: (issue) => CHANGES.filter((change) => change.issue === issue),
        checks: (change) => CHECKS.filter((check) => check.change === change)
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
