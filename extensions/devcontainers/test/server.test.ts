import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { namesOf } from '@ruimte/devcontainer';
import { createTestServer } from '@ruimte/extension/testing';

const CHECKOUT = '/src/ruimte';
const ARCH = process.arch === 'x64' ? 'x64' : 'arm64';
const BUILT = `${CHECKOUT}/apps/server/dist/linux-${ARCH}`;
const PROJECT = { id: 'project-1', name: 'Shop', folder: '/work/shop' };
const FILE = '.devcontainer/devcontainer.json';
const IMAGE = ['// The shop', '{', '    "name": "Shop container",', '    "image": "node:22",', '    "customizations": {},', '}'].join('\n');
const DOCKERFILE = {
    [FILE]: JSON.stringify({
        build: { dockerfile: 'Dockerfile', context: '..', args: { NODE: '22' } },
        remoteUser: 'node',
        containerEnv: { MODE: 'dev' },
        mounts: ['type=volume,source=shop-cache,target=/cache'],
        forwardPorts: [3000],
        postCreateCommand: ['npm', 'ci']
    }),
    '.devcontainer/Dockerfile': 'FROM node:22\n'
};

let checkoutBefore: string | undefined;

beforeEach(() => {
    checkoutBefore = process.env.RUIMTE_DEV_CHECKOUT;
    process.env.RUIMTE_DEV_CHECKOUT = CHECKOUT;
});

afterEach(() => {
    if (checkoutBefore === undefined) {
        delete process.env.RUIMTE_DEV_CHECKOUT;
    } else {
        process.env.RUIMTE_DEV_CHECKOUT = checkoutBefore;
    }
});

async function sourceOf(files: Record<string, string>, project = PROJECT) {
    const server = await createTestServer({ files, project });

    return { server, source: server.machineSource('devcontainer') };
}

describe('the names Dev Containers gives what it makes', () => {
    test('come from the project folder, readable and the same on every start', async () => {
        const names = await namesOf('/work/My Shop (v2)');

        expect(names.container).toMatch(/^ruimte-devcontainer-my-shop-v2-[0-9a-f]{8}$/);
        expect(names).toEqual({
            container: names.container,
            image: names.container,
            machineVolume: `${names.container}-machine`,
            loginVolume: `${names.container}-logins`,
            ports: { first: names.ports.first, last: names.ports.first + 9 }
        });
        expect(names.ports.first % 10).toBe(0);
        expect(names.ports.first).toBeGreaterThanOrEqual(44_000);
        expect(names.ports.last).toBeLessThan(49_000);
        expect(await namesOf('/work/My Shop (v2)')).toEqual(names);
    });

    test('keep two folders with the same name apart, and name a folder without letters too', async () => {
        const first = await namesOf('/work/shop');
        const second = await namesOf('/elsewhere/shop');

        expect(first.container).not.toBe(second.container);
        expect(first.machineVolume).not.toBe(second.machineVolume);
        expect((await namesOf('/work/___')).container).toMatch(/^ruimte-devcontainer-project-[0-9a-f]{8}$/);
    });
});

