import { describe, expect, test } from 'bun:test';
import { MountedRegistry } from './mounted-registry';

interface Node {
    attached: boolean;
}

// Every promise callback queued so far has run by the next macrotask.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('what a client has mounted', () => {
    test('a lost link detaches everything and reports each one', () => {
        const mounted = new MountedRegistry<Node>();
        mounted.set('a', { attached: true });
        mounted.set('b', { attached: true });
        const told: string[] = [];

        mounted.detachAll((id) => told.push(id));

        expect(told).toEqual(['a', 'b']);
        expect([...mounted.values()].every((entry) => !entry.attached)).toBe(true);
    });

    test('a reconnect attaches what is not attached and leaves what is', async () => {
        const mounted = new MountedRegistry<Node>();
        mounted.set('a', { attached: false });
        mounted.set('b', { attached: true });
        const asked: string[] = [];

        await mounted.reattachAll(async (id, entry) => {
            asked.push(id);
            entry.attached = true;
        });

        expect(asked).toEqual(['a']);
    });

    // A node may leave the canvas while an attach is still on the wire; the next one is not its business.
    test('one that fails leaves the rest of the pass alone', async () => {
        const mounted = new MountedRegistry<Node>();
        mounted.set('a', { attached: false });
        mounted.set('b', { attached: false });
        const asked: string[] = [];

        await mounted.reattachAll((id) => {
            asked.push(id);
            return id === 'a' ? Promise.reject(new Error('the socket went')) : Promise.resolve();
        });

        expect(asked).toEqual(['a', 'b']);
    });

    test('an entry that unmounted before its turn is not attached again', async () => {
        const mounted = new MountedRegistry<Node>();
        for (const id of ['a', 'b', 'c', 'd', 'e']) {
            mounted.set(id, { attached: false });
        }
        const asked: string[] = [];

        await mounted.reattachAll(async (id) => {
            asked.push(id);
            mounted.delete('e');
        });

        expect(asked).toEqual(['a', 'b', 'c', 'd']);
    });

    test('attaches four at a time, in the order they were mounted', async () => {
        const mounted = new MountedRegistry<Node>();
        const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
        for (const id of ids) {
            mounted.set(id, { attached: false });
        }
        const started: string[] = [];
        const finish = new Map<string, () => void>();

        const pass = mounted.reattachAll(
            (id) =>
                new Promise<void>((resolve) => {
                    started.push(id);
                    finish.set(id, resolve);
                })
        );
        expect(started).toEqual(['a', 'b', 'c', 'd']);

        finish.get('b')!();
        await settle();
        expect(started).toEqual(['a', 'b', 'c', 'd', 'e']);

        for (const id of ids) {
            finish.get(id)?.();
            await settle();
        }
        await pass;
        expect(started).toEqual(ids);
    });
});
