/*
 * How an error reaches a log, a note or a reply. Bun prints an Error object handed to the console with a
 * code frame of the bundle it came from, which in a compiled binary is a few lines of minified source,
 * so an error is always turned into a string first.
 */

/** The message of an error, or its whole stack with `debug` set. */
export const describeError = (error: unknown, debug: boolean): string => {
    if (!(error instanceof Error)) {
        return String(error);
    }
    if (debug) {
        return error.stack ?? `${error.name}: ${error.message}`;
    }
    return error.message === '' ? error.name : error.message;
};

// The host decides once whether a stack is worth showing; the package reads no variable of its own.
let showStacks = false;

export const setErrorStacks = (on: boolean): void => {
    showStacks = on;
};

/** `describeError` as the host set it, for a log line or a note. */
export const errorText = (error: unknown): string => describeError(error, showStacks);
