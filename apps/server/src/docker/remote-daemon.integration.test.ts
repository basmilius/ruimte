import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import {
    ACCESS_STATEMENT_LIFETIME_MS,
    BrokerPeer,
    accessStatementMessage,
    accessStatementV2Message,
    brokerHostOf,
    lanDoorMessage,
    lanDoorUrl,
    signalMessage,
    type AccessStatement,
    type BrokerRelayed,
    type LanDoorMachineFrame,
    type SignalEnvelope
} from '@ruimte/pulsar';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import { generateKeyPair, signMessage } from '../auth/keys.ts';
import { readLocalSecret } from '../auth/local-secret.ts';
import { DirectClient, type DirectCredential } from '../pulsar/direct-client.ts';
import {
    BYTES_CHUNK_MAX,
    parseServerFrame,
    type AuthSessionsResult,
    type BytesReadResult,
    type EndpointChangedEvent,
    type EndpointInfo,
    type FsBrowseResult,
    type FsListResult,
    type GitStatus,
    type ProjectListResult,
    type ProjectOpenResult,
    type ProjectSaveResult,
    type ProjectSummaryEvent,
    type ProjectView,
    type ServerHelloResult,
    type SessionAttachResult,
    type SessionInfo
} from '@ruimte/contracts';

/*
 * Opt-in wire tests for the disposable daemon container on port 4320. The development container on
 * 4310 keeps state and must never receive these count-sensitive tests. A client on another machine
 * gets in the way the app does: a statement signed with this run's own key (`test.sh`), carried in an
 * offer through the door on the local network. The owner reads the local secret out of the container.
 */
const ENABLED = process.env.RUIMTE_DOCKER === '1';

// The test container by default, so a run by hand never reaches the one being worked against.
const CONTAINER = process.env.RUIMTE_DOCKER_CONTAINER ?? 'ruimte-remote-test';
// The compose file maps this port straight through, so it names the daemon on both sides.
const PORT = Number(process.env.RUIMTE_DOCKER_PORT ?? 4320);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// The door listens on the daemon's port plus 10, which the compose file publishes as it is.
const DOOR_PORT = PORT + 10;
const REPO = '/work/atlas';
const HOME = '/root/.ruimte';
// What the machine calls a client the suite let in on a statement.
const CLIENT_LABEL = 'Bench laptop';
// A broker of the suite's own on this machine, which the test container dials (`compose.yml`).
const BROKER_PORT = 4420;
const BROKER_URL = `ws://127.0.0.1:${BROKER_PORT}`;
const BROKER_HEALTH = `http://127.0.0.1:${BROKER_PORT}/health`;

const STATEMENT_PRIVATE_KEY = process.env.RUIMTE_PULSAR_TEST_STATEMENT_PRIVATE_KEY
    ? Buffer.from(process.env.RUIMTE_PULSAR_TEST_STATEMENT_PRIVATE_KEY, 'base64url').toString('utf8')
    : null;

interface Pending {
    resolve(value: unknown): void;
    reject(reason: Error): void;
}

/* The client side of the wire, small enough to be obviously right: one socket, ids and events. */
class RemoteClient {
    /* Whether the daemon on the other end went away, which is the whole point of the pool's tests. */
    closed = false;
    private readonly socket: WebSocket;
    private readonly pending = new Map<string, Pending>();
    private readonly output: string[] = [];
    private readonly events = new Map<string, unknown[]>();
    private readonly listeners = new Map<string, (payload: unknown) => void>();
    private nextId = 1;

    private constructor(socket: WebSocket) {
        this.socket = socket;
        socket.onmessage = (message) => this.receive(String(message.data));
        socket.onclose = () => {
            this.closed = true;
            const waiting = [...this.pending.values()];
            this.pending.clear();
            for (const entry of waiting) {
                entry.reject(new Error('disconnected'));
            }
        };
    }

    /* `token` is the local secret of the daemon's home or a ticket a direct channel handed out. */
    static async connect(token: string | null, port: number = PORT): Promise<RemoteClient> {
        const query = token === null ? '' : `?token=${encodeURIComponent(token)}`;
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
        await new Promise<void>((resolve, reject) => {
            socket.onopen = () => resolve();
            socket.onclose = (event) => reject(new Error(`The daemon closed the socket: ${event.code} ${event.reason}`));
        });
        return new RemoteClient(socket);
    }

    close(): void {
        this.socket.close();
    }

    /* Hears one event as it arrives, for a test that has to answer it straight away rather than read it later. */
    listen(event: string, handler: (payload: unknown) => void): void {
        this.listeners.set(event, handler);
    }

    request<T>(type: string, payload: unknown): Promise<T> {
        const id = `r${this.nextId++}`;
        // The executor runs now, so the reply has somewhere to land before the frame goes out.
        const reply = new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
        });
        this.socket.send(JSON.stringify({ id, type, payload }));
        return reply;
    }

    /* Everything the daemon wrote on `session.output` since the last read. */
    takeOutput(): string {
        return this.output.splice(0).join('');
    }

    /* The payloads of one event since the last read; a client keeps only what a test asked about. */
    takeEvents<T>(event: string): T[] {
        return (this.events.get(event)?.splice(0) ?? []) as T[];
    }

    private receive(raw: string): void {
        const parsed = parseServerFrame(JSON.parse(raw));
        if (!parsed.ok) {
            throw new Error(`The daemon sent a frame this client cannot read: ${parsed.message}`);
        }
        const frame = parsed.value;
        if (!('ok' in frame)) {
            if (frame.event === 'session.output') {
                this.output.push((frame.payload as { data: string }).data);
                return;
            }
            const listener = this.listeners.get(frame.event);
            if (listener) {
                listener(frame.payload);
                return;
            }
            const seen = this.events.get(frame.event) ?? [];
            seen.push(frame.payload);
            this.events.set(frame.event, seen);
            return;
        }
        const pending = frame.id === null ? undefined : this.pending.get(frame.id);
        if (!pending || frame.id === null) {
            return;
        }
        this.pending.delete(frame.id);
        if (frame.ok) {
            pending.resolve(frame.result);
        } else {
            pending.reject(new Error(`${frame.error.code}: ${frame.error.message}`));
        }
    }
}

