import { describe, expect, test } from 'bun:test';
import { paced, type PaceSeams } from './pace';

/* A clock and a queue of timers the test moves by hand, so nothing here waits on the wall. */
function fakeSeams(): PaceSeams & { advance: (ms: number) => void } {
    let clock = 1000;
    const timers: { at: number; run: () => void }[] = [];
    return {
        now: () => clock,
        delay: (ms, run) => {
            const timer = { at: clock + ms, run };
            timers.push(timer);
            return () => {
                const index = timers.indexOf(timer);
                if (index >= 0) {
                    timers.splice(index, 1);
                }
            };
        },
        advance: (ms) => {
            clock += ms;
            for (const timer of timers.splice(0, timers.length)) {
                if (timer.at <= clock) {
                    timer.run();
                } else {
                    timers.push(timer);
                }
            }
        }
    };
}

/* A pace of three seconds on the fake clock, and what it handed on so far. */
function pacing() {
    const seams = fakeSeams();
    const seen: string[] = [];
    return { seams, seen, pace: paced(3000, (value: string) => seen.push(value), seams) };
}

describe('paced', () => {
    test('keeps only the newest value of a window and hands it on at the end', () => {
        const { seams, seen, pace } = pacing();

        pace.offer('a');
        expect(seen).toEqual(['a']);
        seams.advance(500);
        pace.offer('b');
        seams.advance(500);
        pace.offer('c');
        expect(seen).toEqual(['a']);

        seams.advance(2000);
        expect(seen).toEqual(['a', 'c']);
    });

    test('opens a new window for the value it just handed on', () => {
        const { seams, seen, pace } = pacing();

        pace.offer('a');
        seams.advance(3000);
        pace.offer('b');
        seams.advance(1000);
        pace.offer('c');

        expect(seen).toEqual(['a', 'b']);
        seams.advance(2000);
        expect(seen).toEqual(['a', 'b', 'c']);
    });

    test('a read of the caller drops what was waiting and starts a window', () => {
        const { seams, seen, pace } = pacing();

        pace.offer('a');
        seams.advance(500);
        pace.offer('b');
        pace.mark();
        seams.advance(3000);

        expect(seen).toEqual(['a']);
    });

    test('stops without handing on what was waiting', () => {
        const { seams, seen, pace } = pacing();

        pace.offer('a');
        pace.offer('b');
        pace.stop();
        seams.advance(5000);

        expect(seen).toEqual(['a']);
    });
});
