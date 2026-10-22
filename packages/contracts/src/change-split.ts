import { z } from 'zod';

export const CHANGE_KINDS = ['code', 'tests', 'mocks', 'generated'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const ChangeLinesSchema = z.object({
    added: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative()
});
export type ChangeLines = z.infer<typeof ChangeLinesSchema>;

// The lines of a change by what kind of file they are in; the four always add up to the change's own total.
export const ChangeSplitSchema = z.object({
    code: ChangeLinesSchema,
    tests: ChangeLinesSchema,
    mocks: ChangeLinesSchema,
    generated: ChangeLinesSchema
});
export type ChangeSplit = z.infer<typeof ChangeSplitSchema>;

const LOCKFILES = new Set([
    'bun.lock',
    'bun.lockb',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'deno.lock',
    'cargo.lock',
    'gemfile.lock',
    'composer.lock',
    'poetry.lock',
    'pipfile.lock',
    'uv.lock',
    'pdm.lock',
    'go.sum',
    'go.work.sum',
    'package.resolved',
    'podfile.lock',
    'cartfile.resolved',
    'pubspec.lock',
    'mix.lock',
    'flake.lock',
    'packages.lock.json',
    'gradle.lockfile',
    'paket.lock',
    'conan.lock'
]);

// `*.generated.*`, `*.gen.*`, minified output and what protoc writes for each language.
const GENERATED_NAME =
    /\.(generated|gen)\.[^.]+$|\.min\.(js|mjs|cjs|css)$|\.pb(\.gw)?\.(go|cc|h|swift|ts|js|dart)$|_pb2(_grpc)?\.pyi?$|_grpc_pb\.(js|d\.ts)$|_pb\.(js|d\.ts|ts)$|\.pbobjc\.[hm]$|\.pbjson\.go$/;

const MOCK_FOLDERS = new Set(['__mocks__', 'mocks', '__fixtures__', 'fixtures', 'testdata', '__snapshots__', 'snapshots']);
const MOCK_NAME = /\.mock\.[^.]+$|\.snap$/;

const TEST_FOLDERS = new Set(['test', 'tests', '__tests__', 'spec', 'specs']);
const TEST_NAME = /\.(test|spec)\.[^.]+$|_test\.go$|^test_[^/]*\.py$|_test\.py$|(Test|Tests)\.(java|kt|swift|php|cs)$|_spec\.rb$/;

/* What kind of file a path is, read from its name and folders alone; a file that is none of the other three is code. */
export function changeKindOf(path: string): ChangeKind {
    const parts = path.replaceAll('\\', '/').split('/');
    const name = parts.at(-1) ?? '';
    const folders = parts.slice(0, -1).map((part) => part.toLowerCase());
    if (LOCKFILES.has(name.toLowerCase()) || GENERATED_NAME.test(name)) {
        return 'generated';
    }
    if (MOCK_NAME.test(name) || folders.some((folder) => MOCK_FOLDERS.has(folder))) {
        return 'mocks';
    }
    if (TEST_NAME.test(name) || folders.some((folder) => TEST_FOLDERS.has(folder))) {
        return 'tests';
    }
    return 'code';
}

/* Sums the lines of each file into the kind its path is. */
export function splitChanges(files: Iterable<{ readonly path: string; readonly added: number; readonly deleted: number }>): ChangeSplit {
    const split: ChangeSplit = {
        code: { added: 0, deleted: 0 },
        tests: { added: 0, deleted: 0 },
        mocks: { added: 0, deleted: 0 },
        generated: { added: 0, deleted: 0 }
    };
    for (const file of files) {
        const lines = split[changeKindOf(file.path)];
        lines.added += file.added;
        lines.deleted += file.deleted;
    }
    return split;
}
