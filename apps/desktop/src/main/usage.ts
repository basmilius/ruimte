import { join } from 'node:path';
import type { AppIpc } from '@adecore/shell';
import type { MachineMode } from '@ruimte/desktop-bridge';
import { TELEMETRY_DSN, usageIngestUrl } from '@ruimte/telemetry';
import { countFromPage, DesktopUsage, fileDesktopUsageStore, flushDesktopUsage, sendDesktopUsage, usageCounts, usageSettingOf } from '../usage';
import { electron } from './electron';
import { telemetryBuild } from './telemetry';

const { app, net } = electron;

// The switch is read again at most this often, so a person who turns it off stops the counting within a minute.
const SETTING_MS = 60_000;
// Days only finish at midnight UTC, so an hour is soon enough and also the wait after a failed send.
const FLUSH_MS = 60 * 60 * 1000;

export interface UsageHandle {
    /* The machine is up, so its switch is on disk: counts the start and sends the finished days. */
    started(): void;
    windowOpened(): void;
    quit(): void;
}

const IDLE: UsageHandle = { started: () => undefined, windowOpened: () => undefined, quit: () => undefined };

interface UsageOptions {
    mode: MachineMode;
    ruimteHome: string;
    signedIn(): Promise<boolean>;
}

/* Counts only in a release with a machine of its own; any other app takes no count from its page and keeps no file. */
export function installUsage(ipc: AppIpc, options: UsageOptions): UsageHandle {
    // Whatever the switch says: a build or a mode that never counts reads no file of the machine either.
    if (!usageCounts({ release: telemetryBuild(), mode: options.mode, setting: true })) {
        return IDLE;
    }
    const endpointFile = join(options.ruimteHome, 'endpoint.json');
    let setting: boolean | null = null;
    let settingReadAt = Number.NEGATIVE_INFINITY;
    const enabled = (): boolean => {
        const now = Date.now();
        if (now - settingReadAt >= SETTING_MS || now < settingReadAt) {
            settingReadAt = now;
            setting = usageSettingOf(fileDesktopUsageStore(endpointFile).read());
        }
        return usageCounts({ release: true, mode: options.mode, setting });
    };
    const usage = new DesktopUsage({
        store: fileDesktopUsageStore(join(app.getPath('userData'), 'usage', 'stats.json')),
        version: app.getVersion(),
        enabled
    });
    usage.load();
    const url = usageIngestUrl(TELEMETRY_DSN.desktop);
    const flush = (): void => {
        // A switch a person turned off a moment ago holds before anything leaves, not a minute later.
        settingReadAt = Number.NEGATIVE_INFINITY;
        void flushDesktopUsage(usage, {
            send: (batch) => sendDesktopUsage(url, batch, (input, init) => net.fetch(input as string, init)),
            signedIn: options.signedIn,
            platform: process.platform,
            arch: process.arch
        });
    };

    ipc.on('usage:count', (_event, name: unknown) => countFromPage(usage, name));

    let started = false;
    return {
        started: () => {
            if (started) {
                return;
            }
            started = true;
            usage.started(options.mode);
            flush();
            setInterval(flush, FLUSH_MS).unref();
        },
        windowOpened: () => usage.count('windows.opened'),
        quit: () => usage.persist()
    };
}
