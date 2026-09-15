/*
 * How an error reaches a log or a terminal. Bun prints an Error object handed to the console with a
 * code frame of the bundle it came from, which in a compiled binary is a few lines of minified source,
 * so an error is always turned into a string first.
 */

export const DEBUG_VARIABLE = 'RUIMTE_DEBUG';

export const debugFrom = (env: Record<string, string | undefined>): boolean => env[DEBUG_VARIABLE] === '1';

/** The message of an error, or its whole stack with the debug variable set. */
export const describeError = (error: unknown, debug: boolean): string => {
    if (!(error instanceof Error)) {
        return String(error);
    }
    if (debug) {
        return error.stack ?? `${error.name}: ${error.message}`;
    }
    return error.message === '' ? error.name : error.message;
};

/** `describeError` with the debug variable of this process, for a log line. */
export const errorText = (error: unknown): string => describeError(error, debugFrom(process.env));
