import { afterEach, describe, expect, test } from 'bun:test';
import { GatedHost, turnOver, type Plan } from './lifecycle-harness.ts';

const hosts: GatedHost[] = [];

function gatedHost(...plans: Plan[]): GatedHost {
    const gated = new GatedHost(plans.length === 0 ? [{ manifest: { id: 'acme.one' } }] : plans);

    hosts.push(gated);

    return gated;
}

/* How a call ended, without a rejection nobody waits for. */
function outcome<Value>(promise: Promise<Value>): Promise<{ value?: Value; error?: string }> {
    return promise.then(
        (value) => ({ value }),
        (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) })
    );
}

afterEach(() => hosts.splice(0).forEach((gated) => gated.host.stopAll()));

describe('ExtensionHost under forced orders', () => {
    test('a stop while a start waits on its folder ends that start, and a start after it runs alone', async () => {
        const { host, gates, children, overlaps } = gatedHost();
        const first = outcome(host.call('acme.one', 'add', []));

        await gates.release('store.get', 'acme.one');
        await gates.next('fs.mkdir');

        const relinking = host.linked('acme.one');

        await gates.release('store.link', 'acme.one');
        await relinking;

        const second = outcome(host.call('acme.one', 'add', []));

        await gates.drain();

        expect(await first).toEqual({ error: 'The extension stopped' });
        expect(await second).toEqual({ value: 1 });
        expect(children).toHaveLength(1);
        expect(overlaps).toEqual([]);
    });

    test('a second call joins a start that waits on its folder, and a disable ends both without a process', async () => {
        const gated = gatedHost();
        const { host, gates } = gated;
        const first = outcome(host.call('acme.one', 'add', []));

        await gates.release('store.get', 'acme.one');
        await gates.next('fs.mkdir');

        const second = outcome(host.call('acme.one', 'add', []));

        await gates.release('store.get', 'acme.one');

        const disabling = host.setEnabled('acme.one', false);

        await gates.drain();
        await disabling;

        expect(await first).toEqual({ error: 'The extension stopped' });
        expect(await second).toEqual({ error: 'The extension stopped' });
        expect(gated.children).toEqual([]);
    });

    test.each([
        ['disable', (gated: GatedHost) => gated.host.setEnabled('acme.one', false), 'acme.one is turned off'],
        ['removal', (gated: GatedHost) => gated.host.remove('acme.one'), 'No extension acme.one on this machine']
    ])('a call that read the store before a %s starts no process after it', async (_name, change, refusal) => {
        const gated = gatedHost();
        const { host, gates } = gated;
        const call = outcome(host.call('acme.one', 'add', []));
        const staleRead = await gates.next('store.get', 'acme.one');
        const changing = change(gated);

        await gates.drain((hold) => hold === staleRead);
        await changing;
        staleRead.release();
        await gates.drain();

        expect(await call).toEqual({ error: refusal });
        expect(gated.live('acme.one')).toEqual([]);
    });

    test('a language server added while a disable runs is gone once it is off', async () => {
        const gated = gatedHost({
            manifest: { id: 'acme.one', permissions: { 'languages.servers': 'Adds one' } },
            onLoad: (child) =>
                child.say({ type: 'ask', id: 1, method: 'languages.add', args: [{ name: 'one', command: 'one', languages: ['one'], patterns: [] }] })
        });
        const { host, gates } = gated;

        void outcome(host.call('acme.one', 'add', []));
        await gates.drain((hold) => hold.label === 'languages.add');

        const add = await gates.next('languages.add', 'acme.one');
        const disabling = host.setEnabled('acme.one', false);

        // The disable goes as far as it can before the add lands.
        await gates.drain((hold) => hold === add);
        add.release();
        await gates.drain();
        await disabling;

        expect(gated.enabled('acme.one')).toBe(false);
        expect(gated.languageServers.get('acme.one') ?? new Set()).toEqual(new Set());
        expect(gated.live('acme.one')).toEqual([]);
    });

    test('a tool its process named just before a disable is not listed after it', async () => {
        const gated = gatedHost({
            manifest: { id: 'acme.one', permissions: { 'agents.tools': 'Offers a tool' } },
            onLoad: (child) => child.say({ type: 'tool', name: 'fact', description: 'A fact', parameters: {} })
        });
        const { host, gates } = gated;
        const call = outcome(host.call('acme.one', 'add', []));

        await gates.release('store.get', 'acme.one');
        await gates.release('fs.mkdir');
        await gates.release('fs.write');
        await gates.release('process.ready', 'acme.one');

        // Whatever the host still waits on for the process held back until the disable is done.
        const before = new Set(gates.held);
        const disabling = host.setEnabled('acme.one', false);

        await gates.drain((hold) => before.has(hold));
        await disabling;
        await gates.drain();

        expect(host.agentTools()).toEqual([]);
        expect((await call).error).toBe('The extension stopped');
    });

    test('what a stopped process still says reaches nobody', async () => {
        const gated = gatedHost({ manifest: { id: 'acme.one', permissions: { 'chats.read': 'Counts chats' } } });
        const { host, gates } = gated;
        const heard: string[] = [];

        host.subscribe('client', (event) => heard.push(JSON.stringify(event)));

        const call = outcome(host.call('acme.one', 'add', []));

        await gates.drain();
        await call;

        const [child] = gated.children;

        const disabling = host.setEnabled('acme.one', false);

        await gates.drain();
        await disabling;
        heard.length = 0;
        child?.say({ type: 'emit', name: 'late', payload: {} });
        child?.say({ type: 'ask', id: 9, method: 'chats.list', args: [] });
        await turnOver();
        await gates.drain();

        expect(heard).toEqual([]);
        expect(child?.told.filter((message) => message.type === 'answer')).toEqual([]);
    });

    test('storage writes released in any order all stay, around a restart', async () => {
        const gated = gatedHost();
        const { host, gates } = gated;
        const writes = ['one', 'two', 'three'].map((key) => host.storageSet('acme.one', key, key));
        const restarting = host.linked('acme.one');

        // Each write waits on the one before it, so whichever step is let go first, they land in order.
        while (gates.held.length > 0) {
            gates.held[gates.held.length - 1]?.release();
            await turnOver();
        }

        await Promise.all([...writes, restarting]);
        gates.open.add('fs.read');

        expect(await Promise.all(['one', 'two', 'three'].map((key) => host.storageGet('acme.one', key)))).toEqual(['one', 'two', 'three']);
    });
});