const waitUntil = async (label: string, ready: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!(await ready())) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${label}`);
        }
        await Bun.sleep(100);
    }
};

/* What the command wrote on the other machine, for the things no request answers. */
const inContainer = async (command: string[]): Promise<string> =>
    (await new Response(Bun.spawn(['docker', 'exec', CONTAINER, ...command], { stderr: 'inherit' }).stdout).text()).trim();

/* Starts, stops or pauses the container itself, for the tests about a machine falling away. */
const docker = async (args: string[]): Promise<void> => {
    const exit = await Bun.spawn(['docker', ...args], { stdout: 'ignore', stderr: 'inherit' }).exited;
    if (exit !== 0) {
        throw new Error(`docker ${args.join(' ')} exited with ${exit}`);
    }
};

const answers = async (url: string): Promise<boolean> => (await fetch(`${url}/health`).catch(() => null))?.ok === true;

const randomNonce = (): string => crypto.getRandomValues(new Uint8Array(16)).reduce((text, byte) => text + byte.toString(16).padStart(2, '0'), '');

interface KeyPair {
    publicKey: string;
    privateKey: string;
}

interface Machine {
    id: string;
    publicKey: string;
}

// Every channel and signaling socket the suite opened, closed at the end whatever failed on the way.
const openChannels: DirectClient[] = [];
const openSockets: WebSocket[] = [];

afterAll(() => {
    for (const channel of openChannels.splice(0)) {
        channel.close();
    }
    for (const socket of openSockets.splice(0)) {
        socket.close();
    }
});

/* Who the container is, as the address book lists it: read off its home, never off the door under test. */
const machineInContainer = async (): Promise<Machine> => {
    const written = JSON.parse(await inContainer(['cat', `${HOME}/endpoint.json`])) as Machine;
    return { id: written.id, publicKey: written.publicKey };
};

/* The app on the container's own machine, which presents the local secret of its home. */
const connectOwner = async (): Promise<RemoteClient> => RemoteClient.connect(await inContainer(['cat', `${HOME}/local.key`]));

/* A statement v2 as the address book signs one, with this run's key in place of the address book's. */
const statementFor = (machine: Machine, clientPublicKey: string, overrides: Partial<AccessStatement> = {}): AccessStatement => {
    if (STATEMENT_PRIVATE_KEY === null) {
        throw new Error('No statement key to sign with; run the suite with `bun run --cwd apps/server docker:test`, which makes one');
    }
    const issuedAt = Date.now();
    const base = {
        machineId: machine.id,
        machinePublicKey: machine.publicKey,
        accountId: 'bench-account',
        clientPublicKey,
        nonce: randomNonce(),
        issuedAt,
        expiresAt: issuedAt + ACCESS_STATEMENT_LIFETIME_MS,
        ...overrides
    };
    return {
        ...base,
        signature: signMessage(STATEMENT_PRIVATE_KEY, accessStatementMessage(base.machineId, base.clientPublicKey, base.nonce, base.issuedAt, base.expiresAt)),
        accountSignature: signMessage(
            STATEMENT_PRIVATE_KEY,
            accessStatementV2Message(base.machineId, base.machinePublicKey, base.accountId, base.clientPublicKey, base.nonce, base.issuedAt, base.expiresAt)
        )
    };
};

/* A way to the machine's signals: sends what the client signed, and hands back only what the pinned machine key signed for it. */
interface SignalLine {
    send(envelope: SignalEnvelope): void;
    listen(listener: (envelope: SignalEnvelope) => void): void;
    close(): void;
}

/*
 * The door on the local network, as the app uses it: a nonce first, the machine's proof checked against
 * the pinned key, and only then the signals, signed by `signer`.
 */
const doorLine = async (signer: KeyPair, machine: Machine): Promise<SignalLine> => {
    const socket = new WebSocket(lanDoorUrl('127.0.0.1', DOOR_PORT));
    openSockets.push(socket);
    await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error(`Nothing answers at the door on port ${DOOR_PORT}`));
    });
    const nonce = randomNonce();
    const listeners = new Set<(envelope: SignalEnvelope) => void>();
    const proven = new Promise<void>((resolve, reject) => {
        socket.onmessage = (message) => {
            const frame = JSON.parse(String(message.data)) as LanDoorMachineFrame;
            if (frame.type === 'door') {
                const pinned = frame.machineId === machine.id && frame.publicKey === machine.publicKey;
                if (pinned && verifySignature(machine.publicKey, lanDoorMessage(nonce, frame.machineId, frame.publicKey), frame.signature)) {
                    resolve();
                } else {
                    reject(new Error('The door did not prove the machine that was pinned'));
                }
                return;
            }
            if (frame.type === 'error') {
                reject(new Error(`${frame.code}: ${frame.message}`));
                return;
            }
            if (verifySignature(machine.publicKey, signalMessage(machine.publicKey, signer.publicKey, frame.envelope), frame.signature)) {
                for (const listener of listeners) {
                    listener(frame.envelope);
                }
            }
        };
    });
    socket.send(JSON.stringify({ type: 'hello', nonce }));
    await proven;
    return {
        send: (envelope) =>
            socket.send(
                JSON.stringify({
                    type: 'signal',
                    from: signer.publicKey,
                    envelope,
                    signature: signMessage(signer.privateKey, signalMessage(signer.publicKey, machine.publicKey, envelope))
                })
            ),
        listen: (listener) => {
            listeners.add(listener);
        },
        close: () => socket.close()
    };
};

/* A client on the broker, the way the app signs in: its own key, the host it dialed, every relay signed. */
const onBroker = async (key: KeyPair) => {
    const socket = new WebSocket(BROKER_URL);
    openSockets.push(socket);
    const relayed: BrokerRelayed[] = [];
    const listeners = new Set<(frame: BrokerRelayed) => void>();
    let ready = false;
    const peer = new BrokerPeer({
        role: 'client',
        publicKey: key.publicKey,
        host: brokerHostOf(BROKER_URL),
        sign: (message) => signMessage(key.privateKey, message),
        send: (frame) => socket.send(frame),
        events: {
            ready: () => {
                ready = true;
            },
            relayed: (frame) => {
                relayed.push(frame);
                for (const listener of listeners) {
                    listener(frame);
                }
            },
            refused: (frame) => {
                throw new Error(`The broker refused: ${JSON.stringify(frame)}`);
            },
            failed: (reason) => {
                throw new Error(reason);
            }
        }
    });
    socket.onopen = () => peer.start();
    socket.onmessage = (message) => void peer.receive(String(message.data));
    await waitUntil('the client to sign in to the broker', () => ready);
    return {
        socket,
        peer,
        relayed,
        listen: (listener: (frame: BrokerRelayed) => void) => {
            listeners.add(listener);
        }
    };
};

/* The broker as a line: relays to the machine's key and believes only what that key signed, the way the app does. */
const brokerLine = async (key: KeyPair, machine: Machine): Promise<SignalLine> => {
    const broker = await onBroker(key);
    return {
        send: (envelope) => void broker.peer.relay(machine.publicKey, envelope),
        listen: (listener) =>
            broker.listen((frame) => {
                if (
                    frame.from === machine.publicKey &&
                    verifySignature(machine.publicKey, signalMessage(machine.publicKey, key.publicKey, frame.envelope), frame.signature)
                ) {
                    listener(frame.envelope);
                }
            }),
        close: () => broker.socket.close()
    };
};

const keyCredential = (key: KeyPair, machine: Machine): DirectCredential => ({
    kind: 'key',
    publicKey: key.publicKey,
    privateKey: key.privateKey,
    daemonId: machine.id,
    daemonPublicKey: machine.publicKey
});

interface OfferOptions {
    statement?: AccessStatement;
    // Pings a quiet channel the way the app does.
    ping?: { idleMs?: number; timeoutMs?: number };
}

/* A channel offered over `line`; `open()` answers its ticket, or rejects with what the machine said. */
const offerOver = (line: SignalLine, credential: DirectCredential, options: OfferOptions = {}): DirectClient => {
    const client = new DirectClient({
        stunServers: [],
        credential,
        ...(options.statement ? { access: { statement: options.statement, label: CLIENT_LABEL } } : {}),
        ...(options.ping ? { ping: options.ping } : {}),
        timeoutMs: 20_000,
        signal: (envelope) => line.send(envelope)
    });
    openChannels.push(client);
    line.listen((envelope) => client.receiveSignal(envelope));
    return client;
};

interface LetIn {
    key: KeyPair;
    machine: Machine;
    channel: DirectClient;
    // Opens one socket on the WebSocket API, and serves bytes for as long as it lives.
    ticket: string;
}

/*
 * A client on another machine as the app is one: a new key gets in on a statement through the door, a
 * key the machine already let in offers without one. The door socket goes once the channel is up.
 */
const throughDoor = async (options: { key?: KeyPair; ping?: OfferOptions['ping'] } = {}): Promise<LetIn> => {
    const key = options.key ?? generateKeyPair();
    const machine = await machineInContainer();
    const line = await doorLine(key, machine);
    try {
        const channel = offerOver(line, keyCredential(key, machine), {
            ...(options.key ? {} : { statement: statementFor(machine, key.publicKey) }),
            ...(options.ping ? { ping: options.ping } : {})
        });
        const { ticket } = await channel.open();
        if (ticket === null) {
            throw new Error('The machine let the channel in without a ticket');
        }
        return { key, machine, channel, ticket };
    } finally {
        line.close();
    }
};

/* A socket of a client on another machine, on the ticket of a channel through the door that is closed again. */
const remoteSocket = async (key?: KeyPair): Promise<LetIn & { client: RemoteClient }> => {
    const letIn = await throughDoor(key ? { key } : {});
    letIn.channel.close();
    return { ...letIn, client: await RemoteClient.connect(letIn.ticket) };
};

describe.skipIf(!ENABLED)('the daemon in the Linux container', () => {
    let client: RemoteClient;
    const openedProjects: string[] = [];
    const startedSessions: string[] = [];

    beforeAll(async () => {
        // A container started a second ago is still writing its repositories; anything longer is a container that is not there.
        await waitUntil(`a daemon on ${BASE_URL}; start one with \`bun run --cwd apps/server docker:test\``, () => answers(BASE_URL), 5_000);
        client = (await remoteSocket()).client;
    }, 30_000);

    afterAll(async () => {
        for (const sessionId of startedSessions) {
            await client?.request('session.kill', { sessionId }).catch(() => undefined);
        }
        for (const projectId of openedProjects) {
            await client?.request('project.delete', { projectId, removeFiles: true }).catch(() => undefined);
        }
        client?.close();
    });

    test('the container answers on the mapped port', async () => {
        const response = await fetch(`${BASE_URL}/health`);
        const health = (await response.json()) as { ok: boolean; version: string };
        expect(health.ok).toBe(true);
        expect(health.version.length).toBeGreaterThan(0);
    });

    test('an unknown token gets nowhere', async () => {
        const response = await fetch(`${BASE_URL}/ws?token=not-a-token`);
        expect(response.status).toBe(401);
    });

    test('server.hello reports a Linux daemon', async () => {
        const hello = await client.request<ServerHelloResult>('server.hello', {});
        expect(hello.platform).toBe('linux');
        expect(hello.home).toBe('/root/.ruimte');
        expect(hello.version.length).toBeGreaterThan(0);
    });

    test('a daemon in a container has no hardware to name', async () => {
        const hello = await client.request<ServerHelloResult>('server.hello', {});
        /*
         * A container carries neither the DMI tree nor a device tree, so there is nothing here that
         * says what the machine is and the field stays out of the answer; the row for such a daemon
         * keeps the plain "This machine". A Linux daemon on real hardware answers with what its
         * firmware wrote ("XPS 15 9500", "Raspberry Pi 4 Model B"), which is why it is optional.
         */
        expect(hello.model).toBeUndefined();
    });

    test('endpoint.info knows the client is not on its machine', async () => {
        const info = await client.request<EndpointInfo>('endpoint.info', {});
        expect(info.platform).toBe('linux');
        expect(info.label).toBe('docker-linux');
        expect(info.authenticated).toBe(true);
        // Docker forwards the port through its own gateway, so the daemon sees a private address.
        expect(info.reachability).toBe('lan');
    });

    test('the daemon keeps its id in its home, so a restart finds the same machine', async () => {
        const info = await client.request<EndpointInfo>('endpoint.info', {});
        const written = JSON.parse(await inContainer(['cat', `${HOME}/endpoint.json`])) as { version: number; id: string; publicKey: string };
        expect(written.version).toBe(1);
        expect(written.id).toBe(info.id);
        expect(written.publicKey).toBe(info.publicKey!);
        /*
         * What a second start would do, run against the home of the daemon that is up. A real
         * `docker restart` throws that home away (`docker/entrypoint.sh`, `RUIMTE_FRESH_STATE`), so
         * it would test the harness instead of the daemon.
         */
        const restarted = await inContainer([
            'bun',
            '-e',
            `import { readOrCreateEndpointIdentity } from '/app/apps/server/src/endpoint-id.ts'; console.log((await readOrCreateEndpointIdentity('${HOME}')).id);`
        ]);
        expect(restarted).toBe(info.id);
    });

    test('pairing is gone: its routes answer 410, and neither the owner nor a client gets a pairing token', async () => {
        for (const path of ['/auth/pair', '/auth/pairing-token', '/auth/challenge', '/auth/ticket']) {
            const response = await fetch(`${BASE_URL}${path}`, { method: 'POST' });
            expect([path, response.status]).toEqual([path, 410]);
            expect(await response.text()).toContain('ruimte login');
        }
        const owner = await connectOwner();
        try {
            for (const asker of [client, owner]) {
                await expect(asker.request('auth.pairingToken', {})).rejects.toThrow(/^pairing-removed:/);
                await expect(asker.request('auth.registerKey', { publicKey: generateKeyPair().publicKey })).rejects.toThrow(/^pairing-removed:/);
            }
        } finally {
            owner.close();
        }
    });

    /*
     * Inside the container every request comes from loopback, which is what a tunnel or a reverse
     * proxy in front of a daemon looks like. Without the local secret none of it opens. `ruimte status`
     * asks `/machine/status` with the secret, read from the home.
     */
    test('loopback without the local secret gets through no door', async () => {
        const doors = [
            ['/ws', 'GET'],
            ['/machine/status', 'GET'],
            [`/fs/file?path=${REPO}/README.md`, 'GET'],
            ['/projects/nope/icon', 'GET'],
            ['/attachments/node-1/deadbeef', 'GET']
        ];
        const script = `const codes = []; for (const [path, method] of ${JSON.stringify(doors)}) { codes.push((await fetch('http://127.0.0.1:${PORT}' + path, { method })).status); } console.log(codes.join(','));`;
        expect(await inContainer(['bun', '-e', script])).toBe('401,403,401,401,401');
        // A wrong secret is no secret either.
        const guessed = `console.log((await fetch('http://127.0.0.1:${PORT}/machine/status', { headers: { authorization: 'Bearer guessed' } })).status);`;
        expect(await inContainer(['bun', '-e', guessed])).toBe('403');
    });

    test('a daemon that has seen nothing lists nothing at all, and asking twice still makes nothing', async () => {
        expect((await client.request<ProjectListResult>('project.list', {})).projects).toEqual([]);
        expect((await client.request<ProjectListResult>('project.list', {})).projects).toEqual([]);
    });

    test('a project opens on a repository in /work', async () => {
        const opened = await client.request<ProjectOpenResult>('project.open', { folder: REPO, name: 'Atlas' });
        openedProjects.push(opened.summary.projectId);
        expect(opened.summary.folder).toBe(REPO);
        expect(opened.document.views).toEqual([]);

        const listed = await client.request<ProjectListResult>('project.list', {});
        expect(listed.projects.some((project) => project.projectId === opened.summary.projectId)).toBe(true);
    });

    test('naming the machine reaches every client and outlives the label it was started with', async () => {
        const other = await connectOwner();
        try {
            const named = await client.request<EndpointInfo>('endpoint.setIdentity', { name: 'The box downstairs', icon: { kind: 'lucide', value: 'server' } });
            expect(named.label).toBe('The box downstairs');
            expect(named.nameSource).toBe('chosen');
            expect(named.icon).toEqual({ kind: 'lucide', value: 'server' });

            // The client that did not ask is told, so two machines never disagree about a name.
            let heard: EndpointChangedEvent[] = [];
            await waitUntil('the other client to hear the new name', () => {
                heard = heard.concat(other.takeEvents<EndpointChangedEvent>('endpoint.changed'));
                return heard.length > 0;
            });
            expect(heard.at(-1)).toMatchObject({ id: named.id, label: 'The box downstairs', nameSource: 'chosen' });

            // It is the machine's, not the connection's. It sits in the home next to the id.
            const written = JSON.parse(await inContainer(['cat', `${HOME}/endpoint.json`])) as { version: number; name: string };
            expect(written.version).toBe(1);
            expect(written.name).toBe('The box downstairs');
        } finally {
            // Back to `RUIMTE_LABEL`, which is what the rest of the suite expects this machine to answer.
            await client.request('endpoint.setIdentity', { name: null, icon: null });
            other.close();
        }
        const back = await client.request<EndpointInfo>('endpoint.info', {});
        expect(back.label).toBe('docker-linux');
        expect(back.nameSource).toBe('default');
    });

    test('closing a project drops it under Recent on the machine, and opening it brings it back', async () => {
        const other = await connectOwner();
        try {
            const opened = await client.request<ProjectOpenResult>('project.open', { folder: '/work/beacon', name: 'Beacon' });
            const { projectId } = opened.summary;
            openedProjects.push(projectId);
            expect(opened.summary.closedAt).toBeNull();
            other.takeEvents('project.summary');

            await client.request('project.close', { projectId });
            const closed = (await other.request<ProjectListResult>('project.list', {})).projects.find((project) => project.projectId === projectId);
            expect(closed?.closedAt).toBeNumber();

            // The other client is told, so a machine's list reads the same from both sides.
            let heard: ProjectSummaryEvent[] = [];
            await waitUntil('the other client to hear the project close', () => {
                heard = heard.concat(other.takeEvents<ProjectSummaryEvent>('project.summary'));
                return heard.some((event) => event.summary.projectId === projectId);
            });

            const again = await other.request<ProjectOpenResult>('project.open', { projectId });
            expect(again.summary.closedAt).toBeNull();
            expect((await client.request<ProjectListResult>('project.list', {})).projects.find((row) => row.projectId === projectId)?.closedAt).toBeNull();
        } finally {
            other.close();
        }
    });

    test('closing a project ends the sessions of its nodes, and only those', async () => {
        const opened = await client.request<ProjectOpenResult>('project.open', { folder: '/work/beacon', name: 'Beacon' });
        const { projectId } = opened.summary;
        openedProjects.push(projectId);
        const onCanvas = `node-${Date.now()}`;
        const loose = `loose-${Date.now()}`;
        startedSessions.push(onCanvas, loose);
        // The machine reads which sessions a project holds off the document it saved, so this is what ties them.
        await client.request<ProjectSaveResult>('project.save', {
            projectId,
            baseRev: opened.document.rev,
            content: {
                name: 'Beacon',
                color: '#000',
                views: [
                    {
                        kind: 'canvas',
                        id: 'main',
                        name: 'Canvas',
                        nodes: [{ id: onCanvas, kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 }],
                        texts: [],
                        edges: []
                    }
                ]
            }
        });
        await client.request<SessionInfo>('session.create', { sessionId: onCanvas, cwd: '/work/beacon', cols: 80, rows: 24 });
        await client.request<SessionInfo>('session.create', { sessionId: loose, cwd: '/work/beacon', cols: 80, rows: 24 });

        await client.request('project.close', { projectId });
        const kept = await client.request<{ sessions: SessionInfo[] }>('session.list', {});
        expect(kept.sessions.some((session) => session.sessionId === onCanvas)).toBe(false);
        // A session no node of the project stands for is nobody's to end here.
        expect(kept.sessions.some((session) => session.sessionId === loose)).toBe(true);

        await client.request('session.kill', { sessionId: loose });
    });

    test('a project another client still has open keeps its place and its sessions', async () => {
        const other = await connectOwner();
        try {
            const opened = await client.request<ProjectOpenResult>('project.open', { folder: '/work/beacon', name: 'Beacon' });
            const { projectId } = opened.summary;
            openedProjects.push(projectId);
            await other.request<ProjectOpenResult>('project.open', { projectId });

            await client.request('project.close', { projectId });
            const listed = (await other.request<ProjectListResult>('project.list', {})).projects.find((project) => project.projectId === projectId);
            expect(listed?.closedAt).toBeNull();

            await other.request('project.close', { projectId });
            const closed = (await client.request<ProjectListResult>('project.list', {})).projects.find((project) => project.projectId === projectId);
            expect(closed?.closedAt).toBeNumber();
        } finally {
            other.close();
        }
    });

    test('a terminal session runs a shell in the repository', async () => {
        const sessionId = `docker-test-${Date.now()}`;
        const info = await client.request<SessionInfo>('session.create', { sessionId, cwd: REPO, cols: 80, rows: 24 });
        startedSessions.push(sessionId);
        expect(info.pid).toBeGreaterThan(0);
        expect(info.cwd).toBe(REPO);
        expect(info.exited).toBe(false);

        const attached = await client.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
        expect(attached.exited).toBe(false);

        let seen = '';
        await client.request('session.write', { sessionId, data: 'uname -s && pwd\n' });
        await waitUntil('the shell to answer', () => {
            seen += client.takeOutput();
            return seen.includes('Linux') && seen.includes(REPO);
        });
    });

    test('git.status sees the work left in the repository', async () => {
        const status = await client.request<GitStatus>('git.status', { cwd: REPO });
        expect(status.repo).toBe(true);
        expect(status.root).toBe(REPO);
        expect(status.branch).toBe('main');
        expect(status.detached).toBe(false);
        expect(status.files.find((file) => file.path === 'README.md')?.state).toBe('unstaged');
        expect(status.files.find((file) => file.path === 'notes.txt')?.state).toBe('untracked');
    });

    test('fs.browse lists the repositories on the remote machine', async () => {
        const browsed = await client.request<FsBrowseResult>('fs.browse', { partialPath: '/work/' });
        expect(browsed.parentPath).toBe('/work');
        expect(browsed.entries.map((entry) => entry.name).sort()).toEqual(['atlas', 'beacon']);
        expect(browsed.exists).toBe(true);
    });

    test('a path that is not on that machine comes back as not there', async () => {
        const browsed = await client.request<FsBrowseResult>('fs.browse', { partialPath: '/work/nowhere/' });
        expect(browsed.parentPath).toBe('/work/nowhere');
        expect(browsed.entries).toEqual([]);
        expect(browsed.exists).toBe(false);
    });

    test('createFolder makes the folder on the machine that was asked, not on this one', async () => {
        const folder = '/work/fresh/nested';
        const opened = await client.request<ProjectOpenResult>('project.open', { folder, createFolder: true });
        openedProjects.push(opened.summary.projectId);
        expect(opened.summary.folder).toBe(folder);
        expect(await inContainer(['sh', '-c', `test -d ${folder} && echo yes`])).toBe('yes');
        // A daemon on this machine would have made the same path here, which is what this rules out.
        expect(await Bun.file(folder).exists()).toBe(false);

        const browsed = await client.request<FsBrowseResult>('fs.browse', { partialPath: '/work/fresh/' });
        expect(browsed.entries.map((entry) => entry.name)).toEqual(['nested']);
        expect(browsed.exists).toBe(true);
        await inContainer(['rm', '-rf', '/work/fresh']);
    });
});

