import { beforeEach, describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher, type ClientAccess } from '../dispatcher.ts';
import type { CliVersions } from '../providers/cli-versions.ts';
import type { RegistryAgents } from '../providers/registry-agents.ts';
import { registerAgentRegistryHandlers } from './agent-registry.ts';

const AGENT = {
    id: 'goose',
    kind: 'goose',
    name: 'goose',
    version: '1.55.0',
    description: '',
    distribution: 'binary',
    checksum: true,
    installed: null,
    state: 'missing'
} as const;

const VERSION = {
    provider: 'copilot',
    method: 'npm',
    package: '@github/copilot',
    path: '/opt/homebrew/lib/node_modules/@github/copilot/npm-loader.js',
    version: '1.0.101',
    latest: '1.0.110',
    updatable: true,
    state: 'idle',
    checkedAt: 1
} as const;

let dispatcher: Dispatcher;
let frames: ServerFrame[];
let pressed: string[];

beforeEach(() => {
    pressed = [];
    const agents = {
        catalog: async () => ({ source: 'live', fetchedAt: 1, platform: 'linux-x86_64', agents: [AGENT] }),
        install: async (id: string) => {
            pressed.push(`install ${id}`);
            return { ...AGENT, installed: AGENT.version, state: 'installed' };
        },
        remove: async (id: string) => {
            pressed.push(`remove ${id}`);
            return AGENT;
        }
    } as unknown as RegistryAgents;
    const versions = {
        list: async () => [VERSION],
        one: async () => VERSION,
        update: async (kind: string) => {
            pressed.push(`update ${kind}`);
            return { ...VERSION, version: '1.0.110', updatable: false };
        }
    } as unknown as CliVersions;
    dispatcher = new Dispatcher();
    registerAgentRegistryHandlers(dispatcher, agents, versions);
    frames = [];
});

const OWNER: ClientAccess = { reachability: 'loopback', sessionId: null };
const GUEST: ClientAccess = { reachability: 'lan', sessionId: 'session-1' };

async function call(type: string, payload: unknown, access: ClientAccess): Promise<ServerFrame> {
    await dispatcher.handle({ id: 'client-1', access, send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'r1', type, payload }));
    return frames.at(-1) as ServerFrame;
}

describe('agent registry handlers', () => {
    test('any client reads the catalog and the versions', async () => {
        expect(await call('provider.registry', {}, GUEST)).toMatchObject({ ok: true, result: { catalog: { agents: [{ id: 'goose' }] } } });
        expect(await call('provider.versions', {}, GUEST)).toMatchObject({ ok: true, result: { versions: [{ provider: 'copilot', updatable: true }] } });
    });

    test('only the local secret installs, removes or updates', async () => {
        for (const [type, payload] of [
            ['provider.installAgent', { id: 'goose' }],
            ['provider.removeAgent', { id: 'goose' }],
            ['provider.update', { provider: 'copilot' }]
        ] as const) {
            expect(await call(type, payload, GUEST)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        }
        expect(pressed).toEqual([]);
        expect(await call('provider.installAgent', { id: 'goose' }, OWNER)).toMatchObject({ ok: true, result: { agent: { state: 'installed' } } });
        expect(await call('provider.update', { provider: 'copilot' }, OWNER)).toMatchObject({ ok: true, result: { version: { version: '1.0.110' } } });
        expect(pressed).toEqual(['install goose', 'update copilot']);
    });
});
