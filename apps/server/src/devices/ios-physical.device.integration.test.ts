import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

/*
 * Against a paired iPhone this Mac reaches over the network, with the bridge built
 * (`cargo build --release` in `apps/ios-device-bridge`). Without either the suite does nothing.
 */
describe.skipIf(process.platform !== 'darwin')('iPhone battery', () => {
    test('a paired phone says its own level and whether it is on power', async () => {
        const { createPhysicalBatteryReader, IosPhysicalBackend } = await import('./ios-physical.ts');
        const reader = createPhysicalBatteryReader(join(import.meta.dir, '..', '..', '..', 'ios-device-bridge', 'target', 'release', 'ios-device-bridge'));
        const backend = new IosPhysicalBackend(undefined, undefined, null, undefined, reader);
        const phone = reader === null ? undefined : (await backend.list().catch(() => [])).find((device) => device.state === 'booted');
        if (phone === undefined) {
            return;
        }
        const power = await backend.power(phone.deviceId);
        expect(power).not.toBeNull();
        expect(power!.level).toBeGreaterThanOrEqual(0);
        expect(power!.level).toBeLessThanOrEqual(100);
    }, 60_000);
});
