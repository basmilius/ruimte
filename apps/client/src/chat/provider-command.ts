import type { SessionClient } from '@/terminal/session-client';

// How long a shell stays silent before its prompt counts as drawn.
const QUIET_MS = 300;
// A shell that drew its prompt before the terminal attached prints nothing more, so silence from the start counts too.
const FIRST_MS = 1_000;
// A terminal that never came on screen by then is left alone, since a line typed blind could land anywhere.
const GIVE_UP_MS = 15_000;

export interface Clock {
    set(run: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}

const TIMERS: Clock = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/* A command as one line without its Enter: a person reads it in the terminal and runs it themselves. */
export function typedLine(command: string): string {
    return command.replace(/[\r\n]+/g, ' ').trim();
}

/*
 * Types the line into a new shell once its prompt is drawn, never with an Enter. Answers a way to stop
 * waiting; `typed` runs once the line is in.
 */
export function typeWhenReady(
    sessions: Pick<SessionClient, 'onOutput' | 'write' | 'isMounted'>,
    sessionId: string,
    command: string,
    typed: () => void,
    clock: Clock = TIMERS
): () => void {
    const line = typedLine(command);
    let quiet: unknown = null;
    let giveUp: unknown = null;
    let off = (): void => undefined;
    const stop = (): void => {
        off();
        clock.clear(quiet);
        clock.clear(giveUp);
    };
    const wait = (ms: number): void => {
        clock.clear(quiet);
        quiet = clock.set(() => {
            if (!sessions.isMounted(sessionId)) {
                wait(QUIET_MS);
                return;
            }
            stop();
            sessions.write(sessionId, line);
            typed();
        }, ms);
    };
    off = sessions.onOutput(sessionId, () => wait(QUIET_MS));
    giveUp = clock.set(stop, GIVE_UP_MS);
    wait(FIRST_MS);
    return stop;
}
