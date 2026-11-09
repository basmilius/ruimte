import type { Area } from '../area.ts';

interface ServerDeps {
    version: string;
    home: string;
    /* What this machine's hardware is called, or null when nothing here could say. */
    model: string | null;
}

export function serverArea(deps: ServerDeps): Area {
    return {
        name: 'server',
        handlers: (dispatcher) => {
            dispatcher.register('server.hello', () => ({
                version: deps.version,
                platform: process.platform,
                home: deps.home,
                ...(deps.model === null ? {} : { model: deps.model })
            }));

            // There is nothing to compute. The round trip is the answer, and the client times it.
            dispatcher.register('server.ping', () => ({ time: Date.now() }), { peer: true });
        }
    };
}
