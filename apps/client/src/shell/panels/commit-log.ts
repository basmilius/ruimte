import type { GitCommit } from '@ruimte/contracts';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const DATE_WITH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/* The date a row falls back to once "days ago" stops meaning anything, with the year when it is not this one. */
const dateOf = (at: number, now: number): string => {
    const date = new Date(at * 1000);
    return date.getFullYear() === new Date(now * 1000).getFullYear() ? DATE_FORMAT.format(date) : DATE_WITH_YEAR.format(date);
};

/* How long ago a commit was written, short enough for the right edge of a log row. */
export const relativeTime = (at: number, now: number): string => {
    const seconds = Math.max(0, now - at);
    if (seconds < MINUTE) {
        return 'just now';
    }
    if (seconds < HOUR) {
        return `${Math.floor(seconds / MINUTE)}m ago`;
    }
    if (seconds < DAY) {
        return `${Math.floor(seconds / HOUR)}h ago`;
    }
    if (seconds < 7 * DAY) {
        return `${Math.floor(seconds / DAY)}d ago`;
    }
    return dateOf(at, now);
};

export interface LogSection {
    label: string;
    commits: GitCommit[];
}

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
export const groupCommits = (commits: readonly GitCommit[], now: number): LogSection[] => {
    const today = startOfDay(now);
    const sections: LogSection[] = [];
    for (const commit of commits) {
        const day = startOfDay(commit.at);
        const label = day === today ? 'Today' : day === today - DAY ? 'Yesterday' : dateOf(commit.at, now);
        const last = sections[sections.length - 1];
        if (last?.label === label) {
            last.commits.push(commit);
        } else {
            sections.push({ label, commits: [commit] });
        }
    }
    return sections;
};
