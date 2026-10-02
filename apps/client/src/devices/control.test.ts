import { describe, expect, test } from 'bun:test';
import type { DeviceInfo } from '@ruimte/contracts';
import { useToasts } from '@/state/toasts';
import { controlDevice } from './control';

const phone: DeviceInfo = {
    deviceId: 'phone-1',
    backendId: 'simctl',
    platform: 'ios',
    kind: 'simulator',
    name: 'iPhone 18 Pro',
    runtime: 'iOS 27.0',
    state: 'booted',
    capabilities: { boot: true, shutdown: true, stream: true, input: true, screenshot: true }
};

const refusing = {
    boot: async (): Promise<DeviceInfo> => phone,
    shutdown: async (): Promise<DeviceInfo> => {
        throw new Error('Unable to shutdown device in current state: Shutting Down');
    }
};

describe('starting or shutting down a device', () => {
    test('a refusal is said, with what the machine answered', async () => {
        expect(await controlDevice(refusing, phone, 'shutdown')).toBe(false);
        const toast = useToasts.getState().toasts.at(-1);
        expect(toast).toMatchObject({
            kind: 'error',
            title: 'Could not shut down iPhone 18 Pro',
            description: 'Unable to shutdown device in current state: Shutting Down'
        });
    });

    test('what goes through says nothing', async () => {
        const before = useToasts.getState().toasts.length;
        expect(await controlDevice(refusing, phone, 'boot')).toBe(true);
        expect(useToasts.getState().toasts).toHaveLength(before);
    });
});
