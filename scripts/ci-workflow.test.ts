import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

interface Workflow {
    readonly jobs: Readonly<Record<string, { readonly steps?: ReadonlyArray<{ readonly run?: string }> }>>;
}

function workflow(name: string): Workflow {
    return Bun.YAML.parse(readFileSync(join(import.meta.dir, '../.github/workflows', name), 'utf8')) as Workflow;
}

describe('ci.yml', () => {
    // A web client deploys only after a release is published, so a build that breaks has to break here first.
    test('bundles every web client a release deploys', () => {
        const runs = Object.values(workflow('ci.yml').jobs).flatMap((job) => (job.steps ?? []).map((step) => step.run));

        expect(runs).toContain('bun run --cwd apps/client bundle:station');
        expect(runs).toContain('bun run --cwd apps/client bundle:bench');
    });
});

describe('windows-ci.bunfig.toml', () => {
    const ignored = (Bun.TOML.parse(readFileSync(join(ROOT, 'windows-ci.bunfig.toml'), 'utf8')) as { test: { pathIgnorePatterns: string[] } }).test
        .pathIgnorePatterns;
    const files = ignored.filter((pattern) => !pattern.includes('*'));

    // A moved file left behind by its old path runs on the Windows runner again, and fails other tests there.
    test('names only files that exist', () => {
        expect(files.filter((file) => !existsSync(join(ROOT, file)))).toEqual([]);
    });

    test('leaves out every unit test file that boots a test daemon', () => {
        const booting = [...new Glob('apps/server/src/**/*.test.ts').scanSync(ROOT)]
            .filter((file) => !file.endsWith('.integration.test.ts'))
            .filter((file) => readFileSync(join(ROOT, file), 'utf8').includes('bootTestDaemon('))
            .map((file) => file.replaceAll('\\', '/'));

        expect(booting.filter((file) => !files.includes(file))).toEqual([]);
    });
});
