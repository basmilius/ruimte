import type { DeviceInfo, DevicePower } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import { realTimers, type Timers } from '../timers.ts';
import type { SessionSink } from '../wire.ts';
import type { DeviceManager } from './manager.ts';

/* How often the backends are surveyed while a client watches; no backend tells of a device coming or going. */
export const DEVICE_WATCH_MS = 1_000;

/* A phone's battery moves slowly, so it is read on every this-many surveys. */
const SURVEYS_PER_POWER = 60;

type Surveyed = Pick<DeviceManager, 'survey' | 'power'>;

/*
 * Tells the clients that asked with `device.watch` that the devices or a battery changed, and nothing
 * else: a client reads the list and the batteries it shows itself. The backends are surveyed once for
 * all of them and only while one watches, so the daemon asks them no more often than a single client did.
 */
export class DeviceWatch {
    private readonly devices: Surveyed;
    private readonly timers: Timers;
    private readonly sinks = new ClientSinks((clientId) => this.unwatch(clientId));
    private readonly watching = new Set<string>();
    /*
     * Clients that started watching after the last survey began. A client reads the list around the time
     * it watches, so a change may sit between its read and the next survey's state: it hears the next
     * completed survey whatever that found.
     */
    private readonly fresh = new Set<string>();
    private cancel: (() => void) | null = null;
    // A survey still under way when the last client left belongs to a loop that is over.
    private loop = 0;
    private surveys = 0;
    private seen: string | null = null;
    private powers = new Map<string, DevicePower | null>();

    constructor(devices: Surveyed, timers: Timers = realTimers) {
        this.devices = devices;
        this.timers = timers;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    watch(clientId: string): void {
        this.watching.add(clientId);
        this.fresh.add(clientId);
        if (this.cancel === null) {
            this.seen = null;
            this.surveys = 0;
            this.powers = new Map();
            this.schedule(++this.loop, 0);
        }
    }

    unwatch(clientId: string): void {
        this.watching.delete(clientId);
        this.fresh.delete(clientId);
        if (this.watching.size === 0) {
            this.stop();
        }
    }

    stop(): void {
        this.watching.clear();
        this.fresh.clear();
        this.cancel?.();
        this.cancel = null;
        this.loop += 1;
    }

    private schedule(loop: number, ms: number): void {
        this.cancel = this.timers.set(() => void this.survey(loop), ms);
    }

    private async survey(loop: number): Promise<void> {
        const fresh = new Set(this.fresh);
        this.fresh.clear();
        const state = await this.read();
        if (loop !== this.loop) {
            return;
        }

        const changed = this.seen !== null && state !== this.seen;

        for (const clientId of this.watching) {
            if (changed || fresh.has(clientId)) {
                this.sinks.to(clientId, { event: 'device.changed', payload: {} });
            }
        }

        this.seen = state;
        this.surveys += 1;
        this.schedule(loop, DEVICE_WATCH_MS);
    }

    /* What a client would see, as text to compare: the survey, or the reason there is none, and the batteries of the phones. */
    private async read(): Promise<string> {
        let devices: DeviceInfo[];
        let unavailable: unknown;
        try {
            ({ devices, unavailable } = await this.devices.survey());
        } catch (error) {
            return `failed:${errorText(error)}`;
        }
        const readPowers = this.surveys % SURVEYS_PER_POWER === 0;
        const powers = new Map<string, DevicePower | null>();
        for (const device of devices.filter((candidate) => candidate.kind === 'physical')) {
            const key = `${device.backendId}:${device.deviceId}`;
            powers.set(key, readPowers ? await this.devices.power(device.backendId, device.platform, device.deviceId) : (this.powers.get(key) ?? null));
        }
        this.powers = powers;
        return JSON.stringify({ devices, unavailable, powers: [...powers] });
    }
}
