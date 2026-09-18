import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from '../../../packages/contracts/src';

export const repositoryRoot = resolve(import.meta.dir, '../../..');

export interface DaemonOptions {
    args?: string[];
    binary?: string;
    env?: Record<string, string>;
    home?: string;
}

export class RpcFailure extends Error {
    constructor(
        readonly method: string,
        readonly error: { code?: string; message?: string }
    ) {
        super(`${method}: ${error.code ?? 'error'}: ${error.message ?? 'RPC failed'}`);
    }
}

export async function startDaemon(options: DaemonOptions = {}) {
    const ownsHome = options.home === undefined;
    const home = options.home ?? (await mkdtemp(join(tmpdir(), 'ruimte-wire-')));
    const args = ['--no-hooks', '--no-price-fetch', '--no-broker', '--no-stun', '--port', '0', ...(options.args ?? [])];
    const command = [options.binary ?? join(repositoryRoot, 'apps/server-rust/target/debug/ruimte-server'), ...args];
    const child = Bun.spawn(command, {
        cwd: repositoryRoot,
        env: {
            ...process.env,
            RUIMTE_HOME: home,
            CLAUDE_CONFIG_DIR: join(home, 'claude'),
            CODEX_HOME: join(home, 'codex'),
            ...options.env
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe'
    });
    let output = '';
    let port = 0;
    const inspect = async (stream: ReadableStream): Promise<void> => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) {
            output = `${output}${decoder.decode(chunk, { stream: true })}`.slice(-64 * 1024);
            port ||= Number(/listening on ws:\/\/[^:]+:(\d+)\/ws/.exec(output)?.[1] ?? 0);
        }
    };
    void inspect(child.stdout);
    void inspect(child.stderr);

    const stop = async (): Promise<void> => {
        if (child.exitCode === null) {
            child.kill('SIGTERM');
            if ((await Promise.race([child.exited, Bun.sleep(5000).then(() => null)])) === null) {
                child.kill('SIGKILL');
                await child.exited;
            }
        }
        if (ownsHome) {
            await rm(home, { recursive: true, force: true });
        }
    };

    try {
        const deadline = Date.now() + 30_000;
        while (port === 0) {
            if (child.exitCode !== null || Date.now() > deadline) {
                throw new Error(`Daemon did not start (${child.exitCode}): ${output}`);
            }
            await Bun.sleep(20);
        }
        const token = (await readFile(join(home, 'local.key'), 'utf8')).trim();
        const base = `http://127.0.0.1:${port}`;
        return {
            base,
            child,
            connect: () => connect(port, token),
            home,
            port,
            request: (path: string, init: RequestInit = {}) => {
                const headers = new Headers(init.headers);
                headers.set('authorization', `Bearer ${token}`);
                return fetch(new URL(path, base), { ...init, headers });
            },
            stop,
            token
        };
    } catch (error) {
        await stop();
        throw error;
    }
}

async function connect(port: number, token: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=1&token=${encodeURIComponent(token)}`);
    const pending = new Map<string, { reject: (error: Error) => void; resolve: (frame: any) => void; timer: ReturnType<typeof setTimeout> }>();
    const frames: any[] = [];
    const violations: unknown[] = [];
    let sequence = 0;
    socket.addEventListener('message', (message) => {
        const frame = JSON.parse(String(message.data));
        frames.push(frame);
        if (frame.type === 'event') {
            const result = (EVENT_SCHEMAS as any)[frame.event]?.safeParse(frame.payload);
            if (!result?.success) {
                violations.push({ event: frame.event, issues: result?.error?.issues });
            }
        }
        const request = frame.id ? pending.get(frame.id) : undefined;
        if (request && frame.id) {
            pending.delete(frame.id);
            clearTimeout(request.timer);
            request.resolve(frame);
        }
    });
    socket.addEventListener('close', () => {
        for (const request of pending.values()) {
            clearTimeout(request.timer);
            request.reject(new Error('WebSocket closed'));
        }
        pending.clear();
    });
    await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener('open', () => resolveOpen(), { once: true });
        socket.addEventListener('error', () => reject(new Error('WebSocket failed')), { once: true });
    });

    const call = async (method: string, payload: unknown): Promise<any> => {
        const schema = (REQUEST_SCHEMAS as any)[method];
        schema.payload.parse(payload);
        const id = String(++sequence);
        const frame = await new Promise<any>((resolveReply, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`${method} timed out`));
            }, 15_000);
            pending.set(id, { reject, resolve: resolveReply, timer });
            socket.send(JSON.stringify({ id, type: method, payload }));
        });
        if (!frame.ok) {
            throw new RpcFailure(method, frame.error ?? {});
        }
        const result = schema.result.safeParse(frame.result);
        if (!result.success) {
            throw new Error(`${method} returned an invalid result: ${JSON.stringify(result.error.issues)}`);
        }
        return frame.result;
    };

    return { call, close: () => socket.close(), frames, socket, violations };
}
