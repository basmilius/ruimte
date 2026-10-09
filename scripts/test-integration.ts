import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main(): Promise<void> {
    const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-integration-')));
    try {
        const files = process.argv.slice(2);
        const browser = files[0] === '--browser';
        if (browser) {
            files.shift();
        }
        const config = browser ? 'browser.bunfig.toml' : 'integration.bunfig.toml';
        const pattern = browser ? '.browser.integration.test.ts' : '.integration.test.ts';
        const child = Bun.spawn([process.execPath, `--config=${config}`, 'test', '--conditions=source', ...(files.length > 0 ? files : [pattern])], {
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

await main();
