import { afterAll, afterEach, beforeAll } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import { ExtensionMessageEventSchema, type ProjectContent } from '@ruimte/contracts';
import { serverContract, ID } from '../../../../extensions/poc/contract/contract/server.ts';
import { serverActions } from '../actions/server-actions.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { extensionChatStarter } from './extension-chat.ts';
import { ExtensionHost } from './extension-host.ts';
import { runMachineAction } from './machine-actions.ts';
import { packExtension } from './pack.ts';
import { extensionFailureOf } from './refusal.ts';
import { ExtensionStore } from './store.ts';

const PROBE = join(import.meta.dir, '..', '..', '..', '..', 'extensions', 'poc', 'contract');
const root = mkdtempSync(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-extension-contract-'));
const hosts: ExtensionHost[] = [];
let worlds = 0;
let projects: ProjectStore;
let projectId: string;
let daemon: TestDaemon;

// One daemon of fake CLIs behind every world, so a chat start goes the way the machine's own does.
beforeAll(async () => {
    const folder = join(root, 'project');

    mkdirSync(folder, { recursive: true });
    projects = new ProjectStore(join(root, 'daemon'), projectLinks());

    const opened = await projects.openProject({ folder });

    await projects.save(opened.summary.projectId, opened.document.rev, { name: 'Shop', color: '#123456', views: [] } as ProjectContent);
    projects.release(opened.summary.projectId);
    projectId = opened.summary.projectId;
    daemon = await bootTestDaemon({ home: join(root, 'daemon'), store: projects, clock: new ManualClock() });
});

afterEach(() => hosts.splice(0).forEach((host) => host.stopAll()));
afterAll(async () => {
    await daemon.stop();
    projects.closeAll();
    rmSync(root, { recursive: true, force: true });
});

/* The machine's own host with `poc.contract` packed under these permissions, in a process of its own. */
serverContract(async (permissions) => {
    worlds += 1;

    const folder = join(root, `probe-${worlds}`);
    const manifest = JSON.parse(readFileSync(join(PROBE, 'manifest.json'), 'utf8')) as object;

    cpSync(join(PROBE, 'server'), join(folder, 'server'), { recursive: true });
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ ...manifest, permissions }));

    const store = new ExtensionStore(join(root, `home-${worlds}`));
    const host = new ExtensionHost({
        store,
        asks: () => ({ 'chats.send': async () => undefined }),
        startChat: extensionChatStarter({
            host: daemon.host,
            actions: serverActions,
            folderOf: (id) => projects.index.folderOf(id),
            projectOfFolder: (folder) => projects.index.projectOfFolder(folder)
        }),
        runAction: (_id, _projectId, action, input) =>
            runMachineAction(
                action,
                input,
                async (name, given) => {
                    if (name !== 'launch.start') {
                        throw new Error(`No ${name} here`);
                    }

                    const { launch } = given as { launch: string };

                    return { launchId: launch, name: launch } as never;
                },
                async () => {
                    throw new Error('No Output here');
                }
            )
    });
    const { path } = await packExtension(folder);
    const emitted: { name: string; payload?: unknown }[] = [];

    // As a client hears it: the event crosses as JSON and is read by its schema.
    host.subscribe(`contract-${worlds}`, ({ event, payload }) => {
        if (event === 'extension.message') {
            const { name, payload: said } = ExtensionMessageEventSchema.parse(JSON.parse(JSON.stringify(payload)));

            emitted.push(said === undefined ? { name } : { name, payload: said });
        }
    });
    hosts.push(host);
    await host.install(readFileSync(path).toString('base64'));

    const call = async (method: string, ...args: unknown[]) => {
        try {
            return { ok: true as const, value: await host.call(ID, method, args) };
        } catch (e) {
            const { code, message } = extensionFailureOf(e);

            return { ok: false as const, error: { code: code === 'invalid-input' ? 'failed' : code, message } };
        }
    };

    return {
        project: projectId,
        call,
        fire: (name, payload) => host.forwardEvent(name, payload),
        async tool(id, input, caller) {
            // A tool is listed once its process said so, which it does as it starts.
            await call('heard');

            return host.runAgentTool(`${ID}/${id}`, input, { caller });
        },
        emitted: async () => emitted,
        logs: async () =>
            readFileSync(store.logFile(ID), 'utf8')
                .split('\n')
                .filter((line) => line !== '')
    };
});
