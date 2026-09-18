import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EndpointInfoSchema, REQUEST_SCHEMAS } from '../../../packages/contracts/src';

const root = resolve(import.meta.dir, '../../..');
const children = new Set<ChildProcessWithoutNullStreams>();

interface RunningDaemon {
    child: ChildProcessWithoutNullStreams;
    home: string;
    port: number;
    secret: string;
}

afterEach(async () => {
    await Promise.all(
        [...children].map(async (child) => {
            child.kill('SIGTERM');
            await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
        })
    );
    children.clear();
});

describe('native daemon core wire', () => {
    test('enforces bearer auth, pairs once and answers validated RPC', async () => {
        const daemon = await startDaemon();
        const base = `http://127.0.0.1:${daemon.port}`;
        const health = await fetch(`${base}/health`);
        expect(health.status).toBe(200);
        expect(await health.json()).toMatchObject({ ok: true, service: false });

        expect((await fetch(`${base}/auth/pairing-token`, { method: 'POST' })).status).toBe(403);
        const pairing = await fetch(`${base}/auth/pairing-token`, {
            method: 'POST',
            headers: { authorization: `Bearer ${daemon.secret}` }
        });
        expect(pairing.status).toBe(200);
        const pairingUrl = new URL(((await pairing.json()) as { url: string }).url);
        expect(pairingUrl.search).toBe('');
        expect(pairingUrl.hash.length).toBeGreaterThan(1);
        const token = pairingUrl.hash.slice(1);

        const wrong = await fetch(`${base}/auth/pair`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: 'wrong', label: 'Integration test' })
        });
        expect(wrong.status).toBe(401);
        const paired = await fetch(`${base}/auth/pair`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token, label: 'Integration test' })
        });
        expect(paired.status).toBe(200);
        const pairResult = (await paired.json()) as { sessionToken: string; endpoint: unknown };
        EndpointInfoSchema.parse(pairResult.endpoint);
        expect(pairResult.sessionToken.length).toBeGreaterThan(20);
        expect(
            (
                await fetch(`${base}/auth/pair`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ token, label: 'Replay' })
                })
            ).status
        ).toBe(401);

        const hello = await rpc(daemon.port, pairResult.sessionToken, 'server.hello', {});
        REQUEST_SCHEMAS['server.hello'].result.parse(hello);
        expect(hello.home).toBe(daemon.home);

        expect(await refusedProtocol(daemon.port, daemon.secret)).toBe(4406);

        const keyPair = generateKeyPairSync('ed25519');
        const publicKey = (keyPair.publicKey.export({ format: 'jwk' }) as { x: string }).x;
        const keyedUrl = new URL(
            (
                (await (
                    await fetch(`${base}/auth/pairing-token`, {
                        method: 'POST',
                        headers: { authorization: `Bearer ${daemon.secret}` }
                    })
                ).json()) as { url: string }
            ).url
        );
        const keyedPair = (await (
            await fetch(`${base}/auth/pair`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token: keyedUrl.hash.slice(1), label: 'Keyed integration test', publicKey })
            })
        ).json()) as { sessionToken?: string; endpoint: { id: string; publicKey: string } };
        expect(keyedPair.sessionToken).toBeUndefined();
        const challenge = (await (await fetch(`${base}/auth/challenge`, { method: 'POST' })).json()) as {
            challenge: string;
            daemon: { id: string; publicKey: string; signature: string };
        };
        const daemonKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: challenge.daemon.publicKey }, format: 'jwk' });
        expect(
            verify(
                null,
                Buffer.from(`ruimte-daemon-v1\n${challenge.daemon.id}\n${challenge.challenge}`),
                daemonKey,
                Buffer.from(challenge.daemon.signature, 'base64url')
            )
        ).toBe(true);
        const signature = sign(
            null,
            Buffer.from(`ruimte-client-v1\n${challenge.daemon.id}\n${challenge.challenge}\n${publicKey}`),
            keyPair.privateKey
        ).toString('base64url');
        const ticketResponse = await fetch(`${base}/auth/ticket`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ publicKey, challenge: challenge.challenge, signature })
        });
        expect(ticketResponse.status).toBe(200);
        const { ticket } = (await ticketResponse.json()) as { ticket: string };
        REQUEST_SCHEMAS['server.ping'].result.parse(await rpc(daemon.port, ticket, 'server.ping', {}));
        expect(
            (
                await fetch(`${base}/auth/ticket`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ publicKey, challenge: challenge.challenge, signature })
                })
            ).status
        ).toBe(401);

        const sessions = (await rpc(daemon.port, daemon.secret, 'auth.sessions', {})) as {
            sessions: Array<{ id: string; label: string }>;
        };
        const keyedSession = sessions.sessions.find((session) => session.label === 'Keyed integration test');
        expect(keyedSession).toBeDefined();
        const victim = await openSocket(daemon.port, ticket);
        const revoked = new Promise<number>((resolveClose) => victim.addEventListener('close', (event) => resolveClose(event.code)));
        await rpc(daemon.port, daemon.secret, 'auth.revoke', { id: keyedSession!.id });
        expect(await revoked).toBe(4001);
        await stopDaemon(daemon.child);
        await rm(daemon.home, { recursive: true, force: true });
    }, 60_000);
});

