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

    test('--no-hooks skips the installers', () => {
        expect(parseServerArgs(['--no-hooks'], {}).installHooks).toBe(false);
    });

    test('reads --host and --port', () => {
        const config = parseServerArgs(['--host', '0.0.0.0', '--port', '5000'], {});
        expect(config.host).toBe('0.0.0.0');
        expect(config.port).toBe(5000);
        expect(config.home.endsWith('.ruimte')).toBe(true);
    });

    test('rejects a port that is not a number', () => {
        expect(() => parseServerArgs(['--port', 'abc'], {})).toThrow('Invalid --port');
    });

    test('rejects an unknown flag', () => {
        expect(() => parseServerArgs(['--nope'], {})).toThrow();
    });
});
