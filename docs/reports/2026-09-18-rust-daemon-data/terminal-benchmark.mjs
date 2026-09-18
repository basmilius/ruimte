import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../apps/server/package.json', import.meta.url));
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const count = Number(process.argv[2] ?? 1);
if (![1, 10, 50].includes(count)) throw new Error('Expected 1, 10 or 50 terminals');
const line = '\x1b[32m' + 'x'.repeat(100) + '\x1b[0m\r\n';
const input = line.repeat(10_000);
const create = () => {
    const terminal = new Terminal({ cols: 120, rows: 40, scrollback: 10_000, allowProposedApi: true });
    const serializer = new SerializeAddon();
    terminal.loadAddon(serializer);
    return { terminal, serializer };
};
const write = terminal => new Promise(resolve => terminal.write(input, resolve));
const warm = create();
await write(warm.terminal);
warm.serializer.serialize({ scrollback: 10_000 });
warm.terminal.dispose();
Bun.gc(true);
const baselineRss = process.memoryUsage().rss;
const terminals = Array.from({ length: count }, create);
const cpuStart = process.cpuUsage();
const fillStart = performance.now();
for (const { terminal } of terminals) await write(terminal);
const fillMs = performance.now() - fillStart;
const cpu = process.cpuUsage(cpuStart);
Bun.gc(true);
const filledRss = process.memoryUsage().rss;
const snapshotStart = performance.now();
let snapshotBytes = 0;
const snapshots = terminals.map(({ serializer }) => {
    const screen = serializer.serialize({ scrollback: 10_000 });
    snapshotBytes += Buffer.byteLength(screen);
    return screen;
});
const snapshotMs = performance.now() - snapshotStart;
const snapshotRss = process.memoryUsage().rss;
Bun.gc(true);
const retainedRss = process.memoryUsage().rss;
console.log(JSON.stringify({ count, bun: Bun.version, platform: process.platform, arch: process.arch,
    xterm: require('@xterm/headless/package.json').version,
    serialize: require('@xterm/addon-serialize/package.json').version,
    cols: 120, rows: 40, lines: 10_000, inputBytesPerTerminal: Buffer.byteLength(input),
    baselineRss, filledRss, deltaRss: filledRss - baselineRss, snapshotRss, retainedRss,
    fillMs, fillCpuMs: (cpu.user + cpu.system) / 1000, snapshotMs, snapshotBytes,
    retainedSnapshots: snapshots.length }));
for (const { terminal } of terminals) terminal.dispose();
