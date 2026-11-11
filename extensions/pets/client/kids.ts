import type { SubagentInfo } from '@ruimte/extension/client';
import { PET_HEIGHT, PET_PAINT_WIDTH, PET_WIDTH, type PetMood } from './pet-state';

/* At most this many kids follow one pet; more would crowd the top edge of a node and the bottom of the screen. */
export const MAX_PET_KIDS = 3;

/* A kid is its pet at half the size: a cell of one world pixel. */
export const KID_WIDTH = PET_WIDTH / 2;
export const KID_PAINT_WIDTH = PET_PAINT_WIDTH / 2;
export const KID_HEIGHT = PET_HEIGHT / 2;

/* How far apart the kids stand in their row behind a pet on its node, a little closer than their width. */
export const KID_SPACING = KID_WIDTH - 4;

/*
 * The kids that follow a chat's pet, oldest first: one for each of its sub-agents at work (`useSubagents`), the CLI's
 * own and the tasks it gave, except a task whose node has a pet of its own here, so no agent stands on the canvas
 * twice. A task that waits for a limit to lift rests (`idle`) instead of working, as the pill over the composer says
 * "paused" for it. A terminal has none: nothing of its CLI's sub-agents reaches a client.
 */
export function petKidMoods(subagents: readonly SubagentInfo[], ownPets: ReadonlySet<string>): PetMood[] {
    return subagents
        .filter((subagent) => subagent.node === null || !ownPets.has(subagent.node.id))
        .slice(0, MAX_PET_KIDS)
        .map((subagent) => (subagent.status === 'paused' ? 'idle' : 'working'));
}

/* What a kid is called along the bottom of the screen, beside the node ids of the pets; a node id holds no line break. */
export function kidId(petId: string, index: number): string {
    return `${petId}\n${index}`;
}
