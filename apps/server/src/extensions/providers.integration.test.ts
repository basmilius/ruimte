import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import type { LaunchesDocument, MachineCandidate, MachineSourceChangedEvent, ProjectContent, ServerFrame } from '@ruimte/contracts';
import { launchSessionIdOf } from '../launches/runner.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, invokeTool, releasedProject, type TestDaemon } from '../testing/test-daemon.ts';
import type { ExtensionHost } from './extension-host.ts';
import { buildExtension } from './pack.ts';

const EXTENSIONS = join(import.meta.dir, '../../../../extensions/dev');
const HARBOR = 'dev.harbor';
const LINTEL = 'dev.lintel';
const PULSEBOARD = 'dev.pulseboard';
const WEB = 'dev.harbor:compose:web';
const MIGRATE = 'dev.harbor:compose:migrate';
const COMPOSE = ['services:', '  web:', '    command: bun run dev', '    port: 5173', '  migrate:', '    command: bun run migrate', '    kind: task', ''].join(
    '\n'
);
const MACHINE = [
    'machine:',
    '  name: workbench',
    '  image: harbor/workbench:1',
    '  prepare: sh scripts/prepare.sh',
    '  start: sh scripts/start.sh',
    '  login: sh scripts/login.sh',
    ''
].join('\n');
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

/* A request from the app on this machine, which is the client that presented the local secret. */
async function owner(type: string, payload: unknown): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];

    await daemon.dispatcher.handle(
        { id: 'owner-1', access: { reachability: 'loopback', sessionId: null }, send: (frame) => frames.push(frame) },
        JSON.stringify({ id: 'request', type, payload })
    );

    return frames[0]!;
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

