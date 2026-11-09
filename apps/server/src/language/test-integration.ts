import type { Position } from '@adecore/lsp';

/* Asks again every 100 ms until `accept` takes the answer, for a real server that gets there in its own time. */
export async function eventually<T>(what: string, run: () => Promise<T> | T, accept: (value: T) => boolean = Boolean, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
        try {
            const value = await run();
            if (accept(value)) {
                return value;
            }
            last = value;
        } catch (error) {
            last = error;
        }
        await Bun.sleep(100);
    }
    throw new Error(`${what} never happened (last: ${last instanceof Error ? last.message : JSON.stringify(last)?.slice(0, 400)})`);
}

export function positionOf(text: string, needle: string, offset = 0): Position {
    const before = text.slice(0, text.indexOf(needle) + offset).split('\n');
    return { line: before.length - 1, character: before.at(-1)!.length };
}
