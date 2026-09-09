import { describe, expect, test } from 'bun:test';
import { DEFAULT_HOST, DEFAULT_PORT, parseServerArgs } from './config.ts';

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
        const config = parseServerArgs(
            ['pair', '--label', 'box', '--allow-origin', 'https://a.example', '--allow-origin', 'https://b.example', '--require-token'],
            {}
        );
        expect(config.command).toBe('pair');
        expect(config.label).toBe('box');
        expect(config.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
        expect(config.requireToken).toBe(true);
        expect(parseServerArgs([], { RUIMTE_LABEL: 'named' }).label).toBe('named');
        expect(() => parseServerArgs(['dance'], {})).toThrow('Unknown command');
    });

    test('rejects a port that is not a number', () => {
        expect(() => parseServerArgs(['--port', 'abc'], {})).toThrow('Invalid --port');
    });

    test('rejects an unknown flag', () => {
        expect(() => parseServerArgs(['--nope'], {})).toThrow();
    });
});
