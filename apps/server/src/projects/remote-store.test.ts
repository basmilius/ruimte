import { beforeEach, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectCanvasView, ProjectContent } from '@ruimte/contracts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { RemoteStore, idsOf, machinesOf, withBoundMachines, withMachines, withoutMachines } from './remote-store.ts';

const newHome = tempHomes('ruimte-remote-');
let home: string;

beforeEach(async () => {
    home = await newHome();
});

function node(id: string, machine?: string): ProjectCanvasView['nodes'][number] {
    return { id, kind: 'terminal', title: id, x: 0, y: 0, w: 100, h: 100, ...(machine ? { machine } : {}) };
}

function content(...nodes: ProjectCanvasView['nodes']): ProjectContent {
    return {
        name: 'repo',
        color: '#7c74ff',
        views: [
            { kind: 'canvas', id: 'main', name: 'main', nodes, texts: [], edges: [], layouts: [] },
            { kind: 'terminal', id: 't1', name: 't1', node: {} }
        ]
    };
}

test('a binding set by a save is answered, kept across a restart, and written under the home', async () => {
    const store = new RemoteStore(home);
    await store.bind('p1', new Map([['n1', 'machine-b']]), new Set(['n1', 'n2']));
    expect(store.machineOf('p1', 'n1')).toBe('machine-b');
    expect(store.machineOf('p1', 'n2')).toBeNull();
    expect(store.machineOf('p2', 'n1')).toBeNull();
    expect(JSON.parse(await readFile(join(home, 'remote', 'p1.json'), 'utf8'))).toMatchObject({ links: [], nodes: { n1: 'machine-b' } });

    const restarted = new RemoteStore(home);
    await restarted.load();
    expect(restarted.machineOf('p1', 'n1')).toBe('machine-b');
});

test('a save that names nothing keeps the binding, and a node that left the document takes it along', async () => {
    const store = new RemoteStore(home);
    await store.bind('p1', new Map([['n1', 'machine-b']]), new Set(['n1']));
    await store.bind('p1', new Map(), new Set(['n1', 'n2']));
    expect(store.machineOf('p1', 'n1')).toBe('machine-b');
    await store.prune('p1', new Set(['n2']));
    expect(store.machineOf('p1', 'n1')).toBeNull();
    await expect(readFile(join(home, 'remote', 'p1.json'), 'utf8')).rejects.toThrow();
});

test('a machine named for a node the document does not hold binds nothing', async () => {
    const store = new RemoteStore(home);
    await store.bind('p1', new Map([['ghost', 'machine-b']]), new Set(['n1']));
    expect(store.nodesOf('p1')).toEqual({});
});

test('a key the file holds beyond the nodes survives a write', async () => {
    await new RemoteStore(home).bind('p1', new Map([['n1', 'machine-b']]), new Set(['n1']));
    const path = join(home, 'remote', 'p1.json');
    const written = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...written, links: [{ machineId: 'machine-b' }], future: true }));
    const store = new RemoteStore(home);
    await store.load();
    await store.bind('p1', new Map([['n2', 'machine-c']]), new Set(['n1', 'n2']));
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        links: [{ machineId: 'machine-b' }],
        future: true,
        nodes: { n1: 'machine-b', n2: 'machine-c' }
    });
});

test('a binding lives as long as its id is anywhere in the document', () => {
    expect([...idsOf(content(node('n1'), node('n2')))]).toEqual(['main', 'n1', 'n2', 't1']);
    expect([...machinesOf(content(node('n1', 'machine-b'), node('n2')))]).toEqual([['n1', 'machine-b']]);
});

test('the wire form names the machine of a bound node, and the daemon form names none', () => {
    const bare = content(node('n1'), node('n2'));
    const wire = withMachines(bare, { n1: 'machine-b' });
    expect(machinesOf(wire).get('n1')).toBe('machine-b');
    expect(machinesOf(wire).has('n2')).toBe(false);
    expect(machinesOf(withoutMachines(wire)).size).toBe(0);
});

test('a change keeps the machine the store holds and drops any other', () => {
    const changed = content(node('n1', 'machine-b'), node('n2', 'machine-b'), node('n3', 'machine-c'));
    expect([...machinesOf(withBoundMachines(changed, { n1: 'machine-b', n3: 'machine-b' }))]).toEqual([['n1', 'machine-b']]);
});
