import { describeError, setErrorStacks } from '@ruimte/agents/error-text';

export { describeError };

export const DEBUG_VARIABLE = 'RUIMTE_DEBUG';

export const debugFrom = (env: Record<string, string | undefined>): boolean => env[DEBUG_VARIABLE] === '1';

// What the chats say about an error follows the same switch as the daemon's own lines.
setErrorStacks(debugFrom(process.env));

/** `describeError` with the debug variable of this process, for a log line. */
export const errorText = (error: unknown): string => describeError(error, debugFrom(process.env));
