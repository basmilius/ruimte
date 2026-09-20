import { describe, expect, test } from 'bun:test';
import { createVoiceShortcut } from './shortcut';

function setup(configured = true) {
    let phase = 'idle';
    let starts = 0;
    let stops = 0;
    const shortcut = createVoiceShortcut({
        available: () => configured,
        active: () => phase === 'connecting' || phase === 'listening',
        start: () => {
            starts++;
            phase = 'connecting';
        },
        stop: () => {
            stops++;
            phase = 'idle';
        }
    });
    return {
        shortcut,
        counts: () => ({ starts, stops }),
        phase: (next: string) => {
            phase = next;
        }
    };
}

const released = (timeStamp: number, key = 'M', code = 'KeyM') => ({ timeStamp, key, code });

describe('Voice Control shortcut', () => {
    test('a tap stays active and the next press stops', () => {
        const run = setup();
        expect(run.shortcut.press(0, false)).toBe(true);
        run.shortcut.release(released(399));
        expect(run.counts()).toEqual({ starts: 1, stops: 0 });
        run.shortcut.press(500, false);
        run.shortcut.release(released(1000));
        expect(run.counts()).toEqual({ starts: 1, stops: 1 });
    });

    test('holding stops on release even while still connecting', () => {
        const run = setup();
        run.shortcut.press(0, false);
        run.shortcut.release(released(400));
        expect(run.counts()).toEqual({ starts: 1, stops: 1 });
    });

    test.each(['Meta', 'Control', 'Shift'])('releasing %s first also ends a hold', (key) => {
        const run = setup();
        run.shortcut.press(0, false);
        run.phase('listening');
        run.shortcut.release(released(500, key, ''));
        run.shortcut.release(released(600));
        expect(run.counts()).toEqual({ starts: 1, stops: 1 });
    });

    test('repeats do not restart the timer or toggle the session', () => {
        const run = setup();
        run.shortcut.press(0, false);
        run.shortcut.press(300, true);
        run.shortcut.release(released(400));
        expect(run.counts()).toEqual({ starts: 1, stops: 1 });
    });

    test('unrelated releases leave the hold intact', () => {
        const run = setup();
        run.shortcut.press(0, false);
        run.shortcut.release(released(500, 'A', 'KeyA'));
        expect(run.counts().stops).toBe(0);
        run.shortcut.release(released(600));
        expect(run.counts().stops).toBe(1);
    });

    test('blur ends a pending hold but leaves a toggled session running', () => {
        const run = setup();
        run.shortcut.press(0, false);
        run.shortcut.blur();
        run.shortcut.release(released(500));
        expect(run.counts().stops).toBe(1);
        run.shortcut.press(600, false);
        run.shortcut.release(released(700));
        run.shortcut.blur();
        expect(run.counts()).toEqual({ starts: 2, stops: 1 });
    });

    test('an unconfigured shortcut passes through without starting', () => {
        const run = setup(false);
        expect(run.shortcut.press(0, false)).toBe(false);
        expect(run.counts()).toEqual({ starts: 0, stops: 0 });
    });

    test('release does not clear a connection error', () => {
        const run = setup();
        run.shortcut.press(0, false);
        run.phase('error');
        run.shortcut.release(released(500));
        expect(run.counts().stops).toBe(0);
    });
});
