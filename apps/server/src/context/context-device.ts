import { deviceMatches, type DeviceInfo, type DeviceReference } from '@ruimte/contracts';

/*
 * Which device a line from a device node points at, so an agent asked to put something on it knows
 * which one without asking back. The ids are the machine's and not the project file's, so the
 * reference is looked up among the devices this machine has at the moment of reading; one that is
 * not among them says so, since a name without a device behind it is nothing to build for.
 */
export const renderDevice = (reference: DeviceReference, devices: readonly DeviceInfo[]): string => {
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
};
