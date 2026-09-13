import { describe, expect, test } from 'bun:test';
import type { ProjectLocal } from '@ruimte/contracts';
import { CLIENT_LOCAL_LIMIT, overlayLocal, readClientLocal, writeClientLocal, type ClientLocalStorage } from './client-local';

const memory = (map = new Map<string, string>()): ClientLocalStorage & { map: Map<string, string> } => ({
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value)
});

const layout = {
    columns: [
        { size: 0.5, cells: [{ viewId: 'a', size: 1 }] },
        { size: 0.5, cells: [{ viewId: 'b', size: 1 }] }
    ],
    focus: { column: 1, cell: 0 }
};

const machine: ProjectLocal = {
    activeViewId: 'a',
    views: {
        a: { camera: { center: { x: 1, y: 1 }, zoom: 1 }, focusedNodeId: null },
        b: { camera: { center: { x: 2, y: 2 }, zoom: 1 }, focusedNodeId: null },
        c: { camera: { center: { x: 3, y: 3 }, zoom: 1 }, focusedNodeId: null }
    },
    panels: { panel: { open: true, kind: 'git' }, favicons: { 'browser-1': 'data:image/png;base64,AA' } }
};

describe('overlayLocal', () => {
    test('a project this client never saw opens the way the machine had it', () => {
        expect(overlayLocal(machine, null)).toBe(machine);
    });

    test("the grid, the panels and the open view of the client win, the favicons stay the machine's", () => {
        const client: ProjectLocal = {
            activeViewId: 'b',
            views: { b: { camera: { center: { x: 20, y: 20 }, zoom: 2 }, focusedNodeId: null } },
            panels: { panel: { open: false, kind: 'files' }, favicons: { 'browser-1': 'stale' } },
            layout
        };
        const overlaid = overlayLocal(machine, client);
        expect(overlaid.activeViewId).toBe('b');
        expect(overlaid.layout).toEqual(layout);
        expect(overlaid.panels).toEqual({ panel: { open: false, kind: 'files' }, favicons: { 'browser-1': 'data:image/png;base64,AA' } });
        expect(overlaid.views.b).toEqual(client.views.b);
    });

    test('a record without a grid is one cell, even when the machine has a split', () => {
        const overlaid = overlayLocal({ ...machine, layout }, { activeViewId: 'c', views: {} });
        expect(overlaid.layout).toBeUndefined();
        expect(overlaid.activeViewId).toBe('c');
        expect(overlaid.panels).toEqual({ favicons: machine.panels!.favicons });
    });

    test('a view this client has no camera for takes the one of the machine', () => {
        const client: ProjectLocal = {
            activeViewId: 'a',
            views: { a: { camera: null, focusedNodeId: null }, d: { camera: null, focusedNodeId: 'n1' } }
        };
        const overlaid = overlayLocal(machine, client);
        expect(overlaid.views.a).toEqual(machine.views.a);
        expect(overlaid.views.c).toEqual(machine.views.c);
        expect(overlaid.views.d).toEqual({ camera: null, focusedNodeId: 'n1' });
    });
});

describe("the client's own copy", () => {
    test('is kept per machine and project, without the favicons', () => {
        const storage = memory();
        writeClientLocal(storage, 'daemon-a', 'p1', machine);
        expect(readClientLocal(storage, 'daemon-a', 'p1')).toEqual({ ...machine, panels: { panel: { open: true, kind: 'git' } } });
        expect(readClientLocal(storage, 'daemon-b', 'p1')).toBeNull();
        expect(Object.keys(JSON.parse(storage.map.get('ruimte.local')!))).toEqual(['daemon-a:p1']);
    });

    test('something unreadable counts as nothing, and a broken row leaves the rest alone', () => {
        expect(readClientLocal(memory(new Map([['ruimte.local', 'nonsense']])), 'daemon-a', 'p1')).toBeNull();
        const storage = memory(
            new Map([['ruimte.local', JSON.stringify({ 'daemon-a:p1': { at: 1, local: { views: 'no' } }, 'daemon-a:p2': { at: 1, local: machine } })]])
        );
        expect(readClientLocal(storage, 'daemon-a', 'p1')).toBeNull();
        expect(readClientLocal(storage, 'daemon-a', 'p2')?.activeViewId).toBe('a');
    });

    test('holds at most the limit, and the project looked at longest ago goes first', () => {
        const storage = memory();
        for (let i = 0; i < CLIENT_LOCAL_LIMIT; i++) {
            writeClientLocal(storage, 'daemon-a', `p${i}`, machine, 1000 + i);
        }
        writeClientLocal(storage, 'daemon-a', 'p0', machine, 5000);
        writeClientLocal(storage, 'daemon-a', 'fresh', machine, 6000);
        const keys = Object.keys(JSON.parse(storage.map.get('ruimte.local')!));
        expect(keys).toHaveLength(CLIENT_LOCAL_LIMIT);
        expect(keys).toContain('daemon-a:p0');
        expect(keys).toContain('daemon-a:fresh');
        expect(keys).not.toContain('daemon-a:p1');
    });

    test('a full storage drops the oldest project and tries once more, then gives up quietly', () => {
        const map = new Map<string, string>();
        let refusals = 1;
        const storage: ClientLocalStorage = {
            getItem: (key) => map.get(key) ?? null,
            setItem: (key, value) => {
                if (refusals > 0) {
                    refusals -= 1;
                    throw new DOMException('full', 'QuotaExceededError');
                }
                map.set(key, value);
            }
        };
        map.set('ruimte.local', JSON.stringify({ 'daemon-a:old': { at: 1, local: machine }, 'daemon-a:newer': { at: 2, local: machine } }));
        writeClientLocal(storage, 'daemon-a', 'p1', machine, 3);
        expect(Object.keys(JSON.parse(map.get('ruimte.local')!)).sort()).toEqual(['daemon-a:newer', 'daemon-a:p1']);

        refusals = 2;
        expect(() => writeClientLocal(storage, 'daemon-a', 'p2', machine, 4)).not.toThrow();
        expect(readClientLocal(storage, 'daemon-a', 'p2')).toBeNull();
    });
});
