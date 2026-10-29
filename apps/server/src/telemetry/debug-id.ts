/*
 * Names the source map of this build to the crash reporter. A release ships without one: Observatory
 * keeps it under the id `scripts/compile.ts` stamped in, and the reporter tells which file that id
 * covers by the first frame of the stack it is registered under, as a bundler's debug id snippet does.
 */
export function registerDebugId(debugId: string, stack: string = new Error().stack ?? ''): void {
    const [heading, top] = stack.split('\n');

    if (heading === undefined || top === undefined) {
        return;
    }

    const global = globalThis as { _sentryDebugIds?: Record<string, string> };
    global._sentryDebugIds = { ...global._sentryDebugIds, [`${heading}\n${top}`]: debugId };
}
