import type { KeepAwakeRequest } from '@ruimte/desktop-bridge';
import { electron } from '../electron';
import { createKeepAwakeHold, keepAwakeBlocker, keepAwakeRequestFrom, LEGACY_KEEP_AWAKE, mergeKeepAwake } from '../keep-awake';
import type { DesktopIpc } from './ipc';

const { powerMonitor, powerSaveBlocker } = electron;

export interface Power {
    /* Lets the request of a window go, as one that closes or reloads does. */
    drop(windowId: number): void;
    /* Applies the requests again whenever the power source changes; only once the app is ready. */
    followPowerSource(): void;
}

/* What the pages ask of the computer's sleep and idle state. */
export function installPower(ipc: DesktopIpc): Power {
    // By window id. Kept rather than applied once, since the power source changes while a request stands.
    const requests = new Map<number, KeepAwakeRequest>();
    const hold = createKeepAwakeHold(powerSaveBlocker);

    const apply = (): void => {
        const request = mergeKeepAwake(requests.values());
        // `powerMonitor` only answers once the app is ready, and a request only arrives from a window after that.
        const onBattery = request !== null && powerMonitor.isOnBatteryPower();
        hold(keepAwakeBlocker(request, { platform: process.platform, onBattery }));
    };

    const set = (windowId: number, request: KeepAwakeRequest | null): void => {
        if (request === null) {
            requests.delete(windowId);
        } else {
            requests.set(windowId, request);
        }
        apply();
    };

    ipc.on('power:keep-awake', (event, keep: boolean) => {
        const window = ipc.senderWindow(event);
        if (window) {
            set(window.id, keep === true ? LEGACY_KEEP_AWAKE : null);
        }
    });
    ipc.on('power:keep-awake-request', (event, request: unknown) => {
        const window = ipc.senderWindow(event);
        if (window) {
            set(window.id, keepAwakeRequestFrom(request));
        }
    });
    ipc.handle('power:idle-state', (_event, thresholdSeconds: unknown) => {
        const threshold = typeof thresholdSeconds === 'number' && Number.isInteger(thresholdSeconds) && thresholdSeconds > 0 ? thresholdSeconds : 120;
        return powerMonitor.getSystemIdleState(threshold);
    });

    return {
        drop: (windowId) => set(windowId, null),
        followPowerSource: () => {
            powerMonitor.on('on-battery', apply);
            powerMonitor.on('on-ac', apply);
        }
    };
}
