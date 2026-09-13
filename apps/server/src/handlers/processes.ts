import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { ProcessError, type ProcessMonitor } from '../processes/monitor.ts';

export const registerProcessHandlers = (dispatcher: Dispatcher, monitor: ProcessMonitor): void => {
    // The panel is open on this client: the tempo goes up for as long as it stays open or the socket does.
    dispatcher.register('processes.subscribe', (payload, client) => monitor.follow(client.id, payload));

    dispatcher.register('processes.unsubscribe', (_payload, client) => {
        monitor.unfollow(client.id);
        return {};
    });

    dispatcher.register('processes.signal', (payload) => {
        try {
            monitor.signal(payload);
        } catch (e) {
            if (e instanceof ProcessError) {
                throw new RequestError(e.code, e.message);
            }
            throw e;
        }
        return {};
    });

    dispatcher.register('processes.listAlerts', () => ({ alerts: monitor.alerts() }));

    dispatcher.register('processes.dismiss', (payload) => {
        monitor.dismiss(payload.id);
        return {};
    });
};
