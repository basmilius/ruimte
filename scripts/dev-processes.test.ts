import { describe, expect, test } from 'bun:test';
import { scheduleForcedStop, stopOwnedProcess, type OwnedProcess } from './dev-processes';

describe('development process cleanup', () => {
    test('signals only the owned process group on Unix', () => {
        const groups: Array<[number, NodeJS.Signals]> = [];
        const child: OwnedProcess = { pid: 123, kill: () => true };
        stopOwnedProcess(child, 'SIGTERM', 'darwin', (pid, signal) => groups.push([pid, signal]));
        expect(groups).toEqual([[-123, 'SIGTERM']]);
    });

    test('uses the child handle on Windows', () => {
        const signals: NodeJS.Signals[] = [];
        const child: OwnedProcess = { pid: 123, kill: (signal) => (signals.push(signal), true) };
        stopOwnedProcess(child, 'SIGTERM', 'win32', () => {
            throw new Error('must not signal a Unix group');
        });
        expect(signals).toEqual(['SIGTERM']);
    });

    test('does not signal a process handle that has already exited', () => {
        let killed = false;
        const child: OwnedProcess = { pid: 123, exitCode: 0, signalCode: null, kill: () => (killed = true) };
        stopOwnedProcess(child, 'SIGTERM', 'darwin', () => {
            throw new Error('must not signal a reused process group');
        });
        expect(killed).toBeFalse();
    });

    test('keeps the forced-stop deadline referenced and kills remaining children', async () => {
        const signals: NodeJS.Signals[] = [];
        const child: OwnedProcess = { kill: (signal) => (signals.push(signal), true) };
        const deadline = scheduleForcedStop([child], 1);
        expect(deadline.hasRef()).toBeTrue();
        await Bun.sleep(10);
        expect(signals).toEqual(['SIGKILL']);
    });
});
