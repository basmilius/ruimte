/* The beat every pet on the page moves to, about six frames a second, which pixel art needs no more than. */
export const PET_TICK_MS = 160;

type TickListener = (tick: number) => void;

const listeners = new Set<TickListener>();
let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

/*
 * One interval for the whole page, running only while a pet listens, so a pet repaints its own canvas
 * on a beat without React rendering anything for it.
 */
export function onPetTick(listener: TickListener): () => void {
    listeners.add(listener);
    listener(tick);
    if (timer === null) {
        timer = setInterval(() => {
            tick += 1;
            for (const each of listeners) {
                each(tick);
            }
        }, PET_TICK_MS);
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };
}
