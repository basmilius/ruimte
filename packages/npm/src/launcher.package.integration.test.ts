import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platformPackageOf } from './launcher';

/*
 * The whole chain on this machine: `compile.ts` builds the host binary, `build.ts` lays out the
 * packages, and Node runs the launcher against them the way npm would install them.
 */
const repoRoot = join(import.meta.dir, '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'ruimte-npm-'));

afterAll(() => {
    rmSync(work, { recursive: true, force: true });
});

// The timeout is a budget for a real build, not a wait: on a cold runner compile.ts builds both Rust helpers.
test('node runs the packaged daemon and its search worker', async () => {
    const target = `${process.platform}-${process.arch}`;
    const version = '0.0.0-integration';
    const compile = Bun.spawnSync(['bun', 'apps/server/scripts/compile.ts', '--target', target, '--outdir', join(work, 'binaries', target)], {
        cwd: repoRoot,
        env: { ...process.env, RUIMTE_VERSION: version },
        stdio: ['ignore', 'inherit', 'inherit']
    });
    expect(compile.exitCode).toBe(0);
    if (process.platform === 'darwin') {
        expect(existsSync(join(work, 'binaries', target, 'native', 'serve-sim-duo-hid'))).toBe(true);
        expect(existsSync(join(work, 'binaries', target, 'native', 'serve-sim-camera-helper'))).toBe(true);
        expect(existsSync(join(work, 'binaries', target, 'native', 'libSimCameraInjector.dylib'))).toBe(true);
    }

    const out = join(work, 'packages');
    const build = Bun.spawnSync(
        ['bun', 'packages/npm/scripts/build.ts', '--version', version, '--binaries', join(work, 'binaries'), '--out', out, '--only', target],
        { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'] }
    );
    expect(build.exitCode).toBe(0);

    const scope = join(out, 'ruimte', 'node_modules', '@ruimte');
    mkdirSync(scope, { recursive: true });
    symlinkSync(join(out, target), join(scope, platformPackageOf({ platform: process.platform, arch: process.arch }).split('/')[1]!));

    const run = Bun.spawnSync(['node', join(out, 'ruimte', 'bin', 'ruimte.js'), '--version'], { stdout: 'pipe', stderr: 'pipe' });
    expect(run.stderr.toString()).toBe('');
    expect(run.stdout.toString().trim()).toBe(version);
    expect(run.exitCode).toBe(0);

    const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    const port = reservation.port!;
    await reservation.stop(true);
    const home = join(work, 'home');
    const project = join(work, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'hello.txt'), 'A packaged worker finds this line.\n');
    const daemon = Bun.spawn(
        [
            Bun.which('node')!,
            join(out, 'ruimte', 'bin', 'ruimte.js'),
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--no-hooks',
            '--no-broker',
            '--no-lan',
            '--no-stun',
            '--no-model-fetch',
            '--no-price-fetch'
        ],
        // No ripgrep: the fallback must resolve its worker inside the executable.
        { env: { ...process.env, RUIMTE_HOME: home, PATH: '' }, stdout: 'ignore', stderr: 'inherit' }
    );
    let socket: WebSocket | undefined;
    try {
        const base = `http://127.0.0.1:${port}`;
        // No deadline of its own: a daemon that never comes up runs into the test's budget, a slow one still passes.
        let ready = false;
        while (daemon.exitCode === null) {
            if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(200) }).catch(() => null))?.ok) {
                ready = true;
                break;
            }
            await Bun.sleep(20);
        }
        expect(ready).toBe(true);
        const secret = readFileSync(join(home, 'local.key'), 'utf8').trim();
        const response = await fetch(`${base}/auth/local-ticket`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
        expect(response.ok).toBe(true);
        const { ticket } = (await response.json()) as { ticket: string };
        const connected = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(ticket)}`);
        socket = connected;
        const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
        connected.onmessage = (event) => {
            const frame = JSON.parse(String(event.data)) as { id?: string; ok: boolean; result: unknown; error?: { message: string } };
            const waiter = frame.id === undefined ? undefined : pending.get(frame.id);
            if (waiter === undefined) {
                return;
            }
            pending.delete(frame.id!);
            if (frame.ok) {
                waiter.resolve(frame.result);
            } else {
                waiter.reject(new Error(frame.error?.message ?? 'Packaged request failed'));
            }
        };
        /*
         * A request fails when the daemon can no longer answer it, never on a clock: the daemon bounds
         * its own work (the search without ripgrep stops after ten seconds), and a slow runner is no failure.
         */
        let lost: Error | undefined;
        const lose = (error: Error): void => {
            lost ??= error;
            pending.forEach((waiter) => waiter.reject(lost!));
            pending.clear();
        };
        connected.onclose = () => lose(new Error('The packaged daemon closed the socket'));
        void daemon.exited.then((code) => lose(new Error(`The packaged daemon exited with ${code}`)));
        await new Promise<void>((resolve, reject) => {
            connected.onopen = () => resolve();
            connected.onerror = () => reject(new Error('The packaged daemon refused its local ticket'));
        });
        let nextId = 0;
        function request<T>(type: string, payload: object): Promise<T> {
            return new Promise((resolve, reject) => {
                if (lost !== undefined) {
                    reject(lost);
                    return;
                }
                const id = String(++nextId);
                pending.set(id, { resolve: (value) => resolve(value as T), reject });
                connected.send(JSON.stringify({ id, type, payload }));
            });
        }
        const hello = await request<{ version: string; home: string }>('server.hello', {});
        expect(hello).toMatchObject({ version, home });
        await request('project.open', { folder: project });
        const found = await request<{ matches: Array<{ path: string; line: number; text: string }> }>('fs.grep', {
            cwd: project,
            query: 'packaged worker'
        });
        expect(found.matches).toMatchObject([{ path: 'hello.txt', line: 1, text: 'A packaged worker finds this line.' }]);
    } finally {
        socket?.close();
        daemon.kill('SIGTERM');
        const force = setTimeout(() => daemon.kill('SIGKILL'), 5000);
        await daemon.exited;
        clearTimeout(force);
    }
}, 900_000);
