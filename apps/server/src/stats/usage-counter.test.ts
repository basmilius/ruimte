import { beforeEach, describe, expect, test } from 'bun:test';
import { isMachineStatePath } from '../fs/machine-home.ts';
import { UsageCounter, usageStatePath, type UsageStateStore } from './usage-counter.ts';

const DAY = 86_400_000;

let clock: number;
let written: string | null;
let timers: Array<{ run: () => void; ms: number; cancelled: boolean }>;

function memoryStore(initial: string | null = null): UsageStateStore {
    written = initial;
    return {
        read: async () => written,
        write: async (text) => {
            written = text;
        }
    };
}

function counterOf(store: UsageStateStore = memoryStore()): UsageCounter {
    return new UsageCounter({
        store,
        describe: () => ({ version: '1.2.3', launcher: 'desktop' }),
        now: () => clock,
        schedule: (run, ms) => {
            const timer = { run, ms, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        }
    });
}

function runTimers(): void {
    const due = timers.filter((timer) => !timer.cancelled);
    timers = [];
    due.forEach((timer) => timer.run());
}

beforeEach(() => {
    // A Wednesday.
    clock = Date.parse('2026-10-14T10:00:00Z');
    written = null;
    timers = [];
});

describe('the usage counter', () => {
    test('counts per UTC day and hands out only the finished days, newest first', () => {
        const counter = counterOf();
        counter.count('projects.opened');
        counter.count('projects.opened');
        clock += DAY;
        counter.count('terminals.started');
        clock += DAY;
        counter.touch();

        const finished = counter.finished();
        expect(finished.map((day) => day.date)).toEqual(['2026-10-15', '2026-10-14']);
        expect(finished[1]!.counts).toEqual({ 'projects.opened': 2 });
        expect(finished[0]!.counts).toEqual({ 'terminals.started': 1 });
        expect(finished[1]).toMatchObject({ version: '1.2.3', launcher: 'desktop', signedIn: false });
    });

    test('marks the first active day of a week and of a month', () => {
        const counter = counterOf();
        const flags = (): Record<string, boolean[]> => Object.fromEntries(counter.finished().map((day) => [day.date, [day.firstThisWeek, day.firstThisMonth]]));
        counter.touch();
        clock = Date.parse('2026-10-16T10:00:00Z');
        counter.touch();
        // Monday of the next week, still October.
        clock = Date.parse('2026-10-19T10:00:00Z');
        counter.touch();
        clock = Date.parse('2026-10-20T10:00:00Z');
        expect(flags()).toEqual({ '2026-10-14': [true, true], '2026-10-16': [false, false], '2026-10-19': [true, false] });

        clock = Date.parse('2026-10-31T10:00:00Z');
        counter.touch();
        // A Sunday: the week of the Saturday before it, in a new month.
        clock = Date.parse('2026-11-01T10:00:00Z');
        counter.touch();
        clock = Date.parse('2026-11-02T10:00:00Z');
        expect(flags()).toEqual({ '2026-10-31': [true, false], '2026-11-01': [false, true] });
        expect(counter.firstDate).toBe('2026-10-14');
    });

    test('keeps at most today and the seven days before it', () => {
        const counter = counterOf();
        for (let i = 0; i < 12; i++) {
            counter.count('launches.run');
            clock += DAY;
        }
        counter.touch();
        const dates = counter.finished().map((day) => day.date);
        expect(dates).toHaveLength(7);
        expect(dates[0]).toBe('2026-10-25');
        expect(dates.at(-1)).toBe('2026-10-19');
    });

    test('writes at most once a minute, and at once when asked', async () => {
        const counter = counterOf();
        counter.count('projects.opened');
        counter.count('projects.opened');
        expect(timers).toHaveLength(1);
        expect(timers[0]!.ms).toBe(60_000);
        expect(written).toBeNull();
        runTimers();
        await Promise.resolve();
        expect(JSON.parse(written!).days[0].counts).toEqual({ 'projects.opened': 2 });

        counter.count('projects.opened');
        await counter.persist();
        expect(timers.every((timer) => timer.cancelled)).toBe(true);
        expect(JSON.parse(written!).days[0].counts).toEqual({ 'projects.opened': 3 });
    });

    test('reads back what it wrote, and starts over on a file it cannot read', async () => {
        const first = counterOf();
        first.count('worktree.merges');
        await first.persist();

        const second = counterOf(memoryStore(written));
        await second.load();
        second.count('worktree.merges');
        clock += DAY;
        expect(second.finished()[0]!.counts).toEqual({ 'worktree.merges': 2 });

        const broken = counterOf(memoryStore('{ not json'));
        await broken.load();
        expect(broken.firstDate).toBeNull();
    });

    test('a day is signed in once the machine was on an account at any moment of it', () => {
        const counter = counterOf();
        counter.noteSignedIn(true);
        counter.noteSignedIn(false);
        clock += DAY;
        expect(counter.finished()[0]!.signedIn).toBe(true);
    });

    test('keeps a bounded number of startups', () => {
        const counter = counterOf();
        for (let i = 0; i < 40; i++) {
            counter.startup(1000 + i);
        }
        clock += DAY;
        expect(counter.finished()[0]!.startups).toHaveLength(32);
    });

    test('forgets what was sent, and everything when turned off, keeping the cohort', async () => {
        const counter = counterOf();
        counter.count('projects.opened');
        clock += DAY;
        counter.count('projects.opened');
        clock += DAY;
        counter.forget(['2026-10-14']);
        expect(counter.finished().map((day) => day.date)).toEqual(['2026-10-15']);

        await counter.discard();
        expect(counter.finished()).toEqual([]);
        expect(counter.firstDate).toBe('2026-10-14');
        expect(JSON.parse(written!).days).toEqual([]);
    });

    test('a day after the counts were turned off and on again is the first of its week and month', async () => {
        const counter = counterOf();
        counter.touch();
        await counter.discard();
        clock += DAY;
        counter.touch();
        clock += DAY;
        expect(counter.finished()[0]).toMatchObject({ date: '2026-10-15', firstThisWeek: true, firstThisMonth: true });
    });

    test('counts a key once a day, and again on the next day or after the counts were turned off', async () => {
        const counter = counterOf();
        counter.countOnce('projects.opened', 'p1');
        counter.countOnce('projects.opened', 'p1');
        counter.countOnce('views.canvas', 'p1');
        clock += DAY;
        expect(counter.finished()[0]!.counts).toEqual({ 'projects.opened': 1, 'views.canvas': 1 });
        counter.countOnce('projects.opened', 'p1');
        await counter.discard();
        counter.countOnce('projects.opened', 'p1');
        clock += DAY;
        expect(counter.finished()[0]!.counts).toEqual({ 'projects.opened': 1 });
        await counter.persist();
        expect(written).not.toContain('p1');
    });

    test('keeps its counts where no client file request reaches', () => {
        expect(isMachineStatePath({ homes: ['/home/someone/.ruimte'] }, usageStatePath('/home/someone/.ruimte'))).toBe(true);
    });
});
