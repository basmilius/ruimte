import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AndroidSdk {
    adb: string;
    /* Null when only the platform tools are installed, which still reach a phone. */
    emulator: string | null;
    avdHome: string;
}

export interface AndroidSdkEnvironment {
    env: Record<string, string | undefined>;
    platform: NodeJS.Platform;
    home: string;
    which(command: string): string | null;
    realpath(path: string): string;
    exists(path: string): boolean;
}

const defaultEnvironment = (): AndroidSdkEnvironment => ({
    env: process.env,
    platform: process.platform,
    home: homedir(),
    which: (command) => Bun.which(command),
    realpath: (path) => realpathSync(path),
    exists: (path) => existsSync(path)
});

/*
 * Finds the SDK a person installed. A daemon running as a service gets the login shell's PATH but no
 * ANDROID_HOME, so the SDK that holds the `adb` on PATH counts before the default install folders.
 */
export const locateAndroidSdk = (environment: AndroidSdkEnvironment = defaultEnvironment()): AndroidSdk | null => {
    const { env, exists } = environment;
    const executable = environment.platform === 'win32' ? '.exe' : '';
    const adbIn = (root: string): string => join(root, 'platform-tools', `adb${executable}`);
    const emulatorIn = (root: string): string => join(root, 'emulator', `emulator${executable}`);

    const roots: string[] = [];
    for (const variable of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
        const value = env[variable];
        if (value) {
            roots.push(value);
        }
    }
    const adbOnPath = environment.which('adb');
    if (adbOnPath) {
        try {
            roots.push(dirname(dirname(environment.realpath(adbOnPath))));
        } catch {
            // A dangling link on PATH names no SDK; the default folders below still might.
        }
    }
    roots.push(environment.platform === 'darwin' ? join(environment.home, 'Library', 'Android', 'sdk') : join(environment.home, 'Android', 'Sdk'));

    const root = roots.find((candidate) => exists(adbIn(candidate)));
    const adb = root ? adbIn(root) : adbOnPath;
    if (!adb) {
        return null;
    }
    const emulator = root && exists(emulatorIn(root)) ? emulatorIn(root) : null;
    return { adb, emulator, avdHome: avdHomeOf(environment) };
};

const avdHomeOf = ({ env, home }: AndroidSdkEnvironment): string => {
    if (env.ANDROID_AVD_HOME) {
        return env.ANDROID_AVD_HOME;
    }
    const userHome = env.ANDROID_USER_HOME ?? env.ANDROID_EMULATOR_HOME;
    return join(userHome ?? join(home, '.android'), 'avd');
};
