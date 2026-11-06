import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEVICE_ERROR_CODES, isDeviceErrorCode } from './device-error.ts';

const BRIDGE_SOURCE = join(import.meta.dir, '..', '..', '..', 'ios-device-bridge', 'src', 'main.rs');

describe('device error codes', () => {
    test('has no code twice', () => {
        expect(new Set(DEVICE_ERROR_CODES).size).toBe(DEVICE_ERROR_CODES.length);
    });

    test('names every code the physical device bridge sends, so none is turned into device-helper-failed', () => {
        const sent = [...readFileSync(BRIDGE_SOURCE, 'utf8').matchAll(/"code":\s*"([a-z-]+)"/g)].map((match) => match[1]!);

        expect(sent.length).toBeGreaterThan(0);
        expect(sent.filter((code) => !isDeviceErrorCode(code))).toEqual([]);
    });
});
