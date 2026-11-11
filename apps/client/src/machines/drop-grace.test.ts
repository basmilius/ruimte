import { describe, expect, test } from 'bun:test';
import type { ConnectionState } from '@/transport-api/transport';
import { DropGrace } from './drop-grace';

type Link = Pick<ConnectionState, 'status' | 'attempts'>;

/* A link and a clock by hand: the status moves only when a test says so, and a timer fires only on `elapse`. */
function harness() {
    let link: Link = { status: 'open', attempts: 0 };
    const statusListeners = new Set<() => void>();
    let timers: Array<{ run: () => void; at: number; id: number }> = [];
    let now = 0;
    let nextId = 1;
    const grace = new DropGrace({
        connection: () => link,
        subscribe: (_endpointId, onChange) => {
            statusListeners.add(onChange);
            return () => statusListeners.delete(onChange);
        },
        graceMs: 3_000,
        setTimer: (run, ms) => {
            const id = nextId++;
            timers.push({ run, at: now + ms, id });
            return id as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: (timer) => {
            timers = timers.filter((entry) => entry.id !== (timer as unknown as number));
        }
    });
    return {
        grace,
        set(next: Link): void {
            link = next;
            for (const listener of [...statusListeners]) {
                listener();
            }
        },
        elapse(ms: number): void {
            now += ms;
            const due = timers.filter((entry) => entry.at <= now);
            timers = timers.filter((entry) => entry.at > now);
            for (const entry of due) {
                entry.run();
            }
        },
        timers: () => timers.length,
        statusListeners: () => statusListeners.size
    };
}

describe('a dropped link past its grace', () => {
    test('is overdue only once it stayed down the whole grace', () => {
        const link = harness();
        let changes = 0;
        link.grace.watch('local', () => {
            changes += 1;
        });
        link.set({ status: 'closed', attempts: 1 });
        link.elapse(2_999);
        expect(link.grace.overdue('local')).toBe(false);
        link.elapse(1);
        expect(link.grace.overdue('local')).toBe(true);
        expect(changes).toBe(1);
    });

    test('is never overdue when the link came back within the grace, and the next drop starts a grace of its own', () => {
        const link = harness();
        link.grace.watch('local', () => undefined);
        link.set({ status: 'closed', attempts: 1 });
        link.elapse(400);
        link.set({ status: 'connecting', attempts: 1 });
        link.set({ status: 'open', attempts: 0 });
        expect(link.timers()).toBe(0);
        link.elapse(5_000);
        expect(link.grace.overdue('local')).toBe(false);
        link.set({ status: 'closed', attempts: 1 });
        link.elapse(2_000);
        expect(link.grace.overdue('local')).toBe(false);
    });

    test('keeps one grace across the tries of one drop, and clears once the link is open', () => {
        const link = harness();
        let changes = 0;
        link.grace.watch('local', () => {
            changes += 1;
        });
        link.set({ status: 'closed', attempts: 1 });
        link.elapse(1_000);
        link.set({ status: 'connecting', attempts: 1 });
        link.elapse(1_000);
        link.set({ status: 'closed', attempts: 2 });
        link.elapse(1_000);
        expect(link.grace.overdue('local')).toBe(true);
        link.set({ status: 'open', attempts: 0 });
        expect(link.grace.overdue('local')).toBe(false);
        expect(changes).toBe(2);
    });

    test('says nothing of a link that is opening for the first time', () => {
        const link = harness();
        link.grace.watch('local', () => undefined);
        link.set({ status: 'connecting', attempts: 0 });
        link.elapse(10_000);
        expect(link.grace.overdue('local')).toBe(false);
    });

    test('lets go of the link and its timer once the last watcher is gone', () => {
        const link = harness();
        const stopFirst = link.grace.watch('local', () => undefined);
        const stopSecond = link.grace.watch('local', () => undefined);
        expect(link.statusListeners()).toBe(1);
        link.set({ status: 'closed', attempts: 1 });
        stopFirst();
        expect(link.timers()).toBe(1);
        stopSecond();
        expect(link.timers()).toBe(0);
        expect(link.statusListeners()).toBe(0);
        expect(link.grace.overdue('local')).toBe(false);
    });
});
