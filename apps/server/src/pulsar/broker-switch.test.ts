import { describe, expect, test } from 'bun:test';
import { DEFAULT_BROKER_URL, type BrokerOverride, type BrokerSetting } from '@ruimte/pulsar';
import type { Relay } from '../auth/relay.ts';
import { BrokerSwitch } from './broker-switch.ts';

/* A relay that only records what happened to it. */
class RecordingRelay implements Relay {
    readonly url: string;
    published = false;
    stopped = false;

    constructor(url: string) {
        this.url = url;
    }

    async publish(): Promise<string | null> {
        this.published = true;
        return null;
    }

    async stop(): Promise<void> {
        this.stopped = true;
    }
}

const LOCAL = { host: '127.0.0.1', port: 4210 };
const quiet = { log: () => undefined };

const setup = (override: BrokerOverride, advertise: string | null = null) => {
    let setting: BrokerSetting = { mode: 'default' };
    const relays: RecordingRelay[] = [];
    const broker = new BrokerSwitch({
        override,
        advertise,
        setting: () => setting,
        relayFor: (url) => {
            const relay = new RecordingRelay(url);
            relays.push(relay);
            return relay;
        },
        log: quiet
    });
    return {
        broker,
        relays,
        set: (next: BrokerSetting) => {
            setting = next;
        }
    };
};

describe('BrokerSwitch', () => {
    test('starts on the default broker with nothing set', async () => {
        const { broker, relays } = setup(null);
        expect(broker.describe()).toEqual({ brokerUrl: DEFAULT_BROKER_URL, brokerFixed: false });
        // Nothing is dialed before the daemon listens.
        expect(relays).toHaveLength(0);
        await broker.publish(LOCAL);
        expect(relays.map((relay) => [relay.url, relay.published])).toEqual([[DEFAULT_BROKER_URL, true]]);
        await broker.stop();
        expect(relays[0]!.stopped).toBe(true);
    });

    test('a changed setting stops the old relay and starts one on the new URL, or none', async () => {
        const { broker, relays, set } = setup(null);
        await broker.publish(LOCAL);

        set({ mode: 'custom', url: 'wss://mine.example.com' });
        await broker.apply();
        expect(relays.map((relay) => [relay.url, relay.stopped])).toEqual([
            [DEFAULT_BROKER_URL, true],
            ['wss://mine.example.com', false]
        ]);
        expect(broker.describe().brokerUrl).toBe('wss://mine.example.com');

        // The same URL again changes nothing.
        await broker.apply();
        expect(relays).toHaveLength(2);

        set({ mode: 'off' });
        await broker.apply();
        expect(relays[1]!.stopped).toBe(true);
        expect(broker.current).toBeNull();
        expect(broker.describe()).toEqual({ brokerUrl: null, brokerFixed: false });

        set({ mode: 'default' });
        await broker.apply();
        expect(relays.map((relay) => relay.url)).toEqual([DEFAULT_BROKER_URL, 'wss://mine.example.com', DEFAULT_BROKER_URL]);
        expect(broker.current).toBe(relays[2]!);
        await broker.stop();
    });

    test('two quick changes leave one relay running, on the last URL', async () => {
        const { broker, relays, set } = setup(null);
        await broker.publish(LOCAL);
        set({ mode: 'custom', url: 'wss://one.example.com' });
        const first = broker.apply();
        set({ mode: 'custom', url: 'wss://two.example.com' });
        await Promise.all([first, broker.apply()]);
        expect(relays.filter((relay) => !relay.stopped).map((relay) => relay.url)).toEqual(['wss://two.example.com']);
        await broker.stop();
    });

    test('a flag or the environment wins over the setting, and the setting is kept for later', async () => {
        const { broker, relays, set } = setup({ mode: 'custom', url: 'ws://host.docker.internal:4420' }, 'ws://127.0.0.1:4420');
        await broker.publish(LOCAL);
        set({ mode: 'off' });
        await broker.apply();
        expect(relays.map((relay) => [relay.url, relay.stopped])).toEqual([['ws://host.docker.internal:4420', false]]);
        expect(broker.describe()).toEqual({ brokerUrl: 'ws://127.0.0.1:4420', brokerFixed: true });
        await broker.stop();

        const off = setup({ mode: 'off' });
        off.set({ mode: 'custom', url: 'wss://mine.example.com' });
        await off.broker.publish(LOCAL);
        expect(off.relays).toHaveLength(0);
        expect(off.broker.describe()).toEqual({ brokerUrl: null, brokerFixed: true });
    });
});
