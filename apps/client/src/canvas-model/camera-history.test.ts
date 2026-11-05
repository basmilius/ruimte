import { describe, expect, test } from 'bun:test';
import type { Camera } from '@/canvas-model/math';
import { BURST_QUIET_MS, CAMERA_HISTORY_LIMIT, emptyCameraHistory, noteJump, noteMove, samePlace, settle, step, type CameraHistory } from './camera-history';

function at(x: number, zoom = 1): Camera {
    return { x, y: 0, zoom };
}

const everything = (): boolean => true;

/* A pan gesture: `count` moves 10 ms apart, the camera walking right by 100 px per move. */
function pan(history: CameraHistory, from: number, count: number, start: number): { history: CameraHistory; camera: Camera; clock: number } {
    let next = history;
    let x = from;
    let clock = start;
    for (let i = 0; i < count; i++) {
        next = noteMove(next, at(x), clock);
        x += 100;
        clock += 10;
    }
    return { history: next, camera: at(x), clock };
}

describe('camera history', () => {
    test('a burst of moves within the quiet time is one entry', () => {
        const panned = pan(emptyCameraHistory(), 0, 50, 0);
        const settled = settle(panned.history, panned.camera);
        expect(settled.back).toEqual([{ camera: at(0), nodeId: null }]);
    });

    test('two bursts apart by more than the quiet time are two entries', () => {
        const first = pan(emptyCameraHistory(), 0, 5, 0);
        const second = pan(first.history, first.camera.x, 5, first.clock + BURST_QUIET_MS + 1);
        const settled = settle(second.history, second.camera);
        expect(settled.back.map((stop) => stop.camera.x)).toEqual([0, 500]);
    });

    test('the 31st jump drops the oldest', () => {
        let history = emptyCameraHistory();
        for (let i = 0; i <= CAMERA_HISTORY_LIMIT; i++) {
            history = noteJump(history, at(i * 1000), at((i + 1) * 1000), `n${i}`);
        }
        expect(history.back).toHaveLength(CAMERA_HISTORY_LIMIT);
        expect(history.back[0]!.camera.x).toBe(1000);
    });

    test('back then forward restores the place', () => {
        const jumped = noteJump(emptyCameraHistory(), at(0), at(5000), 'a');
        const back = step(jumped, -1, at(5000), everything)!;
        expect(back.to.camera).toEqual(at(0));
        const forward = step(back.history, 1, at(0), everything)!;
        expect(forward.to).toEqual({ camera: at(5000), nodeId: 'a' });
    });

    test('a stop whose node is gone is skipped', () => {
        let history = noteJump(emptyCameraHistory(), at(0), at(1000), 'a');
        history = noteJump(history, at(1000), at(2000), 'b');
        history = noteJump(history, at(2000), at(3000), 'c');
        // The stops hold the nodes the camera stood at: null, a, b. Node b is gone.
        const result = step(history, -1, at(3000), (id) => id !== 'b')!;
        expect(result.to).toEqual({ camera: at(1000), nodeId: 'a' });
        expect(result.history.back).toEqual([{ camera: at(0), nodeId: null }]);
    });

    test('a jump after a step back clears forward', () => {
        const jumped = noteJump(emptyCameraHistory(), at(0), at(5000), 'a');
        const back = step(jumped, -1, at(5000), everything)!;
        expect(back.history.forward).toHaveLength(1);
        const again = noteJump(back.history, at(0), at(9000), 'b');
        expect(again.forward).toEqual([]);
    });

    test('jitter under the threshold records nothing', () => {
        expect(samePlace(at(0), at(7))).toBe(true);
        expect(samePlace(at(0), at(9))).toBe(false);
        expect(samePlace(at(0, 1), at(0, 1.02))).toBe(false);
        expect(noteJump(emptyCameraHistory(), at(0), at(3), 'a').back).toEqual([]);
        const panned = pan(emptyCameraHistory(), 0, 1, 0);
        expect(settle(panned.history, at(3)).back).toEqual([]);
    });

    test('nothing to step to is null', () => {
        expect(step(emptyCameraHistory(), -1, at(0), everything)).toBeNull();
        expect(step(emptyCameraHistory(), 1, at(0), everything)).toBeNull();
    });
});
