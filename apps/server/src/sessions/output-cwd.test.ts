import { afterEach, expect, test } from 'bun:test';
import { trackTerminalCwd, windowsPathOfMsys } from '@ruimte/contracts';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';

const root = '\x1b]7;file://localhost/root\x07';
const child = '\x1b]7;file://localhost/root/nested\x07';

const open: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (const state of open.splice(0)) {
        state.dispose();
    }
});

function fixture(scrollback = 10000, platform: string | null = null) {
    const term = new Terminal({ cols: 40, rows: 8, scrollback, allowProposedApi: true });
    const cwd = trackTerminalCwd(term, platform);
    const serialize = new SerializeAddon();
    term.loadAddon(serialize);
    const state = {
        term,
        cwd,
        write: (data: string) => new Promise<void>((resolve) => term.write(data, resolve)),
        snapshot: () => serialize.serialize({ scrollback }) + cwd.snapshot(scrollback),
        dispose() {
            cwd.dispose();
            term.dispose();
        }
    };
    open.push(state);
    return state;
}

test('cwd belongs to output, survives reflow and round-trips with the serialized screen', async () => {
    const first = fixture();
    const second = fixture();
    await first.write(root + 'same.ts:12:4-16\r\n' + child + 'same.ts:12:4-16\r\n');
    expect(first.cwd.at(1)).toBe('/root');
    expect(first.cwd.at(2)).toBe('/root/nested');
    first.term.resize(10, 8);
    second.term.resize(10, 8);
    expect(first.cwd.at(1)).toBe('/root');
    expect(first.cwd.at(3)).toBe('/root/nested');
    await second.write(first.snapshot());
    expect(second.cwd.at(1)).toBe('/root');
    expect(second.cwd.at(3)).toBe('/root/nested');
    await second.write('later.ts:12:4-16\r\n');
    expect(second.cwd.at(5)).toBe('/root/nested');
});

test('10000 output lines use one transition marker and trimmed history keeps its cwd', async () => {
    const state = fixture(100);
    await state.write(root + 'same.ts:12:4-16\r\n'.repeat(10000));
    expect(state.term.markers.length).toBeLessThanOrEqual(1);
    expect(state.cwd.at(1)).toBe('/root');
    expect(state.cwd.at(state.term.buffer.normal.length)).toBe('/root');
    expect(state.cwd.snapshot(100).length).toBeLessThan(300);
});

test('cwd transitions are bounded; evicted history is unknown', async () => {
    const state = fixture();
    await state.write(Array.from({ length: 10000 }, (_, index) => `\x1b]7;file://localhost/folder${index}\x07same.ts\r\n`).join(''));
    expect(state.term.markers.length).toBeLessThanOrEqual(128);
    expect(state.cwd.at(1)).toBeNull();
    expect(state.cwd.at(state.term.buffer.normal.length)).toBe('/folder9999');
    expect(state.cwd.snapshot(10000).length).toBeLessThan(32768);
});

for (const sequence of ['\x1bc', '\x1b[2J', '\x1b[3J', '\x1b[?1049h', '\x1b]7;file://host/%00\x07', '\x1b]777;ruimte-cwd;{broken\x07']) {
    test('reset, erase, alternate and malformed metadata revoke cwd: ' + JSON.stringify(sequence), async () => {
        const state = fixture();
        await state.write(root + 'same.ts\r\n' + sequence + 'same.ts\r\n');
        const buffer = state.term.buffer.active;
        expect(state.cwd.at(buffer.baseY + buffer.cursorY)).toBeNull();
    });
}

test('alternate output cannot relabel normal scrollback', async () => {
    const state = fixture();
    await state.write(root + 'same.ts\r\n\x1b[?1049h\x1b[H\x1b[2J' + child + 'other.ts\x1b[?1049l');
    expect(state.cwd.at(1)).toBe('/root');
    await state.write('unknown.ts\r\n');
    expect(state.cwd.at(2)).toBeNull();
});

