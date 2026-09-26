import type { Manifest } from './manifest';

/*
 * The workspace packages another app builds on, published beside `ruimte` with the version of the
 * release. In dependency order, so a package is on the registry before the one that names it.
 */
export const LIBRARIES = ['agent-contracts', 'ui', 'agents', 'agents-react'] as const;

export type Library = (typeof LIBRARIES)[number];

type Exports = Record<string, string>;

interface SourceManifest {
    name: string;
    description?: string;
    exports: Exports;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
}

type PublishedExport = string | { types: string; default: string };

/* A source file becomes its JavaScript and its declarations under `dist`; a stylesheet or a JSON file is copied as it is. */
const publishedExport = (target: string): PublishedExport => {
    const path = target.replace(/^\.\/src\//, './dist/');
    const script = /\.tsx?$/.exec(path);
    if (script === null) {
        return path;
    }
    const base = path.slice(0, -script[0].length);
    return { types: `${base}.d.ts`, default: `${base}.js` };
};

export const publishedExports = (exports: Exports): Record<string, PublishedExport> =>
    Object.fromEntries(Object.entries(exports).map(([subpath, target]) => [subpath, publishedExport(target)]));

/* A workspace dependency is pinned to the release it goes out with, the way the launcher pins its binaries. */
const pinned = (dependencies: Record<string, string> | undefined, version: string): Record<string, string> | undefined =>
    dependencies && Object.fromEntries(Object.entries(dependencies).map(([name, range]) => [name, range.startsWith('workspace:') ? version : range]));

export const libraryManifest = (library: Library, source: SourceManifest, version: string): Manifest => ({
    name: source.name,
    version,
    ...(source.description ? { description: source.description } : {}),
    license: 'FSL-1.1-MIT',
    author: 'Bas Milius',
    homepage: 'https://ruimte.app',
    // npm checks `repository` against the workflow that publishes with provenance, so it names this repository exactly.
    repository: { type: 'git', url: 'git+https://github.com/basmilius/ruimte.git', directory: `packages/${library}` },
    type: 'module',
    exports: publishedExports(source.exports),
    files: ['dist'],
    ...(source.dependencies ? { dependencies: pinned(source.dependencies, version) } : {}),
    ...(source.peerDependencies ? { peerDependencies: source.peerDependencies } : {})
});
