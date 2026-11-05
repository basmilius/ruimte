import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Job {
    readonly permissions?: Readonly<Record<string, string>>;
    readonly concurrency?: { readonly group?: string; readonly 'cancel-in-progress'?: boolean };
}

interface Workflow {
    readonly permissions?: Readonly<Record<string, string>>;
    readonly jobs: Readonly<Record<string, Job>>;
}

const workflow = Bun.YAML.parse(readFileSync(join(import.meta.dir, '../.github/workflows/release.yml'), 'utf8')) as Workflow;

describe('release.yml', () => {
    test('reads by default and writes the release only from the jobs that create, upload to or publish it', () => {
        const writers = Object.entries(workflow.jobs)
            .filter(([, job]) => job.permissions?.contents === 'write')
            .map(([name]) => name)
            .sort();

        expect(workflow.permissions).toEqual({ contents: 'read' });
        expect(writers).toEqual(['draft', 'linux', 'mac', 'publish', 'windows']);
    });

    test('publishes one run at a time and never cancels a publish', () => {
        expect(workflow.jobs.publish?.concurrency).toEqual({ group: 'release-publish', 'cancel-in-progress': false });
    });
});
