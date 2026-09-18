import { describe, test } from 'bun:test';
import { createDeviceHelperLauncher, DeviceHelperSource } from './helper-source.ts';

describe('DeviceHelperSource process boundary', () => {
    test('keeps native stdout logs separate from the protocol pipe', async () => {
        const script = `
            console.log('native diagnostic');
            const payload = new TextEncoder().encode('{"width":1179,"height":2556}');
            const message = new Uint8Array(13 + payload.byteLength);
            message.set([0x52, 0x44, 0x45, 0x56, 1, 0, 0, 0]);
            const header = new DataView(message.buffer);
            header.setUint8(8, 1);
            header.setUint32(9, payload.byteLength);
            message.set(payload, 13);
            const protocol = Bun.file(3).writer();
            protocol.write(message);
            protocol.flush();
            await Bun.stdin.text();
            protocol.end();
        `;
        const source = new DeviceHelperSource('phone-1', createDeviceHelperLauncher([process.execPath, '-e', script]), 1000);

        await source.start(() => undefined);
        await source.stop();
    });
});
