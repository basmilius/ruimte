import { existsSync } from 'node:fs';
import type { GitIssue, GitPrThread, GitPullRequest } from '@ruimte/contracts';
import { checksOf, summarizeChecks, type RawCheck } from './pr-checks.ts';
import { GitError, streamWithTimeout, type GitResult } from './run.ts';

// `gh` talks to the network, and a login prompt that cannot be answered would wait for ever.
const GH_TIMEOUT_MS = 30_000;
const GH_ENV = { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' };

// An issue body is quoted into a prompt; past this it is cut instead of filling one.
const MAX_BODY = 60_000;

/* Runs `gh` with these arguments in a folder; a seam so tests hand in answers. */
export type GhRunner = (args: string[], cwd: string) => Promise<GitResult>;

export const runGh: GhRunner = (args, cwd) => {
    // A folder that is gone would otherwise read as a `gh` that cannot start.
    if (!existsSync(cwd)) {
        return Promise.reject(new GitError('folder-missing', 'That folder no longer exists on this machine.'));
    }
    return streamWithTimeout('gh', args, cwd, GH_TIMEOUT_MS, { env: GH_ENV });
};

export interface IssueRef {
    /* `owner/repo`; null when the reference leaves it to the folder's own repository. */
    repo: string | null;
    number: number;
}

const URL_FORM = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)(?:[/?#].*)?$/i;
const SHORT_FORM = /^([\w.-]+\/[\w.-]+)#(\d+)$/;
const NUMBER_FORM = /^#(\d+)$/;

/* The three ways a person names an issue: its link, `owner/repo#12` and `#12`. */
export function parseIssueRef(text: string): IssueRef | null {
    const trimmed = text.trim();
    const link = URL_FORM.exec(trimmed) ?? SHORT_FORM.exec(trimmed);
    if (link) {
        return { repo: link[1]!, number: Number.parseInt(link[2]!, 10) };
    }
    const bare = NUMBER_FORM.exec(trimmed);
    return bare ? { repo: null, number: Number.parseInt(bare[1]!, 10) } : null;
}

/* A failed `gh` as an error a client can tell apart. Never reads a token: gh holds the login. */
export function ghError(result: GitResult, notFound: 'issue-not-found' | 'pr-not-found' = 'issue-not-found'): GitError {
    const text = result.stderr.trim();
    if (result.code === 128 && /could not be started/.test(text)) {
        return new GitError('gh-missing', 'The GitHub CLI (gh) is not installed on this machine.');
    }
    if (/gh auth login|not logged in|authentication required|HTTP 401/i.test(text)) {
        return new GitError('gh-unauthenticated', 'gh is not signed in on this machine. Run `gh auth login` there.');
    }
    if (/could not resolve to an? (issue|pull ?request)|HTTP 404|no pull requests? found|not found/i.test(text)) {
        return new GitError(notFound, notFound === 'issue-not-found' ? 'That issue was not found.' : 'No pull request was found.');
    }
    return new GitError('gh-failed', text === '' ? 'gh failed' : text);
}

/* The output of a `gh` that succeeded; every other outcome is an error from `ghError`. */
export async function ghOutput(run: GhRunner, args: string[], cwd: string, notFound?: 'issue-not-found' | 'pr-not-found'): Promise<string> {
    const result = await run(args, cwd);
    if (result.code !== 0) {
        throw ghError(result, notFound);
    }
    return result.stdout;
}

/* `owner/repo` of the repository a folder is in, as gh sees its remotes. */
export async function repoOf(run: GhRunner, cwd: string): Promise<string> {
    const output = await ghOutput(run, ['repo', 'view', '--json', 'nameWithOwner'], cwd);
    const name = (JSON.parse(output) as { nameWithOwner?: unknown }).nameWithOwner;
    if (typeof name !== 'string' || name === '') {
        throw new GitError('gh-failed', 'gh did not say which repository this folder belongs to.');
    }
    return name;
}

interface IssueJson {
    number?: number;
    title?: string;
    body?: string | null;
    url?: string;
    state?: string;
    author?: { login?: string } | null;
    labels?: Array<{ name?: string }>;
}

/* An issue with its body, from the repository the reference names or, for `#12`, the one the folder is in. */
export async function readIssue(run: GhRunner, cwd: string, ref: IssueRef): Promise<GitIssue> {
    const repo = ref.repo ?? (await repoOf(run, cwd));
    const output = await ghOutput(run, ['issue', 'view', String(ref.number), '--repo', repo, '--json', 'number,title,body,url,state,author,labels'], cwd);
    let issue: IssueJson;
    try {
        issue = JSON.parse(output) as IssueJson;
    } catch {
        throw new GitError('gh-failed', 'gh answered something that is not an issue.');
    }
    return {
        repo,
        number: issue.number ?? ref.number,
        title: issue.title ?? '',
        body: (issue.body ?? '').slice(0, MAX_BODY),
        url: issue.url ?? `https://github.com/${repo}/issues/${ref.number}`,
        state: issue.state ?? 'OPEN',
        author: issue.author?.login ?? null,
        labels: (issue.labels ?? []).map((label) => label.name ?? '').filter((name) => name !== '')
    };
}

/* Every JSON document in the output of `gh api --paginate`, which writes one page after the other without a separator. */
export function jsonDocuments(output: string): unknown[] {
    const documents: unknown[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < output.length; i += 1) {
        const char = output[i]!;
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
        } else if (char === '{' || char === '[') {
            if (depth === 0) {
                start = i;
            }
            depth += 1;
        } else if ((char === '}' || char === ']') && depth > 0) {
            depth -= 1;
            if (depth === 0 && start !== -1) {
                const parsed: unknown = JSON.parse(output.slice(start, i + 1));
                documents.push(...(Array.isArray(parsed) ? parsed : [parsed]));
                start = -1;
            }
        }
    }
    return documents;
}

const PR_QUERY = `query($owner:String!,$name:String!,$number:Int!,$endCursor:String){
  viewer{login}
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      number url title state isDraft headRefOid headRefName baseRefName mergeable mergeStateStatus reviewDecision additions deletions changedFiles
      reviews(last:20){nodes{id submittedAt state author{login __typename}}}
      commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100,after:$endCursor){
        nodes{__typename
          ... on CheckRun{name status conclusion detailsUrl checkSuite{app{slug} workflowRun{event workflow{name}}}}
          ... on StatusContext{context state targetUrl}}
        pageInfo{hasNextPage endCursor}}}}}}
    }
  }
}`;

const THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!,$endCursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100,after:$endCursor){
        nodes{id isResolved isOutdated path line
          comments(first:100){totalCount nodes{author{login __typename} body url createdAt}}}
        pageInfo{hasNextPage endCursor}}
    }
  }
}`;

interface PullRequestJson {
    number?: number;
    url?: string;
    title?: string;
    state?: string;
    isDraft?: boolean;
    headRefOid?: string;
    headRefName?: string;
    baseRefName?: string;
    mergeable?: string;
    mergeStateStatus?: string;
    reviewDecision?: string | null;
    additions?: number;
    deletions?: number;
    changedFiles?: number;
    reviews?: { nodes?: Array<{ id?: string; submittedAt?: string | null; state?: string; author?: { login?: string; __typename?: string } | null }> };
    commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { contexts?: { nodes?: RawCheck[] } } | null } }> };
}

interface ThreadJson {
    id?: string;
    isResolved?: boolean;
    isOutdated?: boolean;
    path?: string | null;
    line?: number | null;
    comments?: {
        totalCount?: number;
        nodes?: Array<{ author?: { login?: string; __typename?: string } | null; body?: string; url?: string; createdAt?: string }>;
    };
}

interface Page<Node> {
    data?: { viewer?: { login?: string } | null; repository?: { pullRequest?: Node | null } | null };
}

/* The pull request of every page of a `--paginate` answer, in order. */
export function pagesOf<Node>(output: string): Node[] {
    return (jsonDocuments(output) as Array<Page<Node>>)
        .map((page) => page.data?.repository?.pullRequest)
        .filter((node): node is Node => node !== null && node !== undefined);
}

export function isBot(author: { login?: string; __typename?: string } | null | undefined): boolean {
    return author?.__typename === 'Bot' || (author?.login ?? '').endsWith('[bot]');
}

function threadOf(json: ThreadJson): GitPrThread {
    const carried = json.comments?.nodes ?? [];
    return {
        id: json.id ?? '',
        ...(json.path ? { path: json.path } : {}),
        ...(typeof json.line === 'number' ? { line: json.line } : {}),
        resolved: json.isResolved === true,
        outdated: json.isOutdated === true,
        comments: carried.map((comment) => ({
            author: comment.author?.login ?? 'ghost',
            bot: isBot(comment.author),
            body: comment.body ?? '',
            url: comment.url ?? '',
            createdAt: comment.createdAt ?? ''
        })),
        ...((json.comments?.totalCount ?? 0) > carried.length ? { truncated: true } : {})
    };
}

/* Where a pull request lives, from the link `gh pr view` reports. */
function locate(url: string): { owner: string; name: string; number: number } | null {
    const match = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
    return match ? { owner: match[1]!, name: match[2]!, number: Number.parseInt(match[3]!, 10) } : null;
}

export function graphql(query: string, place: { owner: string; name: string; number: number }): string[] {
    return ['api', 'graphql', '--paginate', '-f', `query=${query}`, '-f', `owner=${place.owner}`, '-f', `name=${place.name}`, '-F', `number=${place.number}`];
}

/* Finds the pull request of the branch a folder is on, or the numbered one; null when there is none. */
export async function findPullRequest(run: GhRunner, cwd: string, number?: number): Promise<{ owner: string; name: string; number: number } | null> {
    const result = await run(['pr', 'view', ...(number === undefined ? [] : [String(number)]), '--json', 'number,url'], cwd);
    if (result.code !== 0) {
        if (/no pull requests? found/i.test(result.stderr)) {
            return null;
        }
        throw ghError(result, 'pr-not-found');
    }
    const found = JSON.parse(result.stdout) as { url?: string };
    return found.url === undefined ? null : locate(found.url);
}

/* The pull request with its checks and its review threads, every page of both. */
export async function readPullRequest(run: GhRunner, cwd: string, number?: number): Promise<GitPullRequest | null> {
    const place = await findPullRequest(run, cwd, number);
    if (place === null) {
        return null;
    }
    const [summary, threads] = await Promise.all([
        ghOutput(run, graphql(PR_QUERY, place), cwd, 'pr-not-found'),
        ghOutput(run, graphql(THREADS_QUERY, place), cwd, 'pr-not-found')
    ]);
    return pullRequestOf(`${place.owner}/${place.name}`, pagesOf<PullRequestJson>(summary), pagesOf<{ reviewThreads?: { nodes?: ThreadJson[] } }>(threads));
}

/* Pages of the summary query become one pull request: the fields of the first, the checks of all. */
export function pullRequestOf(
    repo: string,
    pages: readonly PullRequestJson[],
    threadPages: ReadonlyArray<{ reviewThreads?: { nodes?: ThreadJson[] } }>
): GitPullRequest | null {
    const first = pages[0];
    if (first === undefined) {
        return null;
    }
    const raws = pages.flatMap((page) => page.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []);
    const checks = checksOf(raws);
    return {
        repo,
        number: first.number ?? 0,
        url: first.url ?? '',
        title: first.title ?? '',
        state: first.state ?? 'OPEN',
        isDraft: first.isDraft === true,
        headSha: first.headRefOid ?? '',
        headBranch: first.headRefName ?? '',
        baseBranch: first.baseRefName ?? '',
        mergeable: first.mergeable ?? 'UNKNOWN',
        mergeState: first.mergeStateStatus ?? 'UNKNOWN',
        reviewDecision: first.reviewDecision ?? null,
        checks,
        checkState: summarizeChecks(checks),
        threads: threadPages.flatMap((page) => page.reviewThreads?.nodes ?? []).map(threadOf),
        ...(typeof first.additions === 'number' ? { added: first.additions } : {}),
        ...(typeof first.deletions === 'number' ? { deleted: first.deletions } : {}),
        ...(typeof first.changedFiles === 'number' ? { changedFiles: first.changedFiles } : {})
    };
}

export interface PrReview {
    id: string;
    state: string;
    author: string;
    bot: boolean;
    /* ISO time; empty for a review nobody submitted yet. */
    submittedAt: string;
}

export interface PrPoll {
    pr: GitPullRequest;
    /* The account gh is signed in as; null when the answer did not say. */
    viewer: string | null;
    reviews: PrReview[];
}

/* What a watch asks every minute or so: the summary query with its checks and the latest reviews, and no threads. */
export async function pollPullRequest(run: GhRunner, cwd: string, repo: string, number: number): Promise<PrPoll | null> {
    const [owner, name] = repo.split('/');
    if (owner === undefined || name === undefined) {
        return null;
    }
    const output = await ghOutput(run, graphql(PR_QUERY, { owner, name, number }), cwd, 'pr-not-found');
    const pages = pagesOf<PullRequestJson>(output);
    const viewer = (jsonDocuments(output) as Array<Page<PullRequestJson>>).find((page) => page.data?.viewer?.login)?.data?.viewer?.login ?? null;
    const pr = pullRequestOf(repo, pages, []);
    if (pr === null) {
        return null;
    }
    const reviews = (pages[0]?.reviews?.nodes ?? []).map((review) => ({
        id: review.id ?? '',
        state: review.state ?? '',
        author: review.author?.login ?? 'ghost',
        bot: isBot(review.author),
        submittedAt: review.submittedAt ?? ''
    }));
    return { pr, viewer, reviews };
}
