import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TunnelState } from '@ruimte/contracts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { TunnelConfigError } from './tunnel-config.ts';
import { TunnelService, type TunnelPorts } from './tunnel-service.ts';
import { tunnelStore } from './tunnel-store.ts';
import { FakeCloudflared } from './tunnel-test-helpers.ts';

const homeOf = tempHomes('ruimte-tunnels-');

const TUNNEL_ID = '11111111-2222-3333-4444-555555555555';
const API_PORT = 4210;
const LISTENER_PORT = 4230;

interface Fixture {
    service: TunnelService;
    runner: FakeCloudflared;
    home: string;
    state(): Promise<TunnelState>;
    installed: { value: string | null };
    events: { count: number };
    listener: { on: boolean };
}

async function fixture(overrides: Partial<TunnelPorts> = {}, installed: string | null = '/usr/bin/cloudflared'): Promise<Fixture> {
    const home = await homeOf();
    const runner = new FakeCloudflared();
    const installedBinary = { value: installed };
    const events = { count: 0 };
    const listener = { on: false };
    let counter = 0;
    const service = new TunnelService({
        home,
        store: tunnelStore(home),
        installer: {
            locate: async () => installedBinary.value,
            install: async () => {
                installedBinary.value = '/home/tunnels/bin/cloudflared';

                return installedBinary.value;
            },
            impossible: () => null
        },
        runner,
        deniedPorts: () => [API_PORT, LISTENER_PORT],
        setListener: async (enabled) => {
            listener.on = enabled;

            return enabled ? LISTENER_PORT : null;
        },
        listenerPort: () => (listener.on ? LISTENER_PORT : null),
        clients: () => 2,
        discover: async () => [
            { port: 3000, session: 'Vite' },
            { port: API_PORT, session: null }
        ],
        changed: () => {
            events.count += 1;
        },
        random: (bytes) => String((counter += 1)).padStart(bytes * 2, '0'),
        log: () => undefined,
        stopWaitMs: 50,
        ...overrides
    });

    runner.answer('tunnel login', {
        lines: ['Please open the following URL and log in with your Cloudflare account:', 'https://dash.cloudflare.com/argotunnel?aud=x&callback=y']
    });
    runner.answer('tunnel create', {
        lines: [
            `Tunnel credentials written to /home/me/.cloudflared/${TUNNEL_ID}.json. cloudflared chose this file based on where your origin certificate was found.`,
            `Created tunnel ruimte-x with id ${TUNNEL_ID}`
        ]
    });

    return { service, runner, home, state: () => service.state(), installed: installedBinary, events, listener };
}

async function readyTunnel(f: Fixture): Promise<void> {
    await f.service.signIn();
    await f.service.idle();
    await f.service.setup('Example.com');
    await f.service.idle();
}

describe('the screen states', () => {
    test('shows Install while cloudflared is missing, and goes on once it is installed', async () => {
        const f = await fixture({}, null);

        expect((await f.state()).stage).toBe('not-installed');
        expect((await f.service.install()).stage).toBe('installing');

        await f.service.idle();

        expect((await f.state()).stage).toBe('signed-out');
    });

    test('says what to install where Cloudflare ships no build', async () => {
        const f = await fixture({ installer: { locate: async () => null, install: async () => '', impossible: () => 'Install cloudflared yourself.' } }, null);
        const state = await f.state();

        expect(state.stage).toBe('cannot-install');
        expect(state.message).toBe('Install cloudflared yourself.');
    });

    test('fails an install with the sentence the installer gave, and Try again installs again', async () => {
        let attempts = 0;
        const f = await fixture(
            {
                installer: {
                    locate: async () => (attempts > 1 ? '/x/cloudflared' : null),
                    install: async () => {
                        attempts += 1;

                        if (attempts === 1) {
                            throw new Error('Downloading cloudflared failed.');
                        }

                        return '/x/cloudflared';
                    },
                    impossible: () => null
                }
            },
            null
        );

        await f.service.install();
        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'failed', message: 'Downloading cloudflared failed.' });

        await f.service.retry();
        await f.service.idle();

        expect((await f.state()).stage).toBe('signed-out');
    });

    test('signs in through cloudflared and hands the printed address to the screen', async () => {
        const f = await fixture();
        const signing = await f.service.signIn();

        expect(signing.stage).toBe('signing-in');

        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'no-tunnel', signInUrl: null });
        expect(f.runner.called('tunnel', 'login')).toHaveLength(1);
    });

    test('offers the address cloudflared printed while the person signs in', async () => {
        const f = await fixture();
        let seen: string | null = null;
        const original = f.runner.start.bind(f.runner);

        f.runner.start = (binary, args, onLine) => {
            const process = original(binary, args, (line) => {
                onLine(line);
                void f.state().then((state) => {
                    seen ??= state.signInUrl;
                });
            });

            return process;
        };

        await f.service.signIn();
        await f.service.idle();

        expect(seen).toBe('https://dash.cloudflare.com/argotunnel?aud=x&callback=y');
    });

    test('names the sentence cloudflared gave when sign-in fails', async () => {
        const f = await fixture();

        f.runner.answer('tunnel login', { code: 1, lines: ['2026-11-08T10:00:00Z ERR Cannot determine default origin certificate path'] });
        await f.service.signIn();
        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'failed', message: 'Cannot determine default origin certificate path' });
    });

    test('creates the tunnel for the domain and runs with no hostname yet', async () => {
        const f = await fixture();

        await readyTunnel(f);

        const state = await f.state();

        expect(state).toMatchObject({ stage: 'running', domain: 'example.com', rows: [] });
        expect(state.suggestedMcpHostname).toMatch(/^mcp-[0-9]+\.example\.com$/);
        expect(f.runner.running).toBe(0);
    });

    test('refuses a domain that is none', async () => {
        const f = await fixture();

        await f.service.signIn();
        await f.service.idle();

        expect(f.service.setup('not a domain')).rejects.toBeInstanceOf(TunnelConfigError);
    });
});

