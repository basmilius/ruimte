import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { folderWatches } from '@/state/fs-watch';
import type { HeldWatch } from '@/state/held-watches';
import { windowWorkspace } from '@/state/window';
import { ConnectionProvider } from '@/transport/ConnectionProvider';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../../testing/dom';
import { useFileRead } from './use-file-read';

function pending() {
    let resolve!: () => void;
    const promise = new Promise<Record<string, never>>((done) => {
        resolve = () => done({});
    });
    return { promise, resolve };
}

function Reader({ path }: { path: string }) {
    const { state } = useFileRead(path);
    return <output>{state.status === 'ready' && state.read.kind === 'text' ? state.read.text : state.status}</output>;
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let parent: HeldWatch;
let gates: ReturnType<typeof pending>[];

async function render(path: string): Promise<void> {
    await page.render(
        <ConnectionProvider connection={windowWorkspace()!.connection}>
            <Reader path={path} />
        </ConnectionProvider>
    );
}

beforeEach(async () => {
    machine = new FakeMachine();
    gates = [];
    machine.answer('fs.watch', ({ path }) => {
        if (path === '/watch-test') {
            return {};
        }
        const gate = pending();
        gates.push(gate);
        return gate.promise;
    });
    machine.answer('fs.read', () => ({ kind: 'text', text: 'fresh', encoding: 'utf-8', size: 5, mtime: 1 }) as const);
    workspace = await openFakeWorkspace(machine, { views: [] }, { activeViewId: null, views: {} });
    parent = folderWatches.watch(windowWorkspace()!.connection.endpointId, '/watch-test');
    await parent.ready;
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    parent.release();
    workspace.close();
});

test('a read follows a replacement readiness barrier before requesting file content', async () => {
    await render('/watch-test/src/file.txt');
    expect(gates).toHaveLength(1);
    await act(async () => parent.release());
    expect(gates).toHaveLength(2);
    await act(async () => gates[0]!.resolve());
    expect(machine.requests('fs.read')).toHaveLength(0);
    await act(async () => gates[1]!.resolve());
    await until(() => page.host.querySelector('output')?.textContent === 'fresh');
});

test('closing before readiness cancels the file request', async () => {
    await render('/watch-test/src/file.txt');
    await page.unmount();
    await act(async () => gates[0]!.resolve());
    expect(machine.requests('fs.read')).toHaveLength(0);
});

test('switching paths before readiness reads only the path still on screen', async () => {
    await render('/watch-test/src/first.txt');
    await render('/watch-test/src/second.txt');
    await act(async () => gates[0]!.resolve());
    await until(() => page.host.querySelector('output')?.textContent === 'fresh');
    expect(machine.requests('fs.read')).toEqual([{ path: '/watch-test/src/second.txt' }]);
});

test('an in-flight response from the old watch is not shown after its barrier changes', async () => {
    let finish!: () => void;
    const old = new Promise<{ kind: 'text'; text: string; encoding: 'utf-8'; size: number; mtime: number }>((resolve) => {
        finish = () => resolve({ kind: 'text', text: 'old', encoding: 'utf-8', size: 3, mtime: 1 });
    });
    let reads = 0;
    machine.answer('fs.read', () => (++reads === 1 ? old : Promise.resolve({ kind: 'text', text: 'fresh', encoding: 'utf-8', size: 5, mtime: 2 } as const)));
    await render('/watch-test/src/file.txt');
    await act(async () => gates[0]!.resolve());
    expect(reads).toBe(1);
    await act(async () => parent.release());
    await act(async () => finish());
    expect(page.host.querySelector('output')?.textContent).toBe('loading');
    await act(async () => gates[1]!.resolve());
    await until(() => page.host.querySelector('output')?.textContent === 'fresh');
});

test('a precise save re-reads its editor while unrelated files in the folder stay untouched', async () => {
    await render('/watch-test/src/file.txt');
    await act(async () => gates[0]!.resolve());
    await until(() => page.host.querySelector('output')?.textContent === 'fresh');

    await act(async () => {
        machine.emit('fs.changed', { root: '/watch-test', paths: ['/watch-test/src'], changedPaths: ['/watch-test/src/other.txt'] });
    });
    expect(machine.requests('fs.read')).toHaveLength(1);

    for (const changedPaths of [['/watch-test/src/file.txt'], ['/watch-test/src'], undefined]) {
        const before = machine.requests('fs.read').length;
        await act(async () => {
            machine.emit('fs.changed', { root: '/watch-test', paths: ['/watch-test/src'], ...(changedPaths === undefined ? {} : { changedPaths }) });
        });
        await until(() => machine.requests('fs.read').length === before + 1);
    }
});