/*
 * A client a statement let in reaches everything a person works with, and nothing that only the local
 * secret grants: the machine's account, its own state under the home, and a way back in once revoked.
 */
describe.skipIf(!ENABLED)('a client let in on a statement is not the owner', () => {
    let remote: LetIn & { client: RemoteClient };
    let owner: RemoteClient;

    beforeAll(async () => {
        await waitUntil(`a daemon on ${BASE_URL}`, () => answers(BASE_URL), 5_000);
        remote = await remoteSocket();
        owner = await connectOwner();
    }, 30_000);

    afterAll(() => {
        remote?.client.close();
        owner?.close();
    });

    test('it cannot put the machine on an account or take it off, and is not told which account it is on', async () => {
        await expect(remote.client.request('endpoint.signRegistration', { accountId: 'bench-account' })).rejects.toThrow(/^forbidden:/);
        await expect(remote.client.request('endpoint.leaveAccount', {})).rejects.toThrow(/^forbidden:/);
        expect((await remote.client.request<EndpointInfo>('endpoint.info', {})).accountId).toBeUndefined();
        // The owner is told, and letting a client in on a statement put the machine on no account.
        expect((await owner.request<EndpointInfo>('endpoint.info', {})).accountId).toBeNull();
    });

    test("it reads nothing of the machine's own state under the home, by request or by URL", async () => {
        for (const path of [`${HOME}/local.key`, `${HOME}/endpoint.json`, `${HOME}/auth.json`]) {
            await expect(remote.client.request('fs.read', { path })).rejects.toThrow(/^machine-state:/);
        }
        const byUrl = await fetch(`${BASE_URL}/fs/file?path=${encodeURIComponent(`${HOME}/local.key`)}&token=${encodeURIComponent(remote.ticket)}`);
        expect(byUrl.status).toBe(403);
        // The same client reads a person's files, so the refusal is about the path and not about who asked.
        await expect(remote.client.request('fs.read', { path: `${REPO}/README.md` })).resolves.toBeDefined();
    });

    test('revoking it closes its socket, and neither its key nor a new statement for it gets back in', async () => {
        const victim = await remoteSocket();
        const mine = (await victim.client.request<AuthSessionsResult>('auth.sessions', {})).sessions.find((session) => session.current);
        expect(mine).toMatchObject({ label: CLIENT_LABEL, origin: 'statement' });

        await owner.request('auth.revoke', { id: mine!.id });
        await waitUntil('the socket of a revoked client to close', () => victim.client.closed);
        // Its ticket went with it, so the bytes it could fetch a moment ago are closed too.
        expect((await fetch(`${BASE_URL}/fs/file?path=${encodeURIComponent(`${REPO}/README.md`)}&token=${encodeURIComponent(victim.ticket)}`)).status).toBe(
            401
        );

        for (const statement of [null, statementFor(victim.machine, victim.key.publicKey)]) {
            const line = await doorLine(victim.key, victim.machine);
            try {
                const attempt = offerOver(line, keyCredential(victim.key, victim.machine), statement ? { statement } : {});
                await expect(attempt.open()).rejects.toThrow('The machine closed the attempt: not-paired');
            } finally {
                line.close();
            }
        }
    }, 60_000);
});

