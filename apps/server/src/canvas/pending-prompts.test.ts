import { beforeEach, expect, test } from 'bun:test';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { PendingPromptStore } from './pending-prompts.ts';

let home: string;

const newHome = tempHomes('ruimte-prompts-');

beforeEach(async () => {
    home = await newHome();
});

test('a brief and what a person picked survive a daemon that restarts before anyone mounts the node', async () => {
    const before = new PendingPromptStore(home);
    await before.put('p1', 'chat-a', 'use $report', { brief: 'publish it to Output', picked: { skills: ['report'], references: ['canvas-1'] } });

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

    await store.pruneLeftNodes('p1', new Set(['terminal-b']));
    expect(await store.take('terminal-a')).toBeNull();
    expect(await store.take('terminal-b')).toEqual({ prompt: 'b' });
    // Another project's prompts are none of this project's business.
    expect(await store.take('terminal-c')).toEqual({ prompt: 'c' });
});
