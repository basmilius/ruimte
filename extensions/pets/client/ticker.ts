/* The beat every pet on the page moves to, about six frames a second, which pixel art needs no more than.
   The pets keep this pace rather than the spinners', so their beat is a clock of its own. */
export const PET_TICK_MS = 160;

type TickListener = (tick: number) => void;

const listeners = new Set<TickListener>();
let timer: ReturnType<typeof setTimeout> | null = null;
let tick = 0;

/* The next beat on a grid of the document's clock, so a late timer does not drift and every pet keeps one phase.
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
