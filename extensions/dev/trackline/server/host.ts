/*
 * Trackline as Ruimte's own Issues panel and agent tools read it: a tracker in every project once an account is
 * connected, and the code host of a repository whose remote is on `trackline.test`. Both stand on the same account,
 * so a test sees a tracker and a code host without a second fake service.
 */
import {
    defineHostProvider,
    type ChangeCapability,
    type CheckCapability,
    type HostChangeSummary,
    type HostCheckState,
    type HostIssueSummary,
    type HostStatus,
    type IssueCapability
} from '@ruimte/extension/server';
import { changeUrl, issueUrl, TRACKLINE_HOST, type TracklineChange, type TracklineCheck, type TracklineIssue, type TracklineService } from './service';

// Small, so the four issues of the account take more than one page.
const PAGE = 3;
const CHECK_STATES: Readonly<Record<TracklineCheck['state'], HostCheckState>> = { passed: 'success', failed: 'failure', running: 'pending' };
const ISSUE_ADDRESS = new RegExp(`^https://${TRACKLINE_HOST.replace('.', '\\.')}/issues/(TRK-\\d+)$`, 'i');
const ISSUE_KEY = /^TRK-\d+$/i;

type Account = () => Promise<TracklineService | null>;

function paged<Item>(items: readonly Item[], cursor: string | undefined): { items: Item[]; cursor?: string } {
    const start = Number(cursor ?? 0);
    const from = Number.isInteger(start) && start >= 0 ? start : 0;
    const end = from + PAGE;

    return { items: items.slice(from, end), ...(end < items.length ? { cursor: String(end) } : {}) };
}

function matches(text: string, query: string | undefined): boolean {
    return query === undefined || query === '' || text.toLowerCase().includes(query.toLowerCase());
}

function issueSummary(issue: TracklineIssue, service: TracklineService): HostIssueSummary {
    return {
        id: issue.key,
        title: issue.title,
        state: issue.state,
        url: issueUrl(issue.key),
        assignees: [issue.assignee],
        labels: issue.labels,
        commentCount: service.comments(issue.key).length
    };
}

function checkState(checks: readonly TracklineCheck[]): HostCheckState | undefined {
    const states = checks.map((check) => CHECK_STATES[check.state]);

    return (['failure', 'pending', 'success'] as const).find((state) => states.includes(state));
}

function changeSummary(change: TracklineChange, service: TracklineService): HostChangeSummary {
    const state = checkState(service.checks(change.id));

    return {
        id: change.id,
        title: change.title,
        state: change.state,
        url: changeUrl(change.id),
        author: change.author,
        branch: change.branch,
        base: 'main',
        ...(state === undefined ? {} : { checkState: state })
    };
}

async function connected(account: Account): Promise<TracklineService> {
    const service = await account();

    if (service === null) {
        throw new Error('Connect your Trackline account first');
    }

    return service;
}

function capabilities(account: Account): { issues: IssueCapability; changes: ChangeCapability; checks: CheckCapability } {
    return {
        issues: {
            async list(_scope, filter) {
                const service = await connected(account);
                const state = filter.state ?? 'open';
                const issues = service
                    .issues()
                    .filter((issue) => state === 'all' || issue.state === state)
                    .filter((issue) => filter.assigned !== true || issue.assignee === service.account)
                    .filter((issue) => matches(`${issue.key} ${issue.title}`, filter.query));

                return paged(
                    issues.map((issue) => issueSummary(issue, service)),
                    filter.cursor
                );
            },
            async read(_scope, id) {
                const service = await connected(account);
                const issue = service.issue(id);

                return issue === null
                    ? null
                    : {
                          ...issueSummary(issue, service),
                          body: issue.body,
                          comments: service
                              .comments(issue.key)
                              .map((comment) => ({ id: comment.id, author: comment.author, body: comment.body, createdAt: comment.at })),
                          changes: service.changes(issue.key).map((change) => changeSummary(change, service))
                      };
            },
            parse(_scope, text) {
                const key = ISSUE_ADDRESS.exec(text.trim())?.[1] ?? (ISSUE_KEY.test(text.trim()) ? text.trim() : null);

                return key === null ? null : key.toUpperCase();
            }
        },
        changes: {
            async list(_scope, filter) {
                const service = await connected(account);
                const state = filter.state ?? 'open';
                const changes = service
                    .changes()
                    .filter((change) => state === 'all' || change.state === state)
                    .filter((change) => matches(`${change.id} ${change.title}`, filter.query));

                return paged(
                    changes.map((change) => changeSummary(change, service)),
                    filter.cursor
                );
            },
            async read(_scope, id) {
                const service = await connected(account);
                const change = service.change(id);

                return change === null
                    ? null
                    : {
                          ...changeSummary(change, service),
                          body: change.body,
                          headSha: change.head,
                          checks: service.checks(change.id).map((check) => ({ name: check.name, state: CHECK_STATES[check.state] })),
                          threads: service.threads(change.id).map(({ id: thread, author, body, path, line }) => ({ id: thread, author, body, path, line })),
                          size: { additions: change.lines.added, deletions: change.lines.removed, files: change.lines.files },
                          closes: [change.issue]
                      };
            },
            async forBranch(_scope, branch) {
                const service = await connected(account);

                return service.changes().find((change) => change.state === 'open' && change.branch === branch)?.id ?? null;
            }
        },
        checks: {
            async log(_scope, change, check) {
                const service = await connected(account);
                const found = service.checks(change.toUpperCase()).find((candidate) => candidate.name === check);

                return found === undefined ? null : { text: found.log };
            }
        }
    };
}

async function statusOf(account: Account): Promise<HostStatus> {
    try {
        const service = await account();

        return service === null
            ? { state: 'signed-out', reason: 'Connect your Trackline account first, with Connect Trackline in the command palette.' }
            : { state: 'ready', account: service.account };
    } catch (e) {
        return { state: 'unreachable', reason: e instanceof Error ? e.message : String(e) };
    }
}

/* Registers both providers on one account, which answers null while no key is kept. */
export function defineTracklineHosts(account: Account): void {
    const parts = capabilities(account);

    defineHostProvider({ id: 'trackline', title: 'Trackline', status: () => statusOf(account), ...parts });
    defineHostProvider({
        id: 'trackline-code',
        title: 'Trackline Code',
        match: (remote) => remote.includes(`${TRACKLINE_HOST}/`) || remote.includes(`${TRACKLINE_HOST}:`),
        status: () => statusOf(account),
        ...parts
    });
}