const startDaemon = async (): Promise<RunningDaemon> => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-native-'));
    const common = ['--no-hooks', '--no-price-fetch', '--no-broker', '--no-stun', '--port', '0'];
    const command = {
        executable: join(process.env.HOME ?? '', '.cargo/bin/cargo'),
        args: ['run', '--quiet', '--manifest-path', join(root, 'apps/server-rust/Cargo.toml'), '--', ...common]
    };
    const child = spawn(command.executable, command.args, {
        cwd: root,
        env: { ...process.env, RUIMTE_HOME: home },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    children.add(child);
    const port = await listeningPort(child);
    const secret = (await readFile(join(home, 'local.key'), 'utf8')).trim();
    return { child, home, port, secret };
};

const listeningPort = (child: ChildProcessWithoutNullStreams): Promise<number> =>
    new Promise((resolvePort, reject) => {
        let output = '';
        const inspect = (chunk: Buffer): void => {
            output += chunk.toString();
            const match = /listening on ws:\/\/[^:]+:(\d+)\/ws/.exec(output);
            if (match) {
                resolvePort(Number(match[1]));
            }
        };
        child.stdout.on('data', inspect);
        child.stderr.on('data', inspect);
        child.once('exit', (code) => reject(new Error(`Daemon exited before listening (${code}): ${output}`)));
        setTimeout(() => reject(new Error(`Daemon did not listen: ${output}`)), 30_000).unref();
    });

const rpc = (port: number, token: string, method: string, payload: unknown): Promise<Record<string, unknown>> =>
    new Promise((resolveReply, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=1&token=${encodeURIComponent(token)}`);
        socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 'request-1', type: method, payload })));
        socket.addEventListener('message', (event) => {
            const frame = JSON.parse(String(event.data)) as { id?: string; ok?: boolean; result?: Record<string, unknown>; error?: unknown };
            if (frame.id !== 'request-1') {
                return;
            }
            socket.close();
            if (frame.ok && frame.result) {
                resolveReply(frame.result);
            } else {
                reject(new Error(`RPC failed: ${JSON.stringify(frame.error)}`));
            }
        });
        socket.addEventListener('error', () => reject(new Error('WebSocket failed')));
    });

const openSocket = (port: number, token: string, protocol = 1): Promise<WebSocket> =>
    new Promise((resolveSocket, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=${protocol}&token=${encodeURIComponent(token)}`);
        socket.addEventListener('open', () => resolveSocket(socket));
        socket.addEventListener('error', () => reject(new Error('WebSocket failed')));
    });

const refusedProtocol = async (port: number, token: string): Promise<number> => {
    const socket = await openSocket(port, token, 2);
    return new Promise((resolveClose) => socket.addEventListener('close', (event) => resolveClose(event.code)));
};

const stopDaemon = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
    children.delete(child);
    child.kill('SIGTERM');
    await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
};
