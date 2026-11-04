import { describe, expect, test } from 'bun:test';
import { concatBytes } from './device-test-helpers.ts';
import { DEVICE_HELPER_MAGIC, DeviceHelperDecoder, encodeDeviceHelperMessage, type DeviceHelperMessage } from './helper-protocol.ts';

describe('device helper protocol', () => {
    test('decodes split ready and frame messages without base64', () => {
        const messages: DeviceHelperMessage[] = [
            { type: 'ready', width: 1179, height: 2556 },
            { type: 'frame', frame: { sequence: 7, width: 1179, height: 2556, data: new Uint8Array([1, 2, 3]) } }
        ];
        const bytes = concatBytes(DEVICE_HELPER_MAGIC, ...messages.map(encodeDeviceHelperMessage));
        const decoder = new DeviceHelperDecoder();

        expect(decoder.push(bytes.slice(0, 11))).toEqual([]);
        expect(decoder.push(bytes.slice(11))).toEqual(messages);
    });

    test('uses the same framing for commands sent to the helper', () => {
        const input: DeviceHelperMessage = { type: 'input', input: { kind: 'pointer', phase: 'down', x: 0.2, y: 0.8 } };
        const keys: DeviceHelperMessage = { type: 'keys', usages: [0xe3, 0x19] };
        const decoder = new DeviceHelperDecoder();

        expect(
            decoder.push(
                concatBytes(DEVICE_HELPER_MAGIC, encodeDeviceHelperMessage(input), encodeDeviceHelperMessage(keys), encodeDeviceHelperMessage({ type: 'stop' }))
            )
        ).toEqual([input, keys, { type: 'stop' }]);
    });

    test('carries a call to the helper and its reply back, matched by id', () => {
        const call: DeviceHelperMessage = { type: 'call', id: 4, call: { method: 'pose', name: 'tabletop', fromDegrees: 180 } };
        const reply: DeviceHelperMessage = { type: 'reply', id: 4, ok: true, value: false };
        const failed: DeviceHelperMessage = { type: 'reply', id: 5, ok: false, message: 'No hinge' };

        expect(new DeviceHelperDecoder().push(concatBytes(DEVICE_HELPER_MAGIC, ...[call, reply, failed].map(encodeDeviceHelperMessage)))).toEqual([
            call,
            reply,
            failed
        ]);
        expect(() => encodeDeviceHelperMessage({ type: 'call', id: 1, call: { method: 'hinge', degrees: 270 } })).toThrow();
    });

    test('rejects unknown preambles and oversized frames', () => {
        expect(() => new DeviceHelperDecoder().push(new Uint8Array(DEVICE_HELPER_MAGIC.byteLength))).toThrow('Unknown device helper protocol');

        const invalid = concatBytes(DEVICE_HELPER_MAGIC, encodeDeviceHelperMessage({ type: 'stop' }));
        invalid[DEVICE_HELPER_MAGIC.byteLength + 1] = 0xff;
        expect(() => new DeviceHelperDecoder().push(invalid)).toThrow('too large');
    });
});
