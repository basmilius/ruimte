import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeWatch } from '@adecore/agents/testing';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { TemplateStore } from '../templates/template-store.ts';
import type { ClientAccess } from '../wire.ts';
import { registerTemplateHandlers } from './template.ts';
import { askOnce } from './test-helpers.ts';

const homes = tempHomes('ruimte-template-handlers-');

const OWNER: ClientAccess = { reachability: 'loopback', sessionId: null };
const GUEST: ClientAccess = { reachability: 'lan', sessionId: 'session-1' };
const PEER: ClientAccess = { reachability: 'lan', sessionId: 'session-2', peer: { machineId: 'machine-b' } };

let dispatcher: Dispatcher;

function call(type: string, payload: unknown, access?: ClientAccess): Promise<ServerFrame> {
    return askOnce(dispatcher, { id: 'client-1', access }, type, payload);
}

beforeEach(async () => {
    const root = await homes();
    const folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    const store = new TemplateStore({
        path: join(root, 'editor-templates.json'),
        projects: { folderOf: (projectId) => (projectId === 'p1' ? folder : null), holdersOf: (projectId) => (projectId === 'p1' ? ['client-1'] : []) },
        seams: new FakeWatch()
    });

    dispatcher = new Dispatcher();
    registerTemplateHandlers(dispatcher, store);
});

describe('template handlers', () => {
    test('a person and a client the machine let in both edit, and the machine names the requests it answers', async () => {
        const listed = await call('template.list', { projectId: 'p1' }, GUEST);

        expect(listed).toMatchObject({ ok: true, result: { project: { live: [] } } });
        expect(dispatcher.types()).toEqual(expect.arrayContaining(['template.list', 'template.save', 'template.remove', 'template.configure']));

        const revision = (listed as { result: { personal: { revision: number } } }).result.personal.revision;
        const template = { key: 'log', body: 'console.log($0);', languages: ['javascript'] };

        expect(await call('template.save', { scope: 'personal', revision, kind: 'live', template }, GUEST)).toMatchObject({
            ok: true,
            result: { kind: 'live', template: { key: 'log' } }
        });
        expect(await call('template.save', { scope: 'personal', revision, kind: 'live', template }, OWNER)).toMatchObject({
            ok: false,
            error: { code: 'rev-conflict' }
        });
    });

    test('a refused template answers under its code', async () => {
        const { result } = (await call('template.list', {})) as unknown as { result: { personal: { revision: number } } };

        expect(
            await call('template.save', {
                scope: 'personal',
                revision: result.personal.revision,
                kind: 'live',
                template: { key: 'a b', body: 'x', languages: ['php'] }
            })
        ).toMatchObject({ ok: false, error: { code: 'template-invalid' } });
    });

    test('a machine that works here as a peer reads no template', async () => {
        expect(dispatcher.peerTypes()).not.toContain('template.list');
        expect(await call('template.list', {}, PEER)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    });
});
