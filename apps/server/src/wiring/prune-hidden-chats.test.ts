import { beforeEach, describe, expect, jest, test } from 'bun:test';
import { AgentLineageStore } from '@adecore/agents/coordination';
import type { Task } from '@ruimte/contracts';
import { HiddenAgentStore } from '../projects/hidden-agents.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { HIDDEN_CHAT_KEEP_MS, pruneHiddenChats, type HiddenChatPruning } from './prune-hidden-chats.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY_MS;
const LONG_AGO = NOW - HIDDEN_CHAT_KEEP_MS - DAY_MS;

let home: string;

const newHome = tempHomes('ruimte-prune-hidden-');

beforeEach(async () => {
    home = await newHome();
});

function task(childId: string, overrides: Partial<Task> = {}): Task {
    return {
        id: `task-${childId}`,
        projectId: 'project',
        parentId: 'lead',
        childId,
        title: 'Review',
        prompt: 'Review it',
        status: 'done',
        result: null,
        createdAt: LONG_AGO - DAY_MS,
        settledAt: LONG_AGO,
        wake: 'done',
        ...overrides
    } as Task;
}

/* A project with one hidden chat `child`, opened by the chat view `lead`, whose task settled long ago. */
async function harness() {
    const hiddenAgents = new HiddenAgentStore(home);
    await hiddenAgents.load();
    const lineage = new AgentLineageStore(home);
    await lineage.load();
    const places = new Set(['lead']);
    const tasks: Task[] = [];
    const dropped: string[] = [];
    const changed: string[] = [];
    hiddenAgents.onChange = (projectId) => changed.push(projectId);
    let now = NOW;
    const hide = async (id: string, openedBy: string, kind: 'chat' | 'terminal' = 'chat') => {
        await hiddenAgents.put({ projectId: 'project', openedBy, node: { id, kind, title: id, x: 0, y: 0, w: 1, h: 1 } });
        await lineage.put({ projectId: 'project', nodeId: id, openedBy, depth: 1, agent: true });
    };
    await hide('child', 'lead');
    tasks.push(task('child'));
    changed.length = 0;
    const deps: HiddenChatPruning = {
        hiddenAgents,
        index: { has: (projectId) => projectId === 'project', placed: (id) => places.has(id) },
        tasks: { involving: (id) => tasks.filter((entry) => entry.parentId === id || entry.childId === id) },
        lineage,
        chats: {
            dropStored: async (id) => {
                dropped.push(id);
                return true;
            }
        },
        now: () => now
    };
    return {
        deps,
        hiddenAgents,
        lineage,
        places,
        tasks,
        dropped,
        changed,
        hide,
        setNow: (at: number) => {
            now = at;
        },
        prune: () => pruneHiddenChats(deps)
    };
}

describe('pruneHiddenChats', () => {
    test('removes a hidden chat whose task settled over 30 days ago, that no view holds and that has no living child', async () => {
        const daemon = await harness();
        expect(await daemon.prune()).toEqual(['child']);
        expect(daemon.dropped).toEqual(['child']);
        expect(daemon.hiddenAgents.get('child')).toBeUndefined();
        // Forgetting the agent tells its project, which prunes lineage, outbox and tasks as a deleted node does.
        expect(daemon.changed).toEqual(['project']);
    });

    test('keeps a chat whose task settled less than 30 days ago, or is still open', async () => {
        const recent = await harness();
        recent.tasks[0] = task('child', { settledAt: NOW - HIDDEN_CHAT_KEEP_MS + DAY_MS });
        expect(await recent.prune()).toEqual([]);

        const open = await harness();
        open.tasks[0] = task('child', { status: 'open', settledAt: null });
        expect(await open.prune()).toEqual([]);

        const none = await harness();
        none.tasks.length = 0;
        expect(await none.prune()).toEqual([]);
        expect([...recent.dropped, ...open.dropped, ...none.dropped]).toEqual([]);
        expect(recent.hiddenAgents.get('child')).toBeDefined();
    });

    test('keeps a chat that a view of a project holds', async () => {
        const daemon = await harness();
        daemon.places.add('child');
        expect(await daemon.prune()).toEqual([]);
        expect(daemon.dropped).toEqual([]);
        expect(daemon.hiddenAgents.get('child')).toBeDefined();
    });

    test('keeps a chat with a living child, and removes the two together once the child may go too', async () => {
        const daemon = await harness();
        await daemon.hide('grandchild', 'child');
        daemon.tasks.push(task('grandchild', { parentId: 'child', status: 'open', settledAt: null }));
        expect(await daemon.prune()).toEqual([]);
        expect(daemon.hiddenAgents.get('child')).toBeDefined();

        daemon.tasks[1] = task('grandchild', { parentId: 'child' });
        expect((await daemon.prune()).sort()).toEqual(['child', 'grandchild']);
    });

    test('keeps a chat a loaded session holds, and a hidden terminal', async () => {
        const daemon = await harness();
        await daemon.hide('shell', 'lead', 'terminal');
        daemon.tasks.push(task('shell'));
        daemon.deps.chats.dropStored = async () => false;
        expect(await daemon.prune()).toEqual([]);
        expect(daemon.hiddenAgents.get('child')).toBeDefined();
        expect(daemon.hiddenAgents.get('shell')).toBeDefined();
    });

    test('runs only when called: it leaves no timer behind that removes a chat later', async () => {
        jest.useFakeTimers();
        try {
            const daemon = await harness();
            daemon.tasks[0] = task('child', { settledAt: NOW - HIDDEN_CHAT_KEEP_MS + DAY_MS });
            expect(await daemon.prune()).toEqual([]);
            daemon.setNow(NOW + 2 * DAY_MS);
            jest.advanceTimersByTime(2 * DAY_MS);
            expect(daemon.dropped).toEqual([]);
            expect(daemon.hiddenAgents.get('child')).toBeDefined();

            // The next start is what removes it.
            expect(await daemon.prune()).toEqual(['child']);
        } finally {
            jest.useRealTimers();
        }
    });
});
