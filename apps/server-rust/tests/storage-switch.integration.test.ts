import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUEST_SCHEMAS } from '../../../packages/contracts/src';
import { startDaemon } from './wire-client.ts';

test('native daemon restarts preserve authentication and project storage', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'ruimte-storage-switch-'));
    const home = join(temporary, 'home');
    const folder = join(temporary, 'project');
    await mkdir(home);
    await mkdir(folder);
    let projectId = '';
    let token = '';
    let endpoint: { id: string; publicKey: string } | undefined;
    let localSecret = '';
    let revision = 0;
    const unknownNode = {
        id: 'future-node',
        kind: 'future-terminal',
        payload: { version: 8, text: '界' },
        x: 12,
        y: 13,
        w: 100,
        h: 90
    };

    try {
        for (const _attempt of [0, 1, 2]) {
            const daemon = await startDaemon({ home });
            let socket: WebSocket | undefined;
            try {
                const secret = (await readFile(join(home, 'local.key'), 'utf8')).trim();
                if (localSecret) {
                    expect(secret).toBe(localSecret);
                } else {
                    localSecret = secret;
                }
                const base = daemon.base;
                if (!token) {
                    const pairing = (await (
                        await fetch(`${base}/auth/pairing-token`, {
                            method: 'POST',
                            headers: { authorization: `Bearer ${secret}` }
                        })
                    ).json()) as { url: string };
                    const paired = (await (
                        await fetch(`${base}/auth/pair`, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ token: new URL(pairing.url).hash.slice(1), label: 'Storage switch' })
                        })
                    ).json()) as { sessionToken: string };
                    token = paired.sessionToken;
                }
                const connection = await connect(daemon.port, token);
                socket = connection.socket;
                const current = (await connection.rpc('endpoint.info', {})) as { id: string; publicKey: string };
                if (endpoint) {
                    expect(current.id).toBe(endpoint.id);
                    expect(current.publicKey).toBe(endpoint.publicKey);
                } else {
                    endpoint = current;
                }
                const opened = (await connection.rpc('project.open', projectId ? { projectId } : { folder, name: 'Storage switch' })) as any;
                projectId = opened.summary.projectId;
                if (revision > 0) {
                    expect(opened.document.rev).toBe(revision);
                    expect(opened.document.views[0].nodes[0]).toMatchObject({ kind: 'unknown', raw: unknownNode });
                }
                const saved = (await connection.rpc('project.save', {
                    projectId,
                    baseRev: opened.document.rev,
                    content: {
                        name: `Storage switch ${revision}`,
                        color: '#353e53',
                        views: [
                            {
                                kind: 'canvas',
                                id: 'main',
                                name: 'Canvas',
                                nodes: [unknownNode],
                                texts: [],
                                edges: [],
                                layouts: []
                            }
                        ]
                    }
                })) as { rev: number };
                revision = saved.rev;
            } finally {
                socket?.close();
                await daemon.stop();
            }
        }
        expect(revision).toBe(3);
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}, 90_000);

const connect = async (port: number, token: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=1&token=${encodeURIComponent(token)}`);
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let sequence = 0;
    socket.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data)) as { id?: string; ok?: boolean; result?: unknown; error?: unknown };
        const request = frame.id ? pending.get(frame.id) : undefined;
        if (!request || !frame.id) {
            return;
        }
        pending.delete(frame.id);
        if (frame.ok) {
            request.resolve(frame.result);
        } else {
            request.reject(new Error(JSON.stringify(frame.error)));
        }
    });
    await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener('open', () => resolveOpen(), { once: true });
        socket.addEventListener('error', () => reject(new Error('WebSocket authentication failed')), { once: true });
    });
    const rpc = async (method: keyof typeof REQUEST_SCHEMAS, payload: unknown): Promise<unknown> => {
        const id = String(++sequence);
        const result = await new Promise<unknown>((resolveReply, reject) => {
            pending.set(id, { resolve: resolveReply, reject });
            socket.send(JSON.stringify({ id, type: method, payload }));
        });
        REQUEST_SCHEMAS[method].result.parse(result);
        return result;
    };
    return { socket, rpc };
};
