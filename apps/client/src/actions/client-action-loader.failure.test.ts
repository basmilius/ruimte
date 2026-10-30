import { expect, test } from 'bun:test';
import { reloadOnStaleChunk } from '@/stale-chunks';
import { useToasts } from '@/state/toasts';
import { memoryStorage } from '../../testing/memory-storage';
import { loadClientActionRegistry, onClientActionLoadError } from './client-action-loader';

const FAILURE = new Error('chunk unavailable');

// A failing import stands in for a chunk that cannot load; mocking the module would leak into other test files.
function failedImport(): Promise<never> {
    return Promise.reject(FAILURE);
}

test('failed action loads reload once beside a prefetch, report repeated failures, rethrow and unsubscribe', async () => {
    let heard = 0;
    let reloads = 0;
    const stopHearing = onClientActionLoadError(() => {
        heard += 1;
    });
    const stopRecovery = reloadOnStaleChunk({
        target: new EventTarget(),
        storage: memoryStorage(),
        reload: () => reloads++,
        build: 'action-load-test',
        prefetching: () => true,
        failedOpens: [onClientActionLoadError]
    });

    try {
        await expect(loadClientActionRegistry(failedImport)).rejects.toBe(FAILURE);
        expect(heard).toBe(1);
        expect(reloads).toBe(1);

        stopHearing();
        await expect(loadClientActionRegistry(failedImport)).rejects.toBe(FAILURE);
        expect(heard).toBe(1);
        expect(reloads).toBe(1);
        expect(useToasts.getState().toasts.filter((toast) => toast.id === 'action-load-failed')).toMatchObject([
            { kind: 'error', description: 'The action could not be loaded. Reload Ruimte and try again.' }
        ]);

        stopRecovery();
        await expect(loadClientActionRegistry(failedImport)).rejects.toBe(FAILURE);
        expect(reloads).toBe(1);
    } finally {
        stopHearing();
        stopRecovery();
        useToasts.getState().dismiss('action-load-failed');
    }
});
