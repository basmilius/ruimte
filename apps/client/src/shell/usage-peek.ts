import { create } from 'zustand';

/* Long enough that Option on its way to a character or a chord shows nothing. */
export const PEEK_DELAY_MS = 300;

/* Whether Option is held on its own, which shows the usage card; `useAppShortcuts` sets it and the rail reads it. */
export const useUsagePeekShown = create<{ shown: boolean }>(() => ({ shown: false }));

interface PeekTimers {
    set(run: () => void, ms: number): number;
    clear(handle: number): void;
}

interface PeekKey {
    key: string;
    repeat: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
}

/*
 * Option held on its own shows the usage card for as long as it is down. Any other key cancels it, so
 * Option stays free for typed characters and chords; a held pointer does too, since Option is a modifier
 * of a drag on the canvas.
 */
export function createUsagePeek(show: (shown: boolean) => void, timers: PeekTimers) {
    let pending: number | null = null;
    let shown = false;
    let pointerDown = false;

    const cancel = (): void => {
        if (pending !== null) {
            timers.clear(pending);
            pending = null;
        }

        if (shown) {
            shown = false;
            show(false);
        }
    };

    return {
        keyDown(e: PeekKey): void {
            if (e.key !== 'Alt') {
                cancel();

                return;
            }

            if (e.repeat || pending !== null || shown) {
                return;
            }

            if (pointerDown || e.metaKey || e.ctrlKey || e.shiftKey) {
                return;
            }

            pending = timers.set(() => {
                pending = null;
                shown = true;
                show(true);
            }, PEEK_DELAY_MS);
        },
        keyUp(e: { key: string }): void {
            if (e.key === 'Alt') {
                cancel();
            }
        },
        pointerDown(): void {
            pointerDown = true;

            // A click in the open card is a click in it, such as folding an account.
            if (pending !== null) {
                cancel();
            }
        },
        pointerUp(): void {
            pointerDown = false;
        },
        blur(): void {
            pointerDown = false;
            cancel();
        }
    };
}
