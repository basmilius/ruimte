import i18next from 'i18next';
import type { DeviceInfo } from '@ruimte/contracts';
import { useToasts } from '@/state/toasts';

export interface DeviceControl {
    boot(device: DeviceInfo): Promise<unknown>;
    shutdown(device: DeviceInfo): Promise<unknown>;
}

/* Starts or shuts down a device. A refusal goes to a toast, since the row has nowhere else to say it; the answer says whether it went through. */
export async function controlDevice(client: DeviceControl | null | undefined, device: DeviceInfo, action: 'boot' | 'shutdown'): Promise<boolean> {
    if (!client) {
        return false;
    }
    try {
        await client[action](device);
        return true;
    } catch (error: unknown) {
        useToasts.getState().show({
            kind: 'error',
            title: i18next.t(action === 'boot' ? 'panels:devices.startFailed' : 'panels:devices.shutdownFailed', { name: device.name }),
            description: error instanceof Error ? error.message : String(error)
        });
        return false;
    }
}
