import { create } from 'zustand';
import type { Snooze } from '@ruimte/contracts';
import { dropEndpoint, endpointKey, isOfEndpoint, splitKey } from '@/state/keys';
import { isConnectionError, type Transport } from '@/transport/transport';

/*
 * A node that needs you, put aside for a while. It leaves every count and every notification until
 * its time runs out. The machine keeps it (`snooze.set`), so every client and a phone's push alerts
 * share it; it never reaches `project.json`. A machine from before that answers `unknown-request`,
 * and its snoozes stay in this client's storage as they always did. The store only ever holds
 * snoozes that still stand: the clock below takes each out as it runs out, so a render reads
 * presence and never the time.
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

/* Snoozes set for a machine while the link to it was down, by key, until the machine has them. */
const unsent = new Set<string>();

/* Only what this client keeps itself; a machine's own snoozes come back from the machine. */
const write = (byKey: Snoozes, onMachine: OnMachine): void => {
    try {
        const kept = Object.entries(byKey).filter(([key]) => onMachine[splitKey(key).endpointId] !== true || unsent.has(key));
        browserStorage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
        // Storage that refuses keeps the snoozes for this session only.
    }
};

/* The machines that keep the snoozes themselves, by endpoint id. */
type OnMachine = Readonly<Record<string, true>>;

interface SnoozeStore {
    byKey: Snoozes;
    onMachine: OnMachine;
    snooze(endpointId: string, nodeId: string, until: number): void;
    unsnooze(endpointId: string, nodeId: string): void;
    /* Every snooze a machine holds, which makes it the one that keeps them from now on. */
    receive(endpointId: string, snoozes: readonly Pick<Snooze, 'nodeId' | 'until'>[]): void;
    /* Needs you or not, per key, for the nodes whose status is known right now. */
    observe(observed: ReadonlyMap<string, boolean>): void;
    prune(now: number): void;
    forget(endpointId: string): void;
}

/* Not state anything draws, so a pass that only notes a node waiting renders nothing. */
let waiting: ReadonlySet<string> = new Set<string>();

/* The link to each machine that keeps snoozes, which is where a change on that machine is sent. */
const machines = new Map<string, SnoozeSync>();

export const useSnoozes = create<SnoozeStore>((set, get) => {
    const put = (byKey: Snoozes, onMachine: OnMachine = get().onMachine): void => {
        if (byKey !== get().byKey || onMachine !== get().onMachine) {
            set({ byKey, onMachine });
            write(byKey, onMachine);
        }
    };
    const kept = (endpointId: string): SnoozeSync | null => (get().onMachine[endpointId] === true ? (machines.get(endpointId) ?? null) : null);
    return {
        byKey: readStored(browserStorage(), Date.now()),
        onMachine: {},
        snooze(endpointId, nodeId, until) {
            put({ ...get().byKey, [endpointKey(endpointId, nodeId)]: until });
            kept(endpointId)?.set(nodeId, until);
        },
        unsnooze(endpointId, nodeId) {
            const key = endpointKey(endpointId, nodeId);
            if (get().byKey[key] !== undefined) {
                const { [key]: _gone, ...byKey } = get().byKey;
                put(byKey);
            }
            kept(endpointId)?.clear(nodeId);
        },
        receive(endpointId, snoozes) {
            const byKey: Record<string, number> = dropEndpoint(get().byKey, endpointId);
            for (const { nodeId, until } of snoozes) {
                byKey[endpointKey(endpointId, nodeId)] = until;
            }
            put(byKey, get().onMachine[endpointId] === true ? get().onMachine : { ...get().onMachine, [endpointId]: true });
        },
        observe(observed) {
            // A machine that keeps the snoozes ends them itself when their node stops waiting.
            const onMachine = get().onMachine;
            const local = new Map([...observed].filter(([key]) => onMachine[splitKey(key).endpointId] !== true));
            const result = observeWaiting(get().byKey, waiting, local);
            waiting = result.waiting;
            if (result.forget.length > 0) {
                put(Object.fromEntries(Object.entries(get().byKey).filter(([key]) => !result.forget.includes(key))));
            }
        },
        prune(now) {
            put(withoutExpired(get().byKey, now));
        },
        forget(endpointId) {
            const { [endpointId]: _gone, ...onMachine } = get().onMachine;
            put(dropEndpoint(get().byKey, endpointId), onMachine);
        }
    };
});

