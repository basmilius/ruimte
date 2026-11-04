import { CodedError } from '@adecore/agents';
import type { DeviceInfo } from '@ruimte/contracts';

type Target = Pick<DeviceInfo, 'backendId' | 'deviceId' | 'name'>;

function claimKey(device: Pick<DeviceInfo, 'backendId' | 'deviceId'>): string {
    return `${device.backendId}\u0000${device.deviceId}`;
}

/*
 * Which agent operates each device, in memory, so two agents never tap over each other. The first
 * call of an agent on a device claims it, and the claim holds until the terminal or chat behind that
 * agent ends. A daemon that restarts forgets every claim, as it forgets every session.
 */
export class DeviceClaims {
    private readonly holders = new Map<string, string>();

    /* Claims the device for `caller`, or refuses when another agent holds it; the refusal names nothing of that agent. */
    take(caller: string, device: Target): void {
        const key = claimKey(device);
        const holder = this.holders.get(key);

        if (holder !== undefined && holder !== caller) {
            throw new CodedError('device-in-use', `Another agent operates ${device.name} right now, and a device takes one agent at a time`, [
                'note\tPick another device with device_list, or wait until that agent is done and call again'
            ]);
        }

        this.holders.set(key, caller);
    }

    /* Every device `caller` held is free again, for a terminal or a chat that ended. */
    release(caller: string): void {
        for (const [key, holder] of [...this.holders]) {
            if (holder === caller) {
                this.holders.delete(key);
            }
        }
    }
}
