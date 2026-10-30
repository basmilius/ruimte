import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { homedir } from 'node:os';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
import { gitBash } from '../pty/pty.ts';
import { childCounter } from '../service/work.ts';
import { SessionManager } from '../sessions/manager.ts';
import { waitFor } from '../sessions/test-helpers.ts';
import { identityOf, processRates, type ProcessSampler, type RawProcess } from './sampler.ts';

function bunArgs(script: string): string[] {
    return [process.execPath, '-e', script];
}

describe.skipIf(process.platform !== 'win32')('the Windows sampler', () => {
    let sampler: ProcessSampler;
    let child: Bun.Subprocess;

    beforeAll(async () => {
        const { WindowsSampler } = await import('./windows.ts');
        sampler = new WindowsSampler(homedir());
        child = Bun.spawn(bunArgs('setInterval(() => {}, 1000)'), { env: { ...process.env, RUIMTE_PROBE: 'a b=c' }, stdout: 'ignore', stderr: 'ignore' });
    });

    afterAll(async () => {
        child.kill();
        await child.exited;
    });

    const find = (pid: number): RawProcess | undefined => sampler.sample().processes.find((entry) => entry.pid === pid);

    test('the table holds this process with its parent, path, owner and counters', () => {
        const self = find(process.pid);
        expect(self?.name.toLowerCase()).toStartWith('bun');
        expect(self?.path?.toLowerCase()).toBe(process.execPath.toLowerCase());
        expect(self?.uid).toBe(process.getuid?.() ?? -1);
        expect(self?.ppid).toBe(process.ppid);
        expect(self?.cpuNs).toBeGreaterThan(0);
        expect(self?.memory).toBeGreaterThan(1024 * 1024);
        expect(Math.abs((self?.startTime ?? 0) / 1000 - (Date.now() - performance.now()))).toBeLessThan(5000);
    });

    test('a system process is listed but is not this user', () => {
        const system = find(4);
        expect(system?.name).toBe('System');
        expect(system?.uid).not.toBe(process.getuid?.() ?? -1);
    });

    test('a child sits under this process, and burning CPU shows as a rate', async () => {
        const busy = Bun.spawn(bunArgs('const end = Date.now() + 3000; while (Date.now() < end) {}'), { stdout: 'ignore', stderr: 'ignore' });
        const before = sampler.sample();
        await Bun.sleep(1000);
        const after = sampler.sample();
        const entry = after.processes.find((candidate) => candidate.pid === busy.pid);
        expect(entry?.ppid).toBe(process.pid);
        const rate = processRates(before, after).get(identityOf(busy.pid, entry?.startTime ?? 0));
        expect(rate?.cpu).toBeGreaterThan(20);
        busy.kill();
        await busy.exited;
    });

    test('a process of this user gives up its arguments and environment', () => {
        const line = sampler.commandLine(child.pid);
        expect(line?.args).toEqual(bunArgs('setInterval(() => {}, 1000)'));
        expect(line?.env.RUIMTE_PROBE).toBe('a b=c');
    });

    test('the identity check sees the start time and the user, and a gone process is null', () => {
        const entry = find(child.pid);
        expect(sampler.inspect(child.pid)).toEqual({ startTime: entry?.startTime ?? -1, uid: process.getuid?.() ?? -1 });
        expect(sampler.inspect(999_999_996)).toBeNull();
    });

    test('the clocks and machine totals are there', () => {
        const { awakeMs, asleepMs, machine } = sampler.sample();
        expect(awakeMs).toBeGreaterThan(0);
        expect(asleepMs).toBeGreaterThanOrEqual(0);
        expect(machine.cores).toBeGreaterThan(0);
        expect(machine.cpuBusy).toBeGreaterThan(0);
        expect(machine.cpuTotal).toBeGreaterThan(machine.cpuBusy ?? 0);
        expect(machine.memoryUsed).toBeGreaterThan(0);
        expect(machine.memoryUsed ?? 0).toBeLessThan(machine.memoryTotal);
        expect(machine.diskFree).toBeGreaterThan(0);
        expect(machine.diskTotal).toBeGreaterThan(machine.diskFree ?? 0);
    });
});

describe.skipIf(process.platform !== 'win32')('a Git Bash session on a ConPTY', () => {
    test('an idle shell has no child, and what an MSYS program runs stays in its tree', async () => {
        const { WindowsSampler } = await import('./windows.ts');
        const sampler = new WindowsSampler(homedir());
        const manager = new SessionManager({ adapter: new BunPtyAdapter(), env: process.env as Record<string, string> });
        await manager.create({ sessionId: 'tree', cols: 80, rows: 24, shell: gitBash()!, args: [], cwd: homedir() });
        try {
            const root = manager.live('tree')!.pid;
            const inTree = (name: string): boolean => {
                const table = sampler.sample().processes;
                const byPid = new Map(table.map((entry) => [entry.pid, entry]));
                return table.some((entry) => {
                    let current: RawProcess | undefined = entry;
                    for (let depth = 0; current !== undefined && depth < 16; depth++) {
                        if (current.ppid === root) {
                            return entry.name === name;
                        }
                        current = byPid.get(current.ppid);
                    }
                    return false;
                });
            };

            await Bun.sleep(1500);
            expect(childCounter(sampler.sample().processes)(root)).toBe(0);
            manager.write('tree', "sh -c 'sleep 30; :' &\n");
            await waitFor(() => inTree('sleep'), 'sleep under the shell');
        } finally {
            manager.killAll();
        }
    });
});

describe.skipIf(process.platform !== 'win32')('the Windows listener probe', () => {
    let server: Server;
    let port = 0;

    beforeAll(async () => {
        server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as { port: number }).port;
    });

    afterAll(() => {
        server.close();
    });

    test('finds a listener of this process, and only that port when asked', async () => {
        const { WindowsListenerProbe } = await import('./windows.ts');
        const probe = new WindowsListenerProbe();
        const all = await probe.read([process.pid], new AbortController().signal);
        expect(all).toContainEqual({ pid: process.pid, port, host: '127.0.0.1', bindAddress: '127.0.0.1' });
        const one = await probe.read([process.pid], new AbortController().signal, port);
        expect(one.map((entry) => entry.port)).toEqual([port]);
    });
});
