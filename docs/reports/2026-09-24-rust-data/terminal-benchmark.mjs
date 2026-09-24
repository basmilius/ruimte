import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../apps/server/package.json', import.meta.url));
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const [workload, countArg] = process.argv.slice(2);
const count = Number(countArg ?? 1);
const COLS = 120, ROWS = 40, SCROLLBACK = 10_000;
const plain = () => ('\x1b[32m' + 'x'.repeat(100) + '\x1b[0m\r\n').repeat(10_000);
// A TUI that repaints a 40-row region in place: cursor moves, colors, a spinner and wide chars.
const tui = () => {
    let out = '';
    for (let frame = 0; frame < 2_000; frame++) {
        out += '\x1b[?2026h\x1b[H';
        for (let row = 1; row <= 30; row++) {
            out += `\x1b[${row};1H\x1b[2K\x1b[38;5;${(row * 7 + frame) % 256}m${'│ '.padEnd(4)}frame ${frame} row ${row} ✓ 日本語 \x1b[1;34m${'•'.repeat(row % 20)}\x1b[0m`;
        }
        out += `\x1b[40;1H\x1b[2K${'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[frame % 10]} working\x1b[?2026l`;
    }
    return out;
};
const input = workload === 'tui' ? tui() : plain();
const inputBytes = Buffer.byteLength(input);
const create = () => {
    const terminal = new Terminal({ cols: COLS, rows: ROWS, scrollback: SCROLLBACK, allowProposedApi: true });
    const serializer = new SerializeAddon();
    terminal.loadAddon(serializer);
    return { terminal, serializer };
};
const write = (terminal) => new Promise((resolve) => terminal.write(input, resolve));
const warm = create();
await write(warm.terminal);
warm.serializer.serialize({ scrollback: SCROLLBACK });
warm.terminal.dispose();
Bun.gc(true);
const baselineRss = process.memoryUsage().rss;
const terminals = Array.from({ length: count }, create);
const cpuStart = process.cpuUsage();
const fillStart = performance.now();
for (const { terminal } of terminals) { await write(terminal); }
const fillMs = performance.now() - fillStart;
const cpu = process.cpuUsage(cpuStart);
Bun.gc(true);
const filledRss = process.memoryUsage().rss;
const each = [];
let snapshotBytes = 0;
const snapshots = terminals.map(({ serializer }) => {
    const start = performance.now();
    const screen = serializer.serialize({ scrollback: SCROLLBACK });
    each.push(performance.now() - start);
    snapshotBytes += Buffer.byteLength(screen);
    return screen;
});
const snapshotRss = process.memoryUsage().rss;
const plainStart = performance.now();
for (const { terminal } of terminals) {
    const buffer = terminal.buffer.active;
    const lines = [];
    for (let i = 0; i < buffer.length; i++) { lines.push(buffer.getLine(i)?.translateToString(true) ?? ''); }
    lines.join('\n');
}
const plainTextMs = performance.now() - plainStart;
const MiB = 1024 * 1024;
console.log(JSON.stringify({ workload, count, bun: Bun.version, inputMiB: +(inputBytes / MiB).toFixed(2),
    parseMiBps: +((inputBytes * count / MiB) / (fillMs / 1000)).toFixed(1), fillMs: +fillMs.toFixed(1), fillCpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1),
    rssPerTerminalMiB: +((filledRss - baselineRss) / count / MiB).toFixed(1), baselineRssMiB: +(baselineRss / MiB).toFixed(1),
    filledRssMiB: +(filledRss / MiB).toFixed(1), snapshotRssMiB: +(snapshotRss / MiB).toFixed(1),
    serializeMsMax: +Math.max(...each).toFixed(1), serializeMsTotal: +each.reduce((a, b) => a + b, 0).toFixed(1),
    snapshotMiB: +(snapshotBytes / MiB).toFixed(1), plainTextMsTotal: +plainTextMs.toFixed(1), kept: snapshots.length }));
for (const { terminal } of terminals) { terminal.dispose(); }