describe('the config', () => {
    test('writes each hostname with its literal loopback port and a closing 404', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', hostname: 'Shop-3000.Example.com', port: 3000 });
        await f.service.idle();

        const yaml = await readFile(join(f.home, 'tunnels', 'config.yml'), 'utf8');

        expect(yaml).toBe(
            [
                `tunnel: "${TUNNEL_ID}"`,
                `credentials-file: "/home/me/.cloudflared/${TUNNEL_ID}.json"`,
                'ingress:',
                '  - hostname: "shop-3000.example.com"',
                '    service: "http://127.0.0.1:3000"',
                '  - service: http_status:404',
                ''
            ].join('\n')
        );
        expect(f.runner.called('route', 'dns')[0]).toEqual(['tunnel', 'route', 'dns', TUNNEL_ID, 'shop-3000.example.com']);
        expect(f.runner.running).toBe(1);
    });

    test('has cloudflared validate the config before it replaces the running one', async () => {
        const f = await fixture();

        await readyTunnel(f);
        f.runner.answer('validate', { code: 1, lines: ['error parsing YAML'] });
        await f.service.add({ kind: 'dev', hostname: 'a.example.com', port: 3000 });
        await f.service.idle();

        expect(await f.state()).toMatchObject({ stage: 'failed', message: 'parsing YAML' });
        expect(f.runner.running).toBe(0);
    });

    test('restarts the one child on every change and runs it without autoupdate', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', hostname: 'a.example.com', port: 3000 });
        await f.service.idle();
        await f.service.add({ kind: 'dev', hostname: 'b.example.com', port: 3001 });
        await f.service.idle();

        expect(f.runner.called('run')).toHaveLength(2);
        expect(f.runner.running).toBe(1);
        expect(f.runner.called('run')[0]).toContain('--no-autoupdate');
    });

    test('never points at the API port or the listener from a dev row', async () => {
        const f = await fixture();

        await readyTunnel(f);

        for (const port of [API_PORT, LISTENER_PORT]) {
            expect(f.service.add({ kind: 'dev', hostname: `p${port}.example.com`, port })).rejects.toMatchObject({ code: 'port-denied' });
        }

        expect(f.runner.called('route')).toHaveLength(0);
    });

    test('puts the MCP row on the listener only while the listener is on', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'mcp', hostname: 'mcp-secret.example.com' });
        await f.service.idle();

        expect(await readFile(join(f.home, 'tunnels', 'config.yml'), 'utf8')).not.toContain('mcp-secret');

        await f.service.setMcp(true);
        await f.service.idle();

        expect(await readFile(join(f.home, 'tunnels', 'config.yml'), 'utf8')).toContain(`"http://127.0.0.1:${LISTENER_PORT}"`);

        await f.service.setMcp(false);
        await f.service.idle();

        expect(await readFile(join(f.home, 'tunnels', 'config.yml'), 'utf8')).not.toContain('mcp-secret');
        expect(f.listener.on).toBe(false);
    });

    test('refuses a second MCP row and a duplicate hostname', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'mcp', hostname: 'one.example.com' });
        await f.service.idle();

        expect(f.service.add({ kind: 'mcp', hostname: 'two.example.com' })).rejects.toMatchObject({ code: 'mcp-exists' });
        expect(f.service.add({ kind: 'dev', hostname: 'one.example.com', port: 3000 })).rejects.toMatchObject({ code: 'hostname-taken' });
    });
});