describe.skipIf(!ENABLED)('the door on the local network', () => {
    test('endpoint.info says where the door listens', async () => {
        const owner = await connectOwner();
        try {
            const info = await owner.request<EndpointInfo>('endpoint.info', {});
            expect(info.lanDoor).toBe(true);
            expect(info.lanDoorFixed).toBe(false);
            expect(info.lan?.port).toBe(DOOR_PORT);
            // The container's own interfaces, which only Docker's network reaches; the suite dials the published port instead.
            expect(info.lan?.addresses.length).toBeGreaterThan(0);
        } finally {
            owner.close();
        }
    });

    test('anything at the door but its socket answers 404', async () => {
        for (const path of ['/', '/ws', '/health', '/auth/pair', '/signal/more']) {
            const response = await fetch(`http://127.0.0.1:${DOOR_PORT}${path}`);
            expect([path, response.status]).toEqual([path, 404]);
        }
    });

    test('a key without a statement gets a not-paired the machine signed, and no channel', async () => {
        const machine = await machineInContainer();
        const stranger = generateKeyPair();
        // The line only hands on what the pinned machine key signed, so the refusal that arrives is the machine's own.
        const line = await doorLine(stranger, machine);
        try {
            await expect(offerOver(line, keyCredential(stranger, machine)).open()).rejects.toThrow('The machine closed the attempt: not-paired');
        } finally {
            line.close();
        }
    }, 30_000);

    test('ruimte status inside the container exits 0 and names the door', async () => {
        const status = Bun.spawn(['docker', 'exec', CONTAINER, 'bun', '/app/apps/server/src/main.ts', 'status', '--port', String(PORT)], {
            stdout: 'pipe',
            stderr: 'inherit'
        });
        const [printed, exitCode] = await Promise.all([new Response(status.stdout).text(), status.exited]);
        expect(exitCode).toBe(0);
        expect(printed).toMatch(new RegExp(`^Network +\\S+:${DOOR_PORT}`, 'm'));
    }, 30_000);
});

/*
 * The wire over a WebRTC DataChannel instead of the socket. The signals go through the door, and its
 * socket is closed the moment the channel is up. Everything after it, the terminal included, travels
 * over UDP through the ports the compose file publishes, on the access the channel's own handshake gave it.
 */
