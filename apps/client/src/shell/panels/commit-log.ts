import i18next from 'i18next';
import type { GitCommit } from '@ruimte/contracts';
import { formatDay, formatDayWithYear } from '@ruimte/ui/format/datetime';
import { formatAgo } from '@ruimte/ui/format/duration';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* The date a row falls back to once "days ago" stops meaning anything, with the year when it is not this one. */
const dateOf = (at: number, now: number): string => {
    const date = new Date(at * 1000);
    return date.getFullYear() === new Date(now * 1000).getFullYear() ? formatDay(date) : formatDayWithYear(date);
};

/* How long ago a commit was written, short enough for the right edge of a log row. */
export const relativeTime = (at: number, now: number): string => {
    const seconds = Math.max(0, now - at);
    return seconds < 7 * DAY ? formatAgo(seconds * 1000) : dateOf(at, now);
};

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

export interface LogSection {
    label: string;
    commits: LogRow[];
}

/*
 * The logs of several checkouts as one history, newest first. Every page covers a different stretch
 * of time, so the merge reaches no further down than the newest of the pages that have more to give:
 * under that line a repository could still hold a commit older than the rows around it, and putting
 * those rows in now would mean moving them later. They come with the next page instead.
 */
export const mergeLogs = (logs: readonly LoadedLog[]): { rows: LogRow[]; more: boolean } => {
    const floors = logs.filter((log) => log.cursor !== null && log.commits.length > 0).map((log) => log.commits[log.commits.length - 1]!.at);
    const floor = floors.length === 0 ? null : Math.max(...floors);
    const rows = logs
        .flatMap((log) => log.commits.map((commit) => ({ ...commit, cwd: log.cwd, repo: log.repo })))
        .filter((row) => floor === null || row.at >= floor)
        .sort((left, right) => right.at - left.at);
    return { rows, more: logs.some((log) => log.cursor !== null) };
};

const startOfDay = (seconds: number): number => {
    const date = new Date(seconds * 1000);
    date.setHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
};

/*
 * The log as the days it was written on, in the order the commits came in. The days are counted
 * from midnight and not from the elapsed hours, so a commit from last night is under Yesterday the
 * way a person remembers it, not under Today because it was eleven hours ago.
 */
export const groupCommits = (commits: readonly LogRow[], now: number): LogSection[] => {
    const today = startOfDay(now);
    const sections: LogSection[] = [];
    for (const commit of commits) {
        const day = startOfDay(commit.at);
        const label = day === today ? i18next.t('panels:git.log.today') : day === today - DAY ? i18next.t('panels:git.log.yesterday') : dateOf(commit.at, now);
        const last = sections[sections.length - 1];
        if (last?.label === label) {
            last.commits.push(commit);
        } else {
            sections.push({ label, commits: [commit] });
        }
    }
    return sections;
};
