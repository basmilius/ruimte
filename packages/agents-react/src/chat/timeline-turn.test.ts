import { describe, expect, test } from 'bun:test';
import { jumpToTimelineTurn, registerTurnJumper } from './timeline-scroll';
import { useTimelineFlash } from './timeline-flash';

describe('a jump to the turn of a chat', () => {
    test('reaches the thread that is on screen', () => {
        const jumps: Array<[string, string]> = [];
        const stop = registerTurnJumper('m1:chat-a', (turnId, target) => jumps.push([turnId, target]));
        expect(jumpToTimelineTurn('m1:chat-a', 'turn-4', 'changes')).toBe(true);
        expect(jumps).toEqual([['turn-4', 'changes']]);
        stop();
    });

    test('waits for a thread that is not on screen yet and is delivered once when it registers', () => {
        expect(jumpToTimelineTurn('m1:chat-b', 'turn-2', 'prompt')).toBe(false);
        const jumps: Array<[string, string]> = [];
        const stop = registerTurnJumper('m1:chat-b', (turnId, target) => jumps.push([turnId, target]));
        expect(jumps).toEqual([['turn-2', 'prompt']]);
        stop();
        const again: string[] = [];
        registerTurnJumper('m1:chat-b', (turnId) => again.push(turnId))();
        expect(again).toEqual([]);
    });

    test('a thread that is gone no longer takes jumps, and another chat never does', () => {
        const jumps: string[] = [];
        registerTurnJumper('m1:chat-c', (turnId) => jumps.push(turnId))();
        expect(jumpToTimelineTurn('m1:chat-c', 'turn-1', 'prompt')).toBe(false);
        expect(jumps).toEqual([]);
    });
});

describe('the row a jump lit up', () => {
    test('a second jump to the same row counts as a new one', () => {
        useTimelineFlash.getState().flash('m1:chat-a', 'files-turn-4', true);
        const first = useTimelineFlash.getState().target!;
        useTimelineFlash.getState().flash('m1:chat-a', 'files-turn-4', true);
        expect(useTimelineFlash.getState().target).toMatchObject({ key: 'm1:chat-a', rowId: 'files-turn-4', opens: true });
        expect(useTimelineFlash.getState().target!.nonce).toBeGreaterThan(first.nonce);
    });
});
