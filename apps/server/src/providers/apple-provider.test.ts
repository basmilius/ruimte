import { expect, test } from 'bun:test';
import { ProviderRegistry } from './registry.ts';
import { withDefaults } from './accounts/accounts.ts';

test('the machine switch takes effect without restarting the registry or trusting cached detection', async () => {
    let enabled = false;
    const registry = new ProviderRegistry({ appleEnabled: () => enabled, detect: async () => ({ installed: true, version: 'ready' }) });
    expect((await registry.list()).find((provider) => provider.kind === 'apple')).toMatchObject({ installed: false, version: 'Disabled in Settings' });
    enabled = true;
    expect((await registry.list()).find((provider) => provider.kind === 'apple')?.installed).toBe(true);
    enabled = false;
    expect((await registry.list()).find((provider) => provider.kind === 'apple')?.installed).toBe(false);
    expect(() => registry.get('apple').createBackend({} as never, {} as never)).toThrow('Enable Apple Foundation Models');
    expect(withDefaults({}).apple).toEqual({ kind: 'apple' });
    expect(withDefaults({ apple: { kind: 'apple', label: 'Local' } }).apple).toEqual({ kind: 'apple', label: 'Local' });
});

test('turning the machine switch off while detection is in flight never publishes an available model', async () => {
    let enabled = true;
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const registry = new ProviderRegistry({
        appleEnabled: () => enabled,
        detect: async () => {
            await waiting;
            return { installed: true, version: 'ready' };
        }
    });
    const listing = registry.list();
    enabled = false;
    finish();
    expect((await listing).find((provider) => provider.kind === 'apple')?.installed).toBe(false);
});
