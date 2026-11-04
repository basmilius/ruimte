import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DarwinListenerProbe } from '../processes/listeners.ts';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
import { OPEN_BOUNDS } from '../wiring/test-bounds.ts';
import { SessionManager } from './manager.ts';
import { SessionPorts } from './ports.ts';
import { waitFor, waitForAsync } from './test-helpers.ts';

test.skipIf(process.platform !== 'darwin')(
    'real PTY session listeners include children, exclude another session, and disappear after close',
    async () => {
        const { DarwinSampler } = await import('../processes/darwin.ts');
        const home = await mkdtemp(join(tmpdir(), 'ruimte-session-ports-'));
        const ready = join(home, 'ready.json');
        const fixture = join(home, 'listener.ts');
        await Bun.write(
            fixture,
            `
const [mode, ready] = process.argv.slice(2);
if (mode === 'child' || mode === 'replacement') {
    const server = Bun.serve({ hostname: '::1', port: mode === 'replacement' ? Number(ready) : 0, fetch: () => new Response(mode) });
    process.send({ pid: process.pid, port: server.port });
} else {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('root') });
    const child = Bun.spawn([process.execPath, import.meta.path, 'child'], {
        ipc(message) { void Bun.write(ready, JSON.stringify({ root: { pid: process.pid, port: server.port }, child: message })); },
        stdout: 'ignore', stderr: 'inherit'
    });
    process.on('SIGHUP', () => { child.kill(); server.stop(true); process.exit(0); });
}
`
        );
        const manager = new SessionManager({ ...OPEN_BOUNDS, adapter: new BunPtyAdapter(), env: process.env });
        const sampler = new DarwinSampler(home);
        let now = 0;
        const ports = new SessionPorts({
            machineId: 'owner-machine',
            sampler,
            probe: new DarwinListenerProbe(),
            uid: process.getuid!(),
            now: () => now,
            sessions: () => manager.list().flatMap(({ sessionId }) => manager.live(sessionId) ?? []),
            current: (id) => manager.live(id)
        });
        manager.observeLifecycle((session, phase) => (phase === 'created' ? ports.track(session) : ports.forget(session)));
        let childPid: number | undefined;
        let childStart: number | undefined;
        try {
            await manager.create({ sessionId: 'owner', shell: process.execPath, args: [fixture, 'root', ready], cwd: home, cols: 80, rows: 24 });
            await manager.create({ sessionId: 'other', shell: '/bin/sh', args: [], cwd: home, cols: 80, rows: 24 });
            try {
                await waitForAsync(() => Bun.file(ready).exists(), 'listener readiness');
            } catch (error) {
                throw new Error(`${String(error)}\n${await manager.get('owner')?.serializeScreen()}`);
            }
            const fixtureState = (await Bun.file(ready).json()) as { root: { pid: number; port: number }; child: { pid: number; port: number } };
            childPid = fixtureState.child.pid;
            childStart = sampler.inspect(childPid)?.startTime;
            const result = await ports.list('owner');
            expect(result.status).toBe('ready');
            if (result.status !== 'ready') {
                throw new Error('Listener scan failed');
            }
            expect(result.ports.map(({ pid, port }) => ({ pid, port }))).toEqual(expect.arrayContaining([fixtureState.root, fixtureState.child]));
            expect(await ports.list('other')).toEqual({ status: 'ready', ports: [] });
            const child = result.ports.find((entry) => entry.pid === childPid)!;
            const root = result.ports.find((entry) => entry.pid === fixtureState.root.pid)!;
            const opened = await ports.verify('owner', child);
            expect(opened.url).toBe(`http://[::1]:${fixtureState.child.port}/`);
            now += 5001;
            expect(await (await fetch((await ports.verify('owner', root)).url)).text()).toBe('root');
            process.kill(childPid, 'SIGTERM');
            await waitFor(() => sampler.inspect(childPid!) === null, 'child process exit');
            now += 5001;
            const rebound = Promise.withResolvers<void>();
            const replacement = Bun.spawn([process.execPath, fixture, 'replacement', String(child.port)], {
                stdout: 'ignore',
                stderr: 'inherit',
                ipc: () => rebound.resolve(),
                onExit: () => rebound.reject(new Error('Replacement listener exited before readiness'))
            });
            try {
                await rebound.promise;
                expect(await (await fetch(opened.url)).text()).toBe('replacement');
                await expect(ports.verify('owner', child)).rejects.toThrow('could not be verified');
            } finally {
                replacement.kill();
                await replacement.exited;
            }
            await manager.kill('owner');
            expect(await ports.list('owner')).toEqual({ status: 'closed' });
            await waitFor(() => manager.get('owner') === undefined, 'PTY session exit');
            now += 5001;
            expect(await ports.list('other')).toEqual({ status: 'ready', ports: [] });
        } finally {
            ports.stop();
            if (childPid !== undefined && childStart !== undefined && sampler.inspect(childPid)?.startTime === childStart) {
                try {
                    process.kill(childPid, 'SIGKILL');
                } catch {
                    /* The child normally ended in the test. */
                }
            }
            for (const session of manager.list()) {
                await manager.kill(session.sessionId);
            }
            await waitFor(() => manager.list().length === 0, 'fixture cleanup');
            await rm(home, { recursive: true, force: true });
        }
    },
    15000
);

test.skipIf(process.platform !== 'darwin')('lsof cancellation is a failed scan, never an empty result', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new DarwinListenerProbe().read([process.pid], controller.signal)).rejects.toThrow();
});
