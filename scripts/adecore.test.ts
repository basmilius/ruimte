import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    awaitRelease,
    bumpCatalog,
    bumpPackages,
    catalogOf,
    catalogProblems,
    dockerCatalogDrift,
    lockedOffVersion,
    lockedPackages,
    type Registry,
    type RunCommand
} from './adecore.ts';

const repoRoot = join(import.meta.dir, '..');

const rootManifest = `{
    "name": "ruimte",
    "workspaces": {
        "packages": ["apps/*"],
        "catalog": {
            "@adecore/ui": "0.23.1",
            "@adecore/terminal": "0.23.1",
            "@adecore/agents": "0.23.1"
        }
    }
}
`;

const dockerManifest = `{
    "name": "ruimte-remote",
    "workspaces": {
        "packages": ["apps/server"],
        "catalog": {
            "@adecore/ui": "0.23.1",
            "@adecore/terminal": "0.23.1",
            "@adecore/agents": "0.23.1"
        }
    }
}
`;

const clientManifest = `{
    "name": "@ruimte/client",
    "dependencies": {
        "@adecore/ui": "catalog:",
        "@adecore/terminal": "catalog:",
        "react": "^19.3.0"
    },
    "devDependencies": {
        "@adecore/agents": "catalog:"
    }
}
`;

const serverManifest = `{
    "name": "@ruimte/server",
    "dependencies": {
        "@adecore/agents": "catalog:",
        "zod": "^4.6.5"
    }
}
`;

function write(path: string, text: string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
}

describe('the catalog', () => {
    test('is the default catalog under workspaces, and empty for a plain workspace list', () => {
        expect(catalogOf(JSON.parse(rootManifest))).toEqual({ '@adecore/ui': '0.23.1', '@adecore/terminal': '0.23.1', '@adecore/agents': '0.23.1' });
        expect(catalogOf({ name: 'ruimte', workspaces: ['apps/*'] })).toEqual({});
    });

    test('rewrites every ADE CORE entry and keeps the rest of the file as it was', () => {
        const { text, names } = bumpCatalog(rootManifest, '0.24.0');

        expect(names).toEqual(['@adecore/ui', '@adecore/terminal', '@adecore/agents']);
        expect(text).toBe(rootManifest.replaceAll('"0.23.1"', '"0.24.0"'));
    });

    test('leaves an entry that is not ADE CORE alone', () => {
        const manifest = rootManifest.replace('"@adecore/agents": "0.23.1"', '"@adecore/agents": "0.23.1",\n            "react": "^19.3.0"');

        expect(bumpCatalog(manifest, '0.24.0').text).toBe(manifest.replaceAll('"0.23.1"', '"0.24.0"'));
    });

    test('rewrites an entry that is on another version than the rest', () => {
        const { text } = bumpCatalog(rootManifest.replace('"@adecore/terminal": "0.23.1"', '"@adecore/terminal": "0.22.0"'), '0.24.0');

        expect(Object.values(catalogOf(JSON.parse(text)))).toEqual(['0.24.0', '0.24.0', '0.24.0']);
    });

    test('refuses an entry that is not an exact version', () => {
        expect(() => bumpCatalog(rootManifest.replace('"@adecore/ui": "0.23.1"', '"@adecore/ui": "^0.23.1"'), '0.24.0', 'package.json')).toThrow(
            'package.json: the catalog entry @adecore/ui is "^0.23.1", not an exact version.'
        );
    });

    test('leaves a dependency of the root on the catalog alone, and takes a prerelease', () => {
        const manifest = rootManifest.replace('"name": "ruimte",', '"name": "ruimte",\n    "devDependencies": { "@adecore/ui": "catalog:" },');

        expect(bumpCatalog(manifest, '0.25.0-next.1').text).toBe(manifest.replaceAll('"0.23.1"', '"0.25.0-next.1"'));
    });

    test('refuses when the same name appears outside the catalog', () => {
        const manifest = rootManifest.replace('"name": "ruimte",', '"name": "ruimte",\n    "overrides": { "@adecore/ui": "0.23.1" },');

        expect(() => bumpCatalog(manifest, '0.24.0')).toThrow('could not be rewritten without touching other fields');
    });

    test('names the locked ADE CORE packages on another version', () => {
        const lock = [
            '"@adecore/ui": ["@adecore/ui@0.24.0", "", {}, "sha512-a"],',
            '"@adecore/agents": ["@adecore/agents@0.24.0", "", { "dependencies": { "@adecore/plan": "0.23.1" } }, "sha512-b"],',
            '"@adecore/plan": ["@adecore/plan@0.23.1", "", {}, "sha512-c"],'
        ].join('\n');

        expect(lockedOffVersion(lock, '0.24.0')).toEqual(['@adecore/plan@0.23.1']);
    });

    test('names every locked ADE CORE package once, also one no catalog names', () => {
        const lock = [
            '"@adecore/editor": ["@adecore/editor@0.24.0", "", { "dependencies": { "@adecore/editor-core": "0.24.0" } }, "sha512-a"],',
            '"@adecore/editor-core": ["@adecore/editor-core@0.24.0", "", {}, "sha512-b"],',
            '"@adecore/editor/@adecore/editor-core": ["@adecore/editor-core@0.23.1", "", {}, "sha512-c"],'
        ].join('\n');

        expect(lockedPackages(lock)).toEqual(['@adecore/editor', '@adecore/editor-core']);
    });
});

