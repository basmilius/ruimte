import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { developmentExtensions, linkDevelopmentExtensions, linkedExtensions, type DevLinkDeps } from './dev-extensions.ts';

const root = mkdtempSync(join(tmpdir(), 'ruimte-dev-extensions-'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

function repositoryWith(name: string, extensions: readonly string[]): string {
    const repository = join(root, name);

    for (const path of extensions) {
        mkdirSync(join(repository, path), { recursive: true });
        writeFileSync(join(repository, path, 'manifest.json'), '{}');
    }

    return repository;
}

interface World {
    deps: DevLinkDeps;
    built: string[];
    linked: { folder: string; startsOff: boolean }[];
    failures: string[];
    /* A change under a development folder, by its path from that folder, with the debounced work it set off begun. */
    save(parent: string, name: string): void;
    /* Settles once the next build is linked. */
    nextLink(): Promise<void>;
}

function worldOf(repository: string, fails: readonly string[] = []): World {
    const watchers = new Map<string, (name: string | null) => void>();
    const pending: (() => void)[] = [];
    const waiting: (() => void)[] = [];
    const world: World = {
        built: [],
        linked: [],
        failures: [],
        deps: {
            repository,
            extensions: developmentExtensions(repository),
            build: async (folder) => {
                world.built.push(folder);

                if (fails.some((path) => folder.endsWith(path))) {
                    throw new Error('does not build');
                }

                return join(folder, 'dist');
            },
            link: async (folder, startsOff) => {
                world.linked.push({ folder, startsOff });
                waiting.splice(0).forEach((settle) => settle());
            },
            watch: (folder, listener) => void watchers.set(folder, listener),
            debounce: (_key, run) => void pending.push(run),
            failed: (path) => void world.failures.push(path)
        },
        save: (parent, name) => {
            watchers.get(join(repository, parent))?.(name);
            pending.splice(0).forEach((run) => run());
        },
        nextLink: () => new Promise((settle) => void waiting.push(settle))
    };

    return world;
}

describe('the development extensions the dev launch links', () => {
    test('are every folder with a manifest under the development folders, the ones that break on purpose off', () => {
        const repository = repositoryWith('found', ['extensions/dev/trackline', 'extensions/poc/broken', 'extensions/poc/surfaces', 'extensions/pets']);

        mkdirSync(join(repository, 'extensions/dev/empty'), { recursive: true });

        expect(developmentExtensions(repository)).toEqual([
            { path: 'extensions/dev/trackline', startsOff: false },
            { path: 'extensions/poc/broken', startsOff: true },
            { path: 'extensions/poc/surfaces', startsOff: false }
        ]);
    });

    test('are each built and linked from their build, except the probe of the contract suite', async () => {
        const repository = repositoryWith('linked', ['extensions/dev/trackline', 'extensions/poc/broken', 'extensions/poc/contract']);
        const world = worldOf(repository);

        await linkDevelopmentExtensions(world.deps);

        expect(world.linked).toEqual([
            { folder: join(repository, 'extensions/dev/trackline', 'dist'), startsOff: false },
            { folder: join(repository, 'extensions/poc/broken', 'dist'), startsOff: true }
        ]);
    });

    test('leave the others alone when one does not build', async () => {
        const repository = repositoryWith('failing', ['extensions/dev/harbor', 'extensions/dev/trackline']);
        const world = worldOf(repository, ['harbor']);

        await linkDevelopmentExtensions(world.deps);

        expect(world.failures).toEqual(['extensions/dev/harbor']);
        expect(world.linked.map((link) => link.folder)).toEqual([join(repository, 'extensions/dev/trackline', 'dist')]);
    });

    test('build and link one again for a save in its folder, and not for what its own build wrote', async () => {
        const repository = repositoryWith('saved', ['extensions/dev/harbor', 'extensions/dev/trackline']);
        const world = worldOf(repository);

        await linkDevelopmentExtensions(world.deps);
        world.linked.length = 0;
        world.built.length = 0;

        mkdirSync(join(repository, 'extensions/dev/trackline/dist'), { recursive: true });
        writeFileSync(join(repository, 'extensions/dev/trackline/dist/index.js'), '');
        world.save('extensions/dev', 'trackline/dist/index.js');

        // A build begins in the turn of its save, so none began.
        expect(world.built).toEqual([]);

        mkdirSync(join(repository, 'extensions/dev/trackline/client'), { recursive: true });
        writeFileSync(join(repository, 'extensions/dev/trackline/client/index.ts'), '');

        const linked = world.nextLink();

        world.save('extensions/dev', 'trackline/client/index.ts');
        await linked;

        expect(world.linked).toEqual([{ folder: join(repository, 'extensions/dev/trackline', 'dist'), startsOff: false }]);
    });

    test('have the extension that is a product of its own beside them, linked and built again for a save in its own folder', async () => {
        const repository = repositoryWith('products', ['extensions/dev/harbor', 'extensions/devcontainers', 'extensions/pets']);
        const world = worldOf(repository);
        const product = join(repository, 'extensions/devcontainers');

        expect(developmentExtensions(repository).map((extension) => extension.path)).toEqual(['extensions/dev/harbor']);
        expect(linkedExtensions(repository)).toEqual([{ path: 'extensions/devcontainers', startsOff: false }]);
        expect(linkedExtensions(repositoryWith('without', ['extensions/dev/harbor']))).toEqual([]);

        await linkDevelopmentExtensions({ ...world.deps, extensions: [...world.deps.extensions, ...linkedExtensions(repository)] });

        expect(world.linked.map((link) => link.folder)).toEqual([join(repository, 'extensions/dev/harbor', 'dist'), join(product, 'dist')]);

        world.linked.length = 0;
        mkdirSync(join(product, 'server'), { recursive: true });
        writeFileSync(join(product, 'server/index.ts'), '');

        const linked = world.nextLink();

        world.save('extensions/devcontainers', 'server/index.ts');
        await linked;

        expect(world.linked).toEqual([{ folder: join(product, 'dist'), startsOff: false }]);
    });
});
