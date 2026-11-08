import { base64Of } from '../../apps/client/src/base64.ts';
import { PortStreamHub, type PortTransport } from '../../apps/client/src/port-tunnel/stream-client.ts';
import { PortTunnelHost } from '../../apps/client/src/port-tunnel/tunnel-host.ts';
import { decodeBase64 } from '../../apps/client/src/transport/piece.ts';
import type { EventMap, EventType, RequestMap, RequestType } from '../../packages/contracts/src/index.ts';
import type { PortTunnelOpened, PortTunnelRequest, PortTunnelToPage, PortTunnelToShell } from '../../packages/desktop-bridge/src/index.ts';

/* What the preload of the measurement window gives the page, the same channels as the app's bridge. */
interface Harness {
    openPortTunnel(request: PortTunnelRequest): Promise<PortTunnelOpened | null>;
    openProtocolTunnel(request: PortTunnelRequest): Promise<PortTunnelOpened | null>;
    closeTunnel(id: string): void;
    portTunnelSend(message: PortTunnelToShell): void;
    onPortTunnel(listener: (message: PortTunnelToPage) => void): () => void;
    machineUrl: string;
    ipcEcho(bytes: Uint8Array): void;
    onIpcEcho(listener: (bytes: Uint8Array) => void): void;
}

declare global {
    interface Window {
        harness: Harness;
        runScenario(scenario: { kind: 'baseline' | 'bridge' | 'protocol'; sitePort: number; run: number }): Promise<unknown>;
        runIpc(): Promise<unknown>;
    }
}

class SocketTransport implements PortTransport {
    private readonly socket: WebSocket;
    private readonly pending = new Map<string, { resolve: (value: never) => void; reject: (error: Error) => void }>();
    private readonly handlers = new Map<string, Set<(payload: never) => void>>();
    private next = 1;

    constructor(socket: WebSocket) {
        this.socket = socket;
        socket.addEventListener('message', (event) => {
            const frame = JSON.parse(String(event.data)) as {
                id?: string;
                ok?: boolean;
                result?: never;
                error?: { message: string };
                type?: string;
                event?: string;
                payload?: never;
            };

            if (frame.type === 'event' && frame.event !== undefined) {
                for (const handler of this.handlers.get(frame.event) ?? []) {
                    handler(frame.payload as never);
                }

                return;
            }

            const waiting = frame.id === undefined ? undefined : this.pending.get(frame.id);

            if (waiting === undefined || frame.id === undefined) {
                return;
            }

            this.pending.delete(frame.id);

            if (frame.ok === true) {
                waiting.resolve(frame.result as never);
            } else {
                waiting.reject(new Error(frame.error?.message ?? 'The machine refused'));
            }
        });
    }

    static connect(url: string): Promise<SocketTransport> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(url);

            socket.addEventListener('open', () => resolve(new SocketTransport(socket)));
            socket.addEventListener('error', () => reject(new Error('The machine did not answer')));
        });
    }

    request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        const id = `r${this.next++}`;

        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (value: never) => void, reject });
            this.socket.send(JSON.stringify({ id, type, payload }));
        });
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const set = this.handlers.get(event) ?? new Set();

        set.add(handler as (payload: never) => void);
        this.handlers.set(event, set);

        return () => set.delete(handler as (payload: never) => void);
    }
}

let shared: { transport: SocketTransport; grantId: string; port: number } | null = null;

async function machineFor(port: number): Promise<{ transport: SocketTransport; grantId: string }> {
    if (shared === null || shared.port !== port) {
        const transport = await SocketTransport.connect(window.harness.machineUrl);
        const { grant } = await transport.request('port.share', { projectId: 'measurement', port, host: '::1' });

        shared = { transport, grantId: grant.id, port };
    }

    return shared;
}

