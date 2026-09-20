/* What the git panel waits between two statuses it did not ask for itself. */
export const GIT_PANEL_PACE_MS = 3000;

export interface Pace<T> {
    /* The newest value: handed on right away, or at the end of the window the last one opened. */
    offer: (value: T) => void;
    /* Opens a window without handing anything on, for a read the caller did itself. */
    mark: () => void;
    stop: () => void;
}

export interface PaceSeams {
    now: () => number;
    delay: (ms: number, run: () => void) => () => void;
}

const SYSTEM_PACE: PaceSeams = {
    now: () => Date.now(),
    delay: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    }
};

/*
 * Hands values on at most once per window, the first one straight away. An agent writing files
 * moves the status many times a second; a panel that followed every one of them would be unreadable,
 * and one that only drew after the writing stopped would sit still through a long turn.
 */
export const paced = <T>(window: number, apply: (value: T) => void, seams: PaceSeams = SYSTEM_PACE): Pace<T> => {
    let opened = -Infinity;
    let cancel: (() => void) | null = null;
    let waiting: { value: T } | null = null;

    const fire = (): void => {
        cancel = null;
        const held = waiting;
        waiting = null;
        if (held !== null) {
            opened = seams.now();
            apply(held.value);
        }
    };

    return {
        offer: (value) => {
            waiting = { value };
            if (cancel !== null) {
                return;
            }
            const left = opened + window - seams.now();
            if (left <= 0) {
                fire();
            } else {
                cancel = seams.delay(left, fire);
            }
        },
        mark: () => {
            opened = seams.now();
            // Whatever was waiting is older than what the caller just read.
            waiting = null;
        },
        stop: () => {
            cancel?.();
            cancel = null;
            waiting = null;
        }
    };
};
