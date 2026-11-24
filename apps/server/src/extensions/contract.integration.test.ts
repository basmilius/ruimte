import { afterAll, afterEach, beforeAll } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { ChatProvider } from '@adecore/agents/providers';
import { ManualClock } from '@adecore/agents/testing';
import { ExtensionMessageEventSchema, extensionAgentKind, extensionProjectPath, type ProjectContent } from '@ruimte/contracts';
import { serverContract, ID } from '../../../../extensions/poc/contract/contract/server.ts';
import { serverActions } from '../actions/server-actions-test-helpers.ts';
import { markDrawnChat } from '../projects/drawn-chat.ts';
import { projectOverlays } from '../projects/overlays.ts';
import { projectLinks } from '../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../testing/test-daemon.ts';
import { ExtensionAgentProviders } from './agent-providers.ts';
import { extensionChatStarter } from './extension-chat.ts';
import { ExtensionHost, type ExtensionFilesPort } from './extension-host.ts';
import { runMachineAction } from './machine-actions.ts';
import { buildExtension, packExtension } from './pack.ts';
import { terminalWriteRefusal } from './policy.ts';
import { ExtensionProblems } from './problems.ts';
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
 * The files of the project in memory, behind the port the machine's own reads go through, so a change is told the moment
 * a scenario writes it and no watcher of the disk decides when. `project-files.test.ts` holds the real port.
 */
