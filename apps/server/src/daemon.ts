import { CustomLanguageServerInputSchema, extensionChatOf } from '@ruimte/contracts';
import { serverActionCall } from './actions/context.ts';
import { serverActions } from './actions/server-actions.ts';
import { HOOKS_PATH } from './agents/hook-receiver.ts';
import { pruneHiddenChats } from './agents/prune-hidden-chats.ts';
import { dropEmptyMark } from './chat/scratch-project.ts';
import { greetingLines } from './cli/greeting.ts';
import type { ServerConfig } from './config.ts';
import { CONTEXT_PATH } from './context/context-store.ts';
import { Dispatcher } from './dispatcher.ts';
import { errorText } from './error-text.ts';
import { extensionChatStarter } from './extensions/extension-chat.ts';
import { ExtensionHost } from './extensions/extension-host.ts';
import type { ExtensionAsks, ExtensionHostOptions } from './extensions/extension-host.ts';
import { runMachineAction, outputOf } from './extensions/machine-actions.ts';
import { ExtensionRefusal } from './extensions/refusal.ts';
import { ExtensionStore } from './extensions/store.ts';
import { registerExtensionChatRead } from './handlers/extension-chat-read.ts';
import { registerExtensionHandlers, runExtensionPrompt } from './handlers/extensions.ts';
import { registerRoutineHandlers } from './handlers/routine.ts';
import { registerTemplateHandlers } from './handlers/template.ts';
import { registerVoiceHandlers } from './handlers/voice.ts';
import { readMachineModel } from './machine-model.ts';
import { markDrawnChat } from './projects/drawn-chat.ts';
import { probeCodexNoDaemon } from './providers/launch.ts';
import { armShutdownDeadline } from './shutdown-deadline.ts';
import { noteMoment, noteShutdown, rememberSecret, stopTelemetry, watchProjects, type Launcher } from './telemetry/reporter.ts';
import { COMPILED as compiled, VERSION } from './version.ts';
import { wireAgentWork } from './wiring/agent-work.ts';
import { loadAgentStores, wireAgents } from './wiring/agents.ts';
import { wireArtifacts } from './wiring/artifacts.ts';
import { wireCanvasHost } from './wiring/canvas-host.ts';
import { repairChatMoves } from './wiring/chat-move.ts';
import { wireClients } from './wiring/clients.ts';
import { wireDatabases } from './wiring/databases.ts';
import { createComputer, wireDevices } from './wiring/devices.ts';
import { wireGit } from './wiring/git.ts';
import { registerEditorHandlers, registerHandlers } from './wiring/handlers.ts';
import { serveDaemon } from './wiring/http.ts';
import { wireLanguage } from './wiring/language.ts';
import { wireLaunches } from './wiring/launches.ts';
import { wireMachine } from './wiring/machine.ts';
import { wireMaintenance } from './wiring/maintenance.ts';
import { wireNetwork } from './wiring/network.ts';
import { wirePower } from './wiring/power.ts';
import { wireProcesses } from './wiring/processes.ts';
import { wireProjects } from './wiring/projects.ts';
import { wireProviders } from './wiring/providers.ts';
import { wirePush } from './wiring/push.ts';
import { wireRemote } from './wiring/remote.ts';
import { wireRoutines } from './wiring/routines.ts';
import type { DaemonRuntime } from './wiring/runtime.ts';
import { wireTemplates } from './wiring/templates.ts';
import { wireUsageStats } from './wiring/usage-stats.ts';
import { wireUsage } from './wiring/usage.ts';
import { wireVoice } from './wiring/voice.ts';

const EXTENSION_QUERY_ROWS = 500;

/*
 * Runs the daemon until a signal ends the process. The wiring modules are called in boot order; a
 * module that needs one wired after it reaches it through `later`, which only runs once the daemon
 * is up, and a call before then throws instead of answering for a service that is not there.
 */
