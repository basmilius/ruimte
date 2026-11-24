import { describe, expect, test } from 'bun:test';
import { createTestServer } from '@ruimte/extension/testing';
import manifest from '../manifest.json';
import type { HarborServer } from '../server';

const COMPOSE = [
    '# The services of the shop',
    'services:',
    '  web:',
    '    command: bun run dev',
    '    port: 5173',
    '  migrate:',
    '    command: bun run migrate',
    '    kind: task',
    '    workdir: api',
    '  Unnamed Service:',
    '    command: never listed',
    ''
].join('\n');
const MACHINE = [
    'machine:',
    '  name: workbench',
    '  image: harbor/workbench:1',
    '  prepare: sh scripts/prepare.sh',
    '  start: sh scripts/start.sh',
    '  login: sh scripts/login.sh',
    ''
].join('\n');
const PERMISSIONS: Record<string, string> = manifest.permissions;
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
        const permissions = { 'launches.provide': 'Lists', 'machines.provide': 'Lists', 'terminals.profiles': 'Adds a shell' };
        const server = await createTestServer<HarborServer>({ manifest: { permissions } });

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
            'This extension uses a part of Ruimte that is not final yet (terminalProfiles, launchSources, machineSources). It works while its author develops it, and an installed extension cannot use it.'
        );
    });

    test('lists the services of harbor.yaml as launches Ruimte starts, each with the digest of the file', async () => {
        const server = await createTestServer<HarborServer>({ files: { 'harbor.yaml': COMPOSE } });
        const source = server.launchSource('compose');
        const launches = await source.list();

        expect(source.title).toBe('Harbor');
        expect(launches).toEqual([
            {
                id: 'web',
                name: 'web',
                kind: 'service',
                spawn: { command: 'sh', args: ['-c', 'bun run dev'], env: { HARBOR_SERVICE: 'web' } },
                fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
                port: 5173
            },
            {
                id: 'migrate',
                name: 'migrate',
                kind: 'task',
                spawn: { command: 'sh', args: ['-c', 'bun run migrate'], env: { HARBOR_SERVICE: 'migrate' }, cwd: 'api' },
                fingerprint: launches[0]?.fingerprint
            }
        ]);
        expect(server.asked.map((ask) => [ask.method, ask.args])).toEqual([
            ['files.readText', [{ id: 'project-1' }, 'harbor.yaml']],
            ['files.watch', [{ id: 'project-1' }, 'harbor.yaml']]
        ]);
    });

    test('tells Ruimte when harbor.yaml changed, and then lists it under another digest, which asks the person again', async () => {
        const server = await createTestServer<HarborServer>({ files: { 'harbor.yaml': COMPOSE } });
        const source = server.launchSource('compose');
        const [before] = await source.list();

        server.writeFile('src/app.ts', 'export {};\n');

        expect(source.changes).toBe(0);

        server.writeFile('harbor.yaml', COMPOSE.replace('bun run dev', 'bun run dev --host'));

        expect(source.changes).toBe(1);

        const [after] = await source.list();

        expect(after?.spawn.args).toEqual(['-c', 'bun run dev --host']);
        expect(after?.fingerprint).not.toBe(before?.fingerprint);

        // A comment changes no command, and the file a person approved is still another file.
        server.writeFile('harbor.yaml', `# Reviewed\n${COMPOSE}`);

        const [commented] = await source.list();

        expect(commented?.spawn).toEqual(before?.spawn);
        expect(commented?.fingerprint).not.toBe(before?.fingerprint);
    });

    test('lists nothing in a project without harbor.yaml, and still hears when one is written', async () => {
        const server = await createTestServer<HarborServer>();
        const source = server.launchSource('compose');

        expect(await source.list()).toEqual([]);

        server.writeFile('harbor.yaml', COMPOSE);

        expect(source.changes).toBe(1);
        expect((await source.list()).map((launch) => launch.id)).toEqual(['web', 'migrate']);
    });

    test('follows the launches of its own services to say which run, and no launch of anything else', async () => {
        const server = await createTestServer<HarborServer>();
        const project = { id: 'project-1' };

        server.fire('launch.status', { project, launch: 'dev.harbor:compose:web', state: 'starting', exitCode: null });
        server.fire('launch.status', { project, launch: 'dev', state: 'running', exitCode: null });
        server.fire('launch.status', { project, launch: 'dev.harbor:compose:migrate', state: 'running', exitCode: null });

        expect(await server.call('running', 'project-1')).toEqual({ ok: true, value: ['web', 'migrate'] });

        server.fire('launch.status', { project, launch: 'dev.harbor:compose:migrate', state: 'exited', exitCode: 0 });

        expect(await server.call('running', 'project-1')).toEqual({ ok: true, value: ['web'] });
        expect(await server.call('running', 'another')).toEqual({ ok: true, value: [] });
        expect(server.emitted.at(-1)).toEqual({ name: 'harbor.running', payload: { projectId: 'project-1', services: ['web'] } });
    });

    test('reads no file and follows no launch without the permission of each, and says so in its log', async () => {
        const permissions = { 'launches.provide': 'Lists', 'machines.provide': 'Lists', 'terminals.profiles': 'Adds a shell' };
        const server = await createTestServer<HarborServer>({ manifest: { permissions }, files: { 'harbor.yaml': COMPOSE } });

        expect(await server.launchSource('compose').list()).toEqual([]);

        server.fire('launch.status', { project: { id: 'project-1' }, launch: 'dev.harbor:compose:web', state: 'running', exitCode: null });

        expect(await server.call('running', 'project-1')).toEqual({ ok: true, value: [] });
        expect(server.logs).toEqual([
            'launch.status needs the permission launches.read in manifest.json',
            'files.readText answered permission-denied: dev.harbor did not ask for the permission files.read in its manifest',
            'files.watch answered permission-denied: dev.harbor did not ask for the permission files.read in its manifest',
            'Harbor does not follow harbor.yaml: dev.harbor did not ask for the permission files.read in its manifest'
        ]);
    });

    test('lists the machine of harbor.yaml as a place Ruimte can start one in, and none for a file without it', async () => {
        const server = await createTestServer<HarborServer>({ files: { 'harbor.yaml': `${COMPOSE}${MACHINE}` } });
        const source = server.machineSource('compose-machine');

        expect(source.title).toBe('Harbor');
        expect(await source.list()).toEqual([{ id: 'workbench', title: 'workbench', place: 'harbor/workbench:1', running: false }]);

        server.writeFile('harbor.yaml', COMPOSE);

        expect(await source.list()).toEqual([]);
    });

    test('describes the shell lines of the file as the steps of a start, with its sign-in last and the digest of the file', async () => {
        const server = await createTestServer<HarborServer>({ files: { 'harbor.yaml': `${COMPOSE}${MACHINE}` } });
        const source = server.machineSource('compose-machine');
        const env = { HARBOR_MACHINE: 'workbench' };
        const { start, reports } = await source.start('workbench');

        expect(reports).toEqual(['Reading harbor.yaml']);
        expect(start).toEqual({
            steps: [
                { title: 'Prepare workbench', spawn: { command: 'sh', args: ['-c', 'sh scripts/prepare.sh'], env } },
                { title: 'Start workbench', spawn: { command: 'sh', args: ['-c', 'sh scripts/start.sh'], env } }
            ],
            login: { command: 'sh', args: ['-c', 'sh scripts/login.sh'], env },
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
        });
        // It described and ran nothing: all it asked the machine was to read the file.
        expect(new Set(server.asked.map((ask) => ask.method))).toEqual(new Set(['files.readText']));

        server.writeFile('harbor.yaml', `# Reviewed\n${COMPOSE}${MACHINE}`);

        expect((await source.start('workbench')).start.fingerprint).not.toBe(start.fingerprint);
    });

    test('describes a start without a sign-in or a preparation the file leaves out', async () => {
        const server = await createTestServer<HarborServer>({ files: { 'harbor.yaml': 'machine:\n  name: bare\n  start: sh up.sh\n' } });
        const source = server.machineSource('compose-machine');

        expect(await source.list()).toEqual([{ id: 'bare', title: 'bare', place: 'harbor.yaml', running: false }]);
        expect((await source.start('bare')).start).toEqual({
            steps: [{ title: 'Start bare', spawn: { command: 'sh', args: ['-c', 'sh up.sh'], env: { HARBOR_MACHINE: 'bare' } } }],
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
        });
    });

    test('defines no machine source its manifest does not ask the permission for', async () => {
        const { 'machines.provide': _, ...permissions } = PERMISSIONS;

        await expect(createTestServer<HarborServer>({ manifest: { permissions } })).rejects.toThrow(
            'dev.harbor did not ask for the permission machines.provide in its manifest'
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
