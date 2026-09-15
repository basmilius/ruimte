import { describe, expect, test } from 'bun:test';
import { BrokerSettingSchema, DEFAULT_BROKER_URL, brokerUrlProblem, effectiveBrokerUrl } from './broker-url.ts';

describe('brokerUrlProblem', () => {
    test('takes wss anywhere and ws only on a local host', () => {
        expect(brokerUrlProblem('wss://broker.ruimte.app')).toBeNull();
        expect(brokerUrlProblem('wss://broker.example.com:8443/path')).toBeNull();
        expect(brokerUrlProblem('ws://127.0.0.1:4400')).toBeNull();
        expect(brokerUrlProblem('ws://localhost:4400')).toBeNull();
        expect(brokerUrlProblem('ws://[::1]:4400')).toBeNull();
        expect(brokerUrlProblem('ws://host.docker.internal:4420')).toBeNull();
        expect(brokerUrlProblem('ws://192.168.1.20:4400')).toBeNull();
        expect(brokerUrlProblem('ws://studio.local:4400')).toBeNull();
        expect(brokerUrlProblem('ws://broker.example.com')).toContain('wss://');
        expect(brokerUrlProblem('ws://203.0.113.9:4400')).toContain('wss://');
    });

    test('refuses what is not a broker URL at all', () => {
        expect(brokerUrlProblem('https://broker.example.com')).toContain('wss://');
        expect(brokerUrlProblem('broker.example.com')).toBe('Not a URL');
        expect(brokerUrlProblem(`wss://${'a'.repeat(600)}.com`)).toContain('at most');
    });
});

describe('effectiveBrokerUrl', () => {
    test('the flag or the environment beats the setting, which beats the default', () => {
        expect(effectiveBrokerUrl(null, { mode: 'default' })).toBe(DEFAULT_BROKER_URL);
        expect(effectiveBrokerUrl(null, { mode: 'custom', url: 'wss://mine.example.com' })).toBe('wss://mine.example.com');
        expect(effectiveBrokerUrl({ mode: 'custom', url: 'ws://127.0.0.1:4400' }, { mode: 'custom', url: 'wss://mine.example.com' })).toBe(
            'ws://127.0.0.1:4400'
        );
        expect(effectiveBrokerUrl({ mode: 'custom', url: 'ws://127.0.0.1:4400' }, { mode: 'off' })).toBe('ws://127.0.0.1:4400');
    });

    test('off wins wherever it is set, unless something above it says otherwise', () => {
        expect(effectiveBrokerUrl(null, { mode: 'off' })).toBeNull();
        expect(effectiveBrokerUrl({ mode: 'off' }, { mode: 'default' })).toBeNull();
        expect(effectiveBrokerUrl({ mode: 'off' }, { mode: 'custom', url: 'wss://mine.example.com' })).toBeNull();
    });
});

describe('BrokerSettingSchema', () => {
    test('checks a custom URL with the same rule', () => {
        expect(BrokerSettingSchema.safeParse({ mode: 'custom', url: 'wss://mine.example.com' }).success).toBe(true);
        expect(BrokerSettingSchema.safeParse({ mode: 'custom', url: 'ws://mine.example.com' }).success).toBe(false);
        expect(BrokerSettingSchema.safeParse({ mode: 'off' }).success).toBe(true);
        expect(BrokerSettingSchema.safeParse({ mode: 'sometimes' }).success).toBe(false);
    });
});
