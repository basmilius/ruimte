import { beforeEach, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { PendingPromptStore } from './pending-prompts.ts';

let home: string;

const newHome = tempHomes('ruimte-prompts-');

beforeEach(async () => {
    home = await newHome();
});

test('a prompt is delivered once and never again', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', 'terminal-a', 'say hello');
    expect(store.has('terminal-a')).toBe(true);
    expect(await store.take('terminal-a')).toEqual({ prompt: 'say hello' });
    expect(await store.take('terminal-a')).toBeNull();
    expect(store.has('terminal-a')).toBe(false);
});

test('two takers in the same tick cannot both get it', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', 'terminal-a', 'only once');
    const [first, second] = await Promise.all([store.take('terminal-a'), store.take('terminal-a')]);
    expect([first, second].filter((value) => value !== null)).toEqual([{ prompt: 'only once' }]);
});

test('a prompt and its brief survive a daemon that restarts before anyone mounts the node', async () => {
    const before = new PendingPromptStore(home);
    await before.put('p1', 'chat-a', 'start on the parser', 'publish it to Output');

    const after = new PendingPromptStore(home);
    await after.load();
    expect(await after.take('chat-a')).toEqual({ prompt: 'start on the parser', brief: 'publish it to Output' });
    // Taken, so the file is gone and a second restart hands out nothing.
    const again = new PendingPromptStore(home);
    await again.load();
    expect(await again.take('chat-a')).toBeNull();
});

test('what a person picked in a prompt survives a restart beside it', async () => {
    const before = new PendingPromptStore(home);
    await before.put('p1', 'chat-a', 'use $report', 'publish it to Output', { skills: ['report'], references: ['canvas-1'] });

    const after = new PendingPromptStore(home);
    await after.load();
    expect(await after.take('chat-a')).toEqual({
        prompt: 'use $report',
        brief: 'publish it to Output',
        picked: { skills: ['report'], references: ['canvas-1'] }
    });
});

test('a node that left the project takes its prompt with it, and the rest stays', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', 'terminal-a', 'a');
    await store.put('p1', 'terminal-b', 'b');
    await store.put('p2', 'terminal-c', 'c');

    await store.prune('p1', new Set(['terminal-b']));
    expect(await store.take('terminal-a')).toBeNull();
    expect(await store.take('terminal-b')).toEqual({ prompt: 'b' });
    // Another project's prompts are none of this project's business.
    expect(await store.take('terminal-c')).toEqual({ prompt: 'c' });
});

test('a file that is not a prompt is ignored rather than thrown over', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', 'terminal-a', 'a');
    await Bun.write(join(store.dir, 'junk.json'), '{ not json');
    await Bun.write(join(store.dir, 'other.json'), JSON.stringify({ nodeId: 'x' }));

    const after = new PendingPromptStore(home);
    await after.load();
    expect(await after.take('terminal-a')).toEqual({ prompt: 'a' });
    expect(await after.take('x')).toBeNull();
});

test('an id with a slash in it stays inside the directory', async () => {
    const store = new PendingPromptStore(home);
    await store.put('p1', '../escape/id', 'a');
    expect(await readdir(store.dir)).toEqual(['..%2Fescape%2Fid.json']);
    expect(await store.take('../escape/id')).toEqual({ prompt: 'a' });
});
