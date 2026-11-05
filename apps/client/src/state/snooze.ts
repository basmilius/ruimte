import type { Snooze } from '@ruimte/contracts';
import { z } from 'zod';
import { create } from 'zustand';
import { dropEndpoint, endpointKey, isOfEndpoint, splitKey } from '@/state/keys';
import { storedJson } from '@/state/stored-json';
import { isConnectionError, readOnEveryOpen, type Transport } from '@/transport-api/transport';

/*
 * A node that needs you, put aside for a while. It leaves every count and every notification until
 * its time runs out. The machine keeps it (`snooze.set`), so every client and a phone's push alerts
 * share it; it never reaches `project.json`. The store only ever holds snoozes that still stand:
 * the clock below takes each out as it runs out, so a render reads presence and never the time.
 */

// The key snoozes were kept under before the machine kept them, cleared so it does not sit in storage.
storedJson('ruimte.snoozes', z.unknown()).remove();

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
export function snoozeUntil(choice: SnoozeChoice, now: number): number {
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
}

export function isSnoozed(snoozes: Snoozes, key: string, now: number): boolean {
    return (snoozes[key] ?? 0) > now;
}

/* The first snooze still ahead of `now`, or null when none is. */
export function nextWake(snoozes: Snoozes, now: number): number | null {
    let next: number | null = null;
    for (const until of Object.values(snoozes)) {
        if (until > now && (next === null || until < next)) {
            next = until;
        }
    }
    return next;
}

/* The same object when nothing ran out, so a store that sets it changes nothing. */
export function withoutExpired(snoozes: Snoozes, now: number): Snoozes {
    const kept = Object.entries(snoozes).filter(([key]) => isSnoozed(snoozes, key, now));
    return kept.length === Object.keys(snoozes).length ? snoozes : Object.fromEntries(kept);
}

/* Snoozes set for a machine while the link to it was down, by key, until the machine has them. */
const unsent = new Set<string>();

interface SnoozeStore {
    byKey: Snoozes;
    snooze(endpointId: string, nodeId: string, until: number): void;
    unsnooze(endpointId: string, nodeId: string): void;
    /* Every snooze a machine holds. */
    receive(endpointId: string, snoozes: readonly Pick<Snooze, 'nodeId' | 'until'>[]): void;
    prune(now: number): void;
    forget(endpointId: string): void;
}

/* The link to each machine, which is where a change on that machine is sent. */
const machines = new Map<string, SnoozeSync>();

export const useSnoozes = create<SnoozeStore>((set, get) => {
    const put = (byKey: Snoozes): void => {
        if (byKey !== get().byKey) {
            set({ byKey });
        }
    };
    return {
        byKey: {},
        snooze(endpointId, nodeId, until) {
            put({ ...get().byKey, [endpointKey(endpointId, nodeId)]: until });
            machines.get(endpointId)?.set(nodeId, until);
        },
        unsnooze(endpointId, nodeId) {
            const key = endpointKey(endpointId, nodeId);
            if (get().byKey[key] !== undefined) {
                const { [key]: _gone, ...byKey } = get().byKey;
                put(byKey);
            }
            machines.get(endpointId)?.clear(nodeId);
        },
        receive(endpointId, snoozes) {
            const byKey: Record<string, number> = dropEndpoint(get().byKey, endpointId);
            for (const { nodeId, until } of snoozes) {
                byKey[endpointKey(endpointId, nodeId)] = until;
            }
            put(byKey);
        },
        prune(now) {
            put(withoutExpired(get().byKey, now));
        },
        forget(endpointId) {
            put(dropEndpoint(get().byKey, endpointId));
        }
    };
});

/*
 * One machine's side of the snoozes: the list it holds on every fresh link, and every change after.
 * A snooze set or ended while the link was down goes over once it is back.
 */
export class SnoozeSync {
    private readonly endpointId: string;
    private readonly transport: Transport;
    private readonly off: (() => void)[];
    private generation = 0;
    /* Nodes whose snooze a person ended while the link was down. */
    private readonly unsentClears = new Set<string>();

    constructor(endpointId: string, transport: Transport) {
        this.endpointId = endpointId;
        this.transport = transport;
        this.off = [
            transport.on('snooze.changed', ({ snoozes }) => useSnoozes.getState().receive(endpointId, snoozes)),
            readOnEveryOpen(
                transport,
                () => void this.refresh(),
                () => this.generation++
            )
        ];
    }

    set(nodeId: string, until: number): void {
        const key = endpointKey(this.endpointId, nodeId);
        this.unsentClears.delete(nodeId);
        if (this.transport.status !== 'open') {
            unsent.add(key);
            return;
        }
        void this.transport
            .request('snooze.set', { nodeId, until })
            .then(() => {
                unsent.delete(key);
            })
            .catch((e: unknown) => {
                if (isConnectionError(e)) {
                    unsent.add(key);
                } else {
                    void this.refresh();
                }
            });
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

    private async refresh(): Promise<void> {
        const generation = this.generation;
        try {
            const { snoozes } = await this.transport.request('snooze.list', {});
            if (generation !== this.generation) {
                return;
            }
            const state = useSnoozes.getState();
            const mine = Object.entries(state.byKey).filter(([key]) => isOfEndpoint(key, this.endpointId) && unsent.has(key));
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
            // A link that went asks again once it is back.
        }
    }
}

export function watchSnoozes(endpointId: string, transport: Transport): () => void {
    const sync = new SnoozeSync(endpointId, transport);
    machines.set(endpointId, sync);
    return () => {
        sync.dispose();
        if (machines.get(endpointId) === sync) {
            machines.delete(endpointId);
        }
    };
}

/* When the snooze standing on a node runs out, or null while none does. */
export function snoozeOf(snoozes: Snoozes, endpointId: string, nodeId: string): number | null {
    return snoozes[endpointKey(endpointId, nodeId)] ?? null;
}

export function useSnoozedUntil(endpointId: string, nodeId: string): number | null {
    return useSnoozes((s) => snoozeOf(s.byKey, endpointId, nodeId));
}

/*
 * A timer asleep with the machine runs late by as long as it slept, so it never waits longer than
 * this before it reads the wall clock again.
 */
const MAX_TICK_MS = MINUTE;

/*
 * Nothing moves in any store when a snooze runs out, so this clock takes it out on time, and every
 * watcher that reads the snoozes sees the node come back in the same change.
 */
export function startSnoozeClock(now: () => number = Date.now): () => void {
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
}