describe('catalogProblems', () => {
    let root: string;

    beforeEach(() => {
        root = realpathSync(mkdtempSync(join(tmpdir(), 'ruimte-adecore-catalog-')));
        write(join(root, 'package.json'), rootManifest);
        write(join(root, 'apps/client/package.json'), clientManifest);
        write(join(root, 'apps/server/package.json'), serverManifest);
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('finds nothing when every workspace takes its version from the catalog', () => {
        expect(catalogProblems(root)).toEqual([]);
    });

    test('names a workspace that pins an ADE CORE package itself, in any section', () => {
        write(join(root, 'apps/client/package.json'), clientManifest.replace('"@adecore/ui": "catalog:"', '"@adecore/ui": "0.23.1"'));
        write(
            join(root, 'apps/server/package.json'),
            serverManifest.replace(
                '"zod"',
                '"@adecore/terminal": "^0.23.1"\n    },\n    "peerDependencies": {\n        "@adecore/ui": "workspace:*",\n        "zod"'
            )
        );

        expect(catalogProblems(root)).toEqual([
            'apps/client/package.json: @adecore/ui in dependencies is "0.23.1", not "catalog:"',
            'apps/server/package.json: @adecore/terminal in dependencies is "^0.23.1", not "catalog:"',
            'apps/server/package.json: @adecore/ui in peerDependencies is "workspace:*", not "catalog:"'
        ]);
    });

    test('names a package the catalog lacks', () => {
        write(join(root, 'apps/server/package.json'), serverManifest.replace('"zod"', '"@adecore/plan": "catalog:",\n        "zod"'));

        expect(catalogProblems(root)).toEqual(['apps/server/package.json: @adecore/plan in dependencies is missing from the catalog in package.json']);
    });

    test('names a catalog entry that is not an exact version', () => {
        write(join(root, 'package.json'), rootManifest.replace('"@adecore/ui": "0.23.1"', '"@adecore/ui": "latest"'));

        expect(catalogProblems(root)).toEqual(['package.json: the catalog entry @adecore/ui is "latest", not an exact version']);
    });

    test('names an ADE CORE package the root manifest pins outside the catalog', () => {
        write(join(root, 'package.json'), rootManifest.replace('"name": "ruimte",', '"name": "ruimte",\n    "devDependencies": { "@adecore/ui": "0.23.1" },'));

        expect(catalogProblems(root)).toEqual(['./package.json: @adecore/ui in devDependencies is "0.23.1", not "catalog:"']);
    });
});

describe('the daemon image catalog', () => {
    let root: string;

    beforeEach(() => {
        root = realpathSync(mkdtempSync(join(tmpdir(), 'ruimte-adecore-docker-')));
        write(join(root, 'package.json'), rootManifest);
        write(join(root, 'apps/server/docker/workspace-package.json'), dockerManifest);
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('has no drift while it lists what the root lists', () => {
        expect(dockerCatalogDrift(root)).toEqual([]);
    });

    test('names a version, a missing entry and an extra entry', () => {
        write(
            join(root, 'apps/server/docker/workspace-package.json'),
            dockerManifest.replace('"@adecore/ui": "0.23.1"', '"@adecore/ui": "0.23.0"').replace('"@adecore/terminal": "0.23.1",', '"@adecore/plan": "0.23.1",')
        );

        expect(dockerCatalogDrift(root)).toEqual([
            'apps/server/docker/workspace-package.json: @adecore/plan is 0.23.1, the root catalog has no entry',
            'apps/server/docker/workspace-package.json: @adecore/terminal is missing, the root catalog has 0.23.1',
            'apps/server/docker/workspace-package.json: @adecore/ui is 0.23.0, the root catalog has 0.23.1'
        ]);
    });
});

describe('this repository', () => {
    test('takes every ADE CORE version from the root catalog', () => {
        expect(catalogProblems(repoRoot)).toEqual([]);
    });

    test('keeps the catalog of the daemon image equal to the root catalog', () => {
        const root = catalogOf(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')));
        const docker = catalogOf(JSON.parse(readFileSync(join(repoRoot, 'apps/server/docker/workspace-package.json'), 'utf8')));

        expect(Object.keys(root).length).toBeGreaterThan(0);
        expect(docker).toEqual(root);
        expect(dockerCatalogDrift(repoRoot)).toEqual([]);
    });
});

describe('awaitRelease', () => {
    function registry(published: Record<string, number>): Registry & { checks: number; pauses: number } {
        const state = { checks: 0, pauses: 0 };

        return Object.assign(state, {
            async has(name: string) {
                state.checks++;

                // A package shows up once the registry was asked this many times about it.
                return (published[name] ?? Infinity) <= state.pauses;
            },
            async pause() {
                state.pauses++;
            }
        });
    }

    test('returns at once when every tarball is there', async () => {
        const fake = registry({ '@adecore/ui': 0, '@adecore/plan': 0 });

        await awaitRelease(['@adecore/ui', '@adecore/plan'], '0.24.0', fake);

        expect(fake.pauses).toBe(0);
    });

    test('pauses and asks again until the last package is published', async () => {
        const fake = registry({ '@adecore/ui': 0, '@adecore/plan': 3 });

        await awaitRelease(['@adecore/ui', '@adecore/plan'], '0.24.0', fake);

        expect(fake.pauses).toBe(3);
    });

    test('gives up after the bounded number of tries and names what is missing', async () => {
        const fake = registry({ '@adecore/ui': 0 });

        await expect(awaitRelease(['@adecore/ui', '@adecore/plan'], '0.24.0', fake, 4)).rejects.toThrow(
            '@adecore/plan is not on npm at 0.24.0 after 4 tries. No file was changed.'
        );
        expect(fake.pauses).toBe(3);
    });
});

describe('bumpPackages', () => {
    let fixture: string;
    let root: string;
    let adecore: string;

    function installed(workspace: string, name: string, version: string): void {
        write(join(root, workspace, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
    }

    function installAll(version: string): void {
        installed('apps/client', '@adecore/ui', version);
        installed('apps/client', '@adecore/terminal', version);
        installed('apps/client', '@adecore/agents', version);
        installed('apps/server', '@adecore/agents', version);
    }

    function install(version: string, lockVersion = version): RunCommand {
        return async (cwd, args) => {
            expect(cwd).toBe(root);
            expect(args).toEqual(['install']);
            installAll(version);
            write(join(root, 'bun.lock'), `"@adecore/ui": ["@adecore/ui@${version}"],\n"@adecore/plan": ["@adecore/plan@${lockVersion}"],\n`);
        };
    }

    function files(): string[] {
        return ['package.json', 'apps/server/docker/workspace-package.json', 'apps/client/package.json', 'apps/server/package.json', 'bun.lock'].map((file) =>
            readFileSync(join(root, file), 'utf8')
        );
    }

    const published: Registry = {
        has: async () => true,
        pause: async () => {}
    };

    beforeEach(() => {
        fixture = realpathSync(mkdtempSync(join(tmpdir(), 'ruimte-adecore-bump-')));
        root = join(fixture, 'ruimte');
        adecore = join(fixture, 'adecore');
        write(join(root, 'package.json'), rootManifest);
        write(join(root, 'apps/server/docker/workspace-package.json'), dockerManifest);
        write(join(root, 'apps/client/package.json'), clientManifest);
        write(join(root, 'apps/server/package.json'), serverManifest);
        write(join(root, 'bun.lock'), '"@adecore/ui": ["@adecore/ui@0.23.1"],\n');
        installAll('0.23.1');
        write(join(adecore, 'packages/ui/package.json'), JSON.stringify({ name: '@adecore/ui', version: '0.24.0' }));
    });

    afterEach(() => {
        rmSync(fixture, { recursive: true, force: true });
    });

    test('moves the catalog of the root and the image, installs once and ends on npm', async () => {
        await bumpPackages(root, adecore, '0.24.0', install('0.24.0'), published);

        const [main, docker, client, server] = files();

        expect(main).toBe(rootManifest.replaceAll('0.23.1', '0.24.0'));
        expect(docker).toBe(dockerManifest.replaceAll('0.23.1', '0.24.0'));
        expect(client).toBe(clientManifest);
        expect(server).toBe(serverManifest);
    });

    test('waits for the release before it changes a file or installs', async () => {
        const before = files();
        const asked: string[] = [];
        let installs = 0;

        await expect(
            bumpPackages(
                root,
                adecore,
                '0.24.0',
                async () => {
                    installs++;
                },
                {
                    has: async (name, version) => {
                        asked.push(`${name}@${version}`);

                        return name !== '@adecore/terminal';
                    },
                    pause: async () => {}
                }
            )
        ).rejects.toThrow('@adecore/terminal is not on npm at 0.24.0');

        expect(asked).toContain('@adecore/ui@0.24.0');
        expect(installs).toBe(0);
        expect(files()).toEqual(before);
    });

    test('refuses a workspace that pins an ADE CORE package itself', async () => {
        write(join(root, 'apps/server/package.json'), serverManifest.replace('"@adecore/agents": "catalog:"', '"@adecore/agents": "0.23.1"'));
        const before = files();

        await expect(bumpPackages(root, adecore, '0.24.0', install('0.24.0'), published)).rejects.toThrow(
            'apps/server/package.json: @adecore/agents in dependencies is "0.23.1", not "catalog:"'
        );
        expect(files()).toEqual(before);
    });

    test('refuses an image catalog that lists other packages than the root', async () => {
        write(join(root, 'apps/server/docker/workspace-package.json'), dockerManifest.replace('"@adecore/terminal": "0.23.1",', ''));
        const before = files();

        await expect(bumpPackages(root, adecore, '0.24.0', install('0.24.0'), published)).rejects.toThrow('does not list the same ADE CORE packages');
        expect(files()).toEqual(before);
    });

    test('refuses a linked checkout before changing a file', async () => {
        const link = join(root, 'apps/client/node_modules/@adecore/ui');
        rmSync(link, { recursive: true });
        symlinkSync(join(adecore, 'packages/ui'), link);
        const before = files();
        let installs = 0;

        await expect(
            bumpPackages(
                root,
                adecore,
                '0.24.0',
                async () => {
                    installs++;
                },
                published
            )
        ).rejects.toThrow('apps/client: @adecore/ui is linked to');

        expect(installs).toBe(0);
        expect(files()).toEqual(before);
    });

    test('refuses a version that is not exact', async () => {
        await expect(bumpPackages(root, adecore, '^0.24.0', install('0.24.0'), published)).rejects.toThrow('^0.24.0 is not an exact version');
    });

    test('puts the manifests and lockfile back when the install fails', async () => {
        const before = files();

        await expect(
            bumpPackages(
                root,
                adecore,
                '9.9.9',
                async () => {
                    throw new Error('No version matching "9.9.9"');
                },
                published
            )
        ).rejects.toThrow('No version matching');

        expect(files()).toEqual(before);
    });

    test('fails when the lockfile keeps an ADE CORE package on another version', async () => {
        await expect(bumpPackages(root, adecore, '0.24.0', install('0.24.0', '0.23.1'), published)).rejects.toThrow('bun.lock: @adecore/plan@0.23.1');
    });

    test('fails when an installed package is not the catalog version', async () => {
        const run = install('0.24.0');

        await expect(
            bumpPackages(
                root,
                adecore,
                '0.24.0',
                async (cwd, args) => {
                    await run(cwd, args);
                    installed('apps/server', '@adecore/agents', '0.23.1');
                },
                published
            )
        ).rejects.toThrow('do not resolve to the npm install of 0.24.0');
    });
});
