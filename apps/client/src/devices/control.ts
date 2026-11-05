import { messageOf } from '@adecore/ui';
import type { DeviceAction, DeviceInfo } from '@ruimte/contracts';
import i18next from 'i18next';
import { useToasts } from '@/state/toasts';
import { deviceClientFor } from '@/workspace/connections';

export interface DeviceControl {
    boot(device: DeviceInfo): Promise<unknown>;
    shutdown(device: DeviceInfo): Promise<unknown>;
}

/* What erasing asks of a machine beside starting and stopping. */
interface DeviceEraser extends DeviceControl {
    action(action: DeviceAction): Promise<unknown>;
}

/* A refusal of the machine as a toast, for a button that has nowhere else to say it. */
export function toastDeviceFailure(title: string, error: unknown): void {
    useToasts.getState().show({ kind: 'error', title, description: messageOf(error) });
}

export type DeviceActionBody = DeviceAction extends infer Action
    ? Action extends unknown
        ? Omit<Action, 'backendId' | 'platform' | 'deviceId'>
        : never
    : never;

/* One action on a device of the machine; a refusal goes to a toast under `title`. */
export function runDeviceAction(
    endpointId: string,
    device: Pick<DeviceInfo, 'backendId' | 'platform' | 'deviceId'>,
    body: DeviceActionBody,
    title: string
): void {
    void deviceClientFor(endpointId)
        ?.action({ backendId: device.backendId, platform: device.platform, deviceId: device.deviceId, ...body } as DeviceAction)
        .catch((error: unknown) => toastDeviceFailure(title, error));
}

/* Starts or shuts down a device; the answer says whether it went through. */
export async function controlDevice(client: DeviceControl | null | undefined, device: DeviceInfo, action: 'boot' | 'shutdown'): Promise<boolean> {
    if (!client) {
        return false;
    }
    try {
        await client[action](device);
        return true;
    } catch (error: unknown) {
        toastDeviceFailure(i18next.t(action === 'boot' ? 'panels:devices.startFailed' : 'panels:devices.shutdownFailed', { name: device.name }), error);
        return false;
    }
}

/* Shuts the device down and starts it again; a refusal goes to a toast like a start or a stop of its own. */
export async function restartDevice(client: DeviceControl | null | undefined, device: DeviceInfo): Promise<boolean> {
    return (await controlDevice(client, device, 'shutdown')) && (await controlDevice(client, device, 'boot'));
}

/*
 * Erases a simulator or an emulator a person confirmed. The machine erases only a device that is shut
 * down, so a running one is shut down first; one that ran is started again, as an emulator does by itself.
 */
export async function eraseDevice(client: DeviceEraser, device: DeviceInfo): Promise<void> {
    const running = device.state === 'booted';
    if (running && device.capabilities.shutdown) {
        await client.shutdown(device);
    }
    await client.action({ backendId: device.backendId, platform: device.platform, deviceId: device.deviceId, action: 'erase' });
    if (running && device.platform === 'ios' && device.capabilities.boot) {
        await client.boot(device);
    }
}
