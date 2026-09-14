import { describe, expect, test } from 'bun:test';
import { DEFAULT_HOST, DEFAULT_PORT, forgetInheritedSession, parseServerArgs } from './config.ts';

describe('forgetInheritedSession', () => {
    test('drops the session variables and keeps the rest', () => {
        const env: Record<string, string | undefined> = {
            RUIMTE_HOOK_URL: 'http://127.0.0.1:4210/hooks',
            RUIMTE_HOOK_TOKEN: 'hook',
            RUIMTE_CONTEXT_URL: 'http://127.0.0.1:4210/context',
            RUIMTE_CONTEXT_TOKEN: 'context',
            RUIMTE_SESSION_ID: 'node-1',
            RUIMTE_HOME: '/tmp/ruimte-dev',
            RUIMTE_LABEL: 'box',
            PATH: '/usr/bin'
        };
        forgetInheritedSession(env);
        expect(env).toEqual({ RUIMTE_HOME: '/tmp/ruimte-dev', RUIMTE_LABEL: 'box', PATH: '/usr/bin' });
    });
});

describe('parseServerArgs', () => {
    test('defaults', () => {
        const config = parseServerArgs([], { RUIMTE_HOME: '/tmp/ruimte-home' });
        expect(config.host).toBe(DEFAULT_HOST);
        expect(config.port).toBe(DEFAULT_PORT);
        expect(config.home).toBe('/tmp/ruimte-home');
        expect(config.installHooks).toBe(true);
    });

    test('--no-hooks skips the installers and --serve names a client build', () => {
        expect(parseServerArgs(['--no-hooks'], {}).installHooks).toBe(false);
        expect(parseServerArgs([], {}).serve).toBeNull();
        expect(parseServerArgs(['--serve', '/tmp/dist'], {}).serve).toBe('/tmp/dist');
    });

    test('reads --host and --port', () => {
        const config = parseServerArgs(['--host', '0.0.0.0', '--port', '5000'], {});
        expect(config.host).toBe('0.0.0.0');
        expect(config.port).toBe(5000);
        expect(config.home.endsWith('.ruimte')).toBe(true);
    });

    test('reads the endpoint flags and the pair command', () => {
        const config = parseServerArgs(['pair', '--label', 'box', '--allow-origin', 'https://a.example', '--allow-origin', 'https://b.example'], {});
        expect(config.command).toBe('pair');
        expect(config.label).toBe('box');
        expect(config.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
        expect(parseServerArgs([], { RUIMTE_LABEL: 'named' }).label).toBe('named');
        expect(() => parseServerArgs(['dance'], {})).toThrow('Unknown command');
        expect(parseServerArgs(['context', 'read', 'abc'], {})).toMatchObject({ command: 'context', args: ['read', 'abc'] });
        expect(parseServerArgs(['context', 'node', 'note', '--text', 'hi', '--port=1'], {})).toMatchObject({
            command: 'context',
            args: ['node', 'note', '--text', 'hi', '--port=1']
        });
    });

    test('a broker is off by default, and read from the flag or the environment', () => {
        expect(parseServerArgs([], {})).toMatchObject({ broker: null, brokerAdvertise: null });
        // An unset compose variable arrives as an empty string, which is still off.
        expect(parseServerArgs([], { RUIMTE_BROKER_URL: '', RUIMTE_BROKER_ADVERTISE_URL: '' })).toMatchObject({ broker: null, brokerAdvertise: null });
        expect(
            parseServerArgs(['--broker', 'wss://broker.example.com'], {
                RUIMTE_BROKER_URL: 'ws://ignored:1',
                RUIMTE_BROKER_ADVERTISE_URL: 'ws://127.0.0.1:4400'
            })
        ).toMatchObject({ broker: 'wss://broker.example.com', brokerAdvertise: 'ws://127.0.0.1:4400' });
        expect(() => parseServerArgs(['--broker', 'https://broker.example.com'], {})).toThrow('Invalid --broker');
        expect(() => parseServerArgs([], { RUIMTE_BROKER_ADVERTISE_URL: 'not a url' })).toThrow('Invalid --broker-advertise');
    });

    test('rejects a port that is not a number', () => {
        expect(() => parseServerArgs(['--port', 'abc'], {})).toThrow('Invalid --port');
    });

    test('rejects an unknown flag', () => {
        expect(() => parseServerArgs(['--nope'], {})).toThrow();
    });
});
