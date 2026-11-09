import { beforeEach, describe, expect, test } from 'bun:test';
import type { TunnelProposal } from '@ruimte/contracts';
import { TIER_TOOLS } from '../mcp/external-tiers.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { TunnelProposals } from '../tunnels/tunnel-proposals.ts';
import { TunnelService } from '../tunnels/tunnel-service.ts';
import { tunnelStore } from '../tunnels/tunnel-store.ts';
import { FakeCloudflare, FakeCloudflared, FAKE_API_TOKEN, MemoryTokenStore } from '../tunnels/tunnel-test-helpers.ts';
import type { CanvasHost, TunnelAgentHost } from './host.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';
import { TOOLKITS } from './toolkits.ts';

const homeOf = tempHomes('ruimte-tunnel-tools-');

const API_PORT = 4210;
const CHAT = 'chat-1';

let cloudflare: FakeCloudflare;
let service: TunnelService;
let proposals: TunnelProposals;
let published: TunnelProposal[][];
let holds: Array<{ chatId: string; key: string; held: boolean }>;
let expire: Array<() => void>;
let host: CanvasHost;

beforeEach(async () => {
    const home = await homeOf();
    let counter = 0;

    cloudflare = new FakeCloudflare();
    cloudflare.zone('bmnw.nl');
    cloudflare.zone('passly.dev');
    published = [];
    holds = [];
    expire = [];
    service = new TunnelService({
        store: tunnelStore(home),
        installer: { locate: async () => '/usr/bin/cloudflared', install: async () => '/usr/bin/cloudflared', impossible: () => null },
        runner: new FakeCloudflared(),
        tokens: new MemoryTokenStore(),
        cloudflare: cloudflare.fetch,
        machineName: () => 'Bas MacBook',
        machineId: () => 'machine-1',
        deniedPorts: () => [API_PORT],
        setListener: async () => null,
        listenerPort: () => null,
        clients: () => 0,
        discover: async () => [],
        changed: () => proposals.refresh(),
        random: (bytes) => String((counter += 1)).padStart(bytes * 2, '0'),
        log: () => undefined,
        stopWaitMs: 50
    });
    proposals = new TunnelProposals({
        tunnels: service,
        chats: {
            hold: (chatId, key) => holds.push({ chatId, key, held: true }),
            release: (chatId, key) => holds.push({ chatId, key, held: false })
        },
        publish: (list) => published.push(list),
        timers: {
            set: (run) => {
                expire.push(run);

                return () => undefined;
            }
        }
    });
    const tunnels: TunnelAgentHost = {
        state: () => service.state(),
        rowsAsMeant: () => service.rowsAsMeant(),
        zoneOf: (hostname) => service.zoneOf(hostname),
        propose: (ask) => proposals.ask(ask),
        of: (chatId) => proposals.of(chatId)
    };

    host = { projects: { locate: () => null }, tunnels } as unknown as CanvasHost;
});

async function readyTunnel(): Promise<void> {
    await service.setToken(FAKE_API_TOKEN);
    await service.setup();
    await service.idle();
}

async function addRow(label: string, port: number): Promise<string> {
    const state = await service.add({ kind: 'dev', zone: 'zone-bmnw.nl', label, port });

    await service.idle();

    return state.rows.find((row) => row.hostname === `${label}.bmnw.nl`)!.id;
}

async function call(name: string, input: Record<string, unknown> = {}): Promise<string[]> {
    return (await toolAnswer(name, input, toolCall(CHAT, host))).lines;
}

/* The id of the only card that stands. */
function cardId(): string {
    const [card] = proposals.list();

    expect(proposals.list()).toHaveLength(1);

    return card!.proposalId;
}

function writes(): number {
    return cloudflare.calls.filter((entry) => entry.method !== 'GET').length;
}

describe('tunnel_list', () => {
    test('says there is no tunnel until a person sets one up', async () => {
        expect(await call('tunnel_list')).toEqual([
            'tunnel\tnone\tno-token',
            'note\tA person sets up a tunnel under Tunnels in Settings first',
            'note\tRuimte has no hostname on this tunnel'
        ]);
    });

    test('lists the zones by name and each hostname with its target, switch and what Cloudflare does, never the token', async () => {
        await readyTunnel();
        await addRow('app', 5173);

        const lines = await call('tunnel_list');

        expect(lines).toContain('zone\tbmnw.nl');
        expect(lines).toContain('zone\tpassly.dev');
        expect(lines.find((line) => line.startsWith('hostname\t'))).toStartWith('hostname\tapp.bmnw.nl\tdev\t5173\thttp\t-\ton\t');
        expect(lines.join('\n')).not.toContain(FAKE_API_TOKEN);
        expect(lines.join('\n')).not.toContain('zone-bmnw.nl');
    });
});