function awaitResult(view: HTMLElement): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The page gave no result in 40 seconds')), 40_000);

        view.addEventListener('page-title-updated', (event) => {
            const title = (event as unknown as { title: string }).title;

            if (title.startsWith('RESULT:')) {
                clearTimeout(timer);
                resolve(JSON.parse(title.slice('RESULT:'.length)));
            }
        });
    });
}

/*
 * What one IPC hop costs alone: 64 KiB messages to the shell and back as an echo (the copies of the contextBridge and
 * of the structured clone included), and the round trip of a single byte, with no network and no machine in it.
 */
window.runIpc = async () => {
    const chunk = new Uint8Array(64 * 1024);
    const count = 256;
    let echoed = 0;
    let wake: (() => void) | null = null;

    window.harness.onIpcEcho((bytes) => {
        echoed += bytes.byteLength;
        wake?.();
    });

    const roundTrips: number[] = [];

    for (let i = 0; i < 200; i += 1) {
        const start = performance.now();
        const before = echoed;

        window.harness.ipcEcho(new Uint8Array(1));
        await new Promise<void>((resolve) => {
            wake = () => (echoed > before ? resolve() : undefined);
        });
        roundTrips.push(performance.now() - start);
    }

    echoed = 0;

    const start = performance.now();

    for (let i = 0; i < count; i += 1) {
        window.harness.ipcEcho(chunk);
    }

    await new Promise<void>((resolve) => {
        wake = () => (echoed >= count * chunk.byteLength ? resolve() : undefined);
    });

    const elapsed = performance.now() - start;

    roundTrips.sort((a, b) => a - b);

    // The wire format alone, in the renderer: a 16 KiB chunk to base64 in a JSON frame and back, 16 MiB in all.
    const piece = new Uint8Array(16 * 1024).fill(7);
    const codecStart = performance.now();

    for (let i = 0; i < 1024; i += 1) {
        const frame = JSON.stringify({ id: 'r1', type: 'port.write', payload: { streamId: 's', offset: i, data: base64Of(piece) } });

        decodeBase64((JSON.parse(frame) as { payload: { data: string } }).payload.data);
    }

    const codecMs = performance.now() - codecStart;

    return {
        base64JsonMiBPerSecond: Number((16 / (codecMs / 1000)).toFixed(1)),
        echoMiBPerSecond: Number(((count * chunk.byteLength) / 1048576 / (elapsed / 1000)).toFixed(1)),
        oneByteRoundTripMedianMs: Number(roundTrips[100]!.toFixed(2)),
        oneByteRoundTripP95Ms: Number(roundTrips[190]!.toFixed(2))
    };
};

window.runScenario = async ({ kind, sitePort, run }) => {
    const { transport, grantId } = await machineFor(sitePort);
    let partition = `baseline-${run}`;
    let url = `http://[::1]:${sitePort}/`;
    let host: PortTunnelHost | null = null;
    let tunnelId: string | null = null;

    if (kind !== 'baseline') {
        const opened = await (kind === 'bridge' ? window.harness.openPortTunnel : window.harness.openProtocolTunnel)({
            endpointId: 'measurement',
            grantId,
            port: sitePort
        });

        if (opened === null) {
            throw new Error('The shell refused the tunnel');
        }

        tunnelId = opened.id;
        partition = opened.partition;
        // The IPv4 spelling: the site listens on ::1 only, so anything that reaches 127.0.0.1 left the tunnel and hit the decoy.
        url = `http://127.0.0.1:${sitePort}/`;
        host = new PortTunnelHost({ id: opened.id, grantId, shell: window.harness, hub: new PortStreamHub(transport) });
        host.start();
    }

    const view = document.createElement('webview');

    view.setAttribute('partition', partition);
    view.setAttribute('src', url);
    view.style.width = '800px';
    view.style.height = '600px';

    const result = awaitResult(view);

    document.body.append(view);

    try {
        return await result;
    } finally {
        view.remove();
        host?.dispose('measurement over');

        if (tunnelId !== null) {
            window.harness.closeTunnel(tunnelId);
        }
    }
};
