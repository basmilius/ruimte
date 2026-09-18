import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DirectClient } from './support/direct-client.ts';
import { localSecretProof } from './support/channel-auth.ts';
import { generateKeyPair } from './support/keys.ts';
import { DirectChallengeFrameSchema, DirectVerdictFrameSchema, PROTOCOL_VERSION, REQUEST_SCHEMAS } from '../../../packages/contracts/src';

const root = resolve(import.meta.dir, '../../..');

test('the native WebRTC channel authenticates independently and carries RPC', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-direct-'));
    const daemon = Bun.spawn(
        [
            join(process.env.HOME ?? '', '.cargo/bin/cargo'),
            'run',
            '--quiet',
            '--manifest-path',
            join(root, 'apps/server-rust/Cargo.toml'),
            '--',
            '--no-hooks',
            '--no-price-fetch',
            '--no-broker',
            '--no-stun',
            '--port',
            '0'
        ],
        { cwd: root, env: { ...process.env, RUIMTE_HOME: home }, stdout: 'pipe', stderr: 'pipe' }
    );
    let socket: WebSocket | undefined;
    let direct: DirectClient | undefined;
    try {
        const port = await listeningPort(daemon);
        const secret = (await readFile(join(home, 'local.key'), 'utf8')).trim();
        const connection = await connect(port, secret);
        socket = connection.socket;
        const endpoint = (await connection.rpc('endpoint.info', {})) as { id: string };
        direct = new DirectClient({
            stunServers: [],
            credential: { kind: 'secret', secret, daemonId: endpoint.id },
            timeoutMs: 20_000,
            signal: (envelope) => void connection.rpc('direct.signal', { envelope })
        });
        connection.onSignal((envelope) => direct?.receiveSignal(envelope as never));
        const verdict = await direct.open();
        expect(verdict.ticket).toBeNull();
        const info = await direct.request<{
            authenticated: boolean;
            brokerFixed: boolean;
            brokerUrl: string | null;
            id: string;
            reachability: string;
        }>('endpoint.info', {});
        REQUEST_SCHEMAS['endpoint.info'].result.parse(info);
        expect(info.authenticated).toBeFalse();
        expect(info.id).toBe(endpoint.id);
        expect(['loopback', 'lan', 'tunnel', 'public']).toContain(info.reachability);
        expect(info.brokerFixed).toBeTrue();
        expect(info.brokerUrl).toBeNull();
        await Bun.sleep(31_000);
        const stillOpen = await direct.request<{ time: number }>('server.ping', {});
        REQUEST_SCHEMAS['server.ping'].result.parse(stillOpen);
        expect(stillOpen.time).toBeGreaterThan(0);

        direct.close();
        direct = new DirectClient({
            stunServers: [],
            credential: { kind: 'none' },
            timeoutMs: 20_000,
            signal: (envelope) => void connection.rpc('direct.signal', { envelope })
        });
        await expect(direct.open()).rejects.toThrow('Expected a proof');

        direct.close();
        direct = new DirectClient({
            stunServers: [],
            credential: { kind: 'secret', secret: `${secret}-wrong`, daemonId: endpoint.id },
            timeoutMs: 20_000,
            signal: (envelope) => void connection.rpc('direct.signal', { envelope })
        });
        await expect(direct.open()).rejects.toThrow('That is not the secret of this machine');
    } finally {
        direct?.close();
        socket?.close();
        daemon.kill('SIGTERM');
        await Promise.race([daemon.exited, Bun.sleep(5000)]);
        if (daemon.exitCode === null) {
            daemon.kill('SIGKILL');
            await daemon.exited;
        }
        await rm(home, { recursive: true, force: true });
    }
}, 90_000);

