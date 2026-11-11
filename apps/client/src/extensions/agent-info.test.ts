import { describe, expect, test } from 'bun:test';
import type { ChatState, ChatStatuses } from '@adecore/agents-react/state';
import type { AgentInfo as CliInfo, AgentStatus, ChatInfo, ChatItem, ChatSubagentItem, Task } from '@ruimte/contracts';
import { agentInfoOf, subagentsOf, type AgentSources } from '@/extensions/agent-info';
import type { SessionsByKey } from '@/state/sessions';
import { chatInfoOf } from '../../testing/chat-info';

function cli(status: AgentStatus, kind = 'claude'): CliInfo {
    return { kind, agentSessionId: 'a1', transcriptPath: null, status, live: true, updatedAt: 0 };
}

function chat(id: string, patch: Partial<ChatInfo>): ChatState {
    return { info: chatInfoOf(id, patch), items: {}, structure: {}, order: [] };
}

function sources(patch: Partial<AgentSources> = {}): AgentSources {
    return { sessions: {}, chats: {}, snoozes: {}, endpointId: 'local', ...patch };
}

function writer(info: Partial<ChatInfo>, patch: Partial<AgentSources> = {}) {
    const chats: ChatStatuses = { 'local:writer': chat('writer', info) };

    return agentInfoOf({ id: 'writer', kind: 'chat' }, undefined, sources({ chats, ...patch }));
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

function thread(items: ChatItem[], before: ChatItem[] = []): Pick<ChatState, 'structure' | 'order' | 'subagentsBefore'> {
    return {
        structure: Object.fromEntries([...before, ...items].map((item) => [item.id, item])),
        order: items.map((item) => item.id),
        ...(before.length > 0 ? { subagentsBefore: before.map((item) => item.id) } : {})
    };
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

describe('the agent an extension reads', () => {
    test('of a terminal is the CLI that reported through its hooks, and none for a shell', () => {
        const sessions: SessionsByKey = {
            'local:agent': { attached: true, agent: cli('running', 'codex') },
            'local:shell': { attached: true },
            'local:gone': { attached: true, agent: null }
        };

        expect(agentInfoOf({ id: 'shell', kind: 'terminal' }, undefined, sources({ sessions }))).toBeUndefined();
        expect(agentInfoOf({ id: 'gone', kind: 'terminal' }, undefined, sources({ sessions }))).toBeUndefined();
        expect(agentInfoOf({ id: 'agent', kind: 'terminal' }, undefined, sources({ sessions }))).toMatchObject({
            provider: 'codex',
            status: 'running',
            activity: 'turn'
        });
    });

    test('works on a turn, on agents it handed work to, or only on commands it left running', () => {
        expect(writer({ status: 'running' })?.activity).toBe('turn');
        expect(writer({ status: 'idle', delegating: true })?.activity).toBe('delegating');
        expect(writer({ status: 'idle', background: [{ kind: 'shell', id: 'b1', label: 'dev server' } as never] })?.activity).toBe('background');
        expect(writer({ status: 'idle' })?.activity).toBeNull();
    });

    test('waits on a person with nothing else to work on, and says when the person put it off', () => {
        expect(writer({ status: 'needs-you' })).toMatchObject({ status: 'needsYou', activity: null, snoozed: false });
        expect(writer({ status: 'needs-you' }, { snoozes: { 'local:writer': 2_000 } })?.snoozed).toBe(true);
        // Answered, the snooze has nothing left to hold.
        expect(writer({ status: 'idle' }, { snoozes: { 'local:writer': 2_000 } })?.snoozed).toBe(false);
    });

    test('ended in an error reads as stopped, and a chat not heard from yet rests on no known CLI', () => {
        expect(writer({ status: 'error' })?.status).toBe('stopped');
        expect(agentInfoOf({ id: 'writer', kind: 'chat' }, undefined, sources())).toMatchObject({ status: 'idle', provider: null });
    });

    test('is none for a node that runs no agent', () => {
        expect(agentInfoOf({ id: 'plan', kind: 'note' }, undefined, sources())).toBeUndefined();
    });
});

describe('the sub-agents of a chat', () => {
    test('are the ones at work, also from before the part of the thread the client holds, oldest first', () => {
        const row = thread([subagent('a'), subagent('b', { status: 'done', finishedAt: 2 }), subagent('c', { background: true })], [subagent('old')]);

        expect(subagentsOf(row, undefined)).toEqual([
            { status: 'running', node: null },
            { status: 'running', node: null },
            { status: 'running', node: null }
        ]);
        expect(subagentsOf(undefined, undefined)).toEqual([]);
    });

    test('name the node of a task the chat gave, which is paused while it waits for a limit to lift', () => {
        const row = thread([subagent('helper', { origin: 'ruimte', childId: 'helper' }), subagent('own')]);
        const paused = { [task('helper').id]: task('helper', { paused: { kind: 'usage' } }) };

        expect(subagentsOf(row, paused)).toEqual([
            { status: 'paused', node: { id: 'helper' } },
            { status: 'running', node: null }
        ]);
        expect(subagentsOf(row, { [task('helper').id]: task('helper') })[0]?.status).toBe('running');
    });
});
