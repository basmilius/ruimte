import { afterAll, expect, test } from 'bun:test';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REQUEST_SCHEMAS } from '../../../packages/contracts/src';

const run = process.env.RUIMTE_RUN_SLOW_SELF_UPDATE === '1' ? test : test.skip;
const root = resolve(import.meta.dir, '../../..');
const homes: string[] = [];

afterAll(async () => {
    await Promise.all(homes.map((path) => rm(path, { force: true, recursive: true })));
});

run(
    'a changed service build waits for native work to become idle',
    async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'ruimte-self-update-'));
        const home = await mkdtemp(join(tmpdir(), 'ruimte-self-update-home-'));
        homes.push(fixture, home);
        const binary = join(fixture, 'ruimte-server');
        await copyFile(join(root, 'apps/server-rust/target/debug/ruimte-server'), binary);
        await Bun.write(join(fixture, 'ruimte.build'), 'fixture-old\n');

        const child = Bun.spawn([binary, '--no-hooks', '--no-price-fetch', '--no-broker', '--no-stun', '--port', '0'], {
            cwd: root,
            env: {
                ...process.env,
                CLAUDE_CONFIG_DIR: join(home, 'claude'),
                CODEX_HOME: join(home, 'codex'),
                RUIMTE_HOME: home,
                RUIMTE_SERVICE: '1'
            },
            stderr: 'pipe',
            stdout: 'pipe'
        });
        let output = '';
        let port = 0;
        const readOutput = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
            const decoder = new TextDecoder();
            for await (const chunk of stream) {
                output += decoder.decode(chunk, { stream: true });
                port = Number(output.match(/listening on ws:\/\/[^:]+:(\d+)\/ws/)?.[1] ?? port);
            }
        };
        void readOutput(child.stdout);
        void readOutput(child.stderr);

        let socket: WebSocket | undefined;
        try {
            const startupDeadline = Date.now() + 30_000;
            while (port === 0 && child.exitCode === null && Date.now() < startupDeadline) {
                await Bun.sleep(20);
            }
            if (port === 0) throw new Error(`Daemon did not start: ${output}`);

            const token = (await readFile(join(home, 'local.key'), 'utf8')).trim();
            socket = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=1&token=${encodeURIComponent(token)}`);
            await new Promise<void>((accept, reject) => {
                socket!.addEventListener('open', () => accept(), { once: true });
                socket!.addEventListener('error', () => reject(new Error('WebSocket failed')), { once: true });
            });
            let requestId = 0;
            const call = async (method: keyof typeof REQUEST_SCHEMAS, payload: unknown): Promise<unknown> => {
                REQUEST_SCHEMAS[method].payload.parse(payload);
                const id = String(++requestId);
                const reply = await new Promise<Record<string, unknown>>((accept, reject) => {
                    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15_000);
                    const receive = (event: MessageEvent): void => {
                        const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
                        if (frame.id !== id) return;
                        clearTimeout(timer);
                        socket!.removeEventListener('message', receive);
                        accept(frame);
                    };
                    socket!.addEventListener('message', receive);
                    socket!.send(JSON.stringify({ id, payload, type: method }));
                });
                if (reply.ok !== true) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
                return REQUEST_SCHEMAS[method].result.parse(reply.result);
            };

            const base = `http://127.0.0.1:${port}`;
            const health = (await fetch(`${base}/health`).then((response) => response.json())) as Record<string, unknown>;
            await call('session.create', {
                cols: 80,
                command: 'sleep 120',
                rows: 24,
                sessionId: 'busy-update',
                shell: '/bin/sh'
            });
            const work = async (): Promise<{ terminals: number }> =>
                fetch(`${base}/machine/work`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json());
            const workDeadline = Date.now() + 4_000;
            let busy = await work();
            while (busy.terminals === 0 && Date.now() < workDeadline) {
                await Bun.sleep(50);
                busy = await work();
            }
            expect(busy.terminals).toBeGreaterThan(0);

            await Bun.write(join(fixture, 'ruimte.build'), 'fixture-new\n');
            const earlyExit = await Promise.race([child.exited, Bun.sleep(63_500).then(() => null)]);
            expect(earlyExit).toBeNull();
            expect((await work()).terminals).toBeGreaterThan(0);

            await call('session.kill', { sessionId: 'busy-update' });
            socket.close();
            const exitCode = await Promise.race([child.exited, Bun.sleep(8_000).then(() => null)]);
            expect(exitCode).toBe(0);
            expect(health).toMatchObject({ build: 'fixture-old', service: true });
        } finally {
            socket?.close();
            if (child.exitCode === null) {
                child.kill('SIGTERM');
                if ((await Promise.race([child.exited, Bun.sleep(5_000).then(() => null)])) === null) {
                    child.kill('SIGKILL');
                    await child.exited;
                }
            }
        }
    },
    80_000
);
