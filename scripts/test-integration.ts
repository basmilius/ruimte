import { Glob } from 'bun';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { parseArgs } from 'node:util';

const SUITES = ['default', 'core', 'package', 'devices', 'browser'] as const;
export type IntegrationSuite = (typeof SUITES)[number];

export function integrationFiles(root: string, suite: IntegrationSuite = 'default'): string[] {
    return (
        [...new Glob('{apps,packages,scripts}/**/*.integration.test.ts').scanSync({ cwd: root, onlyFiles: true, followSymlinks: false })]
            // The scan answers in the separator of the platform; the list is read and sorted with `/`.
            .map((path) => path.split(sep).join('/'))
            .filter((path) => {
                if (path.split('/').includes('node_modules')) {
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
        const selected = files.length > 0 ? files : integrationFiles(process.cwd(), suite as IntegrationSuite);
        if (selected.length === 0) {
            throw new Error('No integration tests found in apps, packages or scripts.');
        }
        const shard = values.shard === undefined ? [] : [`--shard=${values.shard}`];

        const child = Bun.spawn([process.execPath, `--config=${config}`, 'test', '--conditions=source', '--parallel', ...shard, ...selected], {
            env: { ...process.env, RUIMTE_INTEGRATION_FIXTURE_ROOT: fixtureRoot },
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit'
        });
        const interrupt = () => child.kill('SIGINT');
        const terminate = () => child.kill('SIGTERM');
        process.once('SIGINT', interrupt);
        process.once('SIGTERM', terminate);
        try {
            process.exitCode = await child.exited;
        } finally {
            process.off('SIGINT', interrupt);
            process.off('SIGTERM', terminate);
        }
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
        console.log('Integration fixtures removed.');
    }
}

if (import.meta.main) {
    await main();
}
