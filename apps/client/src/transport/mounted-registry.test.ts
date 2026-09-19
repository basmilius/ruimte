import { describe, expect, test } from 'bun:test';
import { HandlerTable } from './handler-table';
import { MountedRegistry } from './mounted-registry';

interface Node {
    attached: boolean;
}

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
        mounted.set('a', { attached: false });
        mounted.set('b', { attached: false });
        const asked: string[] = [];

        await mounted.reattachAll(async (id) => {
            asked.push(id);
            mounted.delete('b');
        });

        expect(asked).toEqual(['a']);
    });
});

describe('the handlers a client fans a stream out to', () => {
    test('every listener of one id hears it and no listener of another does', () => {
        const table = new HandlerTable<string>();
        const heard: string[] = [];
        table.listen('a', (value) => heard.push(`one ${value}`));
        table.listen('a', (value) => heard.push(`two ${value}`));
        table.listen('b', (value) => heard.push(`other ${value}`));

        table.fanOut('a', 'frame');

        expect(heard).toEqual(['one frame', 'two frame']);
    });

    test('a listener that stops hears nothing more, and an id nobody listens to is quiet', () => {
        const table = new HandlerTable<string>();
        const heard: string[] = [];
        const stop = table.listen('a', (value) => heard.push(value));

        table.fanOut('a', 'first');
        stop();
        table.fanOut('a', 'second');
        table.fanOut('nobody', 'third');

        expect(heard).toEqual(['first']);
    });

    // A frame handler that unsubscribes itself used to change the set being walked.
    test('a listener that stops while it runs does not cut the fan-out short', () => {
        const table = new HandlerTable<string>();
        const heard: string[] = [];
        const stop = table.listen('a', (value) => {
            heard.push(`first ${value}`);
            stop();
        });
        table.listen('a', (value) => heard.push(`second ${value}`));

        table.fanOut('a', 'frame');

        expect(heard).toEqual(['first frame', 'second frame']);
    });
});
