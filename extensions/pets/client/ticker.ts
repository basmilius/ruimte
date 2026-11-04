/* The beat every pet on the page moves to, about five and a half frames a second, which pixel art needs no
   more than. Three steps of a `Spinner`, so a beat lands in a frame a spinner draws anyway. */
export const PET_TICK_MS = 180;

type TickListener = (tick: number) => void;

const listeners = new Set<TickListener>();
let timer: ReturnType<typeof setTimeout> | null = null;
let tick = 0;

/* The next beat on the document's clock, the grid the spinners step on, so a late timer does not drift off it.
   `performance.now()` and `document.timeline` share their origin. */
function schedule(): void {
    timer = setTimeout(beat, PET_TICK_MS - (performance.now() % PET_TICK_MS));
}

function beat(): void {
    tick += 1;
    for (const each of listeners) {
        each(tick);
    }

    // The last pet may have left on this beat.
    if (listeners.size === 0) {
        timer = null;
        return;
    }

    schedule();
}

/*
 * One timer for the whole page, running only while a pet listens, so a pet repaints its own canvas
 * on a beat without React rendering anything for it.
 */
export function onPetTick(listener: TickListener): () => void {
    listeners.add(listener);
    listener(tick);
    if (timer === null) {
        schedule();
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
}
