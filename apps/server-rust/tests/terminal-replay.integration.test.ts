import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { Terminal } from '@xterm/headless';

import { startDaemon } from './wire-client';

const cases: ReadonlyArray<readonly [string, string]> = [
    ['leading combining', '\u0301A\r\n\u0308B'],
    ['wide overwrite', '界界界abc\x1b[1;2HX\x1b[1;5HY'],
    ['wide right edge', '12345678901界Z\r\nnext'],
    ['wrap then newline', '123456789012abc\x1b[1;12HXlogout\r\n'],
    ['wrap then erase', '123456789012abcdefghijkl\x1b[1;4H\x1b[K\x1b[2;1Hend'],
    ['insert delete wide', 'A界BC界D\x1b[1;3H\x1b[2@XX\x1b[1;7H\x1b[2P'],
    ['combining across wrap', '123456789012\u0301X\u0308'],
    ['emoji selectors', '✈️ ☀️ 👍🏽 👩‍💻 🇳🇱 end'],
    ['margins scroll', `${Array.from({ length: 9 }, (_, index) => `line${index}\r\n`).join('')}\x1b[2;5r\x1b[5;1Hbottom\r\nmore\x1b[r`],
    ['tabs', 'A\tB\r\n123\x1bH\r\tX\x1b[3g\r\tZ'],
    ['insert delete lines', 'one\r\ntwo\r\nthree\r\nfour\x1b[2;1H\x1b[1Lnew\x1b[4;1H\x1b[M'],
    ['saved cursor', '123456789012\x1b7\r\nnext\x1b8X'],
    ['no wrap', '\x1b[?7l123456789012345界A\x1b[?7hX'],
    ['erase history', `${Array.from({ length: 15 }, (_, index) => `row${index}\r\n`).join('')}\x1b[3Jkept`],
    ['alternate', 'primary\x1b[?1049halternate界😀\x1b[?1049lreturned']
];

test('terminal snapshots reconstruct the live xterm state across control and Unicode cases', async () => {
    const daemon = await startDaemon();
    const client = await daemon.connect();

    try {
        for (const [index, [name, body]] of cases.entries()) {
            const sessionId = `replay-${index}`;
            const file = join(daemon.home, sessionId);
            await Bun.write(file, `\x1bc${body}`);
            await client.call('session.create', { sessionId, shell: '/bin/sh', cols: 12, rows: 6 });
            await client.call('session.attach', { sessionId, cols: 12, rows: 6 });
            await client.call('session.write', { sessionId, data: `stty -echo; cat '${file}'; exit\n` });
            await waitFor(() => (client.frames.some((frame: any) => frame.event === 'session.exit' && frame.payload.sessionId === sessionId) ? true : null));

            const attached = await client.call('session.attach', { sessionId, follow: true });
            const snapshot = await terminalState(attached.screen);
            const wire = client.frames
                .filter((frame: any) => frame.event === 'session.output' && frame.payload.sessionId === sessionId)
                .map((frame: any) => frame.payload.data)
                .join('');
            const live = await terminalState(wire);

            if (name === 'leading combining') {
                expect(snapshot).not.toEqual(live);
                expect(snapshot.lines[0].cells[0]).toEqual(['A', 1]);
                expect(snapshot.lines[1].cells[0]).toEqual(['B', 1]);
                expect(live.lines[0].cells.slice(0, 2)).toEqual([
                    ['́', 0],
                    ['A', 1]
                ]);
                expect(live.lines[1].cells.slice(0, 2)).toEqual([
                    ['̈', 0],
                    ['B', 1]
                ]);
            } else {
                expect(snapshot, name).toEqual(live);
            }
        }
        expect(client.violations).toEqual([]);
    } finally {
        client.close();
        await daemon.stop();
    }
}, 60_000);

interface TerminalState {
    x: number;
    y: number;
    baseY: number;
    lines: Array<{ wrapped: boolean; cells: Array<[string, number]> }>;
}

const terminalState = async (data: string): Promise<TerminalState> => {
    const terminal = new Terminal({ cols: 12, rows: 6, scrollback: 10_000, allowProposedApi: true });
    await new Promise<void>((resolve) => terminal.write(data, resolve));
    const buffer = terminal.buffer.active;
    const lines = Array.from({ length: buffer.length }, (_, lineIndex) => {
        const line = buffer.getLine(lineIndex);
        return {
            wrapped: line.isWrapped,
            cells: Array.from({ length: 12 }, (_, cellIndex): [string, number] => {
                const cell = line.getCell(cellIndex);
                return [cell.getChars(), cell.getWidth()];
            })
        };
    });
    const state = { x: buffer.cursorX, y: buffer.cursorY, baseY: buffer.baseY, lines };
    terminal.dispose();
    return state;
};

const waitFor = async <T>(read: () => T | null): Promise<T> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const value = read();
        if (value) {
            return value;
        }
        await Bun.sleep(10);
    }
    throw new Error('Condition timed out');
};
