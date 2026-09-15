import { effectiveBrokerUrl, type BrokerOverride, type BrokerSetting } from '@ruimte/pulsar';
import type { Relay } from '../auth/relay.ts';

export interface BrokerSwitchOptions {
    /* What `--broker`, `--no-broker` or `RUIMTE_BROKER_URL` forced; null leaves it to the setting. */
    override: BrokerOverride;
    /* `--broker-advertise`: what clients are told while a broker is on, when they reach it under another name. */
    advertise: string | null;
    /* The machine's own setting from `endpoint.json`, read on every change. */
    setting(): BrokerSetting;
    relayFor(url: string): Relay;
    log?: Pick<Console, 'log'>;
}

/* What a client is told about this machine's broker. */
export interface BrokerDescription {
    brokerUrl: string | null;
    /* True when a flag or the environment decides, so a client's setting is kept but changes nothing. */
    brokerFixed: boolean;
}

/*
 * The broker this daemon is on right now. A setting changed from a client takes effect without a
 * restart: the relay for the old URL is stopped and one for the new URL started, or none at all.
 * Changes are applied one at a time, so two quick changes never leave two relays running.
 */
export class BrokerSwitch implements Relay {
    private readonly options: BrokerSwitchOptions;
    private relay: Relay | null = null;
    private url: string | null = null;
    private local: { host: string; port: number } | null = null;
    private stopped = false;
    private queue: Promise<void> = Promise.resolve();

    constructor(options: BrokerSwitchOptions) {
        this.options = options;
    }

    /* The URL this daemon dials. */
    get dialUrl(): string | null {
        return effectiveBrokerUrl(this.options.override, this.options.setting());
    }

    /* The relay that is running, for tests. */
    get current(): Relay | null {
        return this.relay;
    }

    describe(): BrokerDescription {
        const url = this.dialUrl;
        return { brokerUrl: url === null ? null : (this.options.advertise ?? url), brokerFixed: this.options.override !== null };
    }

    async publish(local: { host: string; port: number }): Promise<string | null> {
        this.local = local;
        await this.apply();
        return null;
    }

    /* Brings the running relay in line with the effective URL; before `publish` there is nothing to start yet. */
    apply(): Promise<void> {
        this.queue = this.queue.then(() => this.settle());
        return this.queue;
    }

    async stop(): Promise<void> {
        this.stopped = true;
        await this.queue;
        await this.relay?.stop();
        this.relay = null;
    }

    private async settle(): Promise<void> {
        if (this.stopped || this.local === null) {
            return;
        }
        const next = this.dialUrl;
        if (this.relay !== null && next === this.url) {
            return;
        }
        if (this.relay === null && next === null) {
            return;
        }
        const log = this.options.log ?? console;
        if (this.relay !== null) {
            await this.relay.stop();
            this.relay = null;
            if (next === null) {
                log.log(`Left the broker at ${this.url}`);
            }
        }
        this.url = next;
        if (next !== null) {
            this.relay = this.options.relayFor(next);
            await this.relay.publish(this.local);
        }
    }
}
