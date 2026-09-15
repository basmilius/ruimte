import { describe, expect, test } from 'bun:test';
import type { RunningMachine } from './fatal.ts';
import { startMachine, type StartDeps } from './start.ts';

const address = { host: '127.0.0.1', port: 4210 };

const fakes = (options: { taken?: boolean; running?: RunningMachine | null; start?: () => Promise<void> }) => {
    const calls: string[] = [];
    const lines: string[] = [];
    const deps: StartDeps = {
        portTaken: async () => {
            calls.push('portTaken');
            return options.taken ?? false;
        },
        askRunningMachine: async () => {
            calls.push('askRunningMachine');
            return options.running ?? null;
        },
        start: async () => {
            calls.push('start');
            await options.start?.();
        },
        err: (line) => lines.push(line)
    };
    return { deps, calls, lines };
};

describe('startMachine', () => {
    test('a free port starts the machine without asking anyone on it', async () => {
        const { deps, calls, lines } = fakes({});
        expect(await startMachine(address, deps)).toBeNull();
        expect(calls).toEqual(['portTaken', 'start']);
        expect(lines).toEqual([]);
    });

    test('a taken port refuses before anything starts', async () => {
        const { deps, calls, lines } = fakes({ taken: true, running: { version: '0.4.0', service: true } });
        expect(await startMachine(address, deps)).toBe(1);
        expect(calls).toEqual(['portTaken', 'askRunningMachine']);
        expect(lines[0]).toStartWith('A Ruimte machine is already running on port 4210 (version 0.4.0, as the background service).');
    });

    test('a port taken in between is caught at the listen', async () => {
        const inUse = Object.assign(new Error('Failed to start server. Is port 4210 in use?'), { code: 'EADDRINUSE' });
        const { deps, calls, lines } = fakes({ start: () => Promise.reject(inUse) });
        expect(await startMachine(address, deps)).toBe(1);
        expect(calls).toEqual(['portTaken', 'start', 'askRunningMachine']);
        expect(lines[0]).toStartWith('Port 4210 is in use by another program.');
    });

    test('any other failure is left to the caller', async () => {
        const { deps } = fakes({ start: () => Promise.reject(new Error('the home is not writable')) });
        expect(startMachine(address, deps)).rejects.toThrow('the home is not writable');
    });

    test('port 0 is never looked at', async () => {
        const { deps, calls } = fakes({ taken: true });
        expect(await startMachine({ ...address, port: 0 }, deps)).toBeNull();
        expect(calls).toEqual(['start']);
    });
});
