import { describe, expect, test } from 'bun:test';
import { createTestServer } from '@ruimte/extension/testing';
import type { BeaconServer } from '../server';

describe('Beacon on the machine', () => {
    test('finds what the rules say of a page by its path, on any host, and nothing on a page it does not know', async () => {
        const server = await createTestServer<BeaconServer>();
        const home = await server.call('findings', 'https://shop.test/');
        const checkout = await server.call('findings', 'http://localhost:3000/checkout/');

        expect(home.ok && home.value.map((finding) => finding.rule)).toEqual(['contrast', 'alt-text']);
        expect(checkout.ok && checkout.value.map((finding) => finding.rule)).toEqual(['labels', 'errors', 'focus']);
        expect(await server.call('findings', 'http://localhost:3000/about')).toEqual({ ok: true, value: [] });
    });

    test('writes a report that says so when nothing was found', async () => {
        const server = await createTestServer<BeaconServer>();

        expect(await server.call('report', { title: 'Beacon: About', subject: '/about', state: [], findings: [], notes: [], summary: null })).toEqual({
            ok: true,
            value: '# Beacon: About\n\nChecked: /about\n\n## Findings (0)\n\nNothing found.\n'
        });
    });

    test('describes Beacon Inspector as an agent Ruimte starts over ACP, with the models of the account', async () => {
        const server = await createTestServer<BeaconServer>();

        expect(await server.agentProvider('inspector')).toEqual({
            kind: 'x-dev-beacon-inspector',
            name: 'Beacon Inspector',
            protocol: 'acp',
            spawn: { command: 'beacon-inspector', args: ['acp'], env: { BEACON_RULES: 'account' } },
            models: [
                { id: 'inspector-fast', name: 'Inspector Fast' },
                { id: 'inspector-deep', name: 'Inspector Deep' }
            ]
        });
    });

    test('describes no agent in an extension a person installed, where a proposed part does not work', async () => {
        await expect(createTestServer<BeaconServer>({ provenance: 'installed' })).rejects.toThrow(
            'This extension uses a part of Ruimte that is not final yet (agentProviders'
        );
    });
});
