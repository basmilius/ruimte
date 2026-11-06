import { formatDay, formatDayWithYear } from '@adecore/ui/format';
import type { GitCommit } from '@ruimte/contracts';
import i18next from 'i18next';

/* The date a row falls back to once "days ago" stops meaning anything, with the year when it is not this one. */
function dateOf(at: number, now: number): string {
    const date = new Date(at * 1000);
    return date.getFullYear() === new Date(now * 1000).getFullYear() ? formatDay(date) : formatDayWithYear(date);
}

/* One commit with the checkout it came out of, which is what opening a row needs and what a row says
   while the folder holds more than one repository. */
export interface LogRow extends GitCommit {
    cwd: string;
    /* The name of the repository, empty while the folder holds a single one. */
    repo: string;
}

/* A page of one checkout's log, as the merge below takes it. */
export interface LoadedLog {
    cwd: string;
    repo: string;
    commits: readonly GitCommit[];
    /* Null when this checkout has no further page. */
    cursor: string | null;
}

interface LogSection {
    label: string;
    commits: LogRow[];
}

/* The date git orders a log by, which a rebase moves and the author date keeps. */
function committedAt(commit: GitCommit): number {
    return commit.committedAt ?? commit.at;
}

/*
 * The logs of several checkouts as one history, newest first. The merge stops where a page that has
 * more to give runs out, since below that its next page could still hold a newer commit.
 */
export function mergeLogs(logs: readonly LoadedLog[]): { rows: LogRow[]; more: boolean } {
    const queues = logs.map((log) => ({ log, next: 0 }));
    const headOf = (queue: (typeof queues)[number]): GitCommit => queue.log.commits[queue.next]!;
    const rows: LogRow[] = [];
    for (;;) {
        const waiting = queues.filter((queue) => queue.next < queue.log.commits.length);
        if (waiting.length === 0) {
            break;
        }
        const newest = waiting.reduce((best, queue) => (committedAt(headOf(queue)) > committedAt(headOf(best)) ? queue : best));
        rows.push({ ...headOf(newest), cwd: newest.log.cwd, repo: newest.log.repo });
        newest.next += 1;
        if (newest.log.cursor !== null && newest.next === newest.log.commits.length) {
            break;
        }
    }
    return { rows, more: logs.some((log) => log.cursor !== null) };
}

function startOfDay(seconds: number): number {
    const date = new Date(seconds * 1000);
    date.setHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
}

/* By the calendar rather than by 24 hours, since the day a clock moves for daylight saving is 23 or 25 hours long. */
function dayBefore(day: number): number {
    const date = new Date(day * 1000);
    date.setDate(date.getDate() - 1);
    date.setHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
}

/* The log grouped by day, counted from midnight, so a commit from last night is under Yesterday. */
export function groupCommits(commits: readonly LogRow[], now: number): LogSection[] {
    const today = startOfDay(now);
    const yesterday = dayBefore(today);
    const sections: LogSection[] = [];
    for (const commit of commits) {
        const day = startOfDay(commit.at);
        const label = day === today ? i18next.t('panels:git.log.today') : day === yesterday ? i18next.t('panels:git.log.yesterday') : dateOf(commit.at, now);
        const last = sections[sections.length - 1];
        if (last?.label === label) {
            last.commits.push(commit);
        } else {
            sections.push({ label, commits: [commit] });
        }
    }
    return sections;
}

/* A name on a commit row. */
interface ShownRef {
    name: string;
    /* The remote-tracking twin on the same commit, such as `origin/main`, or null. */
    tracked: string | null;
}

/*
 * The names a row shows: a local branch and its remote twin on one commit read as the branch with a
 * mark, and a remote's `HEAD` says nothing a row needs. A daemon from before `remoteRefs` names every
 * ref as it is.
 */
export function shownRefs(commit: Pick<GitCommit, 'refs' | 'remoteRefs'>): ShownRef[] {
    const remotes = new Set(commit.remoteRefs ?? []);
    const locals = new Set(commit.refs.filter((ref) => !remotes.has(ref)));
    const twinOf = (remote: string): string => remote.slice(remote.indexOf('/') + 1);
    const tracked = new Map([...remotes].filter((remote) => locals.has(twinOf(remote))).map((remote) => [twinOf(remote), remote]));
    return commit.refs
        .filter((ref) => !remotes.has(ref) || (twinOf(ref) !== 'HEAD' && !tracked.has(twinOf(ref))))
        .map((ref) => ({ name: ref, tracked: tracked.get(ref) ?? null }));
}

/*
 * GitHub's picture for a commit written from its private address, `<id>+<login>@` or, before 2017,
 * `<login>@users.noreply.github.com`, or from an address GitHub linked to an account in the commits it
 * holds (`accounts`, from `git.authors`). Any other address has none: asking a picture service about it
 * would hand that service every author of the repository.
 */
export function githubPicture(email: string | undefined, accounts?: ReadonlyMap<string, number>): string | null {
    const match = /^(?:(\d+)\+)?([a-z\d](?:[a-z\d-]*[a-z\d])?)@users\.noreply\.github\.com$/i.exec(email ?? '');
    if (match === null) {
        const account = email === undefined ? undefined : accounts?.get(email.toLowerCase());
        return account === undefined ? null : `https://avatars.githubusercontent.com/u/${account}?s=32`;
    }
    const [, id, login = ''] = match;
    return id === undefined ? `https://github.com/${login}.png?size=32` : `https://avatars.githubusercontent.com/u/${id}?s=32`;
}
