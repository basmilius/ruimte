import { afterEach, describe, expect, test } from 'bun:test';
import type { ExtensionManifest } from '@ruimte/contracts';
import { defineBuiltIn } from '@/extensions/built-ins';
import { startSharedStorage } from '@/shared-storage';
import { useContributions } from '@/state/extension-registry';
import { until } from '../../testing/dom';

const DISABLED_KEY = 'ruimte.builtIns.disabled';
const BUILT_IN_API = new URL('./host/built-in-api.ts', import.meta.url).pathname;
const address = window.location.href;
const takeOuts: (() => void)[] = [];

afterEach(() => {
    takeOuts.splice(0).forEach((takeOut) => takeOut());
    window.history.replaceState(null, '', address);
    localStorage.removeItem(DISABLED_KEY);
});

function manifest(id: string, permissions: Record<string, string> = {}): ExtensionManifest {
    return { id, name: id, version: '1.0.0', api: 1, permissions };
}

/* The API as a built-in's `@ruimte/extension/client` reaches it. */
async function apiOf(id: string): Promise<typeof import('./host/built-in-api')> {
    return (await import(`${BUILT_IN_API}?extension=${id}`)) as typeof import('./host/built-in-api');
}

/* A built-in whose entry adds a command through the public API, counting how often it ran. */
function counted(id: string, permissions?: Record<string, string>): { runs: number } {
    const count = { runs: 0 };

    takeOuts.push(
        defineBuiltIn({
            manifest: manifest(id, permissions),
            activate: async () => ({
                default: () => {
                    count.runs += 1;
                    void apiOf(id).then((api) => api.defineCommand({ id: 'hello', title: 'Hello', run: () => {} }));
                }
            })
        })
    );

    return count;
}

function commandOf(id: string): boolean {
    return useContributions.getState().commands.some((command) => command.id === `extension:${id}/hello`);
}

function turn(id: string, enabled: boolean): void {
    useContributions
        .getState()
        .builtIns.find((entry) => entry.id === id)
        ?.setEnabled(enabled);
}

describe('a built-in', () => {
    test('runs its entry on the public API, as an installed extension does', async () => {
        counted('acme.entry');
        await until(() => commandOf('acme.entry'));

        expect(commandOf('acme.entry')).toBe(true);
    });

    test('takes out what its entry defined when turned off, and runs the entry anew when turned on', async () => {
        const count = counted('acme.toggled');
        await until(() => commandOf('acme.toggled'));

        turn('acme.toggled', false);
        await until(() => !commandOf('acme.toggled'));

        expect(commandOf('acme.toggled')).toBe(false);

        turn('acme.toggled', true);
        await until(() => commandOf('acme.toggled'));

        expect(count.runs).toBe(2);
    });

    test('runs nothing that a person turned off before its entry came in', async () => {
        const count = counted('acme.overtaken');

        turn('acme.overtaken', false);
        // The start resumes once the loads came in, which this waits for too.
        await import('./host/loads');
        await Promise.resolve();

        expect(count.runs).toBe(0);
        expect(commandOf('acme.overtaken')).toBe(false);
    });

    test('holds to the permissions of its manifest', async () => {
        counted('acme.denied');
        await until(() => commandOf('acme.denied'));
        const api = await apiOf('acme.denied');

        expect((await api.chats.list()).ok).toBe(false);
    });

    test('reaches every name of the API an installed extension reaches', async () => {
        const { clientApiFor } = await import('./host/client-api');
        const installed = clientApiFor({ manifest: manifest('acme.names'), base: '/', disposers: [], settings: null });

        expect(Object.keys(await apiOf('acme.names')).sort()).toEqual(Object.keys(installed).sort());
    });

    test('runs nothing in safe mode', async () => {
        window.history.replaceState(null, '', '?safe-mode');
        const count = counted('acme.safe');
        await Promise.resolve();

        expect(count.runs).toBe(0);
    });

    test('follows another window that turns it off and on, without writing the list back', async () => {
        const stop = startSharedStorage();
        const count = counted('acme.followed');
        const otherWindow = (disabled: string[]): void => {
            localStorage.setItem(DISABLED_KEY, JSON.stringify(disabled));
            window.dispatchEvent(new StorageEvent('storage', { key: DISABLED_KEY }));
        };

        await until(() => commandOf('acme.followed'));
        otherWindow(['acme.followed']);
        await until(() => !commandOf('acme.followed'));
        otherWindow([]);
        await until(() => commandOf('acme.followed'));
        stop();

        expect(count.runs).toBe(2);
        expect(localStorage.getItem(DISABLED_KEY)).toBe('[]');
    });
});