describe('tunnel_propose', () => {
    beforeEach(readyTunnel);

    test('add raises a card that holds the chat and changes nothing until a person confirms', async () => {
        const before = writes();

        expect(await call('tunnel_propose', { action: 'add', hostname: 'Vite.bmnw.nl', port: 5173, protocol: 'https', host_header: 'vite.test' })).toEqual([
            `proposal\t${cardId()}\twaiting`
        ]);
        expect(proposals.list()).toMatchObject([
            { chatId: CHAT, action: 'add', kind: 'dev', hostname: 'vite.bmnw.nl', port: 5173, origin: { https: true, hostHeader: 'vite.test' }, stale: false }
        ]);
        expect(published.at(-1)).toHaveLength(1);
        expect(holds).toEqual([{ chatId: CHAT, key: `tunnel-proposal:${cardId()}`, held: true }]);
        expect(writes()).toBe(before);
        expect((await service.state()).rows).toEqual([]);
    });

    test('a confirm makes the change the screen makes, and the agent hears it once with its next suggestion and in its list', async () => {
        await call('tunnel_propose', { action: 'add', hostname: 'vite.bmnw.nl', port: 5173 });

        const id = cardId();

        expect(await proposals.confirm(id)).toBe(true);

        await service.idle();

        expect((await service.state()).rows).toMatchObject([{ hostname: 'vite.bmnw.nl', port: 5173, enabled: true }]);
        expect(proposals.list()).toEqual([]);
        expect(holds.at(-1)).toEqual({ chatId: CHAT, key: `tunnel-proposal:${id}`, held: false });
        expect(await call('tunnel_list')).toContain(`proposal\t${id}\tadd\tvite.bmnw.nl\tconfirmed`);
        expect(await call('tunnel_propose', { action: 'add', hostname: 'vite.bmnw.nl', port: 5173 })).toEqual([`proposal\t${id}\tconfirmed`]);
        expect(await proposals.confirm(id)).toBe(false);
    });

    test('on, off, edit and remove each wait for the confirm, which applies them as Settings would', async () => {
        const rowId = await addRow('app', 5173);
        const row = () => service.rowsAsMeant().find((candidate) => candidate.id === rowId);

        await call('tunnel_propose', { action: 'off', hostname: 'app.bmnw.nl' });
        expect(row()?.enabled).toBe(true);
        await proposals.confirm(cardId());
        expect(row()?.enabled).toBe(false);

        await call('tunnel_propose', { action: 'on', hostname: 'app.bmnw.nl' });
        expect(row()?.enabled).toBe(false);
        await proposals.confirm(cardId());
        expect(row()?.enabled).toBe(true);

        await call('tunnel_propose', { action: 'edit', hostname: 'app.bmnw.nl', port: 3000, host_header: 'app.test' });
        expect(proposals.list()[0]).toMatchObject({ action: 'edit', port: 3000, origin: { hostHeader: 'app.test' } });
        expect(row()?.port).toBe(5173);
        await proposals.confirm(cardId());
        expect(row()).toMatchObject({ port: 3000, origin: { hostHeader: 'app.test' } });

        await call('tunnel_propose', { action: 'edit', hostname: 'app.bmnw.nl', host_header: '' });
        await proposals.confirm(cardId());
        expect(row()).toMatchObject({ port: 3000 });
        expect(row()?.origin).toBeUndefined();

        await call('tunnel_propose', { action: 'remove', hostname: 'app.bmnw.nl' });
        expect(row()).toBeDefined();
        await proposals.confirm(cardId());
        await service.idle();
        expect(row()).toBeUndefined();
    });

    test('a decline changes nothing and the agent hears it', async () => {
        const rowId = await addRow('app', 5173);
        const before = writes();

        await call('tunnel_propose', { action: 'remove', hostname: 'app.bmnw.nl' });

        const id = cardId();

        expect(proposals.decline(id)).toBe(true);
        expect(writes()).toBe(before);
        expect(service.rowsAsMeant().map((row) => row.id)).toEqual([rowId]);
        expect(await call('tunnel_list')).toContain(`proposal\t${id}\tremove\tapp.bmnw.nl\tdeclined`);
    });

    test('a card whose row changed since goes stale, refuses the confirm and changes nothing', async () => {
        const rowId = await addRow('app', 5173);

        await call('tunnel_propose', { action: 'off', hostname: 'app.bmnw.nl' });

        const id = cardId();

        await service.update(rowId, { port: 3000 });

        expect(published.at(-1)?.[0]?.stale).toBe(true);
        expect(proposals.confirm(id)).rejects.toMatchObject({ code: 'proposal-stale' });
        await proposals.confirm(id).catch(() => undefined);
        expect(service.rowsAsMeant()[0]).toMatchObject({ enabled: true, port: 3000 });
        expect(proposals.decline(id)).toBe(true);
        expect(await call('tunnel_list')).toContain(`proposal\t${id}\toff\tapp.bmnw.nl\tstale`);
    });

    test('a card that nobody answers expires and the agent hears that', async () => {
        await call('tunnel_propose', { action: 'add', hostname: 'vite.bmnw.nl', port: 5173 });

        const id = cardId();

        expire.at(-1)?.();

        expect(proposals.list()).toEqual([]);
        expect(await call('tunnel_list')).toContain(`proposal\t${id}\tadd\tvite.bmnw.nl\texpired`);
    });

    test('refuses what the screen refuses, before any card', async () => {
        await addRow('app', 5173);

        expect((await call('tunnel_propose', { action: 'add', hostname: 'api.bmnw.nl', port: API_PORT }))[0]).toStartWith('refused\tport-denied\t');
        expect(await call('tunnel_propose', { action: 'add', hostname: 'app.example.com', port: 3000 })).toEqual([
            'refused\tunknown-zone\tapp.example.com is in none of the domains this tunnel can use',
            'zone\tbmnw.nl',
            'zone\tpassly.dev'
        ]);
        expect((await call('tunnel_propose', { action: 'add', hostname: 'app.bmnw.nl', port: 3000 }))[0]).toStartWith('refused\thostname-taken\t');
        expect((await call('tunnel_propose', { action: 'add', hostname: 'bmnw.nl', port: 3000 }))[0]).toStartWith('refused\tapex\t');
        expect((await call('tunnel_propose', { action: 'add', hostname: 'vite.bmnw.nl' }))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await call('tunnel_propose', { action: 'edit', hostname: 'app.bmnw.nl', port: API_PORT }))[0]).toStartWith('refused\tport-denied\t');
        expect((await call('tunnel_propose', { action: 'on', hostname: 'app.bmnw.nl' }))[0]).toStartWith('refused\tunchanged\t');
        expect((await call('tunnel_propose', { action: 'edit', hostname: 'app.bmnw.nl', port: 5173 }))[0]).toStartWith('refused\tunchanged\t');
        expect((await call('tunnel_propose', { action: 'off', hostname: 'app.bmnw.nl', port: 3000 }))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await call('tunnel_propose', { action: 'off', hostname: 'gone.bmnw.nl' }))[0]).toStartWith('refused\tunknown-hostname\t');
        expect(proposals.list()).toEqual([]);
        expect(holds).toEqual([]);
    });

    test("never targets a hostname someone else put on the tunnel, nor the MCP's beyond its switch", async () => {
        const tunnel = cloudflare.tunnels.find((candidate) => candidate.name === 'ruimte-bas-macbook-f7a7')!;

        tunnel.ingress.unshift({ hostname: 'blog.bmnw.nl', service: 'http://localhost:8080' });
        await service.add({ kind: 'mcp', zone: 'zone-bmnw.nl', label: 'mcp-door' });
        await service.idle();

        expect((await call('tunnel_propose', { action: 'off', hostname: 'blog.bmnw.nl' }))[0]).toStartWith('refused\tnot-ruimte\t');
        expect((await call('tunnel_propose', { action: 'add', hostname: 'blog.bmnw.nl', port: 3000 }))[0]).toStartWith('refused\thostname-on-tunnel\t');
        expect((await call('tunnel_propose', { action: 'remove', hostname: 'mcp-door.bmnw.nl' }))[0]).toStartWith('refused\tmcp-row\t');
        expect((await call('tunnel_propose', { action: 'edit', hostname: 'mcp-door.bmnw.nl', port: 3000 }))[0]).toStartWith('refused\tmcp-fixed\t');
        expect(proposals.list()).toEqual([]);
    });

    test('a chat that stops takes its cards down', async () => {
        await call('tunnel_propose', { action: 'add', hostname: 'vite.bmnw.nl', port: 5173 });
        proposals.forget(CHAT);

        expect(proposals.list()).toEqual([]);
        expect(holds.at(-1)?.held).toBe(false);
    });
});

describe('who gets the tools', () => {
    test('no external tier lists them, and only a chat proposes', () => {
        const tools = TOOLKITS.flatMap((toolkit) => toolkit.tools);

        for (const tier of Object.values(TIER_TOOLS)) {
            expect(tier.filter((name) => name.startsWith('tunnel_'))).toEqual([]);
        }

        expect(tools.find((tool) => tool.name === 'tunnel_list')?.audience).toBe('everyone');
        expect(tools.find((tool) => tool.name === 'tunnel_propose')?.audience).toBe('chat');
    });
});
