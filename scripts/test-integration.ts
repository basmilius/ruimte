import { Glob } from 'bun';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { parseArgs } from 'node:util';

const SUITES = ['default', 'core', 'package', 'devices', 'browser'] as const;
const BROWSER_TEST_TIMEOUT_MS = 15_000;
export type IntegrationSuite = (typeof SUITES)[number];

const EXTENSION_HOST_TESTS = /^extensions\/(?:poc\/)?[^/]+\/test\//;

export function integrationFiles(root: string, suite: IntegrationSuite = 'default'): string[] {
    return (
        [...new Glob('{apps,extensions,packages,scripts}/**/*.integration.test.ts').scanSync({ cwd: root, onlyFiles: true, followSymlinks: false })]
            // The scan answers in the separator of the platform; the list is read and sorted with `/`.
            .map((path) => path.split(sep).join('/'))
            .filter((path) => {
                // An extension's `test/` runs under `ruimte extension test`, against its fake host (bunfig.toml).
                if (path.split('/').includes('node_modules') || EXTENSION_HOST_TESTS.test(path)) {
                    return false;
                }
                const group = path.endsWith('.browser.integration.test.ts')
                    ? 'browser'
                    : path.endsWith('.device.integration.test.ts')
                      ? 'devices'
                      : path.endsWith('.package.integration.test.ts')
                        ? 'package'
                        : 'core';
                return suite === 'default' ? group === 'core' || group === 'package' : group === suite;
            })
            .sort()
            .map((path) => `./${path}`)
    );
}

/* The files of shard `index/count`, every `count`th from the sorted list, so the long files of one folder spread over the shards. */
export function shardOf(files: readonly string[], shard: string): string[] {
    const match = /^(\d+)\/(\d+)$/.exec(shard);
    const index = Number(match?.[1]);
    const count = Number(match?.[2]);

    if (!match || count < 1 || index < 1 || index > count) {
        throw new Error(`A shard is <index>/<count>, from 1: ${shard}`);
    }

    return files.filter((_, position) => position % count === index - 1);
}

async function main(): Promise<void> {
    const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-integration-')));
    try {
        const { values, positionals: files } = parseArgs({
            args: process.argv.slice(2),
            options: { suite: { type: 'string' }, browser: { type: 'boolean' }, shard: { type: 'string' } },
            allowPositionals: true
        });
        if (values.browser && values.suite !== undefined && values.suite !== 'browser') {
            throw new Error('--browser cannot be combined with another suite.');
        }
        const suite = values.browser ? 'browser' : (values.suite ?? 'default');
        if (!(SUITES as readonly string[]).includes(suite)) {
            throw new Error(`Unknown integration suite: ${suite}`);
        }
        const browser = suite === 'browser';
        const config = browser ? 'browser.bunfig.toml' : 'integration.bunfig.toml';
        const found = files.length > 0 ? files : integrationFiles(process.cwd(), suite as IntegrationSuite);
        const selected = values.shard === undefined ? found : shardOf(found, values.shard);
        if (selected.length === 0) {
            throw new Error('No integration tests found in apps, extensions, packages or scripts.');
        }

        // Chrome keeps the first launch flags and profile for a Bun process; browser files need independent backends.
        const batches = browser ? selected.map((file) => [file]) : [selected];
        // A browser test measures behavior in a real page, not time; on a slow CI runner its fixed cost alone nears 5 s.
        const timeout = browser ? [`--timeout=${BROWSER_TEST_TIMEOUT_MS}`] : [];

        for (const batch of batches) {
            const child = Bun.spawn([process.execPath, `--config=${config}`, 'test', '--conditions=source', ...timeout, ...batch], {
                env: { ...process.env, RUIMTE_INTEGRATION_FIXTURE_ROOT: fixtureRoot },
                stdin: 'inherit',
                stdout: 'inherit',
                stderr: 'inherit'
            });
            let interrupted = false;
            const interrupt = () => {
                interrupted = true;
                child.kill('SIGINT');
            };
            const terminate = () => {
                interrupted = true;
                child.kill('SIGTERM');
            };
            process.once('SIGINT', interrupt);
            process.once('SIGTERM', terminate);
            try {
                const code = await child.exited;

                if (code !== 0) {
                    process.exitCode = code;
                }
            } finally {
                process.off('SIGINT', interrupt);
                process.off('SIGTERM', terminate);
            }

            if (interrupted) {
                break;
            }
        }
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
        console.log('Integration fixtures removed.');
    }
}

if (import.meta.main) {
    await main();
}
