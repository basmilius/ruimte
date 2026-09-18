import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REQUEST_SCHEMAS } from '../../../packages/contracts/src';
import { accessStatementMessage, brokerHelloMessage, signalMessage } from '../../../packages/pulsar/src';
import { generateKeyPair, signMessage, verifySignature } from './support/keys.ts';
import { DirectClient } from './support/direct-client.ts';

const root = resolve(import.meta.dir, '../../..');

test('the native broker authenticates, relays WebRTC and admits a signed access statement', async () => {
    const addressBook = generateKeyPair();
    const home = await mkdtemp(join(tmpdir(), 'ruimte-broker-'));
    let machineSocket: Bun.ServerWebSocket<unknown> | undefined;
    let machineKey = '';
    let brokerReady!: () => void;
    const ready = new Promise<void>((resolveReady) => (brokerReady = resolveReady));
    const clients = new Map<string, DirectClient>();
    const brokerChallenge = randomBytes(24).toString('base64url');
    const broker = Bun.serve({
        port: 0,
        fetch(request, server) {
            return server.upgrade(request) ? undefined : new Response('upgrade required', { status: 426 });
        },
        websocket: {
            message(socket, raw) {
                const frame = JSON.parse(String(raw)) as any;
                if (frame.type === 'hello') {
                    machineSocket = socket;
                    machineKey = frame.publicKey;
                    socket.send(
                        JSON.stringify({
                            type: 'challenge',
                            broker: `127.0.0.1:${broker.port}`,
                            nonce: brokerChallenge
                        })
                    );
                    return;
                }
                if (frame.type === 'prove') {
                    expect(
                        verifySignature(machineKey, brokerHelloMessage(`127.0.0.1:${broker.port}`, 'machine', machineKey, brokerChallenge), frame.signature)
                    ).toBeTrue();
                    socket.send(JSON.stringify({ type: 'ready' }));
                    brokerReady();
                    return;
                }
                if (frame.type === 'ice') {
                    socket.send(JSON.stringify({ type: 'ice', id: frame.id, servers: [], expiresAt: null }));
                    return;
                }
                if (frame.type === 'relay') {
                    expect(verifySignature(machineKey, signalMessage(machineKey, frame.to, frame.envelope), frame.signature)).toBeTrue();
                    clients.get(frame.to)?.receiveSignal(frame.envelope);
                    socket.send(JSON.stringify({ type: 'delivered', id: frame.id }));
                }
            }
        }
    });
    const daemon = Bun.spawn(
        [
            join(root, 'apps/server-rust/target/debug/ruimte-server'),
            '--no-hooks',
            '--no-price-fetch',
            '--no-stun',
            '--broker',
            `ws://127.0.0.1:${broker.port}`,
            '--port',
            '0'
        ],
        {
            cwd: root,
            env: { ...process.env, RUIMTE_HOME: home, RUIMTE_PULSAR_TEST_STATEMENT_KEY: addressBook.publicKey },
            stdout: 'pipe',
            stderr: 'pipe'
        }
    );
    const directClients: DirectClient[] = [];
    try {
        const port = await listeningPort(daemon);
        const secret = (await readFile(join(home, 'local.key'), 'utf8')).trim();
        const endpoint = await endpointInfo(port, secret);
        await ready;

        const paired = generateKeyPair();
        const pairing = await fetch(`http://127.0.0.1:${port}/auth/pairing-token`, {
            method: 'POST',
            headers: { authorization: `Bearer ${secret}` }
        }).then((response) => response.json() as Promise<{ url: string }>);
        const pairResponse = await fetch(`http://127.0.0.1:${port}/auth/pair`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                token: new URL(pairing.url).hash.slice(1),
                label: 'Broker paired client',
                publicKey: paired.publicKey
            })
        });
        expect(pairResponse.status).toBe(200);

        const pairedDirect = makeDirect(paired, endpoint, machineSocket!, machineKey, clients);
        directClients.push(pairedDirect);
        await pairedDirect.open();
        const pairedInfo = await pairedDirect.request('endpoint.info', {});
        REQUEST_SCHEMAS['endpoint.info'].result.parse(pairedInfo);
        expect((pairedInfo as any).authenticated).toBeTrue();

        const newcomer = generateKeyPair();
        const issuedAt = Date.now();
        const expiresAt = issuedAt + 120_000;
        const nonce = randomBytes(16).toString('base64url');
        const statement = {
            machineId: endpoint.id,
            clientPublicKey: newcomer.publicKey,
            nonce,
            issuedAt,
            expiresAt,
            signature: signMessage(addressBook.privateKey, accessStatementMessage(endpoint.id, newcomer.publicKey, nonce, issuedAt, expiresAt))
        };
        const statementDirect = makeDirect(newcomer, endpoint, machineSocket!, machineKey, clients, {
            statement,
            label: 'Statement client'
        });
        directClients.push(statementDirect);
        await statementDirect.open();
        const statementInfo = await statementDirect.request('endpoint.info', {});
        REQUEST_SCHEMAS['endpoint.info'].result.parse(statementInfo);
        expect((statementInfo as any).authenticated).toBeTrue();
    } finally {
        for (const direct of directClients) {
            direct.close();
        }
        daemon.kill('SIGTERM');
        await Promise.race([daemon.exited, Bun.sleep(5000)]);
        if (daemon.exitCode === null) {
            daemon.kill('SIGKILL');
            await daemon.exited;
        }
        broker.stop(true);
        await rm(home, { recursive: true, force: true });
    }
}, 90_000);

