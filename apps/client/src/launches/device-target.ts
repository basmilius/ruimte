import type { DeviceInfo, DevicePlatform } from '@ruimte/contracts';

/* The device a launch runs its app on, as far as its command says; every part may be missing. */
export interface DeviceTarget {
    platform?: DevicePlatform;
    id?: string;
    name?: string;
}

/* Flutter's targets that are no phone: the browser and the desktop. */
const FLUTTER_NOT_A_DEVICE = new Set(['chrome', 'edge', 'web-server', 'macos', 'windows', 'linux']);

function wordsOf(command: string): string[] {
    return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');
}

/* The value of a flag, written as `--flag value` or `--flag=value`. */
function flagValue(words: readonly string[], ...flags: string[]): string | undefined {
    for (let index = 0; index < words.length; index += 1) {
        const word = words[index]!;
        for (const flag of flags) {
            if (word === flag) {
                return words[index + 1];
            }
            if (word.startsWith(`${flag}=`)) {
                return word.slice(flag.length + 1);
            }
        }
    }
    return undefined;
}

function startsAt(words: readonly string[], ...sequence: string[]): number {
    return words.findIndex((_word, index) => sequence.every((part, offset) => words[index + offset] === part));
}

function flutterTarget(words: readonly string[]): DeviceTarget | null {
    if (startsAt(words, 'flutter', 'run') < 0) {
        return null;
    }
    const device = flagValue(words, '-d', '--device-id');
    if (device === undefined) {
        return {};
    }
    return FLUTTER_NOT_A_DEVICE.has(device) ? null : { id: device };
}

function simctlTarget(words: readonly string[]): DeviceTarget | null {
    const at = startsAt(words, 'simctl');
    const verb = at < 0 ? undefined : words[at + 1];
    if (verb !== 'launch' && verb !== 'install') {
        return null;
    }
    const device = words.slice(at + 2).find((word) => !word.startsWith('-'));
    return device === undefined || device === 'booted' ? { platform: 'ios' } : { platform: 'ios', id: device };
}

function xcodebuildTarget(words: readonly string[]): DeviceTarget | null {
    if (!words.includes('xcodebuild')) {
        return null;
    }
    const destination = flagValue(words, '-destination');
    if (destination === undefined) {
        return null;
    }
    const parts = Object.fromEntries(
        destination.split(',').map((part) => {
            const at = part.indexOf('=');
            return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
        })
    );
    if (parts.id) {
        return { platform: 'ios', id: parts.id };
    }
    return parts.name ? { platform: 'ios', name: parts.name } : null;
}

function expoTarget(words: readonly string[]): DeviceTarget | null {
    const run = words.find((word) => word === 'run:ios' || word === 'run:android');
    if (run === undefined) {
        return null;
    }
    const platform: DevicePlatform = run === 'run:ios' ? 'ios' : 'android';
    // Expo takes a device's name or its id after --device.
    const device = flagValue(words, '--device', '-d');
    return device === undefined || device.startsWith('-') ? { platform } : { platform, id: device, name: device };
}

function reactNativeTarget(words: readonly string[]): DeviceTarget | null {
    if (words.includes('run-ios')) {
        const udid = flagValue(words, '--udid');
        const simulator = flagValue(words, '--simulator');
        return udid !== undefined ? { platform: 'ios', id: udid } : simulator !== undefined ? { platform: 'ios', name: simulator } : { platform: 'ios' };
    }
    if (words.includes('run-android')) {
        const device = flagValue(words, '--deviceId', '--device');
        return device === undefined ? { platform: 'android' } : { platform: 'android', id: device };
    }
    return null;
}

function adbTarget(words: readonly string[]): DeviceTarget | null {
    if (!words.some((word) => word === 'adb' || word.endsWith('/adb'))) {
        return null;
    }
    const serial = flagValue(words, '-s');
    return serial === undefined ? { platform: 'android' } : { platform: 'android', id: serial };
}

/*
 * The device a launch's command runs its app on, read from the tools that name one: Flutter, simctl,
 * xcodebuild, Expo, React Native and adb. Null for a command that runs on no device; an empty target
 * for one that does without saying which.
 */
export function deviceTargetOf(command: string): DeviceTarget | null {
    const words = wordsOf(command);
    for (const read of [flutterTarget, simctlTarget, xcodebuildTarget, expoTarget, reactNativeTarget, adbTarget]) {
        const target = read(words);
        if (target !== null) {
            return target;
        }
    }
    return null;
}

/*
 * The device of this machine a target names: by its id, and else by its name, which a tool may also
 * give where an id goes. Null when the command names none of them, or none this machine has.
 */
export function matchLaunchDevice(target: DeviceTarget, devices: readonly DeviceInfo[]): DeviceInfo | null {
    const candidates = devices.filter((device) => target.platform === undefined || device.platform === target.platform);
    const byId = target.id === undefined ? undefined : candidates.find((device) => device.deviceId === target.id);
    const name = target.name ?? target.id;
    return byId ?? (name === undefined ? undefined : candidates.find((device) => device.name === name)) ?? null;
}
