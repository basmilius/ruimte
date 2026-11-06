import { describe, expect, test } from 'bun:test';
import type { DesktopIpc } from './ipc';
import { inSafeMode, installSafeMode, startsInSafeMode } from './safe-mode';

function restart(argv: string[]): { relaunched: string[][]; runLater(): void; ask(): unknown } {
    const handlers = new Map<string, (event: unknown) => unknown>();
    const later: Array<() => void> = [];
    const relaunched: string[][] = [];
    const ipc = { handle: (channel: string, handler: unknown) => void handlers.set(channel, handler as never) } as unknown as DesktopIpc;
    installSafeMode(ipc, { argv, relaunch: (args) => void relaunched.push(args), later: (run) => void later.push(run) });

    return {
        relaunched,
        runLater: () => later.splice(0).forEach((run) => run()),
        ask: () => handlers.get('app:restart-safe-mode')!({})
    };
}

describe('safe mode', () => {
    test('a start with --safe-mode marks the address of every window, and an ordinary start leaves it alone', () => {
        const base = 'app://ruimte/?project=local%3Ap1';

        expect(startsInSafeMode(['/Applications/Ruimte.app/Contents/MacOS/Ruimte', '--safe-mode'])).toBe(true);
        expect(startsInSafeMode(['/Applications/Ruimte.app/Contents/MacOS/Ruimte'])).toBe(false);
        expect(new URL(inSafeMode(base, true)).searchParams.has('safe-mode')).toBe(true);
        expect(new URL(inSafeMode(base, true)).searchParams.get('project')).toBe('local:p1');
        expect(inSafeMode(base, false)).toBe(base);
    });

    test('restarting from Help starts again with --safe-mode once, after the reply', () => {
        const shell = restart(['/usr/bin/ruimte', '--machine=local', '--safe-mode']);
        shell.ask();

        expect(shell.relaunched).toEqual([]);

        shell.runLater();

        expect(shell.relaunched).toEqual([['--machine=local', '--safe-mode']]);
    });
});
