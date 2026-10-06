import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutboxStore } from './outbox.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-outbox-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

// Files exactly as a daemon before the outbox moved into @adecore/agents wrote them, so one updated in place reads them.
const WRITTEN = {
    'start-agent-0a1b2c3d4e5f':
        '{"kind":"start-agent","payload":{"node":"chat","provider":"claude","cwd":"/work","runtimeMode":"auto","ceiling":"auto","account":"claude-work"},"id":"start-agent-0a1b2c3d4e5f","projectId":"project-1","target":"chat-2","createdAt":1000,"attempts":0,"notBefore":1000}',
    'end-children-0a1b2c3d4e60':
        '{"kind":"end-children","payload":{"nodeIds":["chat-2","terminal-3"]},"id":"end-children-0a1b2c3d4e60","projectId":"project-1","target":"chat-1","createdAt":1001,"attempts":2,"notBefore":6001}',
    'background-limit-0a1b2c3d4e61':
        '{"kind":"background-limit","payload":{"taskId":"task-1","commands":["bun dev"],"restarted":true},"id":"background-limit-0a1b2c3d4e61","projectId":"project-1","target":"chat-2","createdAt":1002,"attempts":0,"notBefore":1801002}',
    'wake-parent-0a1b2c3d4e62':
        '{"kind":"wake-parent","payload":{"taskId":"task-1"},"id":"wake-parent-0a1b2c3d4e62","projectId":"project-1","target":"chat-1","createdAt":1003,"attempts":1,"notBefore":2003}',
    'give-task-0a1b2c3d4e63':
        '{"kind":"give-task","payload":{"taskId":"task-2"},"id":"give-task-0a1b2c3d4e63","projectId":"project-1","target":"chat-3","createdAt":1004,"attempts":0,"notBefore":1004}',
    'deliver-waiting-0a1b2c3d4e64':
        '{"kind":"deliver-waiting","payload":{"childId":"chat-2","requestId":"req-1"},"id":"deliver-waiting-0a1b2c3d4e64","projectId":"project-1","target":"chat-1","createdAt":1005,"attempts":0,"notBefore":16005}'
};

test('an entry an older daemon wrote reads back whole, and nothing ends children beside a start of one of them', async () => {
    await mkdir(join(home, 'outbox'), { recursive: true });
    for (const [id, text] of Object.entries(WRITTEN)) {
        await writeFile(join(home, 'outbox', `${id}.json`), text);
    }
    const store = new OutboxStore(home);
    await store.load();
    expect(store.list()).toEqual(Object.values(WRITTEN).map((text) => JSON.parse(text)));
    expect(store.list().map((entry) => store.lanesOf(entry))).toEqual([
        ['chat-2'],
        ['chat-1', 'chat-2', 'terminal-3'],
        ['chat-2'],
        ['chat-1'],
        ['chat-3'],
        ['chat-1']
    ]);
});

test('a new entry is written in the shape an older daemon reads', async () => {
    const store = new OutboxStore(home);
    const entry = await store.put(
        'project-1',
        'chat-2',
        {
            kind: 'start-agent',
            payload: { node: 'chat', provider: 'claude', cwd: '/work', runtimeMode: 'auto', ceiling: 'auto', account: 'claude-work' }
        },
        1000
    );
    expect(entry.id).toMatch(/^start-agent-[0-9a-f]{12}$/);
    expect(await readFile(join(home, 'outbox', `${entry.id}.json`), 'utf8')).toBe(
        WRITTEN['start-agent-0a1b2c3d4e5f'].replaceAll('start-agent-0a1b2c3d4e5f', entry.id)
    );
});

test('pruning keeps the ending of a node that left the project and drops the rest owed for it', async () => {
    const store = new OutboxStore(home);
    await store.put('project-1', 'chat-1', { kind: 'end-children', payload: { nodeIds: ['chat-2'] } }, 1000);
    await store.put('project-1', 'chat-1', { kind: 'wake-parent', payload: { taskId: 'task-1' } }, 1001);
    await store.prune('project-1', new Set(['chat-2']));
    expect(store.list().map((entry) => entry.kind)).toEqual(['end-children']);
});
