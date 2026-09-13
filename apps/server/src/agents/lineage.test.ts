import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLineageStore } from './lineage.ts';

let home: string;
let store: AgentLineageStore;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-lineage-'));
    store = new AgentLineageStore(home);
    await store.load();
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

test('a node nobody wrote down is depth 0, which is where a person starts a chain', () => {
    expect(store.depthOf('terminal-1')).toBe(0);
    expect(store.openedCount('terminal-1')).toBe(0);
});

test('what one caller opened is counted, per caller', async () => {
    await store.put('p1', 'terminal-2', 'terminal-1', 1);
    await store.put('p1', 'terminal-3', 'terminal-1', 1);
    await store.put('p1', 'terminal-4', 'terminal-2', 2);
    expect(store.openedCount('terminal-1')).toBe(2);
    expect(store.openedCount('terminal-2')).toBe(1);
    expect([store.depthOf('terminal-3'), store.depthOf('terminal-4')]).toEqual([1, 2]);
});

test('a restart reads the depths back, so a loop cannot start counting over', async () => {
    await store.put('p1', 'terminal-2', 'terminal-1', 1);
    const restarted = new AgentLineageStore(home);
    await restarted.load();
    expect(restarted.depthOf('terminal-2')).toBe(1);
    expect(restarted.openedCount('terminal-1')).toBe(1);
});

test('a file that is not ours or not JSON is skipped rather than fatal', async () => {
    await store.put('p1', 'terminal-2', 'terminal-1', 1);
    await writeFile(join(store.dir, 'notes.txt'), 'x');
    await writeFile(join(store.dir, 'broken.json'), '{');
    await writeFile(join(store.dir, 'other.json'), JSON.stringify({ nodeId: 'x' }));
    const restarted = new AgentLineageStore(home);
    await restarted.load();
    expect(restarted.depthOf('terminal-2')).toBe(1);
    expect(restarted.depthOf('x')).toBe(0);
});

test('a node the project no longer has is pruned, and its opener may open again', async () => {
    await store.put('p1', 'terminal-2', 'terminal-1', 1);
    await store.put('p2', 'terminal-9', 'terminal-8', 1);
    await store.prune('p1', new Set(['terminal-1']));
    expect(store.openedCount('terminal-1')).toBe(0);
    // Another project's records are none of this project's business.
    expect(store.openedCount('terminal-8')).toBe(1);
    expect(await readdir(store.dir)).toEqual([`${encodeURIComponent('terminal-9')}.json`]);
});

test('loading an empty home is not an error', async () => {
    const fresh = new AgentLineageStore(join(home, 'nothing'));
    await fresh.load();
    expect(fresh.depthOf('terminal-1')).toBe(0);
});
