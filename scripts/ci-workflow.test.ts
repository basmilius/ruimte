import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
