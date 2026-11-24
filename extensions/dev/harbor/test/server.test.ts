import { describe, expect, test } from 'bun:test';
import { createTestServer } from '@ruimte/extension/testing';
import type { HarborServer } from '../server';

const NOT_OPENED = { code: 'refused' as const, message: 'dev.harbor did not open the terminal shell-1, so it cannot type into it' };

describe('Harbor on the machine', () => {
    test("opens a shell through its profile in the project's service, and types the first command into it", async () => {
        const server = await createTestServer<HarborServer>({ storage: { 'service:project-1': 'api' } });

        expect(await server.call('openShell', 'project-1')).toEqual({ ok: true, value: { id: 'terminal-1' } });
        expect(server.terminals).toEqual([
            {
                id: 'terminal-1',
                openedBy: 'extension',
                needsYou: false,
                profile: 'service-shell',
                title: 'Harbor: api',
                spawn: { command: 'sh', env: { HARBOR_SERVICE: 'api', HARBOR_WORKDIR: '/srv/api' } },
                written: ['echo "Harbor: $HARBOR_SERVICE (harbor/api:4.2)"\n']
            }
        ]);
        expect(server.asked.map((ask) => ask.method)).toEqual(['terminals.open', 'terminals.write']);
    });

    test('names its profile for the menu of a new terminal, and describes a shell that knows its service', async () => {
        const server = await createTestServer<HarborServer>();
        const profile = server.profile('service-shell');

        expect([profile.title, profile.icon]).toEqual(['Harbor shell', 'container']);
        expect(await profile.available()).toBe(true);
        expect(await profile.spawn()).toEqual({ command: 'sh', env: { HARBOR_SERVICE: 'web', HARBOR_WORKDIR: '/app' } });

        server.storage['service:other'] = 'db';

        expect(await profile.spawn({ project: { id: 'other' } })).toEqual({
            command: 'sh',
            env: { HARBOR_SERVICE: 'db', HARBOR_WORKDIR: '/var/lib/postgresql' }
        });
    });

    test('types into no terminal a person opened, and into none the machine does not know', async () => {
        const server = await createTestServer<HarborServer>({ terminals: [{ id: 'shell-1' }] });

        expect(await server.call('type', 'shell-1', 'rm -rf .\n')).toEqual({ ok: true, value: NOT_OPENED });
        expect(await server.call('type', 'elsewhere', 'ls\n')).toMatchObject({ ok: true, value: { code: 'refused' } });
        expect(server.terminals[0]?.written).toEqual([]);
        expect(server.logs).toContain(`terminals.write answered refused: ${NOT_OPENED.message}`);
    });

    test('types into its own shell no more once an agent there waits for the person', async () => {
        const server = await createTestServer<HarborServer>();
        const opened = await server.call('openShell', 'project-1');
        const shell = server.terminals[0];

        expect(opened.ok && shell?.written).toHaveLength(1);

        if (shell !== undefined) {
            shell.needsYou = true;
        }

        expect(await server.call('type', 'terminal-1', 'y\n')).toEqual({
            ok: true,
            value: { code: 'refused', message: 'An agent in the terminal terminal-1 waits for the person, so nothing is typed into it' }
        });
        expect(shell?.written).toHaveLength(1);
    });

    test('opens no terminal and types into none without the permission of each', async () => {
        const server = await createTestServer<HarborServer>({ manifest: { permissions: { 'terminals.profiles': 'Adds a shell' } } });

        expect(await server.call('openShell', 'project-1')).toEqual({
            ok: false,
            error: { code: 'failed', message: 'dev.harbor did not ask for the permission canvas.write in its manifest' }
        });
        expect(await server.call('type', 'shell-1', 'ls\n')).toEqual({
            ok: true,
            value: { code: 'permission-denied', message: 'dev.harbor did not ask for the permission terminals.write in its manifest' }
        });
        expect(server.terminals).toEqual([]);
    });

    test('does not load as an extension a person installed, where a proposed part does not work', async () => {
        await expect(createTestServer<HarborServer>({ provenance: 'installed' })).rejects.toThrow(
            'This extension uses a part of Ruimte that is not final yet (terminalProfiles). It works while its author develops it, and an installed extension cannot use it.'
        );
    });

    test('defines no profile its manifest does not name as proposed, list or ask the permission for', async () => {
        const provides = { terminalProfiles: ['service-shell'] };

        await expect(createTestServer<HarborServer>({ manifest: { proposed: [] } })).rejects.toThrow(
            'defineTerminalProfile is still proposed; name terminalProfiles under proposed in manifest.json'
        );
        await expect(createTestServer<HarborServer>({ manifest: { provides: { terminalProfiles: ['another'] } } })).rejects.toThrow(
            'defineTerminalProfile got service-shell, which manifest.json does not list under provides.terminalProfiles'
        );
        await expect(createTestServer<HarborServer>({ manifest: { provides, permissions: {} } })).rejects.toThrow(
            'dev.harbor did not ask for the permission terminals.profiles in its manifest'
        );
    });
});
