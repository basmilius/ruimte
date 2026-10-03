import { describe, expect, test } from 'bun:test';
import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import type { UpdateState } from '@/desktop/bridge';
import type { WatchablePool } from '@/transport/pool-watch';
import type { Transport, TransportStatus } from '@/transport/transport';
import { installStep, machineReportOf, startMachineUpdate } from './machine-update';

class FakeLink implements Transport {
    status: TransportStatus = 'open';
    readonly sent: { type: string; payload: unknown }[] = [];
    private readonly handlers = new Map<string, (payload: unknown) => void>();

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.sent.push({ type, payload });
        return Promise.resolve({} as RequestMap[T]['result']);
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        this.handlers.set(event, handler as (payload: unknown) => void);
        return () => this.handlers.delete(event);
    }

    emit(event: EventType, payload: unknown): void {
        this.handlers.get(event)?.(payload);
    }

    subscribeStatus(): () => void {
        return () => undefined;
    }
}

const poolOf = (links: Record<string, FakeLink>): WatchablePool => ({
    ids: () => Object.keys(links),
    peek: (endpointId) => links[endpointId] ?? null,
    subscribe: () => () => undefined
});

const shellAt = (initial: UpdateState) => {
    const calls: string[] = [];
    let state = initial;
    return {
        calls,
        set(next: UpdateState) {
            state = next;
        },
        shell: {
            state: () => state,
            download: async () => {
                calls.push('download');
            },
            install: () => calls.push('install')
        }
    };
};

describe('machineReportOf', () => {
    test('carries the step, the versions and the percent', () => {
        expect(machineReportOf({ status: 'downloading', currentVersion: '1.0.0', version: '1.1.0', percent: 40 })).toEqual({
            status: 'downloading',
            currentVersion: '1.0.0',
            version: '1.1.0',
            percent: 40
        });
    });

    test('a step this wire does not know tells nothing', () => {
        expect(machineReportOf({ status: 'paused' as UpdateState['status'], currentVersion: '1.0.0' })).toBeNull();
    });
});

test('installStep downloads first when nothing is downloaded yet', () => {
    expect(installStep('ready')).toBe('install');
    expect(installStep('available')).toBe('download');
    expect(installStep('downloading')).toBe('wait');
    expect(installStep('current')).toBe('none');
});

describe('startMachineUpdate', () => {
    test('reports to the local machine only, on open and on every step', () => {
        const local = new FakeLink();
        const other = new FakeLink();
        const { shell } = shellAt({ status: 'current', currentVersion: '1.0.0' });
        const machine = startMachineUpdate(shell, poolOf({ local, other }));
        machine.apply({ status: 'available', currentVersion: '1.0.0', version: '1.1.0' });
        expect(local.sent.map((entry) => entry.payload)).toEqual([
            { status: 'current', currentVersion: '1.0.0' },
            { status: 'available', currentVersion: '1.0.0', version: '1.1.0' }
        ]);
        expect(other.sent).toEqual([]);
        machine.stop();
    });

    test('an install the machine hands back installs a ready update at once', () => {
        const local = new FakeLink();
        const { shell, calls } = shellAt({ status: 'ready', currentVersion: '1.0.0', version: '1.1.0' });
        startMachineUpdate(shell, poolOf({ local }));
        local.emit('endpoint.updateInstall', {});
        expect(calls).toEqual(['install']);
    });

    test('one not yet downloaded downloads first and installs once it is ready', () => {
        const local = new FakeLink();
        const { shell, calls, set } = shellAt({ status: 'available', currentVersion: '1.0.0', version: '1.1.0' });
        const machine = startMachineUpdate(shell, poolOf({ local }));
        local.emit('endpoint.updateInstall', {});
        expect(calls).toEqual(['download']);
        const ready: UpdateState = { status: 'ready', currentVersion: '1.0.0', version: '1.1.0' };
        set(ready);
        machine.apply(ready);
        machine.apply(ready);
        expect(calls).toEqual(['download', 'install']);
    });

    test('a download that fails leaves the next ready to a person', () => {
        const local = new FakeLink();
        const { shell, calls } = shellAt({ status: 'downloading', currentVersion: '1.0.0', percent: 10 });
        const machine = startMachineUpdate(shell, poolOf({ local }));
        local.emit('endpoint.updateInstall', {});
        machine.apply({ status: 'error', currentVersion: '1.0.0', error: 'offline' });
        machine.apply({ status: 'ready', currentVersion: '1.0.0', version: '1.1.0' });
        expect(calls).toEqual([]);
    });
});
