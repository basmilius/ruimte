import { describe, expect, test } from 'bun:test';
import { readDevcontainer, type Devcontainer } from './devcontainer.ts';
import { parseJsonc } from './jsonc.ts';

const PLACE = { file: '.devcontainer/devcontainer.json', folder: '/work/shop' };

function read(json: Record<string, unknown>, place = PLACE): Devcontainer {
    const result = readDevcontainer(JSON.stringify(json), place);

    if (!result.ok) {
        throw new Error(result.reason);
    }

    return result.value;
}

function reason(json: Record<string, unknown>): string {
    const result = readDevcontainer(JSON.stringify(json), PLACE);

    return result.ok ? '' : result.reason;
}

describe('JSON with comments', () => {
    test('reads past line and block comments and a comma after the last entry', () => {
        const text = [
            '// The shop',
            '{',
            '    "name": "Shop", // as people call it',
            '    /* The image',
            '       it starts from */',
            '    "image": "node:22",',
            '    "forwardPorts": [3000, 5173, /* none after */ ],',
            '}'
        ].join('\n');

        expect(parseJsonc(text)).toEqual({ name: 'Shop', image: 'node:22', forwardPorts: [3000, 5173] });
    });

    test('leaves what is in a text as it is, also what looks like a comment or a last comma', () => {
        const text = '{ "url": "https://example.test/a", "note": "a /* b */ c", "list": ",]", "quote": "say \\"//hi\\"" }';

        expect(parseJsonc(text)).toEqual({ url: 'https://example.test/a', note: 'a /* b */ c', list: ',]', quote: 'say "//hi"' });
    });

    test('throws for what is no JSON once the comments are out', () => {
        expect(() => parseJsonc('{ "image": }')).toThrow();
    });
});

