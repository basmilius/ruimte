import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/*
 * Where a background service can run. The dev app never gets one: the Rust experiment runs its own
 * daemon on 4221 with ~/.ruimte-rust-dev, and a service of its own would be a second daemon
 * that outlives every `bun dev`. An AppImage runs from a mount that is gone once the app quits, so a
 * service pointing into it would start nothing. Windows has no service yet.
 */
export type ServiceSupport = 'supported' | 'dev' | 'windows' | 'appimage';

export interface SupportFacts {
    packaged: boolean;
    platform: NodeJS.Platform;
    /* `APPIMAGE`, which the AppImage runtime sets to the image's own path. */
    appImage: string | undefined;
}

export const serviceSupport = (facts: SupportFacts): ServiceSupport => {
    if (!facts.packaged) {
        return 'dev';
    }
    if (facts.platform === 'win32') {
        return 'windows';
    }
    if (facts.platform === 'linux' && facts.appImage) {
        return 'appimage';
    }
    if (facts.platform === 'darwin' || facts.platform === 'linux') {
        return 'supported';
    }
    return 'windows';
};

export interface KeepRunningSetting {
    read(): boolean;
    write(keepRunning: boolean): void;
}

/*
 * "Keep this machine running when Ruimte quits", kept by the shell in `userData` rather than by the
 * client, because the shell needs it before any window exists. Unset means on, since a machine that
 * stops with the app is out of reach from anywhere else; where there is no service it is always off.
 */
export const keepRunningSetting = (path: string, support: ServiceSupport): KeepRunningSetting => ({
    read() {
        if (support !== 'supported') {
            return false;
        }
        try {
            const stored = JSON.parse(readFileSync(path, 'utf8')) as { keepRunning?: unknown };
            return typeof stored.keepRunning === 'boolean' ? stored.keepRunning : true;
        } catch {
            return true;
        }
    },
    write(keepRunning) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify({ keepRunning }, null, 2)}\n`);
    }
});
