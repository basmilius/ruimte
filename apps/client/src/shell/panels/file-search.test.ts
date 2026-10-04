import { expect, test } from 'bun:test';
import { FileSearch } from './file-search';

function deferred() {
    let resolve!: (value: { files: string[] }) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<{ files: string[] }>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

test('late results cannot replace newer results', async () => {
    const search = new FileSearch();
    const old = deferred();
    const first = search.search(() => old.promise);
    expect(await search.search(async () => ({ files: ['new'] }))).toEqual({ kind: 'ready', files: ['new'] });
    old.resolve({ files: ['old'] });
    expect(await first).toBeNull();
});

test('clearing a query or switching projects also retires errors', async () => {
    const search = new FileSearch();
    const pending = deferred();
    const result = search.search(() => pending.promise);
    search.invalidate();
    pending.reject(new Error('Offline'));
    expect(await result).toBeNull();
    expect(
        await search.search(async () => {
            throw new Error('Offline');
        })
    ).toEqual({ kind: 'error', message: 'Offline' });
    expect(await search.search(async () => ({ files: [] }))).toEqual({ kind: 'ready', files: [] });
});