describe.skipIf(!ENABLED)('a direct connection through the door', () => {
    test('a key let in on a statement opens the channel from outside the container, and a terminal answers over it', async () => {
        const { channel: client } = await throughDoor();
        expect((await client.request<EndpointInfo>('endpoint.info', {})).authenticated).toBe(true);

        let output = '';
        client.onFrame((raw) => {
            const frame = JSON.parse(raw) as { event?: string; payload?: { data?: string } };
            if (frame.event === 'session.output') {
                output += frame.payload?.data ?? '';
            }
        });
        const sessionId = `docker-direct-${Date.now()}`;
        await client.request<SessionInfo>('session.create', { sessionId, cwd: REPO, cols: 80, rows: 24 });
        try {
            await client.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
            await client.request('session.write', { sessionId, data: 'echo direct-$((6*7)) && uname -s\n' });
            await waitUntil('the shell to answer over the channel', () => output.includes('direct-42') && output.includes('Linux'));
        } finally {
            await client.request('session.kill', { sessionId }).catch(() => undefined);
        }
        console.log(`direct channel through the door: open after ${client.timings.channelOpenMs} ms, signed in after ${client.timings.authenticatedMs} ms`);
    }, 60_000);

    test('the bytes of a file come over the channel in pieces, and what the route would refuse is refused', async () => {
        const { channel: client } = await throughDoor();
        const path = `${REPO}/direct-bytes.gif`;
        const huge = `${REPO}/direct-huge.gif`;
        // A GIF header is all the daemon sniffs; the noise behind it makes three pieces.
        await inContainer(['sh', '-c', `{ printf 'GIF89a'; head -c ${BYTES_CHUNK_MAX * 2 + 4096} /dev/urandom; } > ${path}`]);
        await inContainer(['sh', '-c', `printf 'GIF89a' > ${huge} && truncate -s 40M ${huge}`]);
        try {
            const expected = Buffer.from(await inContainer(['base64', '-w0', path]), 'base64');
            const parts: Buffer[] = [];
            let offset = 0;
            let size = Number.POSITIVE_INFINITY;
            const started = Date.now();
            while (offset < size) {
                const piece = await client.request<BytesReadResult>('bytes.read', { resource: { kind: 'file', path }, offset, length: BYTES_CHUNK_MAX });
                expect(piece.mime).toBe('image/gif');
                size = piece.size;
                const bytes = Buffer.from(piece.data, 'base64');
                parts.push(bytes);
                offset += bytes.length;
            }
            expect(parts).toHaveLength(3);
            expect(Buffer.concat(parts).equals(expected)).toBe(true);
            console.log(`bytes over the direct channel: ${size} bytes in ${parts.length} pieces, ${Date.now() - started} ms`);

            const refused = (resource: unknown) => client.request('bytes.read', { resource, offset: 0, length: 1024 });
            // A program, since text is served and only a binary that is no picture, sound, video or PDF is not.
            await expect(refused({ kind: 'file', path: '/usr/bin/git' })).rejects.toThrow(/^not-found:/);
            await expect(refused({ kind: 'file', path: `${HOME}/endpoint.json` })).rejects.toThrow(/^machine-state:/);
            await expect(refused({ kind: 'attachment', chatId: 'no-such-chat', attachmentId: 'nothing' })).rejects.toThrow(/^not-found:/);
            const deep = await client.request<BytesReadResult>('bytes.read', {
                resource: { kind: 'file', path: huge },
                offset: 39 * 1024 * 1024,
                length: 1024
            });
            expect(deep.size).toBe(40 * 1024 * 1024);
            expect(Buffer.from(deep.data, 'base64')).toHaveLength(1024);
        } finally {
            await inContainer(['rm', '-f', path, huge]);
        }
    }, 60_000);

    test('a machine that stops answering is noticed by the ping long before ICE gives up', async () => {
        const { channel: client } = await throughDoor({ ping: { idleMs: 2_000, timeoutMs: 5_000 } });
        let lostAt: number | null = null;
        client.onLost(() => {
            lostAt = Date.now();
        });
        // Frozen rather than stopped. No process on the other end gets to say goodbye, like a machine that lost its network.
        await docker(['pause', CONTAINER]);
        const pausedAt = Date.now();
        let iceAtLoss = '';
        try {
            await waitUntil(
                'the ping to notice',
                () => {
                    if (lostAt === null) {
                        iceAtLoss = client.iceState;
                    }
                    return lostAt !== null;
                },
                20_000
            );
        } finally {
            await docker(['unpause', CONTAINER]);
        }
        const noticed = lostAt! - pausedAt;
        console.log(`ping noticed a paused machine after ${noticed} ms; ICE still said ${iceAtLoss} at that moment`);
        expect(noticed).toBeLessThan(9_000);
    }, 60_000);

    test('a channel proved by a key the machine does not know, or by no proof at all, gets nothing, whichever key signaled it', async () => {
        const known = await throughDoor();
        known.channel.close();
        const attempts: Array<[DirectCredential, RegExp]> = [
            [keyCredential(generateKeyPair(), known.machine), /does not know this device/],
            [{ kind: 'none' }, /^Expected a proof$/]
        ];
        for (const [credential, refusal] of attempts) {
            const line = await doorLine(known.key, known.machine);
            try {
                await expect(offerOver(line, credential).open()).rejects.toThrow(refusal);
            } finally {
                line.close();
            }
        }
    }, 60_000);
});

/*
 * Two daemons at once, which is what the client's transport pool holds: a socket per machine, each
 * with a reconnect loop of its own. The second daemon is a plain one on this machine, so the one
 * that has to keep working is not the one being stopped. The container is left running.
 */
describe.skipIf(!ENABLED)('two daemons at the same time', () => {
    const LOCAL_PORT = Number(process.env.RUIMTE_LOCAL_PORT ?? 4311);
    const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
    let daemon: ReturnType<typeof Bun.spawn> | null = null;
    let home = '';
    let here: RemoteClient;
    let there: RemoteClient;
    let firstMachine: Machine;
    const startedSessions: string[] = [];

    beforeAll(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-pool-'));
        // Its own home and no hooks. A test daemon must leave this machine's state and CLI settings alone.
        daemon = Bun.spawn(
            [
                'bun',
                join(import.meta.dir, '../main.ts'),
                '--host',
                '127.0.0.1',
                '--port',
                String(LOCAL_PORT),
                '--no-hooks',
                '--no-price-fetch',
                '--no-model-fetch',
                '--no-lan'
            ],
            { env: { ...process.env, RUIMTE_HOME: home }, stdout: 'ignore', stderr: 'inherit' }
        );
        await waitUntil(`a second daemon on ${LOCAL_URL}`, () => answers(LOCAL_URL));
        await waitUntil(`the container on ${BASE_URL}`, () => answers(BASE_URL), 5_000);
        // Being on this machine is not enough for the daemon here either. The secret of its home is what gets in.
        await expect(RemoteClient.connect(null, LOCAL_PORT)).rejects.toThrow();
        here = await RemoteClient.connect(await readLocalSecret(home), LOCAL_PORT);
        const remote = await remoteSocket();
        there = remote.client;
        firstMachine = remote.machine;
    }, 60_000);

    afterAll(async () => {
        for (const sessionId of startedSessions) {
            await here?.request('session.kill', { sessionId }).catch(() => undefined);
        }
        here?.close();
        there?.close();
        daemon?.kill();
        await daemon?.exited;
        await rm(home, { recursive: true, force: true });
    });

    test('both machines answer at once, each about itself', async () => {
        const [mine, theirs] = await Promise.all([here.request<ServerHelloResult>('server.hello', {}), there.request<ServerHelloResult>('server.hello', {})]);
        expect(mine.platform).toBe(process.platform);
        expect(mine.home).toBe(home);
        expect(theirs.platform).toBe('linux');
        expect(theirs.home).toBe(HOME);

        const [mineInfo, theirsInfo] = await Promise.all([here.request<EndpointInfo>('endpoint.info', {}), there.request<EndpointInfo>('endpoint.info', {})]);
        // Two rows in the client's endpoint list only stay two rows because the ids differ.
        expect(mineInfo.id).not.toBe(theirsInfo.id);
        expect(mineInfo.reachability).toBe('loopback');
        expect(theirsInfo.reachability).toBe('lan');
    });

    test('a shell on each machine runs on the machine it was started on', async () => {
        const mine = `pool-here-${Date.now()}`;
        const theirs = `pool-there-${Date.now()}`;
        startedSessions.push(mine);
        await here.request('session.create', { sessionId: mine, cwd: home, cols: 80, rows: 24 });
        await here.request('session.attach', { sessionId: mine, cols: 80, rows: 24 });
        await there.request('session.create', { sessionId: theirs, cwd: REPO, cols: 80, rows: 24 });
        await there.request('session.attach', { sessionId: theirs, cols: 80, rows: 24 });

        await here.request('session.write', { sessionId: mine, data: 'uname -s\n' });
        await there.request('session.write', { sessionId: theirs, data: 'uname -s\n' });
        let mineSaid = '';
        let theirsSaid = '';
        await waitUntil('both shells to answer', () => {
            mineSaid += here.takeOutput();
            theirsSaid += there.takeOutput();
            return mineSaid.includes('Darwin') && theirsSaid.includes('Linux');
        });
        // The sessions of one machine never show up on the other; the daemons know nothing of each other.
        const listed = await there.request<{ sessions: SessionInfo[] }>('session.list', {});
        expect(listed.sessions.some((session) => session.sessionId === mine)).toBe(false);
    });

    test('the container falling away leaves the daemon on this machine untouched', async () => {
        const sessionId = `pool-survivor-${Date.now()}`;
        startedSessions.push(sessionId);
        await here.request('session.create', { sessionId, cwd: home, cols: 80, rows: 24 });
        await here.request('session.attach', { sessionId, cols: 80, rows: 24 });
        here.takeOutput();

        await docker(['stop', '--time', '5', CONTAINER]);
        await waitUntil('the socket to the container to notice', () => there.closed);

        expect(here.closed).toBe(false);
        await here.request('session.write', { sessionId, data: 'echo still-here\n' });
        let said = '';
        await waitUntil('the shell on this machine to answer with the container gone', () => {
            said += here.takeOutput();
            return said.includes('still-here');
        });
        const hello = await here.request<ServerHelloResult>('server.hello', {});
        expect(hello.home).toBe(home);
    }, 60_000);

    /*
     * What the project menu does with a machine that is not there. The union is per machine, so the
     * one that is up keeps listing and opening its own projects while the other one is away.
     */
    test('a project on the machine that is up opens while the other one is gone', async () => {
        const folder = await mkdtemp(join(tmpdir(), 'ruimte-up-'));
        try {
            const opened = await here.request<ProjectOpenResult>('project.open', { folder, name: 'While the container is down' });
            const listed = await here.request<ProjectListResult>('project.list', {});
            expect(listed.projects.some((project) => project.projectId === opened.summary.projectId)).toBe(true);
            expect(there.closed).toBe(true);
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    });

    test('the container comes back as a new machine and lets a client in on a statement again, next to the connection that never dropped', async () => {
        await docker(['start', CONTAINER]);
        await waitUntil(`the container on ${BASE_URL} again`, () => answers(BASE_URL), 60_000);

        const back = await remoteSocket();
        // A start of the test container wipes its home, so the statement names a machine with a new id and key.
        expect(back.machine.id).not.toBe(firstMachine.id);
        const info = await back.client.request<EndpointInfo>('endpoint.info', {});
        expect(info.platform).toBe('linux');
        expect(back.client.closed).toBe(false);
        expect(here.closed).toBe(false);
        back.client.close();
    }, 90_000);
});

