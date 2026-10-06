/* The clock a language feature waits on, which a test replaces so it never waits on a real one. */
export interface Timers {
    set(callback: () => void, delay: number): unknown;
    clear(handle: unknown): void;
}

export const realTimers: Timers = {
    set: (callback, delay) => setTimeout(callback, delay),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};
