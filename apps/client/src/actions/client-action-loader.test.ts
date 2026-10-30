import { expect, test } from 'bun:test';
import { loadClientActionRegistry, loadedClientActionRegistry } from './client-action-loader';

test('concurrent and later loads share the registry Voice imports', async () => {
    const [first, concurrent] = await Promise.all([loadClientActionRegistry(), loadClientActionRegistry()]);
    const direct = await import('./client-action-registry');
    const later = await loadClientActionRegistry();
    expect(first).toBe(concurrent);
    expect(first).toBe(direct.clientActions);
    expect(later).toBe(first);
    expect(loadedClientActionRegistry()).toBe(first);
});
