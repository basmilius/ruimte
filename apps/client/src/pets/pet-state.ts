import type { AgentKind } from '@ruimte/contracts';
import type { ChatStatuses } from '@adecore/agents-react/state';
import { CLAUDE_BUDDY, CODEX_BUDDY } from '@/pets/buddies';
import { FOX_SPRITE, FROG_SPRITE } from '@/pets/animals';
import { BUBBLE_ABOVE, BUBBLE_BESIDE, BUBBLE_ROWS, JUMP_ROWS, PAINT_COLUMNS, PAINT_ROWS, SPRITE_COLUMNS, type DrawnSprite, type PetPose } from '@/pets/pixel';
import { nodeWorking } from '@/state/agent-work';
import { groupAttention } from '@/state/attention';
import { endpointKey, endpointOfNode } from '@/state/keys';
import { nodeProvider, nodeStatus, type SessionsByKey, type StatusOf } from '@/state/sessions';
import type { Snoozes } from '@/state/snooze';

/* What a pet shows of its node's agent, or that it only drops by. `snoozed` still waits on you, quietly. */
export type PetMood = 'working' | 'waiting' | 'snoozed' | 'idle' | 'stopped' | 'visiting';

export interface AgentPet {
    /* The CLI behind the node, which picks the built-in figure; none for a chat that has not said yet. */
    agent: AgentKind | undefined;
    mood: PetMood;
}

/* Whether two pets draw the same, which `petOf` answers with a new object every time. */
export function samePet(one: AgentPet, other: AgentPet): boolean {
    return one.agent === other.agent && one.mood === other.mood;
}

// Nothing here asks whether a pet was seen, so an empty record keeps the attention pass to the waits alone.
const NO_UNSEEN: Readonly<Record<string, true>> = {};

/*
 * The pet of a node or a view with an agent in it: a chat, a design (whose status is the chat under its
 * own id, as everywhere else), or a terminal whose CLI reported through its hooks.
 * Waiting is the same "needs you" every count reads. A wait a person snoozed keeps its bubble until it
 * is answered, since the question is still open, but does not jump.
 */
export function petOf(node: StatusOf, sessions: SessionsByKey, chats: ChatStatuses, endpointId: string, snoozes: Snoozes): AgentPet | null {
    let agent: AgentKind | undefined;
    if (node.kind === 'terminal') {
        const session = sessions[endpointKey(endpointOfNode(node, endpointId), node.id)];
        if (!session?.agent) {
            return null;
        }
        agent = session.agent.kind;
    } else {
        agent = nodeProvider(node, chats, endpointId);
    }
    const attention = groupAttention([node], sessions, chats, endpointId, NO_UNSEEN, snoozes);
    return { agent, mood: attention.snoozed.length > 0 ? 'snoozed' : moodOf(node, attention.needsYou.length > 0, sessions, chats, endpointId) };
}

function moodOf(node: StatusOf, waiting: boolean, sessions: SessionsByKey, chats: ChatStatuses, endpointId: string): PetMood {
    if (waiting) {
        return 'waiting';
    }
    if (nodeWorking(node, sessions, chats, endpointId)) {
        return 'working';
    }
    const status = nodeStatus(node, sessions, chats, endpointId);
    return status === 'error' || status === 'exited' ? 'stopped' : 'idle';
}

/* How far a waiting pet is off the ground, in cells, frame by frame: up, a moment in the air, down, and a beat on the node. */
const JUMP = [0, 2, 3, JUMP_ROWS, 3, 2, 0, 0] as const;

export interface PetFrame {
    pose: PetPose;
    /* The frame of the pose's own animation. */
    frame: number;
    /* Cells above its node. */
    lift: number;
    bubble: boolean;
}

/*
 * What a pet draws on a tick of the shared clock. A pet that waits on you says so with a bubble and
 * jumps until the question is answered; snoozed it keeps the bubble and stands still. With reduced
 * motion asked for nothing moves: every pet holds its first frame, the bubble included.
 */
export function petFrame(mood: PetMood, tick: number, still: boolean): PetFrame {
    const beat = still ? 0 : tick;
    if (mood === 'waiting' || mood === 'snoozed') {
        return { pose: 'wait', frame: beat, lift: mood === 'snoozed' ? 0 : JUMP[beat % JUMP.length], bubble: true };
    }
    if (mood === 'working') {
        return { pose: 'work', frame: beat, lift: 0, bubble: false };
    }
    if (mood === 'stopped') {
        return { pose: 'stopped', frame: Math.floor(beat / 4), lift: 0, bubble: false };
    }
    if (mood === 'visiting') {
        return { pose: 'stand', frame: Math.floor(beat / 2), lift: 0, bubble: false };
    }
    return { pose: 'sleep', frame: Math.floor(beat / 4), lift: 0, bubble: false };
}

