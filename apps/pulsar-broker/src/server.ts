import { Broker, type Peer } from './broker.ts';
import { clientIpOf, nameFor, type BrokerConfig, type TurnConfig } from './config.ts';
import { cloudflareTurn, noTurn, sharedSecretTurn, type TurnProvider } from './turn.ts';

interface SocketData {
    ip: string;
    name: string;
    peer: Peer | null;
}

export interface RunningBroker {
    port: number;
    broker: Broker;
    stop(): Promise<void>;
}

export const turnProviderFor = (turn: TurnConfig): TurnProvider => {
    switch (turn.kind) {
        case 'none':
            return noTurn;
        case 'shared-secret':
            return sharedSecretTurn(turn);
        case 'cloudflare':
            return cloudflareTurn(turn);
    }
};

/* The broker on a Bun server: `/health` for a monitor, and a WebSocket upgrade on any other path. */
export const startBroker = (config: BrokerConfig): RunningBroker => {
    const broker = new Broker(config.limits, Date.now, turnProviderFor(config.turn));

    const server = Bun.serve<SocketData>({
        hostname: config.host,
        port: config.port,
        fetch(request, bun) {
            const url = new URL(request.url);
            if (url.pathname === '/health') {
                return Response.json({ status: 'ok', ...broker.counts });
            }
            if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
                return new Response('Not found', { status: 404 });
            }
            const name = nameFor(request.headers.get('host'), config.names);
            if (name === null) {
                return new Response('This broker does not answer to that host', { status: 421 });
            }
            const ip = clientIpOf(
                bun.requestIP(request)?.address ?? '',
                { forwardedFor: request.headers.get('x-forwarded-for'), cfConnectingIp: request.headers.get('cf-connecting-ip') },
                config
            );
            const refusal = broker.admit(ip);
            if (refusal) {
                return new Response(refusal.message, { status: 429, headers: { 'retry-after': String(Math.ceil(refusal.retryAfterMs / 1000)) } });
            }
            if (bun.upgrade(request, { data: { ip, name, peer: null } })) {
                return undefined;
            }
            return new Response('Expected a WebSocket upgrade', { status: 400 });
        },
        websocket: {
            maxPayloadLength: config.limits.maxMessageBytes,
            // The broker pings on its own heartbeat and drops by it, so Bun's idle timer would only be a second opinion.
            idleTimeout: 0,
            sendPings: false,
            open(ws) {
                ws.data.peer = broker.open(
                    {
                        send: (frame) => {
                            ws.send(frame);
                        },
                        close: (code, reason) => ws.close(code, reason),
                        ping: () => {
                            ws.ping();
                        }
                    },
                    ws.data.ip,
                    ws.data.name
                );
            },
            message(ws, message) {
                if (ws.data.peer) {
                    broker.message(ws.data.peer, typeof message === 'string' ? message : null);
                }
            },
            pong(ws) {
                if (ws.data.peer) {
                    broker.heard(ws.data.peer);
                }
            },
            close(ws) {
                if (ws.data.peer) {
                    broker.closed(ws.data.peer);
                }
            }
        }
    });

    // Often enough that a hello timeout is kept to within a few seconds, whatever the heartbeat is.
    const sweepMs = Math.max(50, Math.min(5_000, Math.floor(Math.min(config.limits.heartbeatMs, config.limits.helloTimeoutMs) / 4)));
    const sweep = setInterval(() => broker.sweep(), sweepMs);

    return {
        port: server.port ?? config.port,
        broker,
        stop: async () => {
            clearInterval(sweep);
            broker.closeAll();
            await server.stop(true);
        }
    };
};
