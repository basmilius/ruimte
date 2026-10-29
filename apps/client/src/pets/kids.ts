import { isChatNode, type ChatItem, type ChatSubagentItem } from '@ruimte/contracts';
import type { ChatsById } from '@adecore/agents-react/state';
import { PET_HEIGHT, PET_PAINT_WIDTH, PET_WIDTH, type PetMood } from '@/pets/pet-state';
import { memoByIdentity } from '@/state/identity-memo';
import { endpointKey, endpointOfNode } from '@/state/keys';
import type { StatusOf } from '@/state/sessions';
import { childTask, type TasksById } from '@/state/tasks';

/* At most this many kids follow one pet; more would crowd the top edge of a node and the bottom of the screen. */
export const MAX_PET_KIDS = 3;

/* A kid is its pet at half the size: a cell of one world pixel. */
export const KID_WIDTH = PET_WIDTH / 2;
export const KID_PAINT_WIDTH = PET_PAINT_WIDTH / 2;
export const KID_HEIGHT = PET_HEIGHT / 2;

/* How far apart the kids stand in their row behind a pet on its node, a little closer than their width. */
export const KID_SPACING = KID_WIDTH - 4;

const NONE: readonly string[] = [];

const runningOf = memoByIdentity((structure: Readonly<Record<string, ChatItem>>, order: readonly string[], before: readonly string[]): ChatSubagentItem[] =>
    // The ones from before the page the client holds come first, since they are older than all of it.
    [...before, ...order].flatMap((id) => {
        const item = structure[id];
        return item?.kind === 'subagent' && item.status === 'running' ? [item] : [];
    })
);

/*
 * The kids that follow a chat's pet, oldest first: one for each of its sub-agents at work, the CLI's own
 * and the tasks it gave, except a task whose node has a pet of its own here, so no agent stands on the
 * canvas twice. A task that waits for a limit to lift is still a running row, as the pill over the
 * composer says "paused" for it, so its kid rests (`idle`) instead of working. The thread is the one the
 * chat's node holds; a streamed word leaves `structure` as it was, so this looks through the rows only
 * when one of them changed.
 */
export function petKidMoods(
    row: { structure: Readonly<Record<string, ChatItem>>; order: readonly string[]; subagentsBefore?: readonly string[] } | undefined,
    ownPets: ReadonlySet<string>,
    tasks: TasksById | undefined
): PetMood[] {
    if (row === undefined) {
        return [];
    }
    return runningOf(row.structure, row.order, row.subagentsBefore ?? NONE)
        .filter((item) => item.childId === undefined || !ownPets.has(item.childId))
        .slice(0, MAX_PET_KIDS)
        .map((item) => {
            const task = item.origin === 'ruimte' && item.childId !== undefined ? childTask(tasks, item.childId) : null;
            return task?.status === 'open' && task.paused !== undefined ? 'idle' : 'working';
        });
}

/*
 * The kids of a node's or a view's pet, as one string of their moods so a selector answers the same while nothing
 * changed. A design follows the chat under its own id, as its status does. A terminal has none: its
 * CLI's hooks name a sub-agent to the daemon, but nothing of it reaches a client.
 */
export function petKidsOf(
    node: StatusOf,
    chats: ChatsById,
    tasks: Readonly<Record<string, TasksById>>,
    endpointId: string,
    ownPets: ReadonlySet<string>
): string {
    if (!isChatNode(node)) {
        return '';
    }
    const machine = endpointOfNode(node, endpointId);
    return petKidMoods(chats[endpointKey(machine, node.id)], ownPets, tasks[machine]).join(' ');
}

/* The moods `petKidsOf` gave, one per kid. */
export function kidMoodsOf(kids: string): PetMood[] {
    return kids === '' ? [] : (kids.split(' ') as PetMood[]);
}

/* What a kid is called along the bottom of the screen, beside the node ids of the pets; a node id holds no line break. */
export function kidId(petId: string, index: number): string {
    return `${petId}\n${index}`;
}