/*
 * The same node id, the same absolute path and the same request on two machines at once, which is
 * what the client's stores are keyed for. Every answer here has to be about the daemon it was asked
 * of and about nothing else; a client that mixed two of them would show one machine's screen on the
 * other machine's node.
 */
describe.skipIf(!ENABLED)('one id on two machines', () => {
    const LOCAL_PORT = Number(process.env.RUIMTE_LOCAL_PORT ?? 4312);
    const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
    /* A path that exists on both machines, so a key on the path alone would hold one checkout for two. */
    const SHARED = '/tmp/ruimte-two-machines';
    let daemon: ReturnType<typeof Bun.spawn> | null = null;
    let home = '';
    let here: RemoteClient;
    let there: RemoteClient;
    const startedSessions: string[] = [];

    const seedRepo = async (run: (command: string[]) => Promise<unknown>, branch: string, file: string): Promise<void> => {
        await run(['sh', '-c', `rm -rf ${SHARED} && mkdir -p ${SHARED}`]);
        await run([
            'sh',
            '-c',
            `cd ${SHARED} && git init -q -b ${branch} && git config user.email t@t && git config user.name t && ` +
                `echo one > ${file} && git add -A && git commit -q -m first && echo two >> ${file}`
        ]);
    };

    beforeAll(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-scope-'));
        daemon = Bun.spawn(
            [
                'bun',
                join(import.meta.dir, '../main.ts'),
                '--host',
                '127.0.0.1',
                '--port',
                String(LOCAL_PORT),
                '--no-hooks',
                '--no-price-fetch',
                '--no-model-fetch',
                '--no-lan'
            ],
            { env: { ...process.env, RUIMTE_HOME: home }, stdout: 'ignore', stderr: 'inherit' }
        );
        await waitUntil(`a second daemon on ${LOCAL_URL}`, () => answers(LOCAL_URL));
        await waitUntil(`the container on ${BASE_URL}`, () => answers(BASE_URL), 5_000);
        here = await RemoteClient.connect(await readLocalSecret(home), LOCAL_PORT);
        there = (await remoteSocket()).client;
        await seedRepo(async (command) => Bun.spawn(command, { stdout: 'ignore', stderr: 'inherit' }).exited, 'here', 'mine.txt');
        await seedRepo((command) => inContainer(command), 'there', 'theirs.txt');
    }, 60_000);

    afterAll(async () => {
        for (const sessionId of startedSessions) {
            await here?.request('session.kill', { sessionId }).catch(() => undefined);
            await there?.request('session.kill', { sessionId }).catch(() => undefined);
        }
        here?.close();
        there?.close();
        daemon?.kill();
        await daemon?.exited;
        await rm(home, { recursive: true, force: true });
        await rm(SHARED, { recursive: true, force: true });
        await inContainer(['rm', '-rf', SHARED]).catch(() => undefined);
    });

    test('a node id on both machines is two shells, each with its own screen', async () => {
        const sessionId = `scope-${Date.now()}`;
        startedSessions.push(sessionId);
        for (const [client, cwd] of [
            [here, home],
            [there, REPO]
        ] as const) {
            await client.request('session.create', { sessionId, cwd, cols: 80, rows: 24 });
            await client.request('session.attach', { sessionId, cols: 80, rows: 24 });
        }
        await here.request('session.write', { sessionId, data: 'echo screen-of-here\n' });
        await there.request('session.write', { sessionId, data: 'echo screen-of-there\n' });
        await waitUntil('both shells to answer', async () => {
            here.takeOutput();
            there.takeOutput();
            const [mine, theirs] = await Promise.all([
                here.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 }),
                there.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 })
            ]);
            return mine.screen.includes('screen-of-here') && theirs.screen.includes('screen-of-there');
        });

        // The screen of one machine never carries a line that was typed on the other.
        const mine = await here.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
        const theirs = await there.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
        expect(mine.screen).not.toContain('screen-of-there');
        expect(theirs.screen).not.toContain('screen-of-here');
    }, 60_000);

    test('one absolute path is two checkouts, each with its own status', async () => {
        const [mine, theirs] = await Promise.all([
            here.request<GitStatus>('git.status', { cwd: SHARED }),
            there.request<GitStatus>('git.status', { cwd: SHARED })
        ]);
        expect(mine.branch).toBe('here');
        expect(theirs.branch).toBe('there');
        expect(mine.files.map((file) => file.path)).toEqual(['mine.txt']);
        expect(theirs.files.map((file) => file.path)).toEqual(['theirs.txt']);
    });

    test('unwatching that path on one machine leaves the watch on the other standing', async () => {
        await here.request('git.watch', { cwd: SHARED });
        await there.request('git.watch', { cwd: SHARED });
        await here.request('git.unwatch', { cwd: SHARED });
        here.takeEvents('git.status');
        there.takeEvents('git.status');

        await inContainer(['sh', '-c', `echo three >> ${SHARED}/theirs.txt`]);
        await waitUntil('the container to report its checkout changed', () => there.takeEvents('git.status').length > 0, 20_000);
        expect(here.takeEvents('git.status')).toEqual([]);
    }, 30_000);

    test('fs.list on one path answers about the machine it was asked of', async () => {
        const [mine, theirs] = await Promise.all([
            here.request<FsListResult>('fs.list', { path: SHARED }),
            there.request<FsListResult>('fs.list', { path: SHARED })
        ]);
        expect(mine.entries.map((entry) => entry.name)).toContain('mine.txt');
        expect(mine.entries.map((entry) => entry.name)).not.toContain('theirs.txt');
        expect(theirs.entries.map((entry) => entry.name)).toContain('theirs.txt');
        expect(theirs.entries.map((entry) => entry.name)).not.toContain('mine.txt');
    });

    test('a note linked on a canvas of the container is read back inside that container', async () => {
        const sessionId = `scope-context-${Date.now()}`;
        startedSessions.push(sessionId);
        /* A folder of its own, so the project file it writes stays out of the checkouts the git tests read. */
        const opened = await there.request<ProjectOpenResult>('project.open', { folder: `/tmp/ruimte-context-${Date.now()}`, createFolder: true });
        // The daemon derives the links from the document it saved, so no client has to tell it.
        await there.request<ProjectSaveResult>('project.save', {
            projectId: opened.summary.projectId,
            baseRev: opened.document.rev,
            content: {
                name: 'Context',
                color: '#000',
                views: [
                    {
                        kind: 'canvas',
                        id: 'main',
                        name: 'Canvas',
                        nodes: [
                            { id: sessionId, kind: 'terminal', title: 'shell', x: 0, y: 0, w: 560, h: 360 },
                            { id: 'note-1', kind: 'note', title: 'Sprint goals', x: 600, y: 0, w: 240, h: 200, body: 'ship the pool' }
                        ],
                        texts: [],
                        edges: [{ id: 'edge-1', from: 'note-1', to: sessionId }],
                        layouts: []
                    }
                ] satisfies ProjectView[]
            }
        });
        await there.request('session.create', { sessionId, cwd: REPO, cols: 80, rows: 24 });
        await there.request('session.attach', { sessionId, cols: 80, rows: 24 });

        there.takeOutput();
        /*
         * By its path in the image, not by its name. Debian's `/etc/profile` writes PATH from
         * scratch, so the directory the daemon puts in front of it is gone by the first prompt of a
         * login shell. The script itself is what this is about, and it reads the address and the
         * token out of the session's environment either way.
         */
        await there.request('session.write', {
            sessionId,
            data: '/app/apps/server/bin/ruimte-context && /app/apps/server/bin/ruimte-context read note-1\n'
        });
        let said = '';
        await waitUntil('the shell in the container to read its own context', () => {
            said += there.takeOutput();
            return said.includes('Sprint goals') && said.includes('ship the pool');
        });
    }, 30_000);

    /*
     * The two halves of the union. A project id is minted by the daemon that owns it, so one folder
     * on two machines is two projects, and neither daemon knows anything of the other's list. Last
     * of this block. Opening a project writes into the folder the git tests above read.
     */
    test('one folder on both machines is two projects, and neither list holds the other', async () => {
        const [mine, theirs] = await Promise.all([
            here.request<ProjectOpenResult>('project.open', { folder: SHARED, name: 'Shared here' }),
            there.request<ProjectOpenResult>('project.open', { folder: SHARED, name: 'Shared there' })
        ]);
        expect(mine.summary.projectId).not.toBe(theirs.summary.projectId);
        expect(mine.summary.folder).toBe(SHARED);
        expect(theirs.summary.folder).toBe(SHARED);

        const [listedHere, listedThere] = await Promise.all([
            here.request<ProjectListResult>('project.list', {}),
            there.request<ProjectListResult>('project.list', {})
        ]);
        expect(listedHere.projects.map((project) => project.projectId)).toContain(mine.summary.projectId);
        expect(listedHere.projects.map((project) => project.projectId)).not.toContain(theirs.summary.projectId);
        expect(listedThere.projects.map((project) => project.projectId)).toContain(theirs.summary.projectId);
        expect(listedThere.projects.map((project) => project.projectId)).not.toContain(mine.summary.projectId);

        await here.request('project.delete', { projectId: mine.summary.projectId, removeFiles: true });
        await there.request('project.delete', { projectId: theirs.summary.projectId, removeFiles: true });
    }, 30_000);
});

