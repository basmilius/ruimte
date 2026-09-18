import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createDeviceHelperLauncher, DeviceHelperSource } from './helper-source.ts';
import type { DeviceSource } from './manager.ts';

export type PhysicalStreamSourceFactory = (deviceId: string, udid: string) => DeviceSource;

export const createPhysicalStreamSourceFactory = (helper: string): PhysicalStreamSourceFactory | null => {
    if (!existsSync(helper)) {
        return null;
    }
    return (deviceId, udid) => {
        const launch = createDeviceHelperLauncher([helper, 'physical-ios', '--udid', udid]);
        return new DeviceHelperSource(deviceId, launch, 1_500, 'hevc');
    };
};

export const physicalStreamHelperPath = (compiled: boolean, executable: string, appsDirectory: string): string => {
    if (compiled) {
        return join(dirname(executable), 'native', 'ios-device-bridge');
    }
    return join(appsDirectory, 'ios-device-bridge', 'target', 'release', 'ios-device-bridge');
};