describe('after a restart', () => {
    test('defaults the MCP to come back on and a dev server to stay off', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'mcp', hostname: 'one.example.com' });
        await f.service.idle();
        await f.service.add({ kind: 'dev', hostname: 'two.example.com', port: 3000 });
        await f.service.idle();

        const rows = (await f.state()).rows;

        expect(rows.find((row) => row.kind === 'mcp')?.comeBack).toBe(true);
        expect(rows.find((row) => row.kind === 'dev')?.comeBack).toBe(false);
    });

    test('brings back only the rows that come back, and checks the deny list again', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.setMcp(true);
        await f.service.idle();
        await f.service.add({ kind: 'mcp', hostname: 'one.example.com' });
        await f.service.idle();
        await f.service.add({ kind: 'dev', hostname: 'two.example.com', port: 3000 });
        await f.service.idle();
        await f.service.add({ kind: 'dev', hostname: 'three.example.com', port: 3001, comeBack: true });
        await f.service.idle();
        await f.service.stop();

        const again = await fixture({ store: tunnelStore(f.home), home: f.home });

        await again.service.resume();
        await again.service.idle();

        const rows = (await again.state()).rows;

        expect(rows.map((row) => [row.hostname, row.enabled])).toEqual([
            ['one.example.com', true],
            ['two.example.com', false],
            ['three.example.com', true]
        ]);

        // A row that was off goes on again only if its port is still not Ruimte's own.
        expect(again.service.update(rows[1]!.id, { enabled: true })).resolves.toBeDefined();
        expect(again.service.update(rows[1]!.id, { comeBack: true })).resolves.toBeDefined();
    });

    test('leaves a child that will not stop running and says so', async () => {
        const f = await fixture();

        await readyTunnel(f);
        await f.service.add({ kind: 'dev', hostname: 'a.example.com', port: 3000 });
        await f.service.idle();

        // The fake ends a child when asked; this one ignores the request.
        const original = f.runner.start.bind(f.runner);

        f.runner.start = (binary, args, onLine) => {
            const process = original(binary, args, onLine);

            return args.includes('run') ? { exited: process.exited, stop: () => undefined } : process;
        };
        await f.service.add({ kind: 'dev', hostname: 'b.example.com', port: 3001 });
        await f.service.idle();
        await f.service.add({ kind: 'dev', hostname: 'c.example.com', port: 3002 });
        await f.service.idle();

        expect((await f.state()).stage).toBe('failed');
    });

    test('reports a crashed child as a failure with its last sentence', async () => {
        const f = await fixture();

        await readyTunnel(f);
        f.runner.answer('run', { lines: ['2026-11-08T10:00:00Z ERR Unable to reach the origin service'] });
        await f.service.add({ kind: 'dev', hostname: 'a.example.com', port: 3000 });
        await f.service.idle();
        f.runner.crash();
        await Promise.resolve();

        expect(await f.state()).toMatchObject({ stage: 'failed', message: 'Unable to reach the origin service' });
    });
});

describe('what the section reads and offers', () => {
    test('offers the discovered ports without Ruimte own ports and those already on the tunnel', async () => {
        const f = await fixture();

        await readyTunnel(f);
        expect(await f.service.discover()).toEqual([{ port: 3000, session: 'Vite' }]);

        await f.service.add({ kind: 'dev', hostname: 'a.example.com', port: 3000 });
        await f.service.idle();

        expect(await f.service.discover()).toEqual([]);
    });

    test('counts the connected clients and tells every client when the state moved', async () => {
        const f = await fixture();

        await readyTunnel(f);

        expect((await f.state()).clients).toBe(2);
        expect(f.events.count).toBeGreaterThan(0);
    });
});

describe('Cloudflare credentials', () => {
    test('no code of the tunnels folder names cert.pem, opens a credentials file or calls the Cloudflare API', async () => {
        const folder = import.meta.dir;
        const sources = await Promise.all(
            [...new Bun.Glob('*.ts').scanSync(folder)]
                .filter((name) => !name.endsWith('.test.ts') && name !== 'tunnel-test-helpers.ts')
                .map(async (name) => ({ name, text: await readFile(join(folder, name), 'utf8') }))
        );

        // The files of this folder that touch the disk read only what Ruimte wrote itself.
        const hits = (pattern: RegExp, only?: (name: string) => boolean): string[] =>
            sources
                .filter(({ name, text }) => (only?.(name) ?? true) && pattern.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
                .map(({ name }) => name);

        expect(hits(/cert\.pem/)).toEqual([]);
        expect(hits(/api\.cloudflare\.com/)).toEqual([]);
        expect(hits(/tunnel['",\s]+token/)).toEqual([]);
        expect(hits(/readFile|createReadStream|\bopen\(/, (name) => name !== 'credential-store.ts')).toEqual([]);
        // The one file that reads is the credential store, and it reads its own file and nothing of Cloudflare's.
        expect(sources.find(({ name }) => name === 'credential-store.ts')?.text).toContain("'credentials.json'");
    });
});
