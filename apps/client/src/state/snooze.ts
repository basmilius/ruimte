import { create } from 'zustand';
import { dropEndpoint, endpointKey } from '@/state/keys';

/*
 * A node that needs you, put aside for a while by one person on one client. It leaves every count
 * and every notification until its time runs out, and it never reaches `project.json` or the wire.
 * The store only ever holds snoozes that still stand: the clock below takes each out as it runs out,
 * so a render reads presence and never the time.
 */

const STORAGE_KEY = 'ruimte.snoozes';

/* Keyed with `endpointKey`, each the moment the snooze runs out, epoch ms. */
export type Snoozes = Readonly<Record<string, number>>;

export type SnoozeChoice = 'ten-minutes' | 'hour' | 'tomorrow';

export const SNOOZE_CHOICES: readonly SnoozeChoice[] = ['ten-minutes', 'hour', 'tomorrow'];

const MINUTE = 60_000;

/* The hour "tomorrow" wakes at, local time. */
const MORNING_HOUR = 9;

/*
 * When a choice made at `now` runs out. Tomorrow is the next 09:00 still ahead, so a snooze set
 * at two in the night wakes the same morning rather than a day later.
 */
export const snoozeUntil = (choice: SnoozeChoice, now: number): number => {
    if (choice === 'ten-minutes') {
        return now + 10 * MINUTE;
    }
    if (choice === 'hour') {
        return now + 60 * MINUTE;
    }
    const morning = new Date(now);
    morning.setHours(MORNING_HOUR, 0, 0, 0);
    if (morning.getTime() <= now) {
        morning.setDate(morning.getDate() + 1);
    }
    return morning.getTime();
};

export const isSnoozed = (snoozes: Snoozes, key: string, now: number): boolean => (snoozes[key] ?? 0) > now;

/* The first snooze still ahead of `now`, or null when none is. */
export const nextWake = (snoozes: Snoozes, now: number): number | null => {
    let next: number | null = null;
    for (const until of Object.values(snoozes)) {
        if (until > now && (next === null || until < next)) {
            next = until;
        }
    }
    return next;
};

/* The same object when nothing ran out, so a store that sets it changes nothing. */
export const withoutExpired = (snoozes: Snoozes, now: number): Snoozes => {
    const kept = Object.entries(snoozes).filter(([key]) => isSnoozed(snoozes, key, now));
    return kept.length === Object.keys(snoozes).length ? snoozes : Object.fromEntries(kept);
};

/*
 * Which snoozes end early because their node stopped needing you, and which snoozed nodes have been
 * seen waiting. Only a node seen waiting under its snooze can stop: after a reload a terminal reads as
 * running until its agent reports again, and that is not a person having answered.
 */
export const observeWaiting = (
    snoozes: Snoozes,
    waiting: ReadonlySet<string>,
    observed: ReadonlyMap<string, boolean>
): { waiting: Set<string>; forget: string[] } => {
    const next = new Set([...waiting].filter((key) => snoozes[key] !== undefined));
    const forget: string[] = [];
    for (const [key, needsYou] of observed) {
        if (snoozes[key] === undefined) {
            continue;
        }
        if (needsYou) {
            next.add(key);
        } else if (next.has(key)) {
            next.delete(key);
            forget.push(key);
        }
    }
    return { waiting: next, forget };
};

type SnoozeStorage = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): SnoozeStorage | null => (typeof localStorage === 'undefined' ? null : localStorage);

const readStored = (storage: SnoozeStorage | null, now: number): Snoozes => {
    try {
        const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}') as unknown;
        if (typeof parsed !== 'object' || parsed === null) {
            return {};
        }
        return withoutExpired(Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number')), now);
    } catch {
        return {};
    }
};

const write = (byKey: Snoozes): void => {
    try {
        browserStorage()?.setItem(STORAGE_KEY, JSON.stringify(byKey));
    } catch {
        // Storage that refuses keeps the snoozes for this session only.
    }
};

interface SnoozeStore {
    byKey: Snoozes;
    snooze(endpointId: string, nodeId: string, until: number): void;
    unsnooze(endpointId: string, nodeId: string): void;
    /* Needs you or not, per key, for the nodes whose status is known right now. */
    observe(observed: ReadonlyMap<string, boolean>): void;
    prune(now: number): void;
    forget(endpointId: string): void;
}

/* Not state anything draws, so a pass that only notes a node waiting renders nothing. */
let waiting: ReadonlySet<string> = new Set<string>();

export const useSnoozes = create<SnoozeStore>((set, get) => {
    const put = (byKey: Snoozes): void => {
        if (byKey !== get().byKey) {
            set({ byKey });
            write(byKey);
        }
    };
    return {
        byKey: readStored(browserStorage(), Date.now()),
        snooze(endpointId, nodeId, until) {
            put({ ...get().byKey, [endpointKey(endpointId, nodeId)]: until });
        },
        unsnooze(endpointId, nodeId) {
            const key = endpointKey(endpointId, nodeId);
            if (get().byKey[key] !== undefined) {
                const { [key]: _gone, ...byKey } = get().byKey;
                put(byKey);
            }
        },
        observe(observed) {
            const result = observeWaiting(get().byKey, waiting, observed);
            waiting = result.waiting;
            if (result.forget.length > 0) {
                put(Object.fromEntries(Object.entries(get().byKey).filter(([key]) => !result.forget.includes(key))));
            }
        },
        prune(now) {
            put(withoutExpired(get().byKey, now));
        },
        forget(endpointId) {
            put(dropEndpoint(get().byKey, endpointId));
        }
    };
});

/* When the snooze standing on a node runs out, or null while none does. */
export const snoozeOf = (snoozes: Snoozes, endpointId: string, nodeId: string): number | null => snoozes[endpointKey(endpointId, nodeId)] ?? null;

export const useSnoozedUntil = (endpointId: string, nodeId: string): number | null => useSnoozes((s) => snoozeOf(s.byKey, endpointId, nodeId));

/*
 * A timer asleep with the machine runs late by as long as it slept, so it never waits longer than
 * this before it reads the wall clock again.
 */
export const MAX_TICK_MS = MINUTE;

/*
 * Nothing moves in any store when a snooze runs out, so this clock takes it out on time, and every
 * watcher that reads the snoozes sees the node come back in the same change.
 */
export const startSnoozeClock = (now: () => number = Date.now): (() => void) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        const wake = nextWake(useSnoozes.getState().byKey, now());
        if (wake !== null) {
            timer = setTimeout(tick, Math.min(wake - now(), MAX_TICK_MS));
        }
    };
    const tick = (): void => {
        timer = null;
        useSnoozes.getState().prune(now());
        arm();
    };
    const off = useSnoozes.subscribe(arm);
    tick();
    return () => {
        off();
        if (timer !== null) {
            clearTimeout(timer);
        }
    };
};