/*
 * One machine's side of the snoozes: the list it holds on every fresh link, and every change after.
 * What this client kept itself for a machine that turns out to keep them goes over once and leaves
 * the storage, and so does a snooze set or ended while the link was down, once it is back.
 */
export class SnoozeSync {
    private readonly endpointId: string;
    private readonly transport: Transport;
    private readonly off: (() => void)[];
    private generation = 0;
    /* A change heard before the first list would take the machine over before what this client kept went across. */
    private listed = false;
    /* Nodes whose snooze a person ended while the link was down. */
    private readonly unsentClears = new Set<string>();

    constructor(endpointId: string, transport: Transport) {
        this.endpointId = endpointId;
        this.transport = transport;
        this.off = [
            transport.on('snooze.changed', ({ snoozes }) => {
                if (this.listed) {
                    useSnoozes.getState().receive(endpointId, snoozes);
                }
            }),
            transport.subscribeStatus((status) => {
                this.generation++;
                if (status === 'open') {
                    void this.refresh();
                }
            })
        ];
        if (transport.status === 'open') {
            void this.refresh();
        }
    }

    set(nodeId: string, until: number): void {
        const key = endpointKey(this.endpointId, nodeId);
        this.unsentClears.delete(nodeId);
        if (this.transport.status !== 'open') {
            this.hold(key);
            return;
        }
        void this.transport
            .request('snooze.set', { nodeId, until })
            .then(() => {
                unsent.delete(key);
            })
            .catch((e: unknown) => (isConnectionError(e) ? this.hold(key) : this.refresh()));
    }

    clear(nodeId: string): void {
        unsent.delete(endpointKey(this.endpointId, nodeId));
        if (this.transport.status !== 'open') {
            this.unsentClears.add(nodeId);
            return;
        }
        void this.transport.request('snooze.clear', { nodeId }).catch((e: unknown) => {
            if (isConnectionError(e)) {
                this.unsentClears.add(nodeId);
            } else {
                void this.refresh();
            }
        });
    }

    dispose(): void {
        this.generation++;
        this.off.forEach((off) => off());
    }

    /* Kept in this client's storage too, so a reload before the link is back does not lose it. */
    private hold(key: string): void {
        unsent.add(key);
        const { byKey, onMachine } = useSnoozes.getState();
        write(byKey, onMachine);
    }

    private async refresh(): Promise<void> {
        const generation = this.generation;
        try {
            const { snoozes } = await this.transport.request('snooze.list', {});
            if (generation !== this.generation) {
                return;
            }
            this.listed = true;
            const state = useSnoozes.getState();
            const onMachine = state.onMachine[this.endpointId] === true;
            const mine = Object.entries(state.byKey).filter(([key]) => isOfEndpoint(key, this.endpointId) && (!onMachine || unsent.has(key)));
            for (const key of [...unsent].filter((entry) => isOfEndpoint(entry, this.endpointId))) {
                unsent.delete(key);
            }
            state.receive(this.endpointId, snoozes);
            const held = new Map(snoozes.map((snooze) => [snooze.nodeId, snooze.until]));
            const now = Date.now();
            for (const [key, until] of mine) {
                const { id } = splitKey(key);
                if (until > now && held.get(id) !== until) {
                    useSnoozes.getState().snooze(this.endpointId, id, until);
                }
            }
            for (const nodeId of this.unsentClears) {
                if (held.has(nodeId)) {
                    useSnoozes.getState().unsnooze(this.endpointId, nodeId);
                }
            }
            this.unsentClears.clear();
        } catch {
            // A machine from before answers `unknown-request`, so this client goes on keeping its snoozes; a link that went asks again once it is back.
        }
    }
}

export const watchSnoozes = (endpointId: string, transport: Transport): (() => void) => {
    const sync = new SnoozeSync(endpointId, transport);
    machines.set(endpointId, sync);
    return () => {
        sync.dispose();
        if (machines.get(endpointId) === sync) {
            machines.delete(endpointId);
        }
    };
};

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