/*
 * Two projects open at once, one per machine, which is what a workspace carrying its own connection
 * is for. Every request here is made twice, once per daemon, and neither answer may know about the
 * other: the canvas each saves, the bytes each serves and the shell each runs stay on their own side.
 */
describe.skipIf(!ENABLED)('two projects side by side', () => {
    const LOCAL_PORT = Number(process.env.RUIMTE_SIDE_PORT ?? 4313);
    const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
    let daemon: ReturnType<typeof Bun.spawn> | null = null;
    let home = '';
    let folder = '';
    let here: RemoteClient;
    let there: RemoteClient;
    let ticket = '';
    let mine = '';
    let theirs = '';
    /* The rev each file is at; a save names the one it was based on and the daemon refuses any other. */
    let mineRev = 0;
    let theirsRev = 0;

    const canvas = (name: string): ProjectView[] => [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Main',
            nodes: [],
            texts: [{ id: 'text-1', x: 0, y: 0, text: name, size: 18 }],
            edges: [],
            layouts: []
        }
    ];

    beforeAll(async () => {
        home = await mkdtemp(join(tmpdir(), 'ruimte-side-'));
        folder = await mkdtemp(join(tmpdir(), 'ruimte-side-project-'));
        daemon = Bun.spawn(
            [
                'bun',
                join(import.meta.dir, '../main.ts'),
                '--host',
                '127.0.0.1',
                '--port',
                String(LOCAL_PORT),
                '--no-hooks',
                '--no-price-fetch',
                '--no-model-fetch',
                '--no-lan'
            ],
            { env: { ...process.env, RUIMTE_HOME: home }, stdout: 'ignore', stderr: 'inherit' }
        );
        await waitUntil(`a second daemon on ${LOCAL_URL}`, () => answers(LOCAL_URL));
        await waitUntil(`the container on ${BASE_URL}`, () => answers(BASE_URL), 5_000);
        here = await RemoteClient.connect(await readLocalSecret(home), LOCAL_PORT);
        const remote = await remoteSocket();
        there = remote.client;
        ticket = remote.ticket;

        const [opened, openedThere] = await Promise.all([
            here.request<ProjectOpenResult>('project.open', { folder, name: 'Here' }),
            there.request<ProjectOpenResult>('project.open', { folder: REPO, name: 'There' })
        ]);
        mine = opened.summary.projectId;
        theirs = openedThere.summary.projectId;
        mineRev = opened.document.rev;
        theirsRev = openedThere.document.rev;
    }, 60_000);

    afterAll(async () => {
        await here?.request('project.delete', { projectId: mine, removeFiles: true }).catch(() => undefined);
        // The last test stops the container, so it is put back here rather than there. A failure must not leave it down.
        await docker(['start', CONTAINER]).catch(() => undefined);
        await waitUntil(`the container on ${BASE_URL} again`, () => answers(BASE_URL), 60_000).catch(() => undefined);
        // Its socket went with the stop, so what it opened is cleared from inside it.
        await inContainer(['rm', '-rf', `${REPO}/.ruimte`]).catch(() => undefined);
        here?.close();
        there?.close();
        daemon?.kill();
        await daemon?.exited;
        await rm(home, { recursive: true, force: true });
        await rm(folder, { recursive: true, force: true });
    });

    test('each workspace saves its own canvas into its own project file', async () => {
        const [mineSaved, theirsSaved] = await Promise.all([
            here.request<ProjectSaveResult>('project.save', {
                projectId: mine,
                baseRev: mineRev,
                content: { name: 'Here', color: '#000', views: canvas('written here') }
            }),
            there.request<ProjectSaveResult>('project.save', {
                projectId: theirs,
                baseRev: theirsRev,
                content: { name: 'There', color: '#000', views: canvas('written there') }
            })
        ]);
        expect(mineSaved.rev).toBe(mineRev + 1);
        expect(theirsSaved.rev).toBe(theirsRev + 1);
        mineRev = mineSaved.rev;
        theirsRev = theirsSaved.rev;

        const onDisk = await Bun.file(join(folder, '.ruimte/private/project.json')).text();
        expect(onDisk).toContain('written here');
        expect(onDisk).not.toContain('written there');
        const overThere = await inContainer(['cat', `${REPO}/.ruimte/private/project.json`]);
        expect(overThere).toContain('written there');
        expect(overThere).not.toContain('written here');
    }, 30_000);

    test('a project opened on one machine is not in the other machine list', async () => {
        const [listedHere, listedThere] = await Promise.all([
            here.request<ProjectListResult>('project.list', {}),
            there.request<ProjectListResult>('project.list', {})
        ]);
        expect(listedHere.projects.map((project) => project.projectId)).toEqual([mine]);
        expect(listedThere.projects.map((project) => project.projectId)).toContain(theirs);
        expect(listedThere.projects.map((project) => project.projectId)).not.toContain(mine);
    });

    test('each files panel browses its own file system, at the same time', async () => {
        await Bun.write(join(folder, 'here.txt'), 'here');
        const [mineList, theirsList] = await Promise.all([
            here.request<FsListResult>('fs.list', { path: folder }),
            there.request<FsListResult>('fs.list', { path: REPO })
        ]);
        expect(mineList.entries.map((entry) => entry.name)).toContain('here.txt');
        expect(theirsList.entries.map((entry) => entry.name)).toContain('README.md');
        expect(theirsList.entries.map((entry) => entry.name)).not.toContain(basename(folder));
    });

    test('each git panel reads the checkout of its own machine', async () => {
        const [mineStatus, theirsStatus] = await Promise.all([
            here.request<GitStatus>('git.status', { cwd: folder }),
            there.request<GitStatus>('git.status', { cwd: REPO })
        ]);
        // A folder that is no checkout has no branch; the container's repository has one and its outstanding work.
        expect(mineStatus.branch).toBeNull();
        expect(mineStatus.files).toEqual([]);
        expect(theirsStatus.branch).toBe('main');
        expect(theirsStatus.files.map((file) => file.path)).toContain('README.md');
    });

    /*
     * The bytes of an image never travel over the socket, so the viewer of each workspace builds a
     * URL against its own daemon with its own credential: the local secret here, the ticket of the
     * channel there. Without the container's ticket the container's URL opens nothing.
     */
    test('the bytes a viewer draws come from the daemon of its own workspace', async () => {
        /* A one pixel GIF, because the route serves images and video and nothing else. The two
           differ in one byte of the palette, which is what tells the answers apart. */
        const here_gif = 'R0lGODlhAQABAIABAP8AAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        const there_gif = 'R0lGODlhAQABAIABAAD/AAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
        await Bun.write(join(folder, 'here.gif'), Buffer.from(here_gif, 'base64'));
        await inContainer(['sh', '-c', `echo ${there_gif} | base64 -d > ${REPO}/there.gif`]);

        const localSecret = encodeURIComponent((await readLocalSecret(home)) ?? '');
        const mineBytes = await fetch(`${LOCAL_URL}/fs/file?path=${encodeURIComponent(join(folder, 'here.gif'))}&v=1-1&token=${localSecret}`);
        expect(Buffer.from(await mineBytes.arrayBuffer()).toString('base64')).toBe(here_gif);
        const theirsBytes = await fetch(`${BASE_URL}/fs/file?path=${encodeURIComponent(`${REPO}/there.gif`)}&v=1-1&token=${encodeURIComponent(ticket)}`);
        expect(Buffer.from(await theirsBytes.arrayBuffer()).toString('base64')).toBe(there_gif);

        // The same URL without the container's ticket. A workspace only reaches the daemon that let it in.
        const withoutTicket = await fetch(`${BASE_URL}/fs/file?path=${encodeURIComponent(`${REPO}/there.gif`)}&v=1-1`);
        expect(withoutTicket.status).toBe(401);
    }, 30_000);

    /* Last of this block. The container goes down and only comes back for the tests after it. */
    test('the container going down leaves the other workspace saving', async () => {
        await docker(['stop', '--time', '5', CONTAINER]);
        await waitUntil('the socket to the container to notice', () => there.closed);

        expect(here.closed).toBe(false);
        const saved = await here.request<ProjectSaveResult>('project.save', {
            projectId: mine,
            baseRev: mineRev,
            content: { name: 'Here', color: '#000', views: canvas('saved while the other machine is gone') }
        });
        expect(saved.rev).toBe(mineRev + 1);
        mineRev = saved.rev;
        expect(await Bun.file(join(folder, '.ruimte/private/project.json')).text()).toContain('saved while the other machine is gone');
    }, 120_000);
});

