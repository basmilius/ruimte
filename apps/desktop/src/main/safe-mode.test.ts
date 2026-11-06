import { describe, expect, test } from 'bun:test';
import type { AppIpc } from '@adecore/shell';
import { inSafeMode, installSafeMode, startsInSafeMode } from './safe-mode';

function restart(argv: string[], answer = true): { relaunched: string[][]; runLater(): void; ask(): unknown } {
    const handlers = new Map<string, (event: unknown) => unknown>();
    const later: Array<() => void> = [];
    const relaunched: string[][] = [];
    const ipc = { handle: (channel, handler) => void handlers.set(channel, handler as never) } as AppIpc;
    installSafeMode(ipc, {
        argv,
        relaunch: (args) => void relaunched.push(args),
        askBeforeQuit: async () => answer,
        later: (run) => void later.push(run)
    });

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

    test('restarting from Help starts again with --safe-mode once, after the reply', async () => {
        const shell = restart(['/usr/bin/ruimte', '--machine=local', '--safe-mode']);
        await shell.ask();

        expect(shell.relaunched).toEqual([]);

        shell.runLater();

        expect(shell.relaunched).toEqual([['--machine=local', '--safe-mode']]);
    });

    test('restarting from Help while work runs keeps the app open when the person says no', async () => {
        const shell = restart(['/usr/bin/ruimte'], false);
        await shell.ask();
        shell.runLater();

        expect(shell.relaunched).toEqual([]);
    });
});
