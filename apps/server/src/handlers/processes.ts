import type { Area } from '../area.ts';
import type { Dispatcher } from '../dispatcher.ts';
import type { ProcessMonitor } from '../processes/monitor.ts';

export interface ProcessesDeps {
    monitor: ProcessMonitor;
}

export function processesArea(deps: ProcessesDeps): Area {
    const { monitor } = deps;

    return {
        name: 'processes',
        sources: [monitor],
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        stop: [{ phase: 'halt', label: 'Stopping the process monitor', run: () => monitor.stop() }]
    };
}

function registerRequests(dispatcher: Dispatcher, { monitor }: ProcessesDeps): void {
    // The panel is open on this client, so the tempo goes up for as long as it stays open or the socket does.
    dispatcher.register('processes.subscribe', (payload, client) => monitor.follow(client.id, payload));

    dispatcher.register('processes.unsubscribe', (_payload, client) => {
        monitor.unfollow(client.id);
        return {};
    });

    dispatcher.register('processes.signal', (payload) => {
        monitor.signal(payload);
        return {};
    });

    dispatcher.register('processes.listAlerts', () => ({ alerts: monitor.alerts() }));

    dispatcher.register('processes.dismiss', (payload) => {
        monitor.dismiss(payload.id);
        return {};
    });
}
