import { describe, expect, test } from 'bun:test';
import type { SubagentInfo } from '@ruimte/extension/client';
import { MAX_PET_KIDS, petKidMoods } from './kids';

const NO_PETS: ReadonlySet<string> = new Set();

function subagent(node: string | null = null, status: SubagentInfo['status'] = 'running'): SubagentInfo {
    return { status, node: node === null ? null : { id: node } };
}

describe('the kids of a pet', () => {
    test('are one for each sub-agent at work, and none without one', () => {
        expect(petKidMoods([subagent(), subagent()], NO_PETS)).toEqual(['working', 'working']);
        expect(petKidMoods([], NO_PETS)).toEqual([]);
    });

    test('are never more than three', () => {
        expect(MAX_PET_KIDS).toBe(3);
        expect(
            petKidMoods(
                ['a', 'b', 'c', 'd', 'e'].map((id) => subagent(id)),
                NO_PETS
            )
        ).toHaveLength(MAX_PET_KIDS);
    });

    test('leave out a task whose node has a pet of its own on the canvas, and keep one whose node is not there', () => {
        const subagents = [subagent('reviewer'), subagent('helper')];

        expect(petKidMoods(subagents, new Set(['writer', 'reviewer']))).toHaveLength(1);
        expect(petKidMoods(subagents, NO_PETS)).toHaveLength(2);
    });

    test('rest for a task that waits for a limit to lift, as the pill over the composer says it is paused', () => {
        expect(petKidMoods([subagent('helper', 'paused'), subagent()], NO_PETS)).toEqual(['idle', 'working']);
    });
});
