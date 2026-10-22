import { networkInterfaces } from 'node:os';
import type { IceServer } from '@ruimte/pulsar';
import type { ReachCheck, ReachFacts, ReachProbe } from '@ruimte/contracts';
import { iceTargets, probeTarget, type IceTarget } from './ice-probe.ts';
import { classifyReach, reachAdvice } from './reach-classify.ts';

// More servers than a broker hands out; each is one short exchange, all at once.
const MAX_TARGETS = 8;

// A broker that flaps reconnects within seconds; checking on each of those would only send the same packets again.
export const AUTOMATIC_GAP_MS = 10_000;

export interface ReachCheckerOptions {
    broker(): ReachFacts['broker'];
    /* The STUN servers of the machine and every server the broker handed out, credentials included. */
    iceServers(): IceServer[];
    /* Whether the broker handed out any ICE servers at all. */
    granted(): boolean;
    lanDoor(): ReachFacts['lanDoor'];
    tunnel(): Promise<string | null>;
    probe?(target: IceTarget): Promise<ReachProbe>;
    /* What the network looks like, compared between checks; a machine on another network checks again when asked. */
    network?(): string;
    now?(): number;
    log?: Pick<Console, 'log' | 'warn'>;
}

/* The interfaces and their addresses, which change when the machine joins another network or a VPN comes up. */
export function networkFingerprint(): string {
    return Object.entries(networkInterfaces())
        .flatMap(([name, entries]) => (entries ?? []).filter((entry) => !entry.internal).map((entry) => `${name}=${entry.address}`))
        .sort()
        .join(',');
}

/*
 * Whether other devices reach this machine, checked when the broker took it, when a person asks and
 * when its network changed since the last check. Nothing here runs on a clock: a network change is
 * noticed when the broker reconnects, which a new network makes it do, or when the check is read.
 */
export class ReachChecker {
    private readonly options: ReachCheckerOptions;
    private last: ReachCheck | null = null;
    private lastNetwork: string | null = null;
    private running: Promise<ReachCheck> | null = null;

    constructor(options: ReachCheckerOptions) {
        this.options = options;
    }

    get latest(): ReachCheck | null {
        return this.last;
    }

    /* A fresh check; one that is already running is the answer for everyone who asks meanwhile. */
    check(): Promise<ReachCheck> {
        this.running ??= this.run().finally(() => {
            this.running = null;
        });
        return this.running;
    }

    /* The last check, or a new one when there is none yet or the network is not the one it ran on. */
    async current(): Promise<ReachCheck> {
        if (this.last === null || this.network() !== this.lastNetwork) {
            return await this.check();
        }
        return this.last;
    }

    /* The broker took this machine and answered for its ICE servers; a check right after the last one is skipped. */
    brokerSettled(): void {
        const now = this.now();
        if (this.running !== null || (this.last !== null && now - this.last.checkedAt < AUTOMATIC_GAP_MS && this.network() === this.lastNetwork)) {
            return;
        }
        void this.check().catch((e: unknown) => (this.options.log ?? console).warn('Checking whether other devices reach this machine failed:', e));
    }

    private async run(): Promise<ReachCheck> {
        const network = this.network();
        const probe = this.options.probe ?? ((target: IceTarget) => probeTarget(target));
        const broker = this.options.broker();
        const targets = broker.connected ? dedupe(iceTargets(this.options.iceServers())).slice(0, MAX_TARGETS) : [];
        const [probes, tunnel] = await Promise.all([Promise.all(targets.map(probe)), this.options.tunnel()]);
        const facts: ReachFacts = { broker, granted: this.options.granted(), probes, lanDoor: this.options.lanDoor(), tunnel };
        const verdict = classifyReach(facts);
        const check: ReachCheck = { checkedAt: this.now(), ...verdict, facts };
        if (this.last?.cause !== check.cause) {
            const { problem, fix } = reachAdvice(check.cause, facts);
            (this.options.log ?? console).log(fix === null ? problem : `${problem} ${fix}`);
        }
        this.last = check;
        this.lastNetwork = network;
        return check;
    }

    private network(): string {
        return (this.options.network ?? networkFingerprint)();
    }

    private now(): number {
        return (this.options.now ?? Date.now)();
    }
}

function dedupe(targets: IceTarget[]): IceTarget[] {
    const seen = new Set<string>();
    return targets.filter((target) => {
        const key = `${target.kind}:${target.transport}:${target.host}:${target.port}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
