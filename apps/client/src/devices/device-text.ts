import i18next from 'i18next';
import type { DeviceInfo, DeviceUnavailable } from '@ruimte/contracts';

const REASONS: Record<string, string> = {
    unauthorized: 'panels:devices.state.unauthorized',
    offline: 'panels:devices.state.offline'
};

const UNAVAILABLE: Record<string, string> = {
    'adb-unavailable': 'panels:devices.unavailable.androidSdk',
    'simctl-unavailable': 'panels:devices.unavailable.xcode',
    'devicectl-unavailable': 'panels:devices.unavailable.xcode'
};

export const deviceStateText = (device: Pick<DeviceInfo, 'kind' | 'platform' | 'state' | 'reason'>): string => {
    const reason = device.reason === undefined ? undefined : REASONS[device.reason];
    if (reason !== undefined) {
        return i18next.t(reason);
    }
    if (device.kind === 'physical') {
        if (device.state === 'booted') {
            return device.platform === 'android' ? i18next.t('panels:devices.state.connected') : i18next.t('panels:devices.state.paired');
        }
        return device.state === 'shutdown' ? i18next.t('panels:devices.state.unavailable') : i18next.t('panels:devices.state.connecting');
    }
    return device.state === 'booted'
        ? i18next.t('panels:devices.state.running')
        : device.state === 'shutdown'
          ? i18next.t('panels:devices.state.stopped')
          : i18next.t('panels:devices.state.changing');
};

/*
 * One line per kind of device the machine could not look for. Away from macOS a missing Xcode is
 * not something to install, so the iOS entries give way to the one line that says iOS needs a Mac.
 */
export const unavailableNotes = (unavailable: readonly DeviceUnavailable[], platform: string | null): string[] => {
    const notMac = platform !== null && platform !== 'darwin';
    const notes = unavailable
        .filter((entry) => !notMac || entry.platform !== 'ios')
        .map((entry) => {
            const key = UNAVAILABLE[entry.code];
            return key === undefined ? entry.message || entry.code : i18next.t(key);
        });
    if (notMac) {
        notes.push(i18next.t('panels:devices.unavailable.needsMac'));
    }
    return [...new Set(notes)];
};
