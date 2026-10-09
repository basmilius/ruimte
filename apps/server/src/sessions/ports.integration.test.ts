import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DarwinListenerProbe } from '../processes/listeners.ts';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
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
        const manager = new SessionManager({ adapter: new BunPtyAdapter(), env: process.env });
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

const reusePortServer = String.raw`import socket,sys,json
sock=socket.socket()
sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEPORT,1)
sock.bind((sys.argv[1],int(sys.argv[2])))
sock.listen(4)
print(json.dumps({'port':sock.getsockname()[1]}),flush=True)
while True:
 conn,addr=sock.accept()
 conn.recv(4096)
 body=sys.argv[3].encode()
 conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: '+str(len(body)).encode()+b'\r\nConnection: close\r\n\r\n'+body)
 conn.close()
`;

async function reuseListener(host: string, port: number, label: string) {
    const child = Bun.spawn(['/usr/bin/python3', '-u', '-c', reusePortServer, host, String(port), label], { stdout: 'pipe', stderr: 'inherit' });
    const reader = child.stdout.getReader();
    const timeout = setTimeout(() => child.kill(), 5000);
    try {
        const message = await reader.read();
        const ready = JSON.parse(new TextDecoder().decode(message.value)) as { port: number };
        return { child, port: ready.port };
    } catch (error) {
        child.kill();
        await child.exited;
        throw error;
    } finally {
        clearTimeout(timeout);
        reader.releaseLock();
    }
}

for (const binding of ['0.0.0.0', '127.0.0.1']) {
    test.skipIf(process.platform !== 'darwin')(
        `real macOS SO_REUSEPORT competition at ${binding} refuses discovery and opening`,
        async () => {
            const { DarwinSampler } = await import('../processes/darwin.ts');
            const own = await reuseListener(binding, 0, 'OWNED');
            let rival: Awaited<ReturnType<typeof reuseListener>> | undefined;
            const session = { id: 'owned', pid: own.child.pid };
            let now = 0;
            const ports = new SessionPorts({
                machineId: 'owner-machine',
                sampler: new DarwinSampler(tmpdir()),
                probe: new DarwinListenerProbe(),
                sessions: () => [session],
                current: () => session,
                uid: process.getuid!(),
                now: () => now
            });
            ports.track(session);
            try {
                const found = await ports.list(session.id);
                expect(found.status).toBe('ready');
                if (found.status !== 'ready') {
                    throw new Error('Own listener could not be read');
                }
                const listener = found.ports.find((entry) => entry.port === own.port)!;
                expect(listener).toBeDefined();
                expect(listener.bindAddress).toBe(binding === '0.0.0.0' ? '*' : binding);
                const verified = await ports.verify(session.id, listener);
                expect(await (await fetch(verified.url, { signal: AbortSignal.timeout(3000) })).text()).toBe('OWNED');
                rival = await reuseListener('127.0.0.1', own.port, 'UNRELATED');
                if (binding === '0.0.0.0') {
                    // The concrete loopback binding wins over the session's wildcard on macOS.
                    expect(await (await fetch(verified.url, { signal: AbortSignal.timeout(3000) })).text()).toBe('UNRELATED');
                }
                now += 5001;
                await expect(ports.verify(session.id, listener)).rejects.toThrow('could not be verified');
                now += 5001;
                expect(await ports.list(session.id)).toEqual({ status: 'unknown' });
                rival.child.kill();
                await rival.child.exited;
                rival = undefined;
                now += 5001;
                expect(await (await fetch((await ports.verify(session.id, listener)).url, { signal: AbortSignal.timeout(3000) })).text()).toBe('OWNED');
            } finally {
                ports.stop();
                own.child.kill();
                rival?.child.kill();
                await own.child.exited;
                if (rival) {
                    await rival.child.exited;
                }
            }
        },
        15000
    );
}
