import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PendingPromptStore } from './pending-prompts.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-prompts-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

test('a prompt is delivered once and never again', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', 'terminal-a', 'say hello');
    expect(store.has('terminal-a')).toBe(true);
    expect(await store.take('terminal-a')).toBe('say hello');
    expect(await store.take('terminal-a')).toBeNull();
    expect(store.has('terminal-a')).toBe(false);
});

test('two takers in the same tick cannot both get it', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', 'terminal-a', 'only once');
    const [first, second] = await Promise.all([store.take('terminal-a'), store.take('terminal-a')]);
    expect([first, second].filter((value) => value !== null)).toEqual(['only once']);
});

test('a prompt survives a daemon that restarts before anyone mounts the node', async () => {
    const before = new PendingPromptStore(home);
    await before.put('p1', 'chat-a', 'start on the parser');

    const after = new PendingPromptStore(home);
    await after.load();
    expect(await after.take('chat-a')).toBe('start on the parser');
    // Taken, so the file is gone and a second restart hands out nothing.
    const again = new PendingPromptStore(home);
    await again.load();
    expect(await again.take('chat-a')).toBeNull();
});

test('the file goes with the prompt, so the directory does not grow', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', 'terminal-a', 'one');
    expect(await readdir(store.dir)).toHaveLength(1);
    await store.take('terminal-a');
    expect(await readdir(store.dir)).toHaveLength(0);
});

test('a node that left the project takes its prompt with it, and the rest stays', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', 'terminal-a', 'a');
    await store.put('p1', 'terminal-b', 'b');
    await store.put('p2', 'terminal-c', 'c');

    await store.prune('p1', new Set(['terminal-b']));
    expect(await store.take('terminal-a')).toBeNull();
    expect(await store.take('terminal-b')).toBe('b');
    // Another project's prompts are none of this project's business.
    expect(await store.take('terminal-c')).toBe('c');
});

test('a file that is not a prompt is ignored rather than thrown over', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', 'terminal-a', 'a');
    await Bun.write(join(store.dir, 'junk.json'), '{ not json');
    await Bun.write(join(store.dir, 'other.json'), JSON.stringify({ nodeId: 'x' }));

    const after = new PendingPromptStore(home);
    await after.load();
    expect(await after.take('terminal-a')).toBe('a');
    expect(await after.take('x')).toBeNull();
});

test('an id with a slash in it stays inside the directory', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', '../escape/id', 'a');
    expect(await readdir(store.dir)).toEqual(['..%2Fescape%2Fid.json']);
    expect(await store.take('../escape/id')).toBe('a');
});
