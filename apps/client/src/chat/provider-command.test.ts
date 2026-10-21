import { describe, expect, test } from 'bun:test';
import { typedLine, typeWhenReady, type Clock } from '@/chat/provider-command';

/* Timers that run only when the test moves the time on. */
function manualClock() {
    let now = 0;
    let next = 0;
    const timers = new Map<number, { at: number; run: () => void }>();
    const clock: Clock = {
        set: (run, ms) => {
            next += 1;
            timers.set(next, { at: now + ms, run });
            return next;
        },
        clear: (handle) => {
            timers.delete(handle as number);
        }
    };
    const advance = (ms: number): void => {
        const until = now + ms;
        for (;;) {
            const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
            if (due === undefined) {
                break;
            }
            timers.delete(due[0]);
            now = due[1].at;
            due[1].run();
        }
        now = until;
    };
    return { clock, advance, pending: () => timers.size };
}

function fakeSessions(mounted = true) {
    const writes: Array<{ sessionId: string; data: string }> = [];
    const listeners = new Map<string, (data: string) => void>();
    const sessions = {
        mounted,
        onOutput: (sessionId: string, handler: (data: string) => void) => {
            listeners.set(sessionId, handler);
            return () => listeners.delete(sessionId);
        },
        write: (sessionId: string, data: string) => {
            writes.push({ sessionId, data });
        },
        isMounted: () => sessions.mounted
    };
    return { sessions, writes, output: (sessionId: string) => listeners.get(sessionId)?.('$ '), listening: (sessionId: string) => listeners.has(sessionId) };
}

describe('a provider command typed into a new terminal', () => {
    test('is typed once the shell went quiet, without an Enter, so the person runs it', () => {
        const { clock, advance } = manualClock();
        const { sessions, writes, output, listening } = fakeSessions();
        let typed = 0;
        typeWhenReady(sessions, 'term-1', 'curl -fsSL https://x.ai/cli/install.sh | bash', () => (typed += 1), clock);
        output('term-1');
        advance(200);
        output('term-1');
        advance(200);
        expect(writes).toEqual([]);
        advance(200);
        expect(writes).toEqual([{ sessionId: 'term-1', data: 'curl -fsSL https://x.ai/cli/install.sh | bash' }]);
        expect(writes[0]?.data).not.toMatch(/[\r\n]/);
        expect(typed).toBe(1);
        expect(listening('term-1')).toBe(false);
    });

    test('a line break in a command never reaches the shell', () => {
        expect(typedLine('grok login\n')).toBe('grok login');
        expect(typedLine('a\r\nb')).toBe('a b');
    });

    test('a shell that drew its prompt before the terminal attached is typed into after a second of silence', () => {
        const { clock, advance } = manualClock();
        const { sessions, writes } = fakeSessions();
        typeWhenReady(sessions, 'term-1', 'copilot login', () => undefined, clock);
        advance(999);
        expect(writes).toEqual([]);
        advance(1);
        expect(writes).toEqual([{ sessionId: 'term-1', data: 'copilot login' }]);
    });

    test('waits for the terminal to come on screen and gives up on one that never does', () => {
        const { clock, advance, pending } = manualClock();
        const { sessions, writes, listening } = fakeSessions(false);
        typeWhenReady(sessions, 'term-1', 'agy', () => undefined, clock);
        advance(14_999);
        expect(writes).toEqual([]);
        advance(1);
        expect(listening('term-1')).toBe(false);
        expect(pending()).toBe(0);
        sessions.mounted = true;
        advance(10_000);
        expect(writes).toEqual([]);
    });
});
