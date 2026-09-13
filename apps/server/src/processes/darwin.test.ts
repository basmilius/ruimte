import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityOf, processRates } from './sampler.ts';

const onMac = process.platform === 'darwin';

const run = async (command: string[]): Promise<string> => {
    const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'ignore' });
    const text = await new Response(child.stdout).text();
    await child.exited;
    return text;
};

/* `ps` writes CPU time as `[[dd-]hh:]mm:ss.cc`. */
const psSeconds = (text: string): number => text.split(':').reduce((sum, part) => sum * 60 + Number.parseFloat(part), 0);

/* `top` writes memory as `12M`, `1024K` or `2G`, with a `+` or `-` behind it when it moved. */
const topBytes = (text: string): number => {
    const match = /([\d.]+)([BKMG])/.exec(text);
    if (!match) {
        return Number.NaN;
    }
    return Number(match[1]) * { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[match[2] as 'B' | 'K' | 'M' | 'G'];
};

describe.skipIf(!onMac)('the libproc sampler against ps', async () => {
    const { DarwinSampler } = await import('./darwin.ts');
    const folder = await mkdtemp(join(tmpdir(), 'ruimte-processes-'));
    // Burns CPU and writes 16 MB, then waits to be killed, so the counters stand still while we compare.
    const script = `
        const end = Date.now() + 700; let x = 0; while (Date.now() < end) { x += Math.sqrt(x + 1); }
        const fs = require('node:fs'); const fd = fs.openSync(${JSON.stringify(join(folder, 'out.bin'))}, 'w');
        for (let i = 0; i < 16; i++) { fs.writeSync(fd, Buffer.alloc(1024 * 1024, 1)); } fs.fsyncSync(fd); fs.closeSync(fd);
        process.stdout.write('ready\\n'); setInterval(() => {}, 1000);
    `;
    const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'ignore' });
    const reader = child.stdout.getReader();
    await reader.read();

    afterAll(async () => {
        child.kill('SIGKILL');
        await child.exited;
        await rm(folder, { recursive: true, force: true });
    });

    const sampler = new DarwinSampler(tmpdir());

    test('parent, start, CPU time, footprint and disk writes agree with the system tools', async () => {
        const reading = sampler.sample();
        const mine = reading.processes.find((entry) => entry.pid === child.pid);
        expect(mine).toBeDefined();
        expect(mine!.readable).toBe(true);
        expect(mine!.ppid).toBe(process.pid);

        // Elapsed rather than the start as a date, which `ps` writes in a time zone the test runner does not share.
        const [ppid, time, elapsed] = (await run(['ps', '-o', 'ppid=,time=,etime=', '-p', String(child.pid)])).trim().split(/\s+/);
        expect(Number(ppid)).toBe(process.pid);
        expect(Math.abs(mine!.cpuNs! / 1e9 - psSeconds(time!))).toBeLessThan(0.1);
        expect(Math.abs((Date.now() - mine!.startTime / 1000) / 1000 - psSeconds(elapsed!))).toBeLessThan(2);

        // A fresh process gives pages back for a moment after it starts, so both sides are read until they settle.
        let ratio = Number.POSITIVE_INFINITY;
        for (let attempt = 0; attempt < 6 && ratio >= 0.05; attempt++) {
            await Bun.sleep(250);
            const footprint = sampler.sample().processes.find((entry) => entry.pid === child.pid)!.memory!;
            const top = await run(['top', '-l', '1', '-pid', String(child.pid), '-stats', 'pid,mem']);
            const line = top
                .trim()
                .split('\n')
                .find((row) => row.trim().startsWith(String(child.pid)));
            const reported = topBytes(line!.trim().split(/\s+/)[1]!);
            ratio = Math.abs(footprint - reported) / reported;
        }
        expect(ratio).toBeLessThan(0.05);

        expect(mine!.diskWrite!).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    });

    test('a busy process reads as busy and a waiting one as idle', async () => {
        const busy = Bun.spawn([process.execPath, '-e', 'const end = Date.now() + 3000; let x = 0; while (Date.now() < end) { x++; }'], { stdout: 'ignore' });
        try {
            await Bun.sleep(300);
            const before = sampler.sample();
            await Bun.sleep(1000);
            const after = sampler.sample();
            const rates = processRates(before, after);
            const startOf = (pid: number) => after.processes.find((entry) => entry.pid === pid)!.startTime;
            expect(rates.get(identityOf(busy.pid, startOf(busy.pid)))!.cpu!).toBeGreaterThan(70);
            expect(rates.get(identityOf(child.pid, startOf(child.pid)))!.cpu!).toBeLessThan(5);
        } finally {
            busy.kill('SIGKILL');
            await busy.exited;
        }
    });

    test('the environment of a process of this user is readable', () => {
        const line = sampler.commandLine(child.pid);
        expect(line?.args[0]).toBe(process.execPath);
        expect(line?.env.HOME).toBe(process.env.HOME!);
    });

    test('the identity check sees the start time and the user', () => {
        const found = sampler.inspect(child.pid);
        expect(found?.uid).toBe(process.getuid!());
        expect(sampler.inspect(999_999_999)).toBeNull();
    });

    test('the machine totals are there', () => {
        const { machine } = sampler.sample();
        expect(machine.cpuTotal).toBeGreaterThan(0);
        expect(machine.memoryUsed).toBeGreaterThan(0);
        expect(machine.memoryUsed!).toBeLessThan(machine.memoryTotal);
        expect(machine.diskFree).toBeGreaterThan(0);
    });
});
