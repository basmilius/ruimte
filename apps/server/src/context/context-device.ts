import { deviceMatches, type DeviceInfo, type DeviceReference } from '@ruimte/contracts';

/*
 * Which device a line from a device node points at. The ids are the machine's, so the reference is
 * looked up among the devices this machine has now, and one that is not among them says so.
 */
export function renderDevice(reference: DeviceReference, devices: readonly DeviceInfo[]): string {
    const device = devices.find((candidate) => deviceMatches(candidate, reference));
    const lines = [`# Device: ${reference.name}`, '', `platform: ${reference.platform}`, `kind: ${reference.kind}`, `runtime: ${reference.runtime}`];
    if (!device) {
        return [
            ...lines,
            '',
            'This machine has no such device right now: a phone that is unplugged or a simulator that was removed is not there to be found, so nothing can be put on it until it is back.'
        ].join('\n');
    }
    return [...lines, `state: ${device.state}`, `deviceId: ${device.deviceId}`, `backendId: ${device.backendId}`].join('\n');
}
