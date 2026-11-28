import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import type { ProjectContent } from '@ruimte/contracts';
import type { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, releasedProject, type TestDaemon } from '../testing/test-daemon.ts';
import { buildExtension } from './pack.ts';

const HARBOR = join(import.meta.dir, '../../../../extensions/dev/harbor');
const ID = 'dev.harbor';
const PROFILE = 'service-shell';
const scratch = mkdtempSync(join(tmpdir(), 'ruimte-extension-terminals-'));
let built: string;
let root: string;
let home: string;
let folder: string;
let projectId: string;
let store: ProjectStore;
let daemon: TestDaemon;

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [{ id: 'term-own', kind: 'terminal', title: 'Mine', x: 0, y: 0, w: 560, h: 360 }],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

/* A request as a client sends it: its result, or the error it was refused with. */
async function request<Result>(type: string, payload: unknown): Promise<Result> {
    const frame = (await daemon.request(type, payload)) as { ok: boolean; result?: Result; error?: { code: string; message: string } };

    if (!frame.ok) {
        throw Object.assign(new Error(frame.error?.message), { code: frame.error?.code });
    }

    return frame.result as Result;
}

async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 300 && !(await condition()); attempt++) {
        await Bun.sleep(10);
    }
}

function boot(): Promise<TestDaemon> {
    return bootTestDaemon({ home, store, clock: new ManualClock() });
}

beforeAll(async () => {
    // A copy, so its build lands beside no other suite's.
    const copy = join(scratch, 'harbor');

    cpSync(join(HARBOR, 'manifest.json'), join(copy, 'manifest.json'), { recursive: true });
    cpSync(join(HARBOR, 'server'), join(copy, 'server'), { recursive: true });
    built = (await buildExtension(copy)).outdir;
});

beforeEach(async () => {
    ({ root, home, folder, store, projectId } = await releasedProject('ruimte-extension-terminals-', content()));
    daemon = await boot();
    await daemon.bundles.extensions.host.linked(built);
});

afterEach(async () => {
    daemon.bundles.extensions.host.stopAll();
    await daemon.stop();
    store.closeAll();
    rmSync(root, { recursive: true, force: true });
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('a terminal profile of an extension', () => {
    test('is listed from the manifest before server/ runs, and a person who picks it gets the program it describes', async () => {
        const { host } = daemon.bundles.extensions;

        expect(await request('extension.terminalProfiles', { projectId })).toEqual({ profiles: [{ extension: ID, id: PROFILE, title: 'Harbor' }] });
        expect((await host.list())[0]).toMatchObject({ status: 'idle', provenance: 'dev-link' });

        const { nodeId } = await request<{ nodeId: string }>('extension.terminalOpen', {
            id: ID,
            projectId,
            profile: PROFILE,
            picked: true,
            title: 'Harbor shell',
            viewId: 'main',
            at: { x: 900, y: 100 }
        });
        const pty = daemon.adapter.forSession(nodeId);

        expect(pty.options.args.slice(-2)).toEqual(['-c', "'sh'"]);
        expect(pty.options.env).toMatchObject({ HARBOR_SERVICE: 'web', HARBOR_WORKDIR: '/app' });
        expect(pty.options.cwd).toBe(folder);
        expect((await host.list())[0]?.status).toBe('running');
        expect(await request('extension.terminalProfiles', { projectId })).toEqual({
            profiles: [{ extension: ID, id: PROFILE, title: 'Harbor shell', icon: 'container' }]
        });
        expect((await store.read(projectId)).views[0]).toMatchObject({ nodes: [{ id: 'term-own' }, { id: nodeId, kind: 'terminal', title: 'Harbor shell' }] });
        // A person picked it, so Harbor did not open it and types nothing into it.
        await expect(request('extension.terminalWrite', { id: ID, nodeId, text: 'ls\n' })).rejects.toMatchObject({ code: 'refused' });
        expect(pty.typed).not.toContain('ls');
    });

    test('opens from server/ as a view of its own, takes what its extension types, and no other terminal does', async () => {
        const { host } = daemon.bundles.extensions;

        await daemon.sessions.create({ sessionId: 'term-own', cols: 80, rows: 24, cwd: folder });

        const opened = (await host.call(ID, 'openShell', [projectId])) as { id: string };
        const pty = daemon.adapter.forSession(opened.id);

        expect((await store.read(projectId)).views.at(-1)).toMatchObject({ kind: 'terminal', id: opened.id, name: 'Harbor: web' });
        expect(pty.typed).toBe('echo "Harbor: $HARBOR_SERVICE (harbor/web:4.2)"\n');

        await request('extension.terminalWrite', { id: ID, nodeId: opened.id, text: 'pwd\n' });

        expect(pty.typed.endsWith('pwd\n')).toBe(true);
        expect(await host.call(ID, 'type', ['term-own', 'rm -rf .\n'])).toEqual({
            code: 'refused',
            message: 'dev.harbor did not open the terminal term-own, so it cannot type into it'
        });
        await expect(request('extension.terminalWrite', { id: ID, nodeId: 'term-own', text: 'ls\n' })).rejects.toMatchObject({ code: 'refused' });
        expect(daemon.adapter.forSession('term-own').typed).toBe('');
    });

    test('still starts its program and takes its text after the machine restarts, and is forgotten with its node', async () => {
        const opened = (await daemon.bundles.extensions.host.call(ID, 'openShell', [projectId])) as { id: string };

        daemon.bundles.extensions.host.stopAll();
        await daemon.stop();
        daemon = await boot();
        await daemon.sessions.create({ sessionId: opened.id, cols: 80, rows: 24, cwd: folder });

        const pty = daemon.adapter.forSession(opened.id);

        expect(pty.options.args.slice(-2)).toEqual(['-c', "'sh'"]);
        expect(pty.options.env.HARBOR_SERVICE).toBe('web');

        await request('extension.terminalWrite', { id: ID, nodeId: opened.id, text: 'pwd\n' });

        expect(pty.typed).toBe('pwd\n');

        const { rev } = await store.openProject({ folder }).then((project) => project.document);
        const kept = await store.read(projectId);

        await store.save(projectId, rev, { ...kept, views: kept.views.filter((view) => view.id !== opened.id) });
        await until(() => daemon.bundles.extensions.terminals.get(opened.id) === null);

        expect(daemon.bundles.extensions.terminals.get(opened.id)).toBeNull();
    });

    test('leaves the menu once its extension is turned off, while a terminal it started keeps running as it was', async () => {
        const { host } = daemon.bundles.extensions;
        const opened = (await host.call(ID, 'openShell', [projectId])) as { id: string };

        await host.setEnabled(ID, false);

        expect(await request('extension.terminalProfiles', { projectId })).toEqual({ profiles: [] });
        expect(daemon.sessions.live(opened.id)).toBeDefined();
        await expect(request('extension.terminalWrite', { id: ID, nodeId: opened.id, text: 'ls\n' })).rejects.toMatchObject({ code: 'unavailable' });
        await expect(
            request('extension.terminalOpen', { id: ID, projectId, profile: PROFILE, picked: true, viewId: 'main', at: { x: 0, y: 0 } })
        ).rejects.toMatchObject({ code: 'unavailable' });
    });
});