describe('what Dev Containers reads from a devcontainer.json', () => {
    test('takes an image with the folder of the project mounted under its own name', () => {
        expect(read({ image: 'node:22' })).toEqual({
            name: null,
            image: 'node:22',
            build: null,
            workspaceFolder: '/workspaces/shop',
            workspaceMount: 'type=bind,source=/work/shop,target=/workspaces/shop',
            mounts: [],
            containerEnv: {},
            remoteUser: null,
            forwardPorts: [],
            postCreateCommand: null,
            ignored: []
        });
    });

    test('reads every key it supports, with the variables of the file filled in', () => {
        const devcontainer = read({
            $schema: 'https://example.test/schema.json',
            name: 'Shop',
            image: 'node:22',
            workspaceFolder: '/srv/${localWorkspaceFolderBasename}',
            workspaceMount: 'type=bind,source=${localWorkspaceFolder},target=/srv/shop',
            mounts: ['type=volume,source=shop-cache,target=${containerWorkspaceFolder}/.cache', { type: 'bind', source: '/work/shared', target: '/shared' }],
            containerEnv: { APP_HOME: '${containerWorkspaceFolder}', MODE: 'dev' },
            remoteUser: 'node',
            forwardPorts: [3000, '5173', 3000],
            postCreateCommand: 'cd ${containerWorkspaceFolder} && npm ci'
        });

        expect(devcontainer).toEqual({
            name: 'Shop',
            image: 'node:22',
            build: null,
            workspaceFolder: '/srv/shop',
            workspaceMount: 'type=bind,source=/work/shop,target=/srv/shop',
            mounts: ['type=volume,source=shop-cache,target=/srv/shop/.cache', 'type=bind,source=/work/shared,target=/shared'],
            containerEnv: { APP_HOME: '/srv/shop', MODE: 'dev' },
            remoteUser: 'node',
            forwardPorts: [3000, 5173],
            postCreateCommand: 'cd /srv/shop && npm ci',
            ignored: []
        });
    });

    test('reads a Dockerfile and its context from the folder the file is in, as paths from the project folder', () => {
        const build = { dockerfile: 'Dockerfile', context: '..', args: { NODE: '22' } };

        expect(read({ build }).build).toEqual({ dockerfile: '.devcontainer/Dockerfile', context: '.', args: { NODE: '22' } });
        expect(read({ build: { dockerfile: 'docker/Dockerfile' } }, { ...PLACE, file: '.devcontainer.json' }).build).toEqual({
            dockerfile: 'docker/Dockerfile',
            context: '.',
            args: {}
        });
        expect(read({ image: 'node:22', build }).image).toBeNull();
    });

    test('takes postCreateCommand as a program with its arguments too', () => {
        expect(read({ image: 'node:22', postCreateCommand: ['npm', 'ci', '--prefix', '${containerWorkspaceFolder}'] }).postCreateCommand).toEqual([
            'npm',
            'ci',
            '--prefix',
            '/workspaces/shop'
        ]);
    });

    test('names the keys it does not read, and starts the file anyway', () => {
        const devcontainer = read({
            image: 'node:22',
            customizations: { vscode: {} },
            runArgs: ['--network=host'],
            remoteEnv: { A: 'b' },
            features: {},
            build: { cacheFrom: 'x' }
        });

        expect(devcontainer.ignored).toEqual(['build.cacheFrom', 'customizations', 'remoteEnv', 'runArgs']);
    });

    test.each<[string, Record<string, unknown>, string]>([
        ['features', { image: 'node:22', features: { 'ghcr.io/x/y:1': {} } }, 'it needs "features", which is not supported yet'],
        [
            'a compose file and a hook',
            { dockerComposeFile: 'compose.yml', service: 'app', postStartCommand: 'npm start' },
            'it needs "dockerComposeFile", "postStartCommand", which are not supported yet'
        ],
        ['a build target', { build: { dockerfile: 'Dockerfile', target: 'dev' } }, 'it needs "build.target", which is not supported yet'],
        [
            'commands side by side',
            { image: 'node:22', postCreateCommand: { a: 'x', b: 'y' } },
            '"postCreateCommand" is neither one line nor a program with its arguments'
        ],
        ['neither an image nor a Dockerfile', { name: 'Shop' }, 'it names no "image" and no "build.dockerfile"'],
        [
            'a variable of this computer',
            { image: 'node:22', containerEnv: { HOME_HERE: '${localEnv:HOME}' } },
            'it uses ${localEnv:HOME}, which is not supported yet'
        ],
        [
            'a mount without a folder to open',
            { image: 'node:22', workspaceMount: 'type=bind,source=/a,target=/b' },
            'it has a "workspaceMount" and no "workspaceFolder"'
        ],
        ['a Dockerfile outside the project', { build: { dockerfile: '../../Dockerfile' } }, '"../../Dockerfile" is outside the project folder'],
        ['a port under a name', { image: 'node:22', forwardPorts: ['db:5432'] }, '"forwardPorts" holds "db:5432", and only a port number is forwarded'],
        ['a variable that is no name', { image: 'node:22', containerEnv: { 'A B': 'c' } }, '"containerEnv" names "A B", which is no name of a variable']
    ])('says why it cannot start a file with %s', (_what, json, expected) => {
        expect(reason(json)).toBe(expected);
    });

    test.each([
        'source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind',
        'type=bind,src=/Users/sam/.claude,target=/root/.claude',
        'type=bind,source=/Users/sam/.claude.json,target=/root/.claude.json',
        'type=bind,source=/home/sam/.codex,target=/root/.codex',
        'type=bind,source=/Users/sam/.ruimte,target=/root/.ruimte',
        'type=bind,source=/Users/sam/.ruimte-dev/local.key,target=/key'
    ])('keeps the engine, the sign-ins and the state of this computer out: %s', (mount) => {
        expect(reason({ image: 'node:22', mounts: [mount] })).toContain('which Dev Containers keeps out of a container');
    });

    test('says a file that is no JSON is none', () => {
        expect(readDevcontainer('{ "image": ', PLACE)).toEqual({ ok: false, reason: 'it is no JSON' });
        expect(readDevcontainer('[]', PLACE)).toEqual({ ok: false, reason: 'it is no JSON' });
    });
});