test('a directory change inside a wrapped logical row makes the whole row ambiguous', async () => {
    const state = fixture();
    state.term.resize(10, 8);
    await state.write(root + 'prefixprefixprefix ' + child + 'new.ts:3');
    expect(state.cwd.at(1)).toBeNull();
    expect(state.cwd.at(2)).toBeNull();
    await state.write('\r\nnew.ts:3\r\n');
    expect(state.cwd.at(4)).toBe('/root/nested');
});

test('cursor-addressed rewrites revoke old directories until a new cwd arrives', async () => {
    const state = fixture();
    await state.write(root + 'same.ts:2:3-4\r\n' + child + 'same.ts:2:3-4\r\n\x1b[2A\x1b[2Ksame.ts:2:3-4');
    expect(state.cwd.at(1)).toBeNull();
    await state.write('\r\n');
    expect(state.cwd.at(1)).toBeNull();
    await state.write('\r\n' + child + 'same.ts:2:3-4\r\n');
    expect(state.cwd.at(3)).toBe('/root/nested');
});

test('metadata-free output retains no markers at full scrollback', async () => {
    const state = fixture();
    await state.write('same.ts\r\n'.repeat(50000));
    expect(state.term.buffer.normal.length).toBe(10008);
    expect(state.term.markers).toHaveLength(0);
    expect(state.cwd.at(1)).toBeNull();
    expect(state.cwd.at(10008)).toBeNull();
});

test('snapshots without metadata or with incompatible dimensions leave relative paths unknown', async () => {
    const original = fixture();
    const restored = fixture();
    await original.write(root + 'same.ts\r\n' + child + 'same.ts\r\n');
    await restored.write('same.ts\r\n');
    expect(restored.cwd.at(1)).toBeNull();
    restored.term.resize(41, 8);
    await restored.write(original.snapshot());
    expect(restored.cwd.at(1)).toBeNull();
});

test('reduced snapshot scrollback keeps the directory of the retained prefix', async () => {
    const original = fixture();
    const restored = fixture();
    await original.write(root + 'old.ts\r\n'.repeat(15) + child + 'new.ts\r\n'.repeat(15));
    const addon = new SerializeAddon();
    original.term.loadAddon(addon);
    await restored.write(addon.serialize({ scrollback: 3 }) + original.cwd.snapshot(3));
    expect(restored.cwd.at(1)).toBe('/root/nested');
    expect(restored.term.buffer.normal.length).toBe(11);
});

test('an MSYS path is the Windows path it means, and one off any drive is unknown', () => {
    expect(windowsPathOfMsys('/c/Users/bas/my project')).toBe('C:\\Users\\bas\\my project');
    expect(windowsPathOfMsys('/d')).toBe('D:\\');
    expect(windowsPathOfMsys('/C:/Users')).toBe('C:\\Users');
    expect(windowsPathOfMsys('/usr/bin')).toBeNull();
    expect(windowsPathOfMsys('/tmp')).toBeNull();
    expect(windowsPathOfMsys('/')).toBeNull();
});

test('on Windows the cwd Git Bash reports is a Windows path, and round-trips with the screen', async () => {
    const windows = fixture(10000, 'win32');
    const restored = fixture(10000, 'win32');
    const posix = fixture();
    const marker = '\x1b]7;file://localhost/c/Users/bas/my%20project\x07';
    await windows.write(marker + 'out.ts:1\r\n\x1b]7;file://localhost/usr/bin\x07usr.ts:1\r\n');
    expect(windows.cwd.at(1)).toBe('C:\\Users\\bas\\my project');
    expect(windows.cwd.at(2)).toBeNull();
    await restored.write(windows.snapshot());
    expect(restored.cwd.at(1)).toBe('C:\\Users\\bas\\my project');
    await posix.write(marker + 'out.ts:1\r\n');
    expect(posix.cwd.at(1)).toBe('/c/Users/bas/my project');
});
