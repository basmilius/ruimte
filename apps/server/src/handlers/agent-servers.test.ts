import { beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import type { ServerFrame } from '@ruimte/contracts';
import { sha256, zip } from '../disk/test-archives.ts';
import { Dispatcher } from '../dispatcher.ts';
import { AcpServerInstall, parseAcpServerRelease } from '../providers/acp-server.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import type { ClientAccess } from '../wire.ts';
import { registerAgentServerHandlers } from './agent-servers.ts';
import { askOnce } from './test-helpers.ts';

const ARCHIVE = zip([{ path: 'agy_acp_server.par', text: 'server' }]);

let home: string;
let dispatcher: Dispatcher;
let downloads: number;
let invalidated: string[];

const newHome = tempHomes('ruimte-agent-servers-');

beforeEach(async () => {
    home = await newHome();
    downloads = 0;
    invalidated = [];
    const server = new AcpServerInstall({
        provider: 'antigravity',
        home,
        release: parseAcpServerRelease({
            version: '1.4.1',
            assets: { 'linux-x64': { url: 'https://example.test/s.zip', sha256: sha256(ARCHIVE), format: 'zip', executable: 'agy_acp_server.par', args: [] } }
        }),
        platform: 'linux',
        arch: 'x64',
        download: async (_url, destination) => {
            downloads++;
            await writeFile(destination, ARCHIVE);
        }
    });
    dispatcher = new Dispatcher();
    registerAgentServerHandlers(dispatcher, { of: (kind) => (kind === 'antigravity' ? server : undefined), installed: (kind) => invalidated.push(kind) });
});

const OWNER: ClientAccess = { reachability: 'loopback', sessionId: null };
const GUEST: ClientAccess = { reachability: 'lan', sessionId: 'session-1' };

function call(type: string, payload: unknown, access: ClientAccess): Promise<ServerFrame> {
    return askOnce(dispatcher, { id: 'client-1', access }, type, payload);
}

describe('agent server handlers', () => {
    test('any client sees where the server stands, and only the local secret installs it', async () => {
        expect(await call('provider.server', { provider: 'antigravity' }, GUEST)).toMatchObject({ ok: true, result: { server: { state: 'missing' } } });
        expect(await call('provider.installServer', { provider: 'antigravity' }, GUEST)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(downloads).toBe(0);

        expect(await call('provider.installServer', { provider: 'antigravity' }, OWNER)).toMatchObject({
            ok: true,
            result: { server: { state: 'installed', installed: '1.4.1' } }
        });
        expect(invalidated).toEqual(['antigravity']);
    });

    test('a CLI without a server of its own is refused', async () => {
        expect(await call('provider.installServer', { provider: 'claude' }, OWNER)).toMatchObject({ ok: false, error: { code: 'no-agent-server' } });
    });
});