/* World pixels a cell takes, so a pet stays pixel art at every zoom. */
export const WORLD_CELL = 2;
/* The figure's width, and the paint's, which is wider for the bubble beside it. */
export const PET_WIDTH = SPRITE_COLUMNS * WORLD_CELL;
export const PET_PAINT_WIDTH = PAINT_COLUMNS * WORLD_CELL;
export const PET_HEIGHT = PAINT_ROWS * WORLD_CELL;

/*
 * Where a waiting pet's bubble starts in its paint, in cells, at a lift: over its head, or beside it when
 * a node lies there. Beside, it rises no higher than the press box, so it stays clear of a node 40 pixels
 * above as the figure does, through the jump and at rest alike.
 */
export function bubbleCell(lift: number, beside: boolean): { x: number; y: number } {
    const spriteTop = BUBBLE_ROWS + JUMP_ROWS - lift;
    return beside ? { x: BUBBLE_BESIDE, y: spriteTop + 2 } : { x: BUBBLE_ABOVE, y: spriteTop - BUBBLE_ROWS };
}

export const PET_SETS = ['buddies', 'animals'] as const;

export type PetSet = (typeof PET_SETS)[number];

export const CUSTOM_PET_PREFIX = 'custom:';

/* The figure of a built-in set for an agent: Codex has its own, every other CLI the one Claude has. */
export function builtInSprite(set: PetSet, agent: AgentKind | undefined): DrawnSprite {
    const codex = agent === 'codex';
    if (set === 'animals') {
        return codex ? FROG_SPRITE : FOX_SPRITE;
    }
    return codex ? CODEX_BUDDY : CLAUDE_BUDDY;
}

/* A set pets come from: a built-in one, or one a person added. */
export type PetChoice = { kind: 'built-in'; set: PetSet } | { kind: 'custom'; id: string };

/*
 * The sets the setting names that are still there, each once, the built-in ones first. A set a person
 * added and removed since is left out, and when nothing named is left the pets are the buddies.
 */
export function petPoolOf(setting: readonly string[], customIds: readonly string[]): PetChoice[] {
    const pool: PetChoice[] = PET_SETS.filter((set) => setting.includes(set)).map((set) => ({ kind: 'built-in', set }));
    for (const id of customIds) {
        if (setting.includes(`${CUSTOM_PET_PREFIX}${id}`)) {
            pool.push({ kind: 'custom', id });
        }
    }
    return pool.length > 0 ? pool : [{ kind: 'built-in', set: 'buddies' }];
}

/* What the setting holds for a set. */
export function petChoiceKey(choice: PetChoice): string {
    return choice.kind === 'custom' ? `${CUSTOM_PET_PREFIX}${choice.id}` : choice.set;
}

/* The set a key the settings hold names, while it is still there: a built-in set, or a figure a person kept. */
export function petChoiceOfKey(key: string, customIds: readonly string[]): PetChoice | null {
    const set = PET_SETS.find((each) => each === key);

    if (set !== undefined) {
        return { kind: 'built-in', set };
    }

    const id = key.startsWith(CUSTOM_PET_PREFIX) ? key.slice(CUSTOM_PET_PREFIX.length) : null;

    return id !== null && customIds.includes(id) ? { kind: 'custom', id } : null;
}

/*
 * The set an agent's pet comes from: the one a person gave its CLI, such as a cat of their own for
 * Codex, or else the one of the pool that scores highest for the node. A figure given and removed since
 * leaves that CLI to the pool again.
 */
export function agentPetChoice(
    byAgent: Readonly<Record<string, string>>,
    agent: AgentKind | undefined,
    pool: readonly PetChoice[],
    customIds: readonly string[],
    nodeId: string
): PetChoice {
    const given = agent === undefined ? undefined : byAgent[agent];
    const chosen = given === undefined ? null : petChoiceOfKey(given, customIds);

    return chosen ?? petChoiceFor(pool, nodeId);
}

function score(text: string): number {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = (Math.imul(hash, 33) + text.charCodeAt(i)) | 0;
    }
    // Mixed once more, so two keys that differ in their last character do not score side by side.
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    return (hash ^ (hash >>> 16)) >>> 0;
}

/*
 * The set of the pool a node's pet comes from: the one that scores highest for the node. The same node
 * gets the same set every time and in every window, whatever order the sets were picked in, and a set
 * that joins or leaves changes only the pets it takes or gave up.
 */
export function petChoiceFor(pool: readonly PetChoice[], nodeId: string): PetChoice {
    let best = pool[0];
    let bestScore = -1;
    for (const choice of pool) {
        const each = score(`${petChoiceKey(choice)}\n${nodeId}`);
        if (each > bestScore) {
            best = choice;
            bestScore = each;
        }
    }
    return best;
}

/* The pool's sets with one picked or left out, as the setting holds them. The last one stays: a pet always comes from somewhere. */
export function petSetsWith(pool: readonly PetChoice[], key: string, picked: boolean): string[] {
    const keys = pool.map(petChoiceKey);
    const rest = keys.filter((each) => each !== key);
    if (picked) {
        return [...rest, key];
    }
    return rest.length > 0 ? rest : keys;
}
