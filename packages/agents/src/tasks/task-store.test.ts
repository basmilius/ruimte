import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore, type TaskEvent } from './task-store.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-task-store-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

// Records exactly as a Ruimte daemon before tasks moved into @ruimte/agents wrote them, every optional field set, so one updated in place reads them.
const WRITTEN = {
    'task-0a1b2c3d4e5f':
        '{"projectId":"project-1","parentId":"chat-lead","childId":"chat-a","title":"Lexer","prompt":"fix the lexer","batchId":"batch-1","id":"task-0a1b2c3d4e5f","status":"open","result":null,"createdAt":1000,"settledAt":null,"wake":"pending","paused":{"kind":"usage","until":5000}}',
    'task-0a1b2c3d4e60':
        '{"projectId":"project-1","parentId":"chat-lead","childId":"chat-b","title":"Docs","prompt":"write the docs","id":"task-0a1b2c3d4e60","status":"done","result":{"text":"written","source":"done","at":2000},"createdAt":1001,"settledAt":2000,"wake":"sent"}'
};

test('a task an older daemon wrote reads back whole, and settling it writes the fields it always had, in the order of the schema', async () => {
    await mkdir(join(home, 'tasks'), { recursive: true });
    for (const [id, text] of Object.entries(WRITTEN)) {
        await writeFile(join(home, 'tasks', `${id}.json`), text);
    }
    const store = new TaskStore(home);
    await store.load();
    expect(store.ofProject('project-1')).toEqual(Object.values(WRITTEN).map((text) => JSON.parse(text)));

    await store.settle('task-0a1b2c3d4e5f', 'failed', { text: 'stopped', source: 'exit', at: 3000 }, 3000);
    expect(await readFile(join(home, 'tasks', 'task-0a1b2c3d4e5f.json'), 'utf8')).toBe(
        '{"id":"task-0a1b2c3d4e5f","projectId":"project-1","parentId":"chat-lead","childId":"chat-a","title":"Lexer","prompt":"fix the lexer","batchId":"batch-1","status":"failed","result":{"text":"stopped","source":"exit","at":3000},"createdAt":1000,"settledAt":3000,"wake":"pending"}'
    );
});

test('a new task is written in the shape an older daemon reads, and every client hears it', async () => {
    const store = new TaskStore(home);
    const heard: TaskEvent[] = [];
    store.subscribe('client-1', (event) => heard.push(event));
    const task = await store.open({ projectId: 'project-1', parentId: 'chat-lead', childId: 'chat-b', title: 'Docs', prompt: 'write the docs' }, 1001);
    expect(task.id).toMatch(/^task-[0-9a-f]{12}$/);
    expect(await readFile(join(home, 'tasks', `${task.id}.json`), 'utf8')).toBe(
        `{"projectId":"project-1","parentId":"chat-lead","childId":"chat-b","title":"Docs","prompt":"write the docs","id":"${task.id}","status":"open","result":null,"createdAt":1001,"settledAt":null,"wake":"pending"}`
    );
    expect(heard).toEqual([{ event: 'task.changed', payload: { task } }]);
});
