import type { KeepAwakeRequest } from '@ruimte/desktop-bridge';

export type KeepAwakeBlocker = 'prevent-app-suspension' | 'prevent-display-sleep';

export interface PowerFacts {
    platform: NodeJS.Platform;
    onBattery: boolean;
}

/* What a client from before the request asked for with its `true`: the system only, on any power source. */
export const LEGACY_KEEP_AWAKE: KeepAwakeRequest = { onBattery: true, display: false };

/* A request as it came over IPC. Anything that is not one asks for nothing. */
export const keepAwakeRequestFrom = (value: unknown): KeepAwakeRequest | null => {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const { onBattery, display } = value as Partial<KeepAwakeRequest>;
    return { onBattery: onBattery === true, display: display === true };
};

/*
 * The block a request comes down to right now, or none. Mac only for now, so anywhere else a request
 * is heard and ignored. Agents need `prevent-app-suspension`, not a lit display; the display block is
 * only for a person who asked for it. On macOS, `pmset -g assertions` reports these as
 * `NoIdleSleepAssertion` and `NoDisplaySleepAssertion` owned by Electron.
 */
export const keepAwakeBlocker = (request: KeepAwakeRequest | null, facts: PowerFacts): KeepAwakeBlocker | null => {
    if (request === null || facts.platform !== 'darwin') {
        return null;
    }
    if (facts.onBattery && !request.onBattery) {
        return null;
    }
    return request.display ? 'prevent-display-sleep' : 'prevent-app-suspension';
};

/* The part of Electron's `powerSaveBlocker` the hold uses, so a test hands it a fake. */
export interface PowerSaveBlocker {
    start(type: KeepAwakeBlocker): number;
    stop(id: number): void;
    isStarted(id: number): boolean;
}

/*
 * One block at a time, so a second request never leaks the first. A new type starts before the old
 * one stops, so the machine is not left without a block for the moment in between.
 */
export const createKeepAwakeHold = (blocker: PowerSaveBlocker): ((type: KeepAwakeBlocker | null) => void) => {
    let held: { id: number; type: KeepAwakeBlocker } | null = null;
    return (type) => {
        if ((held?.type ?? null) === type) {
            return;
        }
        const previous = held;
        held = type === null ? null : { id: blocker.start(type), type };
        if (previous !== null && blocker.isStarted(previous.id)) {
            blocker.stop(previous.id);
        }
    };
};