const makeDirect = (
    client: ReturnType<typeof generateKeyPair>,
    endpoint: { id: string; publicKey: string },
    socket: Bun.ServerWebSocket<unknown>,
    machineKey: string,
    clients: Map<string, DirectClient>,
    access?: ConstructorParameters<typeof DirectClient>[0]['access']
): DirectClient => {
    const direct = new DirectClient({
        stunServers: [],
        credential: {
            kind: 'key',
            ...client,
            daemonId: endpoint.id,
            daemonPublicKey: endpoint.publicKey
        },
        access,
        timeoutMs: 20_000,
        signal(envelope) {
            socket.send(
                JSON.stringify({
                    type: 'relayed',
                    from: client.publicKey,
                    envelope,
                    signature: signMessage(client.privateKey, signalMessage(client.publicKey, machineKey, envelope))
                })
            );
        }
    });
    clients.set(client.publicKey, direct);
    return direct;
};

const endpointInfo = async (port: number, secret: string): Promise<{ id: string; publicKey: string }> => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=1&token=${encodeURIComponent(secret)}`);
    await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener('open', () => resolveOpen(), { once: true });
        socket.addEventListener('error', () => reject(new Error('WebSocket failed')), { once: true });
    });
    const result = await new Promise<any>((resolveResult, reject) => {
        const timeout = setTimeout(() => reject(new Error('endpoint.info timed out')), 10_000);
        socket.addEventListener('message', (event) => {
            const frame = JSON.parse(String(event.data));
            if (frame.id === 'endpoint') {
                clearTimeout(timeout);
                resolveResult(frame.result);
            }
        });
        socket.send(JSON.stringify({ id: 'endpoint', type: 'endpoint.info', payload: {} }));
    });
    socket.close();
    return result;
};

const listeningPort = async (child: ReturnType<typeof Bun.spawn>): Promise<number> => {
    let output = '';
    let port = 0;
    const inspect = async (stream: ReadableStream): Promise<void> => {
        for await (const chunk of stream) {
            output += new TextDecoder().decode(chunk);
            port ||= Number(/listening on ws:\/\/[^:]+:(\d+)\/ws/.exec(output)?.[1] ?? 0);
        }
    };
    void inspect(child.stdout);
    void inspect(child.stderr);
    const deadline = Date.now() + 30_000;
    while (!port) {
        if (child.exitCode !== null || Date.now() > deadline) {
            throw new Error(`Daemon failed to listen: ${output}`);
        }
        await Bun.sleep(20);
    }
    return port;
};
