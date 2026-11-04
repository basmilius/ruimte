import { describe, expect, test } from 'bun:test';
import type { AppIpc } from '@adecore/shell';
import type { MachineMode } from '@ruimte/desktop-bridge';
import type { MachineModeFile } from '../machine-mode';
import { installMachineMode } from './machine-mode';

interface Rig {
    events: string[];
    choose(next: unknown): unknown;
    runLater(): void;
}

function rig(mode: MachineMode, options: { writeFails?: boolean; removeFails?: boolean } = {}): Rig {
    const events: string[] = [];
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const later: Array<() => void> = [];
    const ipc = { handle: (channel, handler) => void handlers.set(channel, handler as never) } as AppIpc;
    const store: MachineModeFile = {
        read: () => null,
        write(next) {
            events.push(`write ${next}`);
            if (options.writeFails && next !== mode) {
                throw new Error('disk full');
            }
        }
    };
    installMachineMode(ipc, {
        mode,
        store,
        machine: {
            stopPreview: async () => ({ work: null, home: '~/.ruimte', commandLine: false }),
            stopOnQuit: (stop) => void events.push(`stopOnQuit ${stop}`),
            removeOwnService() {
                events.push('removeOwnService');
                if (options.removeFails) {
                    throw new Error('launchctl failed');
                }
            }
        },
        relaunch: () => void events.push('relaunch'),
        later: (run) => void later.push(run)
    });
    return {
        events,
        choose: (next) => handlers.get('machine:choose')!({}, next),
        runLater: () => later.splice(0).forEach((run) => run())
    };
}

describe('machine:choose', () => {
    test('refuses a mode it does not know and touches nothing', () => {
        const shell = rig('local');
        for (const next of ['ask', 'remote', '', null, undefined, 3]) {
            expect(() => shell.choose(next)).toThrow('Unknown machine mode');
        }
        expect(shell.events).toEqual([]);
    });

    test('writes the choice before anything stops, and relaunches only after the reply', () => {
        const shell = rig('local');
        shell.choose('none');
        expect(shell.events).toEqual(['write none', 'removeOwnService', 'stopOnQuit true']);
        shell.runLater();
        expect(shell.events.at(-1)).toBe('relaunch');
    });

    test('choosing without stopping a machine still writes the choice and defers relaunch', () => {
        const choices: Array<[MachineMode, 'local' | 'none']> = [
            ['ask', 'local'],
            ['ask', 'none'],
            ['none', 'local'],
            ['none', 'none'],
            ['local', 'local']
        ];
        for (const [current, next] of choices) {
            const shell = rig(current);
            shell.choose(next);
            expect(shell.events).toEqual([`write ${next}`, 'stopOnQuit false']);
            shell.runLater();
            expect(shell.events).toEqual([`write ${next}`, 'stopOnQuit false', 'relaunch']);
        }
    });

    test('a write that fails rejects before anything stopped, and the choice can be made again', () => {
        const shell = rig('local', { writeFails: true });
        expect(() => shell.choose('none')).toThrow('disk full');
        expect(shell.events).toEqual(['write none']);
        shell.runLater();
        expect(shell.events).toEqual(['write none']);
        expect(() => shell.choose('none')).toThrow('disk full');
    });

    test('a definition that cannot be removed puts the old mode back and rejects', () => {
        const shell = rig('local', { removeFails: true });
        expect(() => shell.choose('none')).toThrow('launchctl failed');
        expect(shell.events).toEqual(['write none', 'removeOwnService', 'write local']);
    });

    test('once a choice is on its way every later one is refused', () => {
        const shell = rig('local');
        shell.choose('none');
        expect(() => shell.choose('local')).toThrow('already switching');
        expect(() => shell.choose('none')).toThrow('already switching');
        shell.runLater();
        expect(shell.events.filter((event) => event.startsWith('write'))).toEqual(['write none']);
        expect(shell.events.filter((event) => event === 'relaunch')).toHaveLength(1);
    });
});