export async function startDaemon(config: ServerConfig, launcher: Launcher = 'standalone'): Promise<void> {
    const runtime: DaemonRuntime = {
        config,
        compiled,
        sourceDir: import.meta.dir,
        contextUrl: `http://127.0.0.1:${config.port}${CONTEXT_PATH}`
    };
    const { home } = config;
    let extensionAsks: ExtensionAsks = {};
    let runExtensionAction: NonNullable<ExtensionHostOptions['runAction']> = () => Promise.reject(new Error('The machine is still starting'));
    let addExtensionLanguageServer: NonNullable<ExtensionHostOptions['addLanguageServer']> = () => Promise.reject(new Error('The machine is still starting'));
    let startExtensionChat: NonNullable<ExtensionHostOptions['startChat']> = () => Promise.reject(new Error('The machine is still starting'));
    const extensions = new ExtensionHost({
        store: new ExtensionStore(home),
        asks: () => extensionAsks,
        startChat: (id, start, check) => startExtensionChat(id, start, check),
        runAction: (id, projectId, action, input) => runExtensionAction(id, projectId, action, input),
        addLanguageServer: (id, server) => addExtensionLanguageServer(id, server),
        removeLanguageServers: (id) => language.host.customRemoveOwned(id),
        languageServerOwners: () => language.host.customOwners()
    });

    // Runs while the stores load; it never rejects, and the managers await it before any launch.
    const codexProbe = probeCodexNoDaemon();
    const machineModel = readMachineModel();
    const machine = await wireMachine(config);
    const { identity } = machine;
    rememberSecret(machine.access.localSecret);
    const stores = await loadAgentStores(home);
    const computer = createComputer(runtime, stores.computerStore, { agents: () => agents, projects: () => projects });
    const stats = await wireUsageStats(home, identity, machine.auth, launcher);
    const providers = await wireProviders(config, identity, () => computer.start(), stats.flush);
    const agents = await wireAgents({
        runtime,
        identity,
        stores,
        providers,
        computer,
        codexProbe,
        later: {
            projects: () => projects,
            git: () => git,
            devices: () => devices,
            databases: () => databases,
            launches: () => launches,
            usage: () => usage,
            work: () => work,
            artifacts: () => artifacts,
            routines: () => routines
        }
    });
    const projects = await wireProjects({
        home,
        machineId: machine.identity.id,
        stores,
        agents,
        computer,
        later: {
            launches: () => launches,
            work: () => work,
            databases: () => databases,
            language: () => language,
            templates: () => templates,
            devices: () => devices
        }
    });
    const templates = wireTemplates(home, projects);
    watchProjects(projects.store);
    const artifacts = await wireArtifacts({
        home,
        machineId: identity.id,
        machineHome: machine.machineHome,
        stores,
        agents,
        projects,
        later: { routines: () => routines.routines }
    });
    const databases = await wireDatabases(home, machine.machineHome, projects.store, { language: () => language });
    const remote = await wireRemote({ home, identity, machine, outbox: stores.outbox, later: { brokerUrl: () => network.brokerSwitch.describe().brokerUrl } });
    const work = wireAgentWork({
        home,
        identity,
        stores,
        agents,
        projects: projects.store,
        remote,
        providers,
        later: { push: () => push, launches: () => launches, git: () => git, clients: () => clients, routines: () => routines.routines }
    });
    const launches = wireLaunches({ home, stores, agents, work, projects: projects.store, later: { git: () => git } });
    const routines = await wireRoutines({ home, machineId: identity.id, stores, agents, projects, launches, artifacts });
    // Before the socket answers, so an agent whose project nobody opened since the restart still reads its links.
    await projects.store.warmIndex();
    const git = wireGit(home, identity, agents, work, projects.store.peers);
    const devices = wireDevices(runtime, computer);
    const usage = wireUsage(config, providers, agents, projects.store);
    const processes = await wireProcesses({
        config,
        machineId: identity.id,
        agents,
        work,
        launches,
        projects: projects.store,
        devices: devices.deviceDriver,
        shutdown: (reason) => shutdown(reason)
    });
    const maintenance = wireMaintenance(home, processes, { language: () => language.host, projects: () => projects.store.index });
    const canvasHost = wireCanvasHost({
        extensions,
        identity,
        stores,
        providers,
        agents,
        projects,
        work,
        launches,
        git,
        devices,
        databases,
        remote,
        usage,
        artifacts,
        routines,
        templates,
        later: { language: () => language.host, push: () => push }
    });

    const { sessions, chats } = agents;
    const push = wirePush(home, machine.auth, identity, agents, projects.store, work.snoozes);
    sessions.observe((event) => push.consume(event));
    sessions.observe((event) => work.tasks.terminals.sessionEvent(event));
    chats.observe((event) => push.consume(event));
    processes.processes.observeAlerts((alerts) => push.processAlerts(alerts));
    const voice = wireVoice({ config, projects: projects.store, machine: identity, canvasHost, chats });
    const power = wirePower(home, identity, agents);
    sessions.observe((event) => computer.observe(event));
    chats.observe((event) => computer.observe(event));
    chats.observe((event) => launches.secrets.observe(event));
    chats.observe((event) => extensions.forwardEvent(event.event, event.payload));
    sessions.observe((event) => extensions.forwardEvent(event.event, event.payload));
    chats.observe((event) => agents.proposals.observe(event));
    chats.observe((event) => launches.afterSettle.chatEvent(event));
    chats.observe((event) => {
        if (event.event === 'chat.event' && event.payload.event.type === 'item' && event.payload.event.item.kind === 'user') {
            dropEmptyMark(projects.store, event.payload.chatId).catch((e: unknown) => console.error('Listing a written chat failed:', errorText(e)));
        }
    });

    const dispatcher = new Dispatcher();
    await registerHandlers(dispatcher, {
        machineModel,
        runtime,
        machine,
        stores,
        providers,
        agents,
        projects,
        work,
        launches,
        git,
        devices,
        processes,
        power,
        push,
        canvasHost,
        remote,
        stats,
        artifacts,
        later: { network: () => network, clients: () => clients }
    });
    registerVoiceHandlers(dispatcher, voice);
    registerRoutineHandlers(dispatcher, routines);
    registerTemplateHandlers(dispatcher, templates.store);
    const language = await wireLanguage({
        home,
        compiled,
        machineHome: machine.machineHome,
        watches: git.watches,
        projects: projects.store,
        sqlAnalysis: databases.sqlAnalysis,
        agents,
        providers
    });
    agents.context.useExtensionNodes(async (extension, type, data) => {
        const parts = await extensions.nodeContext(extension, type, data);

        return Array.isArray(parts) ? parts.map((part: { text?: string }) => part.text ?? '').join('\n') : typeof parts === 'string' ? parts : null;
    });
    startExtensionChat = extensionChatStarter({
        host: canvasHost,
        actions: serverActions,
        folderOf: (projectId) => projects.store.index.folderOf(projectId),
        projectOfFolder: (folder) => projects.store.index.projectOfFolder(folder),
        markDrawn: (projectId, viewId, extensionId) => markDrawnChat(projects.store, projectId, viewId, extensionId)
    });
    runExtensionAction = async (id, projectId, action, input) => {
        const folder = projects.store.index.folderOf(projectId);

        if (folder === null) {
            throw new ExtensionRefusal('not-found', `No project ${projectId} on this machine`);
        }

        const call = serverActionCall(canvasHost, { projectId, folder, canvasId: null }, `extension:${id}`);

        call.context.extension = true;

        return runMachineAction(
            action,
            input,
            async (name, translated) => outputOf(await serverActions.execute(name, translated, call)),
            (files) => artifacts.artifacts.publishFor(projectId, files)
        );
    };
    // Saved like one a person added, so it is listed in Settings and held when its file changes.
    addExtensionLanguageServer = async (id, server) => {
        const input = CustomLanguageServerInputSchema.safeParse({ args: [], ...server, id: undefined });

        if (!input.success) {
            throw new ExtensionRefusal('invalid-input', `defineLanguageServer takes another shape: ${input.error.issues[0]?.message ?? 'invalid'}`);
        }

        await language.host.customSaveFor(id, input.data);
    };
    const readExtensionChat = async (chatId: string): Promise<string> =>
        (await agents.context.answerSource('extension', { id: chatId, kind: 'chat', title: chatId }, null, null)).text ?? '';

    extensionAsks = {
        'agents.run': (options: { prompt: string; context?: string[]; provider?: string }) => runExtensionPrompt(providers.providers, options),
        'chats.send': async (chatId: string, text: string) => {
            await chats.send(chatId, text);
        },
        'chats.list': async () => (await chats.list()).map(extensionChatOf),
        'chats.read': readExtensionChat
    };
    registerExtensionChatRead(dispatcher, readExtensionChat);
    registerExtensionHandlers(dispatcher, extensions, {
        viewsOf: (projectId) => projects.store.index.viewsOf(projectId),
        folderOf: (projectId) => projects.store.index.folderOf(projectId),
        readSource: async (source, projectId) => (await agents.context.answerSource('extension', source, null, null, projectId)).text ?? '',
        providers: providers.providers,
        databaseQuery: async (projectId, connection, sql) => {
            const folder = projects.store.index.folderOf(projectId);

            if (folder === null) {
                throw new ExtensionRefusal('not-found', `No project ${projectId} on this machine`);
            }

            const { result } = await databases.agents.query({ projectId, folder }, 'extension', connection, sql, { schema: null, limit: EXTENSION_QUERY_ROWS });

            return {
                columns: result.columns.map((column) => (typeof column === 'string' ? column : column.name)),
                rows: result.rows.map((row) => [...row]),
                hasMore: result.hasMore
            };
        }
    });
    registerEditorHandlers(dispatcher, {
        machine,
        providers,
        projects,
        work,
        launches,
        git,
        devices,
        databases,
        usage,
        processes,
        language,
        agents,
        artifacts
    });
    const network = wireNetwork(config, compiled, machine, dispatcher, { clients: () => clients });

    noteMoment('daemon.boot', 'wired');
    void extensions.startAutostarted();
    // Only from here on has the identity everything its announce describes; a CLI found sooner took the daemon down.
    providers.integrations.onChanged(() => identity.announce());
    void providers.integrations.refreshInstalled();
    void providers.integrations.installDefaults();

    const clients = wireClients(machine.handshake, {
        dispatcher,
        extensions,
        presence: push,
        snoozes: work.snoozes,
        prWatches: work.prWatches,
        peers: projects.store.peers,
        remote: remote.status,
        peerTasks: work.peerTasks,
        voice: voice.sessions,
        voicePreferences: voice.preferences,
        sessions,
        chats,
        browsers: devices.browsers,
        browserPages: devices.browserPages,
        devices: devices.devices,
        deviceControl: devices.deviceControl,
        identity,
        updates: power.updates,
        projects: projects.store,
        drawings: projects.drawings,
        diagrams: projects.diagrams,
        launchStore: launches.store,
        launches: launches.runner,
        databases: databases.service,
        databaseConnections: databases.connections,
        databaseAgents: databases.agents,
        language: language.host,
        sqlAnalysis: databases.sqlAnalysis,
        folders: git.folders,
        statuses: git.statuses,
        usage: usage.usage,
        limits: usage.limits,
        providerAccounts: providers.accounts,
        providerList: providers.feed,
        processes: processes.processes,
        tasks: stores.tasks,
        worktrees: git.worktrees,
        plans: agents.plans,
        provenance: language.provenance,
        computer,
        secrets: launches.secrets,
        proposals: agents.proposals,
        artifacts: artifacts.artifacts,
        routines: routines.watchers,
        templates: templates.store
    });
    // Before the socket answers, so no client attaches to or writes in a chat that is half moved; the outbox starts after.
    await repairChatMoves({
        chats,
        store: projects.store,
        lineage: stores.lineage,
        tasks: stores.tasks,
        outbox: stores.outbox,
        notices: stores.notices,
        prWatches: work.prWatches,
        machineHome: machine.machineHome,
        journal: stores.chatMoves,
        snoozes: work.snoozes
    }).catch((e) => console.error('Finishing interrupted chat moves failed:', errorText(e)));
    // Once per start, before the outbox runs and never on a clock.
    await pruneHiddenChats({
        hiddenAgents: projects.store.hiddenAgents,
        index: projects.store.index,
        tasks: stores.tasks,
        lineage: stores.lineage,
        chats,
        now: Date.now
    }).catch((e) => console.error('Removing old hidden agent chats failed:', errorText(e)));
    const server = serveDaemon({
        requestStop: () => void shutdown('a request'),
        extensions,
        runtime,
        machine,
        stores,
        agents,
        projects,
        devices,
        processes,
        power,
        network,
        clients,
        canvasHost,
        voice,
        artifacts
    });

    // The first read runs now, so a page opened straight after a start already has the plan on it.
    usage.limits.start();
    providers.accounts.start();
    processes.processes.start();

    // Hooks and context always go over loopback, whatever interface the socket listens on.
    sessions.hookUrl = `http://127.0.0.1:${server.port}${HOOKS_PATH}`;
    sessions.contextUrl = `http://127.0.0.1:${server.port}${CONTEXT_PATH}`;
    // Only once `hookUrl` is set: a terminal the worker starts before that runs without hooks for good.
    await work.tasks.recover();
    await work.peerTasks.recover();
    // Before the outbox works, so a routine whose time passed while the machine was off runs once now.
    await routines.routines.start().catch((e: unknown) => console.error('Scheduling routines failed:', errorText(e)));
    work.worker.start();
    work.endChildren.start();
    maintenance.start();
    // Beside the daemon answering: a turn a restart interrupted is taken up again without waiting for a client.
    void chats.recoverInterrupted().catch((e) => console.error('Resuming interrupted turns failed:', errorText(e)));

    void network.brokerSwitch.publish({ host: config.host, port: server.port ?? config.port });

    let shuttingDown = false;
    const shutdown = async (reason: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        armShutdownDeadline(
            (code) => process.exit(code),
            () => sessions.killAllSettled()
        );
        noteShutdown();
        console.log(`ruimte server stopping for ${reason}, writing snapshots`);
        processes.selfUpdate.stop();
        power.keepAwake.stop();
        power.closedLid.stop();
        work.snoozes.stop();
        work.prWatches.close();
        work.worker.stop();
        work.tasks.coordinator.stop();
        work.tasks.waiting.stop();
        work.summaries.coordinator.stop();
        agents.snapshotSchedule.stop();
        usage.usage.stop();
        usage.limits.stop();
        providers.accounts.stop();
        processes.processes.stop();
        processes.sessionPorts.stop();
        // Before anything is awaited: a `bun --watch` reload restarts the module during the first
        // await, so a turn in flight would otherwise never reach its file.
        chats.persistAllSync();
        // Each on its own: a step that fails must not keep the chats' CLIs, and what they started, running past the daemon.
        const step = async (what: string, run: () => Promise<void>): Promise<void> => {
            try {
                await run();
            } catch (e) {
                console.error(`${what} on shutdown failed:`, errorText(e));
            }
        };
        await step('Stopping maintenance', () => maintenance.stop());
        await step('Stopping extensions', async () => extensions.stopAll());
        // Before the sessions go: a Voice session left open at OpenAI keeps costing.
        await step('Ending Voice sessions', async () => voice.sessions.stopAll());
        await step('Settling tasks', () => work.tasks.coordinator.settled());
        await step('Writing terminal snapshots', () => agents.snapshotSchedule.flush());
        await step('Writing chats', () => chats.shutdown());
        await step('Stopping computer use', () => computer.stop());
        await step('Ending terminals', () => sessions.killAllSettled());
        devices.browsers.closeAll();
        await step('Stopping visual previews', () => devices.visualRenderer.stop());
        devices.deviceDriver.releaseAll();
        devices.deviceControl.stop();
        devices.devices.closeAll();
        projects.store.closeAll();
        projects.drawings.closeAll();
        projects.diagrams.closeAll();
        launches.runner.close();
        launches.store.closeAll();
        databases.connections.closeAll();
        templates.store.closeAll();
        databases.agents.close();
        await step('Stopping the database helper', () => databases.service.dispose());
        await step('Stopping language servers', () => language.host.close());
        await step('Stopping editor model requests', () => language.editorAssist.dispose());
        await step('Writing the usage counts', () => stats.stop());
        await step('Sending error reports', () => stopTelemetry());
        network.peers.closeAll();
        network.lanDoor.stop();
        await step('Leaving the broker', () => network.brokerSwitch.stop());
        void server.stop(true);
        process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    processes.selfUpdate.start();
    // `always` holds from the start, before any agent has moved.
    power.keepAwake.check();
    // Puts back what a daemon before this one left, and only then decides for the lid.
    void power.closedLid.start();

    const greeting = greetingLines({
        version: VERSION,
        host: server.hostname ?? config.host,
        port: server.port ?? config.port,
        home,
        interactive: process.stdout.isTTY === true && !config.underService
    });
    for (const line of greeting) {
        console.log(line);
    }
    noteMoment('daemon.boot', 'serving');
    // After the greeting, so a person who just ran `npx ruimte` reads what runs before where it is reachable.
    if (network.lanDoorWanted()) {
        network.lanDoor.start();
    }
}
