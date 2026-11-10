import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import { textDrafts } from '@/state/text-drafts';
import { closeWithoutSaving, retryClose, useUnsavedClose, type PendingClose } from './unsaved-close';

const saves = spyOn(textDrafts, 'save');
const discards = spyOn(textDrafts, 'discard');

afterAll(() => {
    saves.mockRestore();
    discards.mockRestore();
});

afterEach(() => {
    saves.mockReset();
    discards.mockReset();
    useUnsavedClose.setState({ pending: null });
});

test('retry keeps only the files that still fail, without closing or discarding drafts', async () => {
    let closed = false;
    const pending: PendingClose = {
        endpointId: 'machine',
        paths: ['/a.ts', '/b.ts'],
        run: () => {
            closed = true;
        }
    };
    useUnsavedClose.setState({ pending });
    saves.mockImplementation(async (_endpoint, path) => path !== '/b.ts');
    await retryClose(pending);
    expect(useUnsavedClose.getState().pending?.paths).toEqual(['/b.ts']);
    expect(closed).toBe(false);
    expect(discards).not.toHaveBeenCalled();
    saves.mockResolvedValue(true);
    await retryClose(useUnsavedClose.getState().pending!);
    expect(closed).toBe(true);
    expect(useUnsavedClose.getState().pending).toBeNull();
});

test('a dismissed close cannot finish when an old save reply arrives', async () => {
    let resolve!: (saved: boolean) => void;
    let closed = false;
    const pending: PendingClose = {
        endpointId: 'machine',
        paths: ['/a.ts'],
        run: () => {
            closed = true;
        }
    };
    useUnsavedClose.setState({ pending });
    saves.mockImplementation(
        () =>
            new Promise<boolean>((yes) => {
                resolve = yes;
            })
    );
    const retry = retryClose(pending);
    useUnsavedClose.setState({ pending: null });
    resolve(true);
    await retry;
    expect(closed).toBe(false);
});

test('discard is explicit and limited to the failed files on their own machine', () => {
    let closed = false;
    discards.mockImplementation(() => undefined);
    closeWithoutSaving({
        endpointId: 'machine',
        paths: ['/a.ts', '/b.ts'],
        run: () => {
            closed = true;
        }
    });
    expect(discards.mock.calls).toEqual([
        ['machine', '/a.ts'],
        ['machine', '/b.ts']
    ]);
    expect(closed).toBe(true);
});