function memoryFiles(folder: string): { port: ExtensionFilesPort; write(path: string, text: string): void } {
    const texts = new Map<string, string>();
    const watches = new Map<string, { path: string; changed(): void }>();
    const placed = (path: string): string => {
        const full = extensionProjectPath(folder, path);

        if (full === null) {
            throw new ExtensionRefusal('outside-project', `${path} is outside the project folder`);
        }

        return relative(folder, full);
    };

    return {
        port: {
            readText: async (_projectId, path) => {
                const text = texts.get(placed(path));

                if (text === undefined) {
                    throw new ExtensionRefusal('not-found', `No file ${path} in the project`);
                }

                return text;
            },
            list: async (_projectId, listed) => {
                const under = placed(listed) === '' ? '' : `${placed(listed)}/`;
                const names = new Map<string, 'file' | 'directory'>();

                for (const path of texts.keys()) {
                    if (path.startsWith(under)) {
                        const [name, ...deeper] = path.slice(under.length).split('/') as [string, ...string[]];

                        names.set(name, deeper.length === 0 ? 'file' : 'directory');
                    }
                }

                return [...names]
                    .toSorted(([left, leftKind], [right, rightKind]) =>
                        leftKind === rightKind ? left.localeCompare(right) : leftKind === 'directory' ? -1 : 1
                    )
                    .map(([name, kind]) => ({ path: join(folder, under, name), name, kind }));
            },
            watch: async (extensionId, watch, _projectId, path, changed) => void watches.set(`${extensionId}:${watch}`, { path: placed(path), changed }),
            unwatch: (extensionId, watch) => void watches.delete(`${extensionId}:${watch}`),
            unwatchAll: (extensionId) => {
                for (const key of [...watches.keys()].filter((each) => each.startsWith(`${extensionId}:`))) {
                    watches.delete(key);
                }
            }
        },
        write: (path, text) => {
            texts.set(path, text);

            for (const watch of [...watches.values()]) {
                if (watch.path === '' || watch.path === path || path.startsWith(`${watch.path}/`)) {
                    watch.changed();
                }
            }
        }
    };
}

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
    const project = { id: projectId, name: 'Shop', folder: projectFolder };
    const files = memoryFiles(projectFolder);
    const problems = new ExtensionProblems({ folderOf: (id) => projects.index.folderOf(id), holders: () => [] });
    const launchChanges = new Map<string, number>();
    // The probe lists its models before it says what its agent is, so that comes a moment after its process is up.
    const agentDescribed = Promise.withResolvers<void>();
    const offered = new Map<string, ChatProvider>();
    const agents = new ExtensionAgentProviders({
        list: (start) => host.agentProviders(start),
        providers: { add: (provider) => void offered.set(provider.kind, provider), remove: (kind) => void offered.delete(kind), invalidate: () => undefined }
    });
    const host: ExtensionHost = new ExtensionHost({
        store,
        projectFiles: () => files.port,
        problems: () => problems,
        launchesChanged: (_id, source) => void launchChanges.set(source, (launchChanges.get(source) ?? 0) + 1),
        agentsDescribed: () => agentDescribed.resolve(),
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
        launches: async (source) => {
            const listed = (await host.launchSources(project)).find((listing) => listing.source === source);

            if (listed === undefined) {
                throw new Error(`${ID} lists no launch source ${source}`);
            }

            await host.watchLaunchSource(ID, source, project, true);

            return { title: listed.title, launches: listed.launches };
        },
        launchChanges: async (source) => launchChanges.get(source) ?? 0,
        unfollowLaunches: (source) => host.watchLaunchSource(ID, source, project, false),
        machines: async (source) => {
            const listed = (await host.machineSources(project)).find((listing) => listing.source === source);

            if (listed === undefined) {
                throw new Error(`${ID} lists no machine source ${source}`);
            }

            return { title: listed.title, candidates: listed.candidates };
        },
        machineStart: async (source, candidate, stopped) => {
            const stop = new AbortController();
            const reports: string[] = [];
            const place = (await host.machineSources(project)).flatMap((listing) => listing.candidates).find((listed) => listed.id === candidate);

            if (place === undefined) {
                throw new Error(`${source} lists no place ${candidate}`);
            }

            if (stopped) {
                stop.abort();
            }

            try {
                const start = await host.machineStart(ID, source, project, place, { report: (line) => reports.push(line), signal: stop.signal });

                return { start, reports, failure: null };
            } catch (e) {
                return { start: null, reports: [], failure: (e as Error).message };
            }
        },
        composer: async () => {
            const offered = await host.composerItems(project);

            return {
                references: offered.references.map(({ extension: _extension, ...thing }) => thing),
                commands: offered.commands.map(({ extension: _extension, ...command }) => command)
            };
        },
        pick: (reference, item) => host.readReference(ID, reference, item, project),
        slash: (name, args) => host.expandCommand(ID, name, args, project),
        // As the machine's wiring offers it: the provider the registry is handed once the extension's process described it.
        agent: async (id) => {
            if (!(await host.agentProviders(true)).some((listed) => listed.extension === ID && listed.id === id)) {
                throw new Error(`${ID} supplies no agent ${id}`);
            }

            await agentDescribed.promise;
            await agents.refresh(false);

            const described = (await host.agentProviders(false)).find((listed) => listed.id === id)?.described;
            const provider = offered.get(extensionAgentKind(ID, id) ?? '');

            if (provider === undefined || described === null || described === undefined) {
                throw new Error(`${ID} supplies no agent ${id}`);
            }

            return {
                kind: provider.kind,
                name: provider.name,
                command: [...provider.command],
                env: described.spawn.env ?? {},
                models: provider.catalog.list().map((model) => ({ id: model.slug, name: model.name }))
            };
        },
        uiSource: async (id) => {
            const listed = (await host.uiSources(true)).find((source) => source.extension === ID && source.id === id);

            if (listed === undefined) {
                throw new Error(`${ID} supplies no UI source ${id}`);
            }

            return { name: `${ID}/${id}`, ...listed.described };
        },
        readUi: async (id, args) => {
            try {
                return { value: await host.readUiSource(ID, id, args, project) };
            } catch (e) {
                return { failure: (e as Error).message };
            }
        },
        notify: async (channel, body, reason) => {
            const listed = (await host.notificationChannels()).find((each) => each.extension === ID && each.id === channel);

            if (listed === undefined) {
                throw new Error(`${ID} lists no notification channel ${channel}`);
            }

            const notification = { title: 'Agent', body, project: { id: projectId }, node: { id: 'node-1' }, reason };
            const delivered = await host.deliverNotification(ID, channel, notification);

            // The title a process that ran gave it, which the list only knows after the first delivery.
            return { title: (await host.notificationChannels()).find((each) => each.id === channel)?.title ?? listed.title, delivered };
        },
        launchIs: (launch, state, exitCode) =>
            host.forwardEvent('launch.status', {
                projectId,
                launchId: launch,
                sessionId: `launch-${launch}`,
                kind: 'service',
                state,
                exitCode,
                startedAt: 1,
                endedAt: state === 'exited' ? 2 : null,
                port: null,
                url: null,
                stopped: false
            }),
        projectIs: (open) => host.forwardEvent(open ? 'project.opened' : 'project.closed', open ? { project } : { projectId }),
        problems: async () =>
            problems.of(projectId).map((file) => ({
                source: file.server.slice(ID.length + 1),
                path: file.path,
                messages: file.problems.map((problem) => problem.message)
            })),
        writeFile: async (path, text) => files.write(path, text),
        logs: async () =>
            readFileSync(store.logFile(ID), 'utf8')
                .split('\n')
                .filter((line) => line !== '')
    };
});
