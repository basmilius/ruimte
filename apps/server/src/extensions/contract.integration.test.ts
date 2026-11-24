import { afterAll, afterEach, beforeAll } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import { ExtensionMessageEventSchema, type ProjectContent } from '@ruimte/contracts';
import { serverContract, ID } from '../../../../extensions/poc/contract/contract/server.ts';
import { serverActions } from '../actions/server-actions-test-helpers.ts';
import { markDrawnChat } from '../projects/drawn-chat.ts';
import { projectOverlays } from '../projects/overlays.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../testing/test-daemon.ts';
import { extensionChatStarter } from './extension-chat.ts';
import { ExtensionHost } from './extension-host.ts';
import { runMachineAction } from './machine-actions.ts';
import { buildExtension, packExtension } from './pack.ts';
import { terminalWriteRefusal } from './policy.ts';
import { ExtensionRefusal, extensionFailureOf } from './refusal.ts';
import { ExtensionStore } from './store.ts';
import { ExtensionTerminals, extensionTerminalOpener } from './terminals.ts';

const PROBE = join(import.meta.dir, '..', '..', '..', '..', 'extensions', 'poc', 'contract');
const root = mkdtempSync(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-extension-contract-'));
const hosts: ExtensionHost[] = [];
let worlds = 0;
let projects: ProjectStore;
let projectId: string;
let projectFolder: string;
let daemon: TestDaemon;

// One daemon of fake CLIs behind every world, so a chat start goes the way the machine's own does.
beforeAll(async () => {
    const folder = join(root, 'project');

    mkdirSync(folder, { recursive: true });
    projects = new ProjectStore(join(root, 'daemon'), projectLinks(), projectOverlays(join(root, 'daemon')));

    const opened = await projects.openProject({ folder });

    await projects.save(opened.summary.projectId, opened.document.rev, { name: 'Shop', color: '#123456', views: [] } as ProjectContent);
    projects.release(opened.summary.projectId);
    projectId = opened.summary.projectId;
    projectFolder = folder;
    daemon = await bootTestDaemon({ home: join(root, 'daemon'), store: projects, clock: new ManualClock() });
});

afterEach(() => hosts.splice(0).forEach((host) => host.stopAll()));
afterAll(async () => {
    await daemon.stop();
    projects.closeAll();
    rmSync(root, { recursive: true, force: true });
});

/*
 * The machine's own host with `poc.contract` under these permissions, in a process of its own: packed and installed,
 * or linked as `ruimte extension dev` links it when its manifest uses a proposed part, which an install refuses.
 * Its terminals are sessions of the daemon on fake PTYs, opened and typed into by the machine's own rules.
 */
serverContract(async (permissions, { provenance, ...provided } = {}) => {
    worlds += 1;

    const folder = join(root, `probe-${worlds}`);
    const manifest = JSON.parse(readFileSync(join(PROBE, 'manifest.json'), 'utf8')) as object;
    const linked = provenance !== 'installed' && (provided.provides !== undefined || provided.proposed !== undefined);
    const personTerminal = `shell-${worlds}`;
    const records = new ExtensionTerminals();

    cpSync(join(PROBE, 'server'), join(folder, 'server'), { recursive: true });
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ ...manifest, permissions, ...provided }));

    const store = new ExtensionStore(join(root, `home-${worlds}`));
    const openTerminal = extensionTerminalOpener({
        projects: daemon.host.projects,
        terminals: records,
        folderOf: (id) => projects.index.folderOf(id),
        worktreePaths: async () => [],
        nodeSize: () => ({ w: 560, h: 360 }),
        // As the daemon's own wiring starts a session for a node with a profile: with the program its extension describes.
        start: async (nodeId, cwd) => {
            const profile = records.get(nodeId)?.profile;
            const described =
                profile === undefined
                    ? null
                    : await host.profileSpawn(profile.extension, profile.id, { project: { id: projectId, name: 'Shop', folder: projectFolder }, cwd });

            await daemon.sessions.create({
                sessionId: nodeId,
                cwd,
                cols: 80,
                rows: 24,
                ...(described === null ? {} : { exec: described.command, env: described.env ?? {} })
            });
        }
    });
    const host: ExtensionHost = new ExtensionHost({
        store,
        terminals: () => ({
            open: openTerminal,
            read: async () => 'The screen',
            write: async (id, nodeId, text) => {
                const refused = terminalWriteRefusal(id, nodeId, records.get(nodeId), daemon.sessions.awaitsPerson(nodeId));

                if (refused !== null) {
                    throw new ExtensionRefusal(refused.code, refused.message);
                }

                daemon.sessions.write(nodeId, text);
            }
        }),
        asks: () => ({
            'chats.send': async () => undefined,
            'agents.run': async ({ prompt }: { prompt: string }) => ({ text: `Answer to ${prompt}` }),
            'chats.list': async () => [{ id: 'chat-1', provider: 'claude', status: 'idle', model: null, cwd: '/work' }]
        }),
        startChat: extensionChatStarter({
            host: daemon.host,
            actions: serverActions,
            folderOf: (id) => projects.index.folderOf(id),
            projectOfFolder: (folder) => projects.index.projectOfFolder(folder),
            markDrawn: (id, viewId, extensionId) => markDrawnChat(projects, id, viewId, extensionId)
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
    const emitted: { name: string; payload?: unknown }[] = [];

    // As a client hears it: the event crosses as JSON and is read by its schema.
    host.subscribe(`contract-${worlds}`, ({ event, payload }) => {
        if (event === 'extension.message') {
            const { name, payload: said } = ExtensionMessageEventSchema.parse(JSON.parse(JSON.stringify(payload)));

            emitted.push(said === undefined ? { name } : { name, payload: said });
        }
    });
    hosts.push(host);

    if (linked) {
        await host.linked((await buildExtension(folder)).outdir);
    } else {
        await host.install(readFileSync((await packExtension(folder)).path).toString('base64'));
    }

    await daemon.sessions.create({ sessionId: personTerminal, cols: 80, rows: 24, cwd: projectFolder });

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
        personTerminal,
        typed: async (terminal) => (daemon.sessions.get(terminal) === undefined ? '' : daemon.adapter.forSession(terminal).typed),
        variable: async (terminal, name) => daemon.adapter.forSession(terminal).options.env[name],
        waits: async (terminal) => {
            const token = daemon.adapter.forSession(terminal).options.env.RUIMTE_HOOK_TOKEN as string;

            await daemon.sessions.applyHook('claude', token, { session_id: `conversation-${terminal}`, hook_event_name: 'UserPromptSubmit' });
            await daemon.sessions.applyHook('claude', token, {
                session_id: `conversation-${terminal}`,
                hook_event_name: 'Notification',
                notification_type: 'permission_prompt',
                message: 'Claude needs your permission to use Bash'
            });
        },
        logs: async () =>
            readFileSync(store.logFile(ID), 'utf8')
                .split('\n')
                .filter((line) => line !== '')
    };
});
