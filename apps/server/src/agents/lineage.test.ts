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
    expect(store.madeBy('terminal-1')).toBeNull();
});

test('a plain node names its maker without counting against what may open agents', async () => {
    await store.put({ projectId: 'p1', nodeId: 'note-1', openedBy: 'terminal-1', depth: 0, agent: false });
    expect(store.madeBy('note-1')).toBe('terminal-1');
    expect(store.openedCount('terminal-1')).toBe(0);
});

test('a record from before plain nodes were written down is an agent node', async () => {
    await store.put({ projectId: 'p1', nodeId: 'terminal-2', openedBy: 'other', depth: 1, agent: true });
    await writeFile(
        join(store.dir, 'terminal-7.json'),
        JSON.stringify({ projectId: 'p1', nodeId: 'terminal-7', openedBy: 'terminal-1', depth: 1, createdAt: 1 })
    );
    const restarted = new AgentLineageStore(home);
    await restarted.load();
    expect(restarted.openedCount('terminal-1')).toBe(1);
});

test('what one caller opened is counted, per caller', async () => {
    await store.put({ projectId: 'p1', nodeId: 'terminal-2', openedBy: 'terminal-1', depth: 1, agent: true });
    await store.put({ projectId: 'p1', nodeId: 'terminal-3', openedBy: 'terminal-1', depth: 1, agent: true });
    await store.put({ projectId: 'p1', nodeId: 'terminal-4', openedBy: 'terminal-2', depth: 2, agent: true });
    expect(store.openedCount('terminal-1')).toBe(2);
    expect(store.openedCount('terminal-2')).toBe(1);
    expect([store.depthOf('terminal-3'), store.depthOf('terminal-4')]).toEqual([1, 2]);
});

test('a restart reads the depths back, so a loop cannot start counting over', async () => {
    await store.put({ projectId: 'p1', nodeId: 'terminal-2', openedBy: 'terminal-1', depth: 1, agent: true });
    const restarted = new AgentLineageStore(home);
    await restarted.load();
    expect(restarted.depthOf('terminal-2')).toBe(1);
    expect(restarted.openedCount('terminal-1')).toBe(1);
});

test('a file that is not ours or not JSON is skipped rather than fatal', async () => {
    await store.put({ projectId: 'p1', nodeId: 'terminal-2', openedBy: 'terminal-1', depth: 1, agent: true });
    await writeFile(join(store.dir, 'notes.txt'), 'x');
    await writeFile(join(store.dir, 'broken.json'), '{');
    await writeFile(join(store.dir, 'other.json'), JSON.stringify({ nodeId: 'x' }));
    const restarted = new AgentLineageStore(home);
    await restarted.load();
    expect(restarted.depthOf('terminal-2')).toBe(1);
    expect(restarted.depthOf('x')).toBe(0);
});

test('a node the project no longer has is pruned, and its opener may open again', async () => {
    await store.put({ projectId: 'p1', nodeId: 'terminal-2', openedBy: 'terminal-1', depth: 1, agent: true });
    await store.put({ projectId: 'p2', nodeId: 'terminal-9', openedBy: 'terminal-8', depth: 1, agent: true });
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

test('a fork keeps the depth of its original and lives on its own: no child, no count, no orphan and no maker', async () => {
    await store.put({ projectId: 'p1', nodeId: 'chat-a', openedBy: 'chat-root', depth: 1, agent: true });
    await store.put({ projectId: 'p1', nodeId: 'chat-b', openedBy: 'chat-a', depth: 1, agent: true, relation: 'fork' });
    await store.put({ projectId: 'p1', nodeId: 'chat-c', openedBy: 'chat-b', depth: 2, agent: true });
    expect(store.depthOf('chat-b')).toBe(1);
    expect(store.descendants('chat-a')).toEqual([]);
    expect(store.descendants('chat-b')).toEqual(['chat-c']);
    expect(store.openedCount('chat-a')).toBe(0);
    expect(store.madeBy('chat-b')).toBeNull();
    // The original left the canvas; the fork stays, while what the fork opened still counts as its own.
    expect(store.orphans('p1', new Set(['chat-b', 'chat-c']))).toEqual([]);
    const restarted = new AgentLineageStore(home);
    await restarted.load();
    expect(restarted.descendants('chat-a')).toEqual([]);
    await restarted.prune('p1', new Set(['chat-a']));
    expect(restarted.projectOf('chat-b')).toBeNull();
});
