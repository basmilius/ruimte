import { expect, test } from 'bun:test';
import { NodeLifecycle } from './node-lifecycle.ts';

test('every listener of an event hears it, in the order they subscribed, and the others do not', async () => {
    const lifecycle = new NodeLifecycle();
    const heard: string[] = [];
    lifecycle.on('closed', (nodeId) => void heard.push(`first ${nodeId}`));
    lifecycle.on('closed', (nodeId) => void heard.push(`second ${nodeId}`));
    lifecycle.on('exited', (nodeId) => void heard.push(`exited ${nodeId}`));

    await lifecycle.emit('closed', 'chat-1');

    expect(heard).toEqual(['first chat-1', 'second chat-1']);
});

test('a sync listener has run when emit returns, and the promise waits for one that works on', async () => {
    const lifecycle = new NodeLifecycle();
    const done: string[] = [];
    let release: () => void = () => undefined;
    lifecycle.on('closed', async () => {
        await new Promise<void>((resolve) => {
            release = resolve;
        });
        done.push('slow');
    });
    lifecycle.on('closed', () => void done.push('sync'));

    const emitted = lifecycle.emit('closed', 'chat-1');
    expect(done).toEqual(['sync']);

    release();
    await emitted;
    expect(done).toEqual(['sync', 'slow']);
});

test('a listener that throws stops the rest and the error reaches the caller', () => {
    const lifecycle = new NodeLifecycle();
    const heard: string[] = [];
    lifecycle.on('turnEnded', () => {
        throw new Error('no');
    });
    lifecycle.on('turnEnded', () => void heard.push('late'));

    expect(() => lifecycle.emit('turnEnded', 'chat-1', 'done')).toThrow('no');
    expect(heard).toEqual([]);
});

test('the nodes a project still places reach the listeners with the project', async () => {
    const lifecycle = new NodeLifecycle();
    const seen: Array<[string, string[]]> = [];
    lifecycle.on('placed', (projectId, ids) => void seen.push([projectId, [...ids]]));

    await lifecycle.emit('placed', 'project-1', new Set(['a', 'b']));

    expect(seen).toEqual([['project-1', ['a', 'b']]]);
});