/* Runs the suite's broker on this machine until `stop`; the container backs off up to 30 seconds between tries to reach it. */
const startBroker = async (): Promise<Subprocess> => {
    const broker = Bun.spawn(['bun', join(import.meta.dir, '..', '..', '..', 'pulsar-broker', 'src', 'main.ts'), '--port', String(BROKER_PORT)], {
        stdout: 'ignore',
        stderr: 'inherit'
    });
    await waitUntil('the broker to answer', async () => (await fetch(BROKER_HEALTH).catch(() => null))?.ok === true);
    return broker;
};

const machineAnnounced = (): Promise<void> =>
    waitUntil(
        'the machine in the container to announce itself to the broker',
        async () => (((await (await fetch(BROKER_HEALTH)).json()) as { machines: number }).machines ?? 0) >= 1,
        45_000
    );

/*
 * The same channel with no socket to the container at all. A broker runs on this machine, the
 * container dials it at `host.docker.internal` (`compose.yml`), and a client here signals through it
 * alone, on a key the door let in before. Stopping the broker afterwards shows that a channel that is
 * in never needed it again.
 */
describe.skipIf(!ENABLED)('a direct connection signaled through the broker', () => {
    let broker: Subprocess | null = null;

    beforeAll(async () => {
        broker = await startBroker();
    });

    afterAll(async () => {
        broker?.kill();
        await broker?.exited;
    });

    test('endpoint.info names the broker the machine announces itself to', async () => {
        const owner = await connectOwner();
        try {
            expect((await owner.request<EndpointInfo>('endpoint.info', {})).brokerUrl).toBe(BROKER_URL);
        } finally {
            owner.close();
        }
        await machineAnnounced();
    }, 60_000);

    test('a key nobody let in gets a signed not-paired, and a signal a known key did not sign gets nothing', async () => {
        await machineAnnounced();
        const { publicKey: machineKey } = await machineInContainer();
        const offer: SignalEnvelope = { connectionId: `stranger-${Date.now()}`, signal: { kind: 'offer', sdp: 'v=0' } };

        const stranger = generateKeyPair();
        const strangerOnBroker = await onBroker(stranger);
        await strangerOnBroker.peer.relay(machineKey, offer);
        await waitUntil('the refusal', () => strangerOnBroker.relayed.length === 1);
        const refusal = strangerOnBroker.relayed[0]!;
        expect(refusal.from).toBe(machineKey);
        expect(refusal.envelope).toEqual({ connectionId: offer.connectionId, signal: { kind: 'close', reason: 'not-paired' } });
        expect(verifySignature(machineKey, signalMessage(machineKey, stranger.publicKey, refusal.envelope), refusal.signature)).toBe(true);

        const known = await throughDoor();
        known.channel.close();
        const knownOnBroker = await onBroker(known.key);
        const forged: SignalEnvelope = { connectionId: `forged-${Date.now()}`, signal: { kind: 'offer', sdp: 'v=0' } };
        knownOnBroker.socket.send(
            JSON.stringify({
                type: 'relay',
                id: 'forged',
                to: machineKey,
                envelope: forged,
                signature: signMessage(generateKeyPair().privateKey, signalMessage(known.key.publicKey, machineKey, forged))
            })
        );
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        expect(knownOnBroker.relayed).toEqual([]);
    }, 60_000);

    test('a key the door let in opens the channel through the broker alone, with no statement, and the channel outlives the broker', async () => {
        await machineAnnounced();
        const known = await throughDoor();
        known.channel.close();
        const line = await brokerLine(known.key, known.machine);
        const client = offerOver(line, keyCredential(known.key, known.machine));
        await client.open();
        // Like the app, the broker socket is only for the signals.
        line.close();
        expect((await client.request<EndpointInfo>('endpoint.info', {})).authenticated).toBe(true);
        console.log(`direct channel through the broker: open after ${client.timings.channelOpenMs} ms, signed in after ${client.timings.authenticatedMs} ms`);

        let output = '';
        client.onFrame((raw) => {
            const frame = JSON.parse(raw) as { event?: string; payload?: { data?: string } };
            if (frame.event === 'session.output') {
                output += frame.payload?.data ?? '';
            }
        });
        const sessionId = `docker-broker-${Date.now()}`;
        await client.request<SessionInfo>('session.create', { sessionId, cwd: REPO, cols: 80, rows: 24 });
        try {
            await client.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
            await client.request('session.write', { sessionId, data: 'echo brokered-$((6*7)) && uname -s\n' });
            await waitUntil('the shell to answer over the channel', () => output.includes('brokered-42') && output.includes('Linux'));

            broker!.kill();
            await broker!.exited;
            expect(await fetch(BROKER_HEALTH).catch(() => null)).toBeNull();
            await client.request('session.write', { sessionId, data: 'echo without-broker-$((6*7))\n' });
            await waitUntil('the shell to answer with the broker gone', () => output.includes('without-broker-42'));
            expect(client.isOpen).toBe(true);
        } finally {
            await client.request('session.kill', { sessionId }).catch(() => undefined);
        }
    }, 90_000);
});

/*
 * The route the account list opens from anywhere: a statement carried in an offer through the broker,
 * from a key the machine has never seen. Nothing here reaches the container but the broker.
 */
describe.skipIf(!ENABLED)('a machine opened on a statement through the broker', () => {
    let broker: Subprocess | null = null;

    beforeAll(async () => {
        broker = await startBroker();
        // The broker before this one went away, so the container is somewhere in its backoff.
        await machineAnnounced();
    }, 60_000);

    afterAll(async () => {
        broker?.kill();
        await broker?.exited;
    });

    test('a statement for this machine and this key opens a terminal, and the machine lists the client as let in through a statement', async () => {
        const machine = await machineInContainer();
        const key = generateKeyPair();
        const line = await brokerLine(key, machine);
        const client = offerOver(line, keyCredential(key, machine), { statement: statementFor(machine, key.publicKey) });
        await client.open();
        line.close();
        expect((await client.request<EndpointInfo>('endpoint.info', {})).authenticated).toBe(true);
        const { sessions } = await client.request<AuthSessionsResult>('auth.sessions', {});
        expect(sessions.find((session) => session.current)).toMatchObject({ label: CLIENT_LABEL, origin: 'statement' });

        let output = '';
        client.onFrame((raw) => {
            const frame = JSON.parse(raw) as { event?: string; payload?: { data?: string } };
            if (frame.event === 'session.output') {
                output += frame.payload?.data ?? '';
            }
        });
        const sessionId = `docker-statement-${Date.now()}`;
        await client.request<SessionInfo>('session.create', { sessionId, cwd: REPO, cols: 80, rows: 24 });
        try {
            await client.request<SessionAttachResult>('session.attach', { sessionId, cols: 80, rows: 24 });
            await client.request('session.write', { sessionId, data: 'echo statement-$((6*7)) && uname -s\n' });
            await waitUntil('the shell to answer over the channel', () => output.includes('statement-42') && output.includes('Linux'));
        } finally {
            await client.request('session.kill', { sessionId }).catch(() => undefined);
        }
    }, 90_000);

    test('no statement, one for another key, one that ran out, one for another machine or its key and one that names no account all get not-paired and no channel', async () => {
        const machine = await machineInContainer();
        const attempts: Array<[string, (key: KeyPair) => AccessStatement | null]> = [
            ['no statement', () => null],
            ['another key', () => statementFor(machine, generateKeyPair().publicKey)],
            [
                'ran out',
                (key) =>
                    statementFor(machine, key.publicKey, {
                        issuedAt: Date.now() - 10 * 60_000,
                        expiresAt: Date.now() - 10 * 60_000 + ACCESS_STATEMENT_LIFETIME_MS
                    })
            ],
            ['another machine', (key) => statementFor({ ...machine, id: 'the-machine-next-door' }, key.publicKey)],
            ['another machine key', (key) => statementFor({ ...machine, publicKey: generateKeyPair().publicKey }, key.publicKey)],
            [
                'no account, as a client older than 0.12 sends it',
                (key) => {
                    const { machineId, clientPublicKey, nonce, issuedAt, expiresAt, signature } = statementFor(machine, key.publicKey);
                    return { machineId, clientPublicKey, nonce, issuedAt, expiresAt, signature };
                }
            ]
        ];
        for (const [what, statementOf] of attempts) {
            const key = generateKeyPair();
            const line = await brokerLine(key, machine);
            const statement = statementOf(key);
            const client = offerOver(line, keyCredential(key, machine), statement ? { statement } : {});
            const outcome = await client.open().then(
                () => 'opened',
                (e: Error) => e.message
            );
            expect([what, outcome]).toEqual([what, 'The machine closed the attempt: not-paired']);
            line.close();
        }
    }, 120_000);
});