describe('Harbor, a machine source in a process of its own', () => {
    const target = { projectId: '', extension: HARBOR, source: 'compose-machine', candidate: 'workbench' };
    const heard: MachineCandidate[] = [];
    const LOGIN = 'sh -c sh scripts/login.sh';

    async function start(approve?: string): Promise<MachineCandidate> {
        const frame = await owner('extension.machineStart', { ...target, ...(approve === undefined ? {} : { approve }) });

        if (!('ok' in frame) || !frame.ok) {
            throw new Error(JSON.stringify(frame));
        }

        return (frame.result as { candidate: MachineCandidate }).candidate;
    }

    beforeAll(() => {
        target.projectId = projectId;
        writeFileSync(join(folder, 'harbor.yaml'), `${COMPOSE}${MACHINE}`);
        daemon.bundles.extensions.machineSources.subscribe('owner-1', (event) => void heard.push((event.payload as MachineSourceChangedEvent).candidate));
    });

    afterAll(() => {
        // The launches below read the file as it was before a machine was named in it.
        writeFileSync(join(folder, 'harbor.yaml'), COMPOSE);
    });

    test('lists the machine of harbor.yaml to the app on this machine, and to no client a statement let in', async () => {
        expect(await owner('extension.machineList', { projectId })).toMatchObject({
            ok: true,
            result: {
                candidates: [
                    {
                        source: { extension: HARBOR, id: 'compose-machine', title: 'Harbor' },
                        id: 'workbench',
                        title: 'workbench',
                        place: 'harbor/workbench:1',
                        running: false,
                        state: 'idle',
                        lines: []
                    }
                ]
            }
        });
        expect(await daemon.request('extension.machineList', { projectId })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await daemon.request('extension.machineStart', target)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    });

    test('holds the start until a person approved it, and then runs the programs Harbor described up to the sign-in of the new machine', async () => {
        const held = await start();

        expect(held).toMatchObject({
            state: 'held',
            lines: ['Reading harbor.yaml'],
            held: {
                programs: [
                    { title: 'Prepare workbench', command: "sh -c 'sh scripts/prepare.sh'", cwd: folder, env: { HARBOR_MACHINE: 'workbench' } },
                    { title: 'Start workbench', command: "sh -c 'sh scripts/start.sh'", cwd: folder, env: { HARBOR_MACHINE: 'workbench' } },
                    { login: true, command: "sh -c 'sh scripts/login.sh'", cwd: folder, env: { HARBOR_MACHINE: 'workbench' } }
                ]
            }
        });
        expect(daemon.machineSteps.ran).toEqual([]);

        daemon.machineSteps.script('sh -c sh scripts/start.sh', { lines: ['workbench is up'] });
        daemon.machineSteps.script(LOGIN, { lines: ['Open https://station.ruimte.app/link?code=BCDF-GHJK'], stays: true });

        expect((await start(held.held?.digest)).state).toBe('starting');
        await until(async () => (heard.at(-1)?.state === 'joining' && heard.at(-1)?.lines.at(-1)?.startsWith('Open ') === true ? true : null));

        expect(daemon.machineSteps.ran.map((step) => [step.command, ...step.args, step.cwd, step.env.HARBOR_MACHINE])).toEqual([
            ['sh', '-c', 'sh scripts/prepare.sh', folder, 'workbench'],
            ['sh', '-c', 'sh scripts/start.sh', folder, 'workbench'],
            ['sh', '-c', 'sh scripts/login.sh', folder, 'workbench']
        ]);
        expect(heard.at(-1)?.lines).toEqual([
            'Reading harbor.yaml',
            'Prepare workbench',
            'Start workbench',
            'workbench is up',
            'Open https://station.ruimte.app/link?code=BCDF-GHJK'
        ]);

        // The person approved the code on the page, so the sign-in of the new machine ended by itself.
        daemon.machineSteps.finish(LOGIN);
        await until(async () => (heard.at(-1)?.state === 'done' ? true : null));
    });

    test('asks a person again once harbor.yaml changed, though the programs stayed the same', async () => {
        const before = daemon.machineSteps.ran.length;

        writeFileSync(join(folder, 'harbor.yaml'), `# Reviewed\n${COMPOSE}${MACHINE}`);

        expect((await start()).state).toBe('held');
        expect(daemon.machineSteps.ran).toHaveLength(before);

        // Let go of, so nothing waits on this machine when the test ends.
        expect(await owner('extension.machineStop', target)).toMatchObject({ ok: true });
        expect(heard.at(-1)?.state).toBe('idle');
    });
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

describe('Pulseboard, a notification channel in a process of its own', () => {
    const told = async (): Promise<{ title: string; body: string; reason: string }[]> => {
        const frame = await daemon.request('extension.storageGet', { id: PULSEBOARD, key: 'told' });

        return 'ok' in frame && frame.ok ? ((frame.result as { value?: { title: string; body: string; reason: string }[] }).value ?? []) : [];
    };

    beforeAll(() => link('pulseboard'));

    test('lists its channel off to the app on this machine, and to no client a statement let in', async () => {
        expect(await owner('extension.notificationChannels', {})).toMatchObject({
            ok: true,
            result: { channels: [{ extension: PULSEBOARD, id: 'log', title: 'Pulseboard', on: false }] }
        });
        expect(await daemon.request('extension.notificationChannels', {})).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await daemon.request('extension.notificationChannelSet', { extension: PULSEBOARD, channel: 'log', on: true })).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
        });
    });

    test('hears nothing while it is off, and what a phone would hear once a person turned it on', async () => {
        daemon.bundles.push.alert('chat', 'chat-lead', 'Lead', 'Before the switch');
        await daemon.bundles.push.settled();
        await daemon.bundles.extensions.notificationChannels.settled();
        expect(await told()).toEqual([]);

        expect(await owner('extension.notificationChannelSet', { extension: PULSEBOARD, channel: 'log', on: true })).toMatchObject({ ok: true });
        daemon.bundles.push.alert('chat', 'chat-lead', 'Lead', 'The build is red');
        await daemon.bundles.push.settled();
        await daemon.bundles.extensions.notificationChannels.settled();

        expect(await told()).toEqual([{ title: 'Lead', body: 'The build is red', reason: 'needsYou' }]);
    });

    test('hears nothing more once it is turned off as an extension', async () => {
        await host.setEnabled(PULSEBOARD, false);

        expect(await owner('extension.notificationChannels', {})).toMatchObject({ ok: true, result: { channels: [] } });
    });
});
