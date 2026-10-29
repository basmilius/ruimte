import { describe, expect, test } from 'bun:test';
import type { ChatItem, ChatSubagentItem, Task } from '@ruimte/contracts';
import type { ChatState, ChatsById } from '@adecore/agents-react/state';
import { kidMoodsOf, MAX_PET_KIDS, petKidMoods, petKidsOf } from '@/pets/kids';
import type { CanvasNode } from '@/state/canvas';
import { endpointKey, endpointOfNode } from '@/state/keys';
import { chatInfoOf } from '../../testing/chat-info';

const NO_PETS: ReadonlySet<string> = new Set();

/* How many kids a thread brings, without tasks to look up. */
function petKidCount(row: ChatState | undefined, ownPets: ReadonlySet<string>): number {
    return petKidMoods(row, ownPets, undefined).length;
}

function task(childId: string, patch: Partial<Task> = {}): Task {
    return {
        id: `task-of-${childId}`,
        projectId: 'atlas',
        parentId: 'writer',
        childId,
        title: childId,
        prompt: 'Do it',
        status: 'open',
        result: null,
        createdAt: 1,
        settledAt: null,
        wake: 'pending',
        ...patch
    };
}

function subagent(id: string, patch: Partial<ChatSubagentItem> = {}): ChatSubagentItem {
    return {
        id,
        kind: 'subagent',
        turnId: null,
        createdAt: 1,
        toolUseId: `spawn-${id}`,
        description: id,
        subagentType: null,
        prompt: null,
        background: false,
        status: 'running',
        startedAt: 1,
        finishedAt: null,
        summary: null,
        result: null,
        usage: null,
        lastTool: null,
        itemsTruncated: false,
        ...patch
    };
}

function thread(items: ChatItem[], before: ChatItem[] = []): ChatState {
    const structure = Object.fromEntries([...before, ...items].map((item) => [item.id, item]));
    return {
        info: chatInfoOf('writer'),
        items: structure,
        structure,
        order: items.map((item) => item.id),
        ...(before.length > 0 ? { subagentsBefore: before.map((item) => item.id) } : {})
    };
}

function node(kind: CanvasNode['kind'], patch: Partial<CanvasNode> = {}): CanvasNode {
    return { id: 'writer', kind, title: 'Writer', x: 0, y: 0, w: 480, h: 520, ...patch } as CanvasNode;
}

describe('the kids of a pet', () => {
    test('are one for each sub-agent at work, also one from before the part of the thread the client holds', () => {
        const row = thread([subagent('a'), subagent('b', { status: 'done', finishedAt: 2 }), subagent('c', { background: true })], [subagent('old')]);
        expect(petKidCount(row, NO_PETS)).toBe(3);
    });

    test('are none without a thread or without a sub-agent at work', () => {
        expect(petKidCount(undefined, NO_PETS)).toBe(0);
        expect(petKidCount(thread([subagent('a', { status: 'failed', finishedAt: 2 })]), NO_PETS)).toBe(0);
    });

    test('are never more than three', () => {
        const row = thread(['a', 'b', 'c', 'd', 'e'].map((id) => subagent(id)));
        expect(MAX_PET_KIDS).toBe(3);
        expect(petKidCount(row, NO_PETS)).toBe(MAX_PET_KIDS);
    });

    test('leave out a task whose node has a pet of its own on the canvas, and keep one whose node is not there', () => {
        const row = thread([subagent('shown', { origin: 'ruimte', childId: 'reviewer' }), subagent('hidden', { origin: 'ruimte', childId: 'helper' })]);
        expect(petKidCount(row, new Set(['writer', 'reviewer']))).toBe(1);
        expect(petKidCount(row, NO_PETS)).toBe(2);
    });

    test('go when their sub-agent ends', () => {
        const running = subagent('a');
        expect(petKidCount(thread([running]), NO_PETS)).toBe(1);
        expect(petKidCount(thread([{ ...running, status: 'done', finishedAt: 2 }]), NO_PETS)).toBe(0);
    });

    test('follow a chat and a design through the thread under the node id, on the machine of the node, and never a terminal', () => {
        const elsewhere = node('chat', { machine: 'mini' });
        const chats: ChatsById = {
            [endpointKey('local', 'writer')]: thread([subagent('a')]),
            [endpointKey(endpointOfNode(elsewhere, 'local'), 'writer')]: thread([subagent('a'), subagent('b')])
        };
        expect(kidMoodsOf(petKidsOf(node('chat'), chats, {}, 'local', NO_PETS))).toEqual(['working']);
        expect(kidMoodsOf(petKidsOf(node('design'), chats, {}, 'local', NO_PETS))).toEqual(['working']);
        expect(kidMoodsOf(petKidsOf(elsewhere, chats, {}, 'local', NO_PETS))).toEqual(['working', 'working']);
        expect(petKidsOf(node('terminal'), chats, {}, 'local', NO_PETS)).toBe('');
        expect(kidMoodsOf('')).toEqual([]);
    });

    test('rest for a task that waits for a limit to lift, as the pill over the composer says it is paused', () => {
        const row = thread([subagent('helper', { origin: 'ruimte', childId: 'helper' }), subagent('own')]);
        const paused = { [task('helper').id]: task('helper', { paused: { kind: 'usage' } }) };
        expect(petKidMoods(row, NO_PETS, paused)).toEqual(['idle', 'working']);
        expect(petKidMoods(row, NO_PETS, { [task('helper').id]: task('helper') })).toEqual(['working', 'working']);
        const chats: ChatsById = { [endpointKey('local', 'writer')]: row };
        expect(petKidsOf(node('chat'), chats, { local: paused }, 'local', NO_PETS)).toBe('idle working');
    });
});