test('direct proof validation and paired-key revocation match the authenticated channel contract', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-direct-auth-'));
    const daemon = Bun.spawn(
        [join(root, 'apps/server-rust/target/debug/ruimte-server'), '--no-hooks', '--no-price-fetch', '--no-broker', '--no-stun', '--port', '0'],
        { cwd: root, env: { ...process.env, RUIMTE_HOME: home }, stdout: 'pipe', stderr: 'pipe' }
    );
    let socket: WebSocket | undefined;
    let active: DirectClient | undefined;
    try {
        const port = await listeningPort(daemon);
        const secret = (await readFile(join(home, 'local.key'), 'utf8')).trim();
        const connection = await connect(port, secret);
        socket = connection.socket;
        const endpoint = (await connection.rpc('endpoint.info', {})) as { id: string; publicKey: string };

        for (const proofCase of [
            'protocol-null',
            'protocol-string',
            'protocol-negative',
            'protocol-future',
            'challenge-missing',
            'proof-number',
            'valid-legacy'
        ] as const) {
            const direct = new DirectClient({
                stunServers: [],
                credential: { kind: 'none' },
                signal: (envelope) => void connection.rpc('direct.signal', { envelope }),
                timeoutMs: 8000
            });
            const stopSignals = connection.onSignal((envelope) => direct.receiveSignal(envelope as never));
            let verdictFrame: any;
            (direct as any).handshake = (channel: any, binding: string) =>
                new Promise((resolveHandshake, reject) => {
                    channel.onClose(() => reject(new Error('closed')));
                    channel.receiveWith((raw: string) => {
                        const frame = JSON.parse(raw);
                        const challenge = DirectChallengeFrameSchema.safeParse(frame);
                        if (challenge.success) {
                            const proof: any = {
                                type: 'direct.secret',
                                protocol: PROTOCOL_VERSION,
                                challenge: challenge.data.challenge,
                                proof: localSecretProof(secret, challenge.data.daemon.id, challenge.data.challenge, binding)
                            };
                            if (proofCase === 'protocol-null') proof.protocol = null;
                            if (proofCase === 'protocol-string') proof.protocol = String(PROTOCOL_VERSION);
                            if (proofCase === 'protocol-negative') proof.protocol = -1;
                            if (proofCase === 'protocol-future') proof.protocol = PROTOCOL_VERSION + 1;
                            if (proofCase === 'challenge-missing') delete proof.challenge;
                            if (proofCase === 'proof-number') proof.proof = 42;
                            if (proofCase === 'valid-legacy') delete proof.protocol;
                            channel.send(JSON.stringify(proof));
                            return;
                        }
                        verdictFrame = DirectVerdictFrameSchema.parse(frame);
                        if (verdictFrame.type === 'direct.refused') {
                            reject(new Error(verdictFrame.reason));
                        } else {
                            resolveHandshake({ ticket: verdictFrame.ticket });
                        }
                    }, 4096);
                });
            try {
                if (proofCase === 'valid-legacy') {
                    await expect(direct.open()).resolves.toMatchObject({ ticket: null });
                    expect(verdictFrame).toMatchObject({ type: 'direct.accepted', ticket: null, expiresIn: null });
                } else {
                    const expected = proofCase === 'protocol-future' ? 'This machine and this client run different versions of Ruimte' : 'Expected a proof';
                    await expect(direct.open()).rejects.toThrow(expected);
                    expect(verdictFrame).toMatchObject({ type: 'direct.refused', reason: expected });
                    if (proofCase === 'protocol-future') {
                        expect(verdictFrame).toMatchObject({ protocol: PROTOCOL_VERSION });
                    } else {
                        expect(verdictFrame).not.toHaveProperty('protocol');
                    }
                }
            } finally {
                direct.close();
                stopSignals();
            }
        }

        const pairing = (await connection.rpc('auth.pairingToken', {})) as { url: string };
        const key = generateKeyPair();
        const pairResponse = await fetch(`http://127.0.0.1:${port}/auth/pair`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                token: new URL(pairing.url).hash.slice(1),
                label: 'Direct key fixture',
                publicKey: key.publicKey
            })
        });
        expect(pairResponse.status).toBe(200);
        const paired = (await pairResponse.json()) as { endpoint: { id: string; publicKey: string } };
        active = new DirectClient({
            stunServers: [],
            credential: {
                kind: 'key',
                ...key,
                daemonId: paired.endpoint.id,
                daemonPublicKey: paired.endpoint.publicKey
            },
            signal: (envelope) => void connection.rpc('direct.signal', { envelope }),
            timeoutMs: 10_000
        });
        const stopSignals = connection.onSignal((envelope) => active?.receiveSignal(envelope as never));
        const accepted = await active.open();
        expect(typeof accepted.ticket).toBe('string');
        const info = await active.request<{ authenticated: boolean; id: string }>('endpoint.info', {});
        REQUEST_SCHEMAS['endpoint.info'].result.parse(info);
        expect(info).toMatchObject({ authenticated: true, id: endpoint.id });
        const sessions = (await connection.rpc('auth.sessions', {})) as { sessions: Array<{ id: string; label: string }> };
        const pairedSession = sessions.sessions.find((session) => session.label === 'Direct key fixture');
        expect(pairedSession).toBeDefined();
        await connection.rpc('auth.revoke', { id: pairedSession!.id });
        const deadline = Date.now() + 3000;
        while (active.isOpen && Date.now() < deadline) {
            await Bun.sleep(10);
        }
        expect(active.isOpen).toBeFalse();
        stopSignals();
    } finally {
        active?.close();
        socket?.close();
        daemon.kill('SIGTERM');
        await Promise.race([daemon.exited, Bun.sleep(5000)]);
        if (daemon.exitCode === null) {
            daemon.kill('SIGKILL');
            await daemon.exited;
        }
        await rm(home, { recursive: true, force: true });
    }
}, 90_000);

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
    const deadline = Date.now() + 45_000;
    while (!port) {
        if (child.exitCode !== null || Date.now() > deadline) {
            throw new Error(`Daemon failed to listen: ${output}`);
        }
        await Bun.sleep(20);
    }
    return port;
};

const connect = async (port: number, token: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=1&token=${encodeURIComponent(token)}`);
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const signalListeners = new Set<(envelope: unknown) => void>();
    let sequence = 0;
    socket.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data)) as any;
        if (frame.type === 'event') {
            if (frame.event === 'direct.signaled') {
                for (const listener of signalListeners) {
                    listener(frame.payload.envelope);
                }
            }
            return;
        }
        const request = pending.get(frame.id);
        if (!request) {
            return;
        }
        pending.delete(frame.id);
        if (frame.ok) {
            request.resolve(frame.result);
        } else {
            request.reject(new Error(`${frame.error?.code}: ${frame.error?.message}`));
        }
    });
    await new Promise<void>((open, reject) => {
        socket.addEventListener('open', () => open(), { once: true });
        socket.addEventListener('error', () => reject(new Error('WebSocket failed')), { once: true });
    });
    return {
        socket,
        onSignal(listener: (envelope: unknown) => void) {
            signalListeners.add(listener);
            return () => signalListeners.delete(listener);
        },
        rpc(type: string, payload: unknown): Promise<unknown> {
            const id = String(++sequence);
            const reply = new Promise<unknown>((resolveReply, reject) => pending.set(id, { resolve: resolveReply, reject }));
            socket.send(JSON.stringify({ id, type, payload }));
            return reply;
        }
    };
};
