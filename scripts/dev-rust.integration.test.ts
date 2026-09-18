import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { stopOwnedProcess } from './dev-processes';

const running: ChildProcess[] = [];
const temporary: string[] = [];

const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

const waitUntil = async (condition: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> => {
    const deadline = Date.now() + timeout;
    while (!(await condition())) {
        if (Date.now() >= deadline) {
            throw new Error('Timed out waiting for development supervisor state');
        }
        await Bun.sleep(20);
    }
};

const text = async (path: string): Promise<string> => await readFile(path, 'utf8').catch(() => '');

const executable = async (path: string, source: string): Promise<void> => {
    await writeFile(path, `#!/usr/bin/env bun\n${source}`);
    await chmod(path, 0o755);
};

interface FixtureOptions {
    changesBinary?: boolean;
    descendant?: 'none' | 'stubborn' | 'orphan';
    failBuildOn?: string;
    profile?: string;
    resolvedExecutable?: boolean;
    watchContracts?: boolean;
}

const fixture = async (options: FixtureOptions = {}) => {
    const { changesBinary = true, descendant = 'none', failBuildOn, profile = 'dev', resolvedExecutable = false, watchContracts = false } = options;
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-dev-rust-'));
    temporary.push(directory);
    const watched = join(directory, 'watched');
    const source = join(watched, 'crate/src/lib.rs');
    const contract = join(directory, 'contract.ts');
    const schema = join(directory, 'contracts.json');
    const buildLog = join(directory, 'build.log');
    const daemonLog = join(directory, 'daemon.log');
    const generatorLog = join(directory, 'generator.log');
    const generator = join(directory, 'generator.ts');
    const cargo = join(directory, 'cargo.ts');
    const target = join(directory, 'cargo-target');
    const profileDirectory = profile === 'dev' ? 'debug' : profile;
    const daemon = resolvedExecutable ? join(target, profileDirectory, 'ruimte-server') : join(directory, 'daemon.ts');
    await mkdir(join(watched, 'crate/src'), { recursive: true });
    await mkdir(join(daemon, '..'), { recursive: true });
    await writeFile(source, 'initial');
    await writeFile(contract, 'initial');
    await writeFile(schema, 'initial');
    await executable(
        generator,
        `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(generatorLog)}, 'GENERATE ' + process.pid + '\\n');
writeFileSync(${JSON.stringify(schema)}, readFileSync(${JSON.stringify(contract)}));`
    );
    await executable(
        cargo,
        `import { appendFileSync, readFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(buildLog)}, 'START ' + process.pid + ' ' + JSON.stringify(process.argv.slice(2)) + '\\n');
await Bun.sleep(250);
if (${JSON.stringify(failBuildOn)} && readFileSync(${JSON.stringify(source)}, 'utf8').includes(${JSON.stringify(failBuildOn)})) {
    appendFileSync(${JSON.stringify(buildLog)}, 'FAIL ' + process.pid + '\\n');
    process.exit(1);
}
${changesBinary ? `appendFileSync(${JSON.stringify(daemon)}, '\\n// built ' + Date.now());` : ''}
${resolvedExecutable ? `console.log(JSON.stringify({ reason: 'compiler-artifact', target: { name: 'ruimte-server' }, executable: ${JSON.stringify(daemon)} }));` : ''}
appendFileSync(${JSON.stringify(buildLog)}, 'END ' + process.pid + '\\n');`
    );
    await executable(
        daemon,
        `import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
appendFileSync(${JSON.stringify(daemonLog)}, 'START ' + process.pid + '\\n');
${
    descendant !== 'none'
        ? `const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
appendFileSync(${JSON.stringify(daemonLog)}, 'CHILD ' + child.pid + '\\n');`
        : ''
}
${descendant === 'orphan' ? `setTimeout(() => process.exit(0), 100);` : ''}
process.on('SIGTERM', () => {
    appendFileSync(${JSON.stringify(daemonLog)}, 'TERM ' + process.pid + '\\n');
    process.exit(0);
});
setInterval(() => {}, 1000);`
    );
    const supervisor = spawn(process.execPath, [join(import.meta.dir, 'dev-rust.ts')], {
        cwd: join(import.meta.dir, '..'),
        detached: process.platform !== 'win32',
        stdio: 'ignore',
        env: {
            ...process.env,
            CARGO_TARGET_DIR: target,
            RUIMTE_CARGO: cargo,
            RUIMTE_RUST_CONTRACT_WATCH_PATHS: watchContracts ? contract : undefined,
            RUIMTE_RUST_EXECUTABLE: resolvedExecutable ? undefined : daemon,
            RUIMTE_RUST_PROFILE: profile,
            RUIMTE_RUST_SCHEMA_GENERATOR: generator,
            RUIMTE_RUST_SCHEMA_OUTPUT: schema,
            RUIMTE_RUST_WATCH_PATHS: watched
        }
    });
    running.push(supervisor);
    return { supervisor, source, contract, buildLog, daemonLog, generatorLog };
};

afterEach(async () => {
    for (const child of running) {
        stopOwnedProcess(child, 'SIGKILL');
    }
    running.length = 0;
    await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe.skipIf(process.platform === 'win32')('Rust development supervisor integration', () => {
    test('serializes build and restart work while coalescing changes', async () => {
        const { supervisor, source, buildLog, daemonLog } = await fixture();
        await waitUntil(async () => (await text(daemonLog)).match(/^START/gm)?.length === 1);
        await writeFile(source, 'one');
        await waitUntil(async () => (await text(buildLog)).match(/^START/gm)?.length === 2);
        await writeFile(source, 'two');
        await writeFile(source, 'three');
        await waitUntil(async () => (await text(daemonLog)).match(/^START/gm)?.length === 3);

        const builds = (await text(buildLog)).trim().split('\n');
        expect(builds.map((line) => line.split(' ')[0])).toEqual(['START', 'END', 'START', 'END', 'START', 'END']);
        const daemons = (await text(daemonLog)).trim().split('\n');
        expect(daemons.map((line) => line.split(' ')[0])).toEqual(['START', 'TERM', 'START', 'TERM', 'START']);

        supervisor.kill('SIGTERM');
        await once(supervisor, 'exit');
        expect(supervisor.exitCode).toBe(0);
    }, 15_000);

    test('kills a stubborn daemon descendant and leaves another process group alive', async () => {
        const { supervisor, daemonLog } = await fixture({ descendant: 'stubborn' });
        const control = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
        running.push(control);
        await waitUntil(async () => (await text(daemonLog)).includes('CHILD '));
        const log = await text(daemonLog);
        const daemonPid = Number(log.match(/^START (\d+)$/m)?.[1]);
        const descendantPid = Number(log.match(/^CHILD (\d+)$/m)?.[1]);

        supervisor.kill('SIGTERM');
        await once(supervisor, 'exit');
        await waitUntil(() => !isAlive(descendantPid), 8000);
        expect(isAlive(daemonPid)).toBeFalse();
        expect(isAlive(descendantPid)).toBeFalse();
        expect(isAlive(control.pid!)).toBeTrue();
    }, 15_000);

    test('reaps the daemon group when its leader exits by itself', async () => {
        const { supervisor, daemonLog } = await fixture({ descendant: 'orphan' });
        const control = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
        running.push(control);
        await waitUntil(async () => (await text(daemonLog)).includes('CHILD '));
        const descendantPid = Number((await text(daemonLog)).match(/^CHILD (\d+)$/m)?.[1]);

        await once(supervisor, 'exit');
        await waitUntil(() => !isAlive(descendantPid), 8000);
        expect(isAlive(descendantPid)).toBeFalse();
        expect(isAlive(control.pid!)).toBeTrue();
    }, 15_000);

    test('keeps the daemon running after a Cargo no-op', async () => {
        const { supervisor, source, buildLog, daemonLog } = await fixture({ changesBinary: false });
        await waitUntil(async () => (await text(daemonLog)).match(/^START/gm)?.length === 1);
        await writeFile(source, 'crate edit');
        await waitUntil(async () => (await text(buildLog)).match(/^END/gm)?.length === 2);
        await Bun.sleep(250);
        expect((await text(daemonLog)).match(/^START/gm)?.length).toBe(1);
        expect(await text(daemonLog)).not.toContain('TERM');
        supervisor.kill('SIGTERM');
        await once(supervisor, 'exit');
    });

    test('coalesces its generated schema event into the contract build', async () => {
        const { supervisor, contract, buildLog, daemonLog, generatorLog } = await fixture({ watchContracts: true });
        await waitUntil(async () => (await text(daemonLog)).match(/^START/gm)?.length === 1);
        await writeFile(contract, 'changed contract');
        await waitUntil(async () => (await text(buildLog)).match(/^END/gm)?.length === 2);
        await Bun.sleep(400);
        expect((await text(generatorLog)).match(/^GENERATE/gm)?.length).toBe(2);
        expect((await text(buildLog)).match(/^START/gm)?.length).toBe(2);
        supervisor.kill('SIGTERM');
        await once(supervisor, 'exit');
    });

    test('keeps the last daemon through a failed build and restarts after recovery', async () => {
        const { supervisor, source, buildLog, daemonLog } = await fixture({ failBuildOn: 'broken' });
        await waitUntil(async () => (await text(daemonLog)).match(/^START/gm)?.length === 1);
        await writeFile(source, 'broken');
        await waitUntil(async () => (await text(buildLog)).match(/^FAIL/gm)?.length === 1);
        expect((await text(daemonLog)).match(/^START/gm)?.length).toBe(1);
        expect(await text(daemonLog)).not.toContain('TERM');
        await writeFile(source, 'fixed');
        await waitUntil(async () => (await text(daemonLog)).match(/^START/gm)?.length === 2);
        supervisor.kill('SIGTERM');
        await once(supervisor, 'exit');
    });

    test('exits without launching a daemon when the initial build fails', async () => {
        const { supervisor, buildLog, daemonLog } = await fixture({ failBuildOn: 'initial' });
        await once(supervisor, 'exit');
        expect(supervisor.exitCode).toBe(1);
        expect(await text(buildLog)).toContain('FAIL');
        expect(await text(daemonLog)).toBe('');
    });

    test('uses the custom Cargo target and profile with root workspace selections', async () => {
        const { supervisor, buildLog, daemonLog } = await fixture({ profile: 'fast', resolvedExecutable: true });
        await waitUntil(async () => (await text(daemonLog)).match(/^START/gm)?.length === 1);
        const build = (await text(buildLog)).split('\n').find((line) => line.startsWith('START '))!;
        expect(build).toContain('Cargo.toml');
        expect(build).toContain('ruimte_server');
        expect(build).toContain('ruimte_cli');
        expect(build).toContain('ruimte-context');
        expect(build).toContain('fast');
        supervisor.kill('SIGTERM');
        await once(supervisor, 'exit');
    });
});
