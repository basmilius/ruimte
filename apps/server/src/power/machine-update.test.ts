import { describe, expect, test } from 'bun:test';
import type { SessionEvent } from '../sessions/manager.ts';
import { MachineUpdates, workEndedByInstall } from './machine-update.ts';

function listen(updates: MachineUpdates, clientId: string) {
    const events: SessionEvent[] = [];
    const off = updates.subscribe(clientId, (event) => events.push(event));
    return { events, off };
}

describe('MachineUpdates', () => {
    test('without an app the machine says so', () => {
        expect(new MachineUpdates().state()).toEqual({ app: false, status: 'unsupported' });
    });

    test('the app report is the state, and every client hears a change once', () => {
        const updates = new MachineUpdates();
        const app = listen(updates, 'app');
        const phone = listen(updates, 'phone');
        updates.report('app', { status: 'available', currentVersion: '1.0.0', version: '1.1.0' });
        updates.report('app', { status: 'available', currentVersion: '1.0.0', version: '1.1.0' });
        expect(updates.state()).toEqual({ app: true, status: 'available', currentVersion: '1.0.0', version: '1.1.0' });
        expect(phone.events).toEqual([
            { event: 'endpoint.updateChanged', payload: { update: { app: true, status: 'available', currentVersion: '1.0.0', version: '1.1.0' } } }
        ]);
        expect(app.events).toHaveLength(1);
    });

    test('a download is told per whole percent', () => {
        const updates = new MachineUpdates();
        const phone = listen(updates, 'phone');
        listen(updates, 'app');
        for (const percent of [10.1, 10.6, 10.9, 11.2]) {
            updates.report('app', { status: 'downloading', percent });
        }
        expect(phone.events).toHaveLength(2);
    });

    test('the app going takes its report along', () => {
        const updates = new MachineUpdates();
        const phone = listen(updates, 'phone');
        const app = listen(updates, 'app');
        updates.report('app', { status: 'ready', version: '1.1.0' });
        app.off();
        expect(updates.state()).toEqual({ app: false, status: 'unsupported' });
        expect(phone.events.at(-1)).toEqual({ event: 'endpoint.updateChanged', payload: { update: { app: false, status: 'unsupported' } } });
    });

    test('an install goes to the window that reported last, and only with something to install', () => {
        const updates = new MachineUpdates();
        expect(updates.requestInstall()).toBe('no-app');
        const first = listen(updates, 'first');
        const second = listen(updates, 'second');
        updates.report('first', { status: 'current' });
        updates.report('second', { status: 'current' });
        expect(updates.requestInstall()).toBe('nothing');
        updates.report('second', { status: 'ready', version: '1.1.0' });
        updates.report('first', { status: 'ready', version: '1.1.0' });
        expect(updates.requestInstall()).toBe('asked');
        expect(first.events.filter((event) => event.event === 'endpoint.updateInstall')).toHaveLength(1);
        expect(second.events.filter((event) => event.event === 'endpoint.updateInstall')).toHaveLength(0);
    });
});

test('an install ends nothing when the service outlives the app', () => {
    expect(workEndedByInstall(true, { terminals: 2, agents: 1 })).toEqual({ terminals: 0, agents: 0 });
    expect(workEndedByInstall(false, { terminals: 2, agents: 1 })).toEqual({ terminals: 2, agents: 1 });
});
