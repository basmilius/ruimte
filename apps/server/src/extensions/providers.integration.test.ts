import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import type { LaunchesDocument, ProjectContent } from '@ruimte/contracts';
import { launchSessionIdOf } from '../launches/runner.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, invokeTool, releasedProject, type TestDaemon } from '../testing/test-daemon.ts';
import type { ExtensionHost } from './extension-host.ts';
import { buildExtension } from './pack.ts';

const EXTENSIONS = join(import.meta.dir, '../../../../extensions/dev');
const HARBOR = 'dev.harbor';
const LINTEL = 'dev.lintel';
const WEB = 'dev.harbor:compose:web';
const MIGRATE = 'dev.harbor:compose:migrate';
const COMPOSE = ['services:', '  web:', '    command: bun run dev', '    port: 5173', '  migrate:', '    command: bun run migrate', '    kind: task', ''].join(
    '\n'
);
const CONTENT: ProjectContent = {
    name: 'Shop',
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [{ id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
};

let root: string;
let folder: string;
let store: ProjectStore;
let projectId: string;
let daemon: TestDaemon;
let host: ExtensionHost;

/* A development extension as `ruimte extension dev` links it: its `server/` built in a folder of this test, in a process of its own. */
async function link(name: string): Promise<void> {
    const copy = join(root, 'extensions', name);

    mkdirSync(copy, { recursive: true });
    cpSync(join(EXTENSIONS, name, 'server'), join(copy, 'server'), { recursive: true });
    cpSync(join(EXTENSIONS, name, 'manifest.json'), join(copy, 'manifest.json'));
    await host.linked((await buildExtension(copy)).outdir);
}

async function launches(): Promise<LaunchesDocument> {
    // A client's read loads the launches, and what the sources list comes in after its answer, as `launches.changed` tells it.
    expect(await daemon.request('launches.read', { projectId })).toMatchObject({ ok: true });
    await daemon.bundles.launches.store.resolveAll(projectId);

    return daemon.bundles.launches.store.read(projectId);
}

function tool(name: string, input: Record<string, unknown> = {}): Promise<string[]> {
    return invokeTool(daemon, 'chat-lead', name, input);
}

async function until<Value>(read: () => Promise<Value | null>): Promise<Value> {
    for (let attempt = 0; attempt < 400; attempt++) {
        const value = await read();

        if (value !== null) {
            return value;
        }

        await Bun.sleep(10);
    }

    throw new Error('It never came');
}

beforeAll(async () => {
    ({ root, folder, store, projectId } = await releasedProject('ruimte-extension-providers-', CONTENT));
    writeFileSync(join(folder, 'harbor.yaml'), COMPOSE);
    mkdirSync(join(folder, 'src'));
    writeFileSync(join(folder, 'src', 'app.ts'), 'export const port = 5173;\n// TODO: read the port from the environment\n');
    daemon = await bootTestDaemon({ home: join(root, 'home'), store, clock: new ManualClock() });
    host = daemon.bundles.extensions.host;
    await link('harbor');
    await link('lintel');
});

afterAll(async () => {
    host.stopAll();
    await daemon.stop();
    store.closeAll();
    rmSync(root, { recursive: true, force: true });
});

describe('Harbor, a launch source in a process of its own', () => {
    test('shows the services of harbor.yaml as launches beside the project own, to a client and to an agent', async () => {
        const document = await launches();

        expect(document.launches).toEqual([]);
        expect(document.sourced?.map((launch) => [launch.id, launch.kind, launch.command, launch.url, launch.source.title])).toEqual([
            [WEB, 'service', "sh -c 'bun run dev'", 'http://localhost:5173', 'Harbor'],
            [MIGRATE, 'task', "sh -c 'bun run migrate'", undefined, 'Harbor']
        ]);
        expect(document.approved).toEqual([]);
        expect(await tool('launch_list')).toEqual([
            `${WEB}\tweb\tservice\t-\tno\t5173\thttp://localhost:5173\t-\tHarbor`,
            `${MIGRATE}\tmigrate\ttask\t-\tno\t-\t-\t-\tHarbor`
        ]);
    });

    test('starts a launch only after a person approved it, and then for an agent too, as the program Harbor described', async () => {
        expect((await tool('launch_control', { action: 'start', launch: WEB }))[0]).toStartWith('refused\tlaunch-held\t');
        expect(await daemon.request('launch.start', { projectId, launchId: WEB })).toMatchObject({
            ok: true,
            result: {
                outcome: 'held',
                held: [{ launchId: WEB, command: "sh -c 'bun run dev'", cwd: folder, source: { extension: HARBOR, id: 'compose', title: 'Harbor' } }]
            }
        });
        expect(daemon.sessions.get(launchSessionIdOf(projectId, WEB))).toBeUndefined();

        expect(await daemon.request('launch.start', { projectId, launchId: WEB, approve: true })).toMatchObject({ ok: true, result: { outcome: 'started' } });

        const pty = daemon.adapter.forSession(launchSessionIdOf(projectId, WEB));

        expect(pty.options.args.at(-1)).toBe("sh -c 'bun run dev'");
        expect(pty.options.env.HARBOR_SERVICE).toBe('web');
        expect((await tool('launch_control', { action: 'start', launch: WEB }))[0]).toStartWith('started\t');
        // The launch's status reached Harbor's own process in the shape an extension hears.
        expect(await until(async () => ((await host.call(HARBOR, 'running', [projectId])) as string[]).find((service) => service === 'web') ?? null)).toBe(
            'web'
        );
    });

    test('asks a person again for every launch once harbor.yaml changed, also one approved with the whole source', async () => {
        expect(await daemon.request('launches.approveSource', { projectId, extension: HARBOR, source: 'compose' })).toMatchObject({ ok: true });
        expect((await launches()).approved).toEqual([WEB, MIGRATE]);

        writeFileSync(join(folder, 'harbor.yaml'), `# Reviewed\n${COMPOSE}`);

        // The command did not change. The file a person approved did, which a start reads before it runs anything.
        expect((await tool('launch_control', { action: 'start', launch: MIGRATE }))[0]).toStartWith('refused\tlaunch-held\t');
        expect((await launches()).approved).toEqual([]);
        expect(daemon.sessions.get(launchSessionIdOf(projectId, MIGRATE))).toBeUndefined();
    });

    test('lists its launches no more once it is turned off', async () => {
        await host.setEnabled(HARBOR, false);

        expect((await launches()).sourced).toBeUndefined();
        expect((await tool('launch_control', { action: 'start', launch: MIGRATE }))[0]).toStartWith('refused\tunknown-launch\t');
    });
});

describe('Lintel, a problem source in a process of its own', () => {
    test('gives an agent the problems it found in the project a person opened, under its source', async () => {
        daemon.bundles.extensions.projectOpened(projectId);
        await until(async () => (await host.call(LINTEL, 'found', [projectId])) as object | null);

        const lines = await tool('language_problems');

        expect(lines).toContain('server\textension\tdev.lintel/rules');
        expect(lines).toContain('diagnostic\tsrc/app.ts:2:4\tinformation\tLintel/marker\tA TODO is left here');
        expect(JSON.parse((await tool('language_problems', { json: true })).join('\n'))).toMatchObject({
            servers: [{ kind: 'extension', process: 'dev.lintel/rules' }],
            diagnostics: [{ path: 'src/app.ts', line: 2, column: 4, severity: 'information', source: 'Lintel', code: 'marker' }]
        });
    });

    test('takes its problems along when it is turned off', async () => {
        await host.setEnabled(LINTEL, false);

        expect(daemon.bundles.extensions.problems.of(projectId)).toEqual([]);
        expect((await tool('language_problems'))[0]).toStartWith('refused\tno-workspace-diagnostics\t');
    });
});
