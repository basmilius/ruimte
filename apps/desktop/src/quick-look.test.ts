import { describe, expect, test } from 'bun:test';
import { quickLookPath, registryFolderOf, type QuickLookFiles } from './quick-look';

const REGISTRY = JSON.stringify({
    projects: [
        { projectId: 'p1', folder: '/work/app' },
        { projectId: 'loose', folder: 'relative' }
    ]
});

/* A disk of real paths, where `links` maps a path to what it points at. */
function disk(entries: { files: string[]; folders: string[]; links?: Record<string, string> }, registry: string | null = REGISTRY): QuickLookFiles {
    const exists = new Set([...entries.files, ...entries.folders]);
    return {
        registry: async () => registry,
        realpath: async (path) => {
            const real = entries.links?.[path] ?? path;
            return exists.has(real) ? real : null;
        },
        isFile: async (path) => entries.files.includes(path)
    };
}

const files = disk({
    files: ['/work/app/src/logo.png', '/work/elsewhere/secret.txt', '/work/app-other/a.txt'],
    folders: ['/work/app', '/work/app/src'],
    links: { '/work/app/out.txt': '/work/elsewhere/secret.txt', '/work/app/inside.png': '/work/app/src/logo.png' }
});

describe('quick look path', () => {
    test('a file inside the folder of the window project is shown', async () => {
        expect(await quickLookPath('local:p1', '/work/app/src/logo.png', files)).toBe('/work/app/src/logo.png');
    });

    test('a link is followed and shown only when it lands inside the folder', async () => {
        expect(await quickLookPath('local:p1', '/work/app/inside.png', files)).toBe('/work/app/src/logo.png');
        expect(await quickLookPath('local:p1', '/work/app/out.txt', files)).toBeNull();
    });

    test('a path outside the folder, the folder itself or a folder in it is refused', async () => {
        expect(await quickLookPath('local:p1', '/work/elsewhere/secret.txt', files)).toBeNull();
        expect(await quickLookPath('local:p1', '/work/app-other/a.txt', files)).toBeNull();
        expect(await quickLookPath('local:p1', '/work/app/../elsewhere/secret.txt', files)).toBeNull();
        expect(await quickLookPath('local:p1', '/work/app', files)).toBeNull();
        expect(await quickLookPath('local:p1', '/work/app/src', files)).toBeNull();
    });

    test('a window on another machine, on no project or on an unknown one shows nothing', async () => {
        expect(await quickLookPath('abc123:p1', '/work/app/src/logo.png', files)).toBeNull();
        expect(await quickLookPath(null, '/work/app/src/logo.png', files)).toBeNull();
        expect(await quickLookPath('local:p2', '/work/app/src/logo.png', files)).toBeNull();
    });

    test('a relative path, a path that is gone or anything but a string is refused', async () => {
        expect(await quickLookPath('local:p1', 'src/logo.png', files)).toBeNull();
        expect(await quickLookPath('local:p1', '/work/app/src/gone.png', files)).toBeNull();
        expect(await quickLookPath('local:p1', 4, files)).toBeNull();
    });

    test('without a registry nothing is shown', async () => {
        expect(await quickLookPath('local:p1', '/work/app/src/logo.png', disk({ files: ['/work/app/src/logo.png'], folders: ['/work/app'] }, null))).toBeNull();
    });
});

describe('registry folder', () => {
    test('reads the absolute folder of a project', () => {
        expect(registryFolderOf(REGISTRY, 'p1')).toBe('/work/app');
        expect(registryFolderOf(REGISTRY, 'loose')).toBeNull();
        expect(registryFolderOf(REGISTRY, 'missing')).toBeNull();
    });

    test('a registry that does not read names no folder', () => {
        expect(registryFolderOf('{ not json', 'p1')).toBeNull();
        expect(registryFolderOf('{"projects":4}', 'p1')).toBeNull();
        expect(registryFolderOf('null', 'p1')).toBeNull();
    });
});
