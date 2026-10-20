/* Time for Voice run by the daemon, injected so a test runs every deadline without waiting on the wall clock. */
export interface VoiceClock {
    now(): number;
    /* Runs `run` once after `ms`; the function it answers cancels that. */
    after(ms: number, run: () => void): () => void;
}

export const SYSTEM_CLOCK: VoiceClock = {
    now: () => Date.now(),
    after: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    }
};