describe('Dev Containers on the machine', () => {
    test('lists the dev container of a project under the name of its file, and none without a file', async () => {
        const { server, source } = await sourceOf({ [FILE]: IMAGE });
        const { container } = await namesOf(PROJECT.folder);

        expect(source.title).toBe('Dev Containers');
        expect(await source.list()).toEqual([{ id: 'devcontainer', title: 'Shop container', place: container, running: false }]);

        server.writeFile(FILE, '{ "image": "node:22" }');

        expect(await source.list()).toEqual([{ id: 'devcontainer', title: 'Shop', place: container, running: false }]);
        expect(await (await sourceOf({})).source.list()).toEqual([]);
    });

    test('finds the file in the project folder itself too, and takes the one in .devcontainer first', async () => {
        const { server, source } = await sourceOf({ '.devcontainer.json': '{ "name": "Loose", "image": "node:22" }' });

        expect((await source.list())[0]?.title).toBe('Loose');

        server.writeFile(FILE, '{ "name": "Foldered", "image": "node:22" }');

        expect((await source.list())[0]?.title).toBe('Foldered');
    });

    test('lists a file it cannot start with the reason, and starts nothing for it', async () => {
        const { source } = await sourceOf({ [FILE]: '{ "name": "Shop", "image": "node:22", "features": { "ghcr.io/x/y:1": {} } }' });
        const reason = `${FILE}: it needs "features", which is not supported yet`;

        expect(await source.list()).toEqual([{ id: 'devcontainer', title: 'Shop', place: `Cannot start ${reason}`, running: false }]);
        await expect(source.start('devcontainer')).rejects.toThrow(`Dev Containers cannot start ${reason}`);
    });

    test('describes the start of an image: Ruimte for Linux, the image, the container with its volumes, and the machine in it', async () => {
        const { server, source } = await sourceOf({ [FILE]: IMAGE });
        const { container, ports } = await namesOf(PROJECT.folder);
        const range = `${ports.first}-${ports.last}`;
        const { start, reports } = await source.start('devcontainer');
        const ignored = `Ignoring what Dev Containers does not read in ${FILE}: customizations`;

        expect(reports).toEqual([`Reading ${FILE}`, ignored]);
        expect(server.logs).toContain(ignored);
        expect(start.steps.map((step) => step.title)).toEqual([
            'Build Ruimte for Linux from this checkout',
            'Pull node:22, unless it is here already',
            `Create the container ${container}, unless it is there as described`,
            'Start the container',
            'Prepare the container for Ruimte',
            'Check that Ruimte runs in the container',
            'Start Ruimte in the container'
        ]);

        const [build, pull, create, run, prepare, check, machine] = start.steps.map((step) => step.spawn);
        const madeFrom = create?.args?.[3] ?? '';

        expect(build).toEqual({ command: 'bun', args: [`${CHECKOUT}/apps/server/scripts/compile.ts`, '--target', `linux-${ARCH}`] });
        expect(pull).toEqual({ command: 'sh', args: ['-c', expect.stringContaining('docker pull "$0"'), 'node:22'] });
        expect(madeFrom).toMatch(/^[0-9a-f]{32}$/);
        expect(create).toEqual({
            command: 'sh',
            args: [
                '-c',
                expect.stringContaining('exec docker "$@"'),
                container,
                madeFrom,
                'create',
                '--name',
                container,
                '--label',
                `app.ruimte.devcontainer=${madeFrom}`,
                '--init',
                '--workdir',
                '/workspaces/shop',
                '--mount',
                'type=bind,source=/work/shop,target=/workspaces/shop',
                '--mount',
                `type=volume,source=${container}-machine,target=/var/lib/ruimte`,
                '--mount',
                `type=volume,source=${container}-logins,target=/var/lib/ruimte-logins`,
                '--mount',
                `type=bind,source=${BUILT},target=/opt/ruimte,readonly`,
                '--publish',
                `127.0.0.1:${range}:${range}/udp`,
                '--env',
                'RUIMTE_HOME=/var/lib/ruimte/home',
                '--env',
                'RUIMTE_LABEL=Shop container',
                '--env',
                'CLAUDE_CONFIG_DIR=/var/lib/ruimte-logins/claude',
                '--env',
                'CODEX_HOME=/var/lib/ruimte-logins/codex',
                '--env',
                'GROK_HOME=/var/lib/ruimte-logins/grok',
                '--env',
                'GEMINI_HOME=/var/lib/ruimte-logins/gemini',
                '--entrypoint',
                '/bin/sh',
                'node:22',
                '-c',
                'while sleep 1000; do :; done'
            ]
        });
        expect(run).toEqual({ command: 'docker', args: ['start', container] });
        expect(prepare).toEqual({
            command: 'docker',
            args: ['exec', '--user', '0', container, 'sh', '-c', expect.stringContaining('ln -sf /opt/ruimte/ruimte'), 'sh']
        });
        expect(check).toEqual({ command: 'docker', args: ['exec', container, 'ruimte', '--version'] });
        expect(machine).toEqual({
            command: 'docker',
            args: [
                'exec',
                '--detach',
                '--env',
                'RUIMTE_BROKER_URL',
                '--env',
                'RUIMTE_BROKER_ADVERTISE_URL',
                container,
                'sh',
                '-c',
                'exec ruimte --no-lan --direct-ports "$0" --direct-host-address 127.0.0.1 >>/var/lib/ruimte/machine.log 2>&1',
                range
            ]
        });
        expect(start.inside).toEqual({ command: 'docker', args: ['exec', container] });
        expect(start.fingerprint).toMatch(/^[0-9a-f]{64}$/);
        // It described and ran nothing: all it asked the machine was to read the file.
        expect(new Set(server.asked.map((ask) => ask.method))).toEqual(new Set(['files.readText']));
    });

    test('describes the start of a Dockerfile: the build, the user, and the command that runs once per container', async () => {
        const { source } = await sourceOf(DOCKERFILE);
        const { container, image } = await namesOf(PROJECT.folder);
        const { start } = await source.start('devcontainer');
        const spawnOf = (title: string) => start.steps.find((step) => step.title.startsWith(title))?.spawn;
        const create = spawnOf('Create the container')?.args ?? [];

        expect(spawnOf('Build the image from .devcontainer/Dockerfile')).toEqual({
            command: 'docker',
            args: ['build', '--tag', image, '--file', '.devcontainer/Dockerfile', '--build-arg', 'NODE=22', '.']
        });
        expect(create).toContain('type=volume,source=shop-cache,target=/cache');
        expect(create).toContain('127.0.0.1:3000:3000');
        expect(create.indexOf('MODE=dev')).toBeLessThan(create.indexOf('RUIMTE_HOME=/var/lib/ruimte/home'));
        expect(create.slice(-4)).toEqual(['/bin/sh', image, '-c', 'while sleep 1000; do :; done']);
        expect(spawnOf('Prepare the container')?.args?.slice(-2)).toEqual(['sh', 'node']);
        expect(spawnOf('Run postCreateCommand')).toEqual({
            command: 'docker',
            args: [
                'exec',
                '--user',
                'node',
                container,
                'sh',
                '-c',
                '[ -e "$0" ] || { "$@" && : > "$0"; }',
                '/var/lib/ruimte-container/post-create',
                'npm',
                'ci'
            ]
        });
        expect(spawnOf('Check that Ruimte runs')?.args?.slice(0, 4)).toEqual(['exec', '--user', 'node', container]);
        expect(spawnOf('Start Ruimte')?.args?.slice(0, 4)).toEqual(['exec', '--detach', '--user', 'node']);
        expect(start.inside).toEqual({ command: 'docker', args: ['exec', '--user', 'node', container] });
    });

    test('hands a postCreateCommand of one line to a shell in the container', async () => {
        const { source } = await sourceOf({ [FILE]: '{ "image": "node:22", "postCreateCommand": "npm ci && npm run build" }' });
        const { start } = await source.start('devcontainer');
        const command = start.steps.find((step) => step.title.startsWith('Run postCreateCommand'))?.spawn;

        expect(command?.args?.slice(-4)).toEqual(['/var/lib/ruimte-container/post-create', 'sh', '-c', 'npm ci && npm run build']);
    });

    test('describes the same start again for the same files, so a second start finds its container and volumes', async () => {
        const { source } = await sourceOf(DOCKERFILE);

        expect((await source.start('devcontainer')).start).toEqual((await source.start('devcontainer')).start);
    });

    test('asks again and makes the container again once the file or the Dockerfile it names changed', async () => {
        const { server, source } = await sourceOf(DOCKERFILE);
        const madeFromOf = (start: { steps: { spawn: { args?: string[] } }[] }) => start.steps[2]?.spawn.args?.[3];
        const { start: first } = await source.start('devcontainer');

        server.writeFile('.devcontainer/Dockerfile', 'FROM node:24\n');

        const { start: second } = await source.start('devcontainer');

        expect(second.fingerprint).not.toBe(first.fingerprint);
        expect(madeFromOf(second)).not.toBe(madeFromOf(first));
        // The names stay, so the machine in the new container is the one of the old.
        expect(second.inside).toEqual(first.inside);

        server.writeFile(FILE, `// Reviewed\n${DOCKERFILE[FILE]}`);

        expect((await source.start('devcontainer')).start.fingerprint).not.toBe(second.fingerprint);
    });

    test('starts nothing for a Dockerfile it cannot read', async () => {
        const { source } = await sourceOf({ [FILE]: DOCKERFILE[FILE] });

        await expect(source.start('devcontainer')).rejects.toThrow(`${FILE} names .devcontainer/Dockerfile, which cannot be read`);
    });

    test('keeps two projects apart in every name and port', async () => {
        const other = { id: 'project-2', name: 'Blog', folder: '/work/blog' };
        const { start: shop } = await (await sourceOf({ [FILE]: IMAGE })).source.start('devcontainer');
        const { start: blog } = await (await sourceOf({ [FILE]: IMAGE }, other)).source.start('devcontainer', { project: other });
        const madeOf = (start: typeof shop) => (start.steps[2]?.spawn.args ?? []).filter((arg) => /ruimte-devcontainer-|udp$/.test(arg));

        expect(madeOf(shop).filter((arg) => madeOf(blog).includes(arg))).toEqual([]);
        expect(madeOf(blog)).toHaveLength(madeOf(shop).length);
    });

    test('mounts nothing of this computer but the project folder and Ruimte for Linux, read only', async () => {
        const { source } = await sourceOf({ [FILE]: IMAGE });
        const { start } = await source.start('devcontainer');
        const binds = start.steps.flatMap((step) => step.spawn.args ?? []).filter((arg) => arg.startsWith('type=bind'));

        expect(binds).toEqual(['type=bind,source=/work/shop,target=/workspaces/shop', `type=bind,source=${BUILT},target=/opt/ruimte,readonly`]);
    });

    test('starts nothing in a Ruimte that has no build for Linux to put in a container', async () => {
        delete process.env.RUIMTE_DEV_CHECKOUT;

        const { source } = await sourceOf({ [FILE]: IMAGE });

        await expect(source.start('devcontainer')).rejects.toThrow('This Ruimte has no build for Linux to put in a container yet');
    });

    test('does not load as an extension a person installed, where a proposed part does not work', async () => {
        await expect(createTestServer({ provenance: 'installed' })).rejects.toThrow(
            'This extension uses a part of Ruimte that is not final yet (machineSources)'
        );
    });
});
