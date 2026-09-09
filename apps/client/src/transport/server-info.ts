import { useServer } from '@/state/server';
import { transport } from '@/transport';

const load = (): void => {
    transport
        .request('server.hello', {})
        .then((info) => useServer.getState().setInfo({ platform: info.platform, home: info.home }))
        .catch(() => undefined);
};

/* Asks the daemon who it is on every connection; the answer feeds platform-specific labels. */
export const startServerInfo = (): (() => void) => {
    if (transport.status === 'open') {
        load();
    }
    return transport.subscribeStatus((status) => {
        if (status === 'open') {
            load();
        }
    });
};
