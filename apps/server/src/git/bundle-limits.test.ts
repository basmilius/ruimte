import { beforeEach, describe, expect, test } from 'bun:test';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { BundleStore, bundleIdFor } from './bundles.ts';

let home: string;

const newHome = tempHomes('ruimte-bundle-limits-');

beforeEach(async () => {
    home = await newHome();
});

const piece = (size: number): Uint8Array => new Uint8Array(size);

/* Whether the file is there, without `made`, which counts as beginning to read it. */
function written(store: BundleStore, id: string): Promise<boolean> {
    return Bun.file(store.pathOf(id)).exists();
}

describe('the bundles one machine sends', () => {
    test('a finished transfer that nobody fetched still counts, so a third one is refused', async () => {
        const store = new BundleStore(home, 'machine-a', { bundles: 2, bytes: 1000 });
        await store.receive('first-one', 0, piece(10), 10);
        await store.receive('second-one', 0, piece(10), 10);
        await expect(store.receive('third-one', 0, piece(10), 10)).rejects.toMatchObject({ code: 'peer-bundle-limit' });
        await store.dropIncoming('first-one');
        await store.receive('third-one', 0, piece(10), 10);
    });

    test('results written for the machine do not take the place of a transfer, and have a limit of their own', async () => {
        const store = new BundleStore(home, 'machine-a', { bundles: 2, bytes: 1000, results: 3 });
        await store.receive('first-one', 0, piece(10), 10);
        for (const id of ['result-one', 'result-two', 'result-three']) {
            await Bun.write(store.pathOf(id), new Uint8Array(10));
            await store.keep(id, 'client-1');
        }
        await store.receive('second-one', 0, piece(10), 10);
        expect(await Promise.all(['result-one', 'result-two', 'result-three'].map((id) => written(store, id)))).not.toContain(false);
        await Bun.write(store.pathOf('result-four'), new Uint8Array(10));
        await store.keep('result-four', 'client-1');
        expect(await written(store, 'result-one')).toBe(false);
        expect(await written(store, 'result-four')).toBe(true);
    });

    test('evicts only bundles nobody began to read, so a reader of another client keeps its bundle', async () => {
        const store = new BundleStore(home, 'machine-a', { bundles: 2, bytes: 1000, results: 2 });
        for (const id of ['read-by-one', 'unread-of-two']) {
            await Bun.write(store.pathOf(id), new Uint8Array(10));
        }
        await store.keep('read-by-one', 'client-1');
        await store.keep('unread-of-two', 'client-2');
        expect(await store.made('read-by-one')).not.toBeNull();

        store.admit('client-3', 'being-made');
        await Bun.write(store.pathOf('newest'), new Uint8Array(10));
        await store.keep('newest', 'client-3');

        expect(await written(store, 'read-by-one')).toBe(true);
        expect(await written(store, 'unread-of-two')).toBe(false);
        expect(await written(store, 'newest')).toBe(true);
    });

    test('a place is held from the admit on, so two bundles made at once for one client cannot pass its share', () => {
        const store = new BundleStore(home);
        for (const id of ['first-one', 'second-one', 'third-one', 'fourth-one']) {
            store.admit('client-1', id);
        }
        expect(() => store.admit('client-1', 'fifth-one')).toThrow(expect.objectContaining({ code: 'bundle-limit' }));
    });

    test('sending the same bundle again replaces it instead of adding another', async () => {
        const store = new BundleStore(home, 'machine-a', { bundles: 2, bytes: 1000 });
        const id = bundleIdFor('task-1');
        await store.receive(id, 0, piece(10), 10);
        await store.receive(id, 0, piece(20), 20);
        await store.receive(id, 0, piece(30), 30);
        expect((await Bun.file(store.incomingPathOf(id)).arrayBuffer()).byteLength).toBe(30);
        await store.receive('another-one', 0, piece(10), 10);
    });

    test('the bytes count as well, finished or not', async () => {
        const store = new BundleStore(home, 'machine-a', { bundles: 8, bytes: 100 });
        await store.receive('first-one', 0, piece(60), 60);
        await expect(store.receive('second-one', 0, piece(10), 60)).rejects.toMatchObject({ code: 'peer-bundle-limit' });
        await store.receive('second-one', 0, piece(10), 40);
    });

    test('two transfers that begin together do not both take the last place', async () => {
        const store = new BundleStore(home, 'machine-a', { bundles: 1, bytes: 1000 });
        const results = await Promise.allSettled([store.receive('first-one', 0, piece(5), 10), store.receive('second-one', 0, piece(5), 10)]);
        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    });

    test('a person is not held to it, and an id a machine picks cannot reach a person or another machine', async () => {
        const person = new BundleStore(home);
        const first = new BundleStore(home, 'machine-a', { bundles: 1, bytes: 1000 });
        const second = new BundleStore(home, 'machine-b', { bundles: 1, bytes: 1000 });
        await person.receive('shared-id', 0, new Uint8Array([1, 2, 3]), 3);
        for (let i = 0; i < 5; i++) {
            await person.receive(`person-${i}`, 0, piece(1), 1);
        }
        await first.receive('shared-id', 0, new Uint8Array([9, 9]), 2);
        await second.receive('shared-id', 0, new Uint8Array([7]), 1);
        expect([...new Uint8Array(await Bun.file(person.incomingPathOf('shared-id')).arrayBuffer())]).toEqual([1, 2, 3]);
        expect([...new Uint8Array(await Bun.file(first.incomingPathOf('shared-id')).arrayBuffer())]).toEqual([9, 9]);
        expect([...new Uint8Array(await Bun.file(second.incomingPathOf('shared-id')).arrayBuffer())]).toEqual([7]);
    });
});

describe('the id of a piece of work', () => {
    test('is the same every time, differs per task and is a valid bundle id', () => {
        expect(bundleIdFor('task-1')).toBe(bundleIdFor('task-1'));
        expect(bundleIdFor('task-1')).not.toBe(bundleIdFor('task-2'));
        expect(BundleStore.isId(bundleIdFor('task-1'))).toBe(true);
    });
});
