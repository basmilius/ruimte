import { nodeSessionFs } from '@adecore/agents/chat';
import { createServerActions } from './actions/server-actions.ts';
import { AGENT_FEATURES, AGENT_TOOLKITS } from './agent-features/list.ts';
import { stopSteps, type StopPhase } from './area.ts';
import { dropEmptyMark } from './chat/scratch-project.ts';
import { greetingLines } from './cli/greeting.ts';
import type { ServerConfig } from './config.ts';
import { Dispatcher } from './dispatcher.ts';
import { errorText } from './error-text.ts';
import { readMachineModel } from './machine-model.ts';
import { buildCatalog } from './mcp/catalog.ts';
import { probeCodexNoDaemon } from './providers/launch.ts';
import { armShutdownDeadline } from './shutdown-deadline.ts';
import { countUsages } from './stats/usage-stats.ts';
import { noteActivity } from './telemetry/activity.ts';
import { noteMoment, noteShutdown, recordRequestDuration, rememberSecret, watchProjects, type Launcher } from './telemetry/reporter.ts';
import { COMPILED as compiled, VERSION } from './version.ts';
import { wireAgentWork } from './wiring/agent-work.ts';
import { loadAgentStores, wireAgents } from './wiring/agents.ts';
import { daemonAreas } from './wiring/areas.ts';
import { wireArtifacts } from './wiring/artifacts.ts';
import type { DaemonBundles } from './wiring/bundles.ts';
import { wireCanvasHost } from './wiring/canvas-host.ts';
import { chatMover } from './wiring/chat-move.ts';
import { wireClients } from './wiring/clients.ts';
import { wireDatabases } from './wiring/databases.ts';
import { createComputer, wireDevices } from './wiring/devices.ts';
import { wireExtensions } from './wiring/extensions.ts';
import { wireGit } from './wiring/git.ts';
import { listenFirst } from './wiring/http.ts';
import { wireLanguage } from './wiring/language.ts';
import { lateness } from './wiring/later.ts';
import { wireLaunches } from './wiring/launches.ts';
import { wireMachine } from './wiring/machine.ts';
import { wireMaintenance } from './wiring/maintenance.ts';
import { wireNetwork } from './wiring/network.ts';
import { wirePower } from './wiring/power.ts';
import { wireProcesses } from './wiring/processes.ts';
import { wireProjects } from './wiring/projects.ts';
import { wireProviders } from './wiring/providers.ts';
import { pruneHiddenChats } from './wiring/prune-hidden-chats.ts';
import { wirePush } from './wiring/push.ts';
import { wireRemote } from './wiring/remote.ts';
import { wireRoutines } from './wiring/routines.ts';
import { loopbackUrls, type DaemonRuntime } from './wiring/runtime.ts';
import { wireTemplates } from './wiring/templates.ts';
import { wireUsageStats } from './wiring/usage-stats.ts';
import { wireUsage } from './wiring/usage.ts';
import { wireVoice } from './wiring/voice.ts';

const STOP_PHASES: readonly StopPhase[] = ['halt', 'drain', 'end', 'last'];

/*
 * Runs the daemon until a signal ends the process. The port is taken first, so every URL a session
 * is told is known before anything is wired. The wiring modules are called in boot order; one that
 * needs a bundle wired after it reaches it through `later` (`wiring/later.ts`), which throws on a
 * call before the daemon wired it instead of answering for a service that is not there.
 */
export async function startDaemon(config: ServerConfig, launcher: Launcher = 'standalone'): Promise<void> {
    const doorway = listenFirst(config);
    const runtime: DaemonRuntime = { config, compiled, sourceDir: import.meta.dir, ...loopbackUrls(doorway.port) };
    const { home } = config;
    const { later, provide } = lateness<DaemonBundles>();
    provide('actions', createServerActions(AGENT_FEATURES));
    const extensions = provide('extensions', wireExtensions(home, later));

    // Runs while the stores load; it never rejects, and the managers await it before any launch.
    const codexProbe = probeCodexNoDaemon();
    const machineModel = readMachineModel();
    const machine = provide('machine', await wireMachine(config));
    const { identity } = machine;
    rememberSecret(machine.access.localSecret);
    const stores = provide('stores', await loadAgentStores(home));
    const computer = provide('computer', createComputer(runtime, stores.computerStore, stores.lifecycle, later));
    const stats = provide('stats', await wireUsageStats(home, identity, machine.auth, launcher));
    const providers = provide('providers', await wireProviders(config, identity, () => computer.start(), stats.flush));
    const agents = provide('agents', await wireAgents({ runtime, identity, stores, providers, computer, machineHome: machine.machineHome, codexProbe, later }));
    const projects = provide('projects', await wireProjects({ home, machineId: identity.id, machineHome: machine.machineHome, stores, agents, later }));
    const templates = provide('templates', wireTemplates(home, projects));
    watchProjects(projects.store);
    const artifacts = provide(
        'artifacts',
        await wireArtifacts({ home, machineId: identity.id, machineHome: machine.machineHome, stores, agents, projects, later })
    );
    const databases = provide('databases', await wireDatabases(home, machine.machineHome, projects.store, later));
    const remote = provide('remote', await wireRemote({ home, identity, machine, outbox: stores.outbox, later }));
    const work = provide('work', wireAgentWork({ home, identity, stores, agents, projects: projects.store, remote, providers, later }));
    const launches = provide('launches', wireLaunches({ home, stores, agents, work, projects: projects.store, later }));
    const routines = provide('routines', await wireRoutines({ home, machineId: identity.id, stores, agents, projects, launches, artifacts }));
    // Before the socket answers, so an agent whose project nobody opened since the restart still reads its links.
    await projects.store.warmIndex();
    const git = provide('git', wireGit(home, identity, machine.machineHome, agents, work, projects.store.peers));
    const devices = provide('devices', wireDevices(runtime, computer, stores.lifecycle, machine.machineHome));
    const usage = provide('usage', wireUsage(config, providers, agents, projects.store));
    const processes = provide(
        'processes',
        await wireProcesses({
            config,
            machineId: identity.id,
            agents,
            launches,
            projects: projects.store,
            lifecycle: stores.lifecycle,
            shutdown: (reason) => shutdown(reason)
        })
    );
    const maintenance = provide('maintenance', wireMaintenance(home, processes, later));
    const canvasHost = provide(
        'canvasHost',
        wireCanvasHost(AGENT_FEATURES, {
            extensions: extensions.host,
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
            later
        })
    );

    const { sessions, chats } = agents;
    const push = provide('push', wirePush(home, machine.auth, identity, agents, projects.store, work.snoozes));
    sessions.observe((event) => push.consume(event));
    sessions.observe((event) => work.tasks.terminals.sessionEvent(event));
    chats.observe((event) => push.consume(event));
    processes.processes.observeAlerts((alerts) => push.processAlerts(alerts));
    const voice = provide('voice', wireVoice({ config, projects: projects.store, machine: identity, canvasHost, actions: later.actions(), chats }));
    const power = provide('power', wirePower(home, identity, agents));
    sessions.observe((event) => computer.observe(event));
    chats.observe((event) => computer.observe(event));
    chats.observe((event) => launches.secrets.observe(event));
    chats.observe((event) => extensions.host.forwardEvent(event.event, event.payload));
    sessions.observe((event) => extensions.host.forwardEvent(event.event, event.payload));
    chats.observe((event) => agents.proposals.observe(event));
    chats.observe((event) => launches.afterSettle.chatEvent(event));
    chats.observe((event) => {
        if (event.event === 'chat.event' && event.payload.event.type === 'item' && event.payload.event.item.kind === 'user') {
            dropEmptyMark(projects.store, event.payload.chatId).catch((e: unknown) => console.error('Listing a written chat failed:', errorText(e)));
        }
    });

    const language = provide(
        'language',
        await wireLanguage({
            home,
            compiled,
            machineHome: machine.machineHome,
            watches: git.watches,
            projects: projects.store,
            sqlAnalysis: databases.sqlAnalysis,
            agents,
            providers
        })
    );
    const network = provide('network', wireNetwork(config, compiled, machine, later));
    const mover = provide(
        'chatMover',
        chatMover({
            chats,
            store: projects.store,
            lineage: stores.lineage,
            tasks: stores.tasks,
            outbox: stores.outbox,
            notices: stores.notices,
            prWatches: work.prWatches,
            machineHome: machine.machineHome,
            journal: stores.chatMoves,
            snoozes: work.snoozes,
            proposals: agents.proposals
        })
    );

    const areas = daemonAreas(
        {
            runtime,
            machineModel: await machineModel,
            sessionFs: await nodeSessionFs(),
            machine,
            stores,
            stats,
            providers,
            computer,
            agents,
            projects,
            templates,
            artifacts,
            databases,
            remote,
            work,
            launches,
            routines,
            git,
            devices,
            usage,
            processes,
            maintenance,
            chatMover: mover,
            language,
            push,
            voice,
            power,
            network,
            actions: later.actions(),
            canvasHost,
            extensions
        },
        later
    );
    const dispatcher = new Dispatcher();
    dispatcher.observe({
        started: (type) => noteActivity(`request ${type}`),
        answered: (type, ms, counts) => {
            recordRequestDuration(type, ms);
            countUsages(counts);
        }
    });
    for (const area of areas) {
        area.handlers?.(dispatcher);
    }

    noteMoment('daemon.boot', 'wired');
    void extensions.host.startAutostarted();
    // Only from here on has the identity everything its announce describes; a CLI found sooner took the daemon down.
    providers.integrations.onChanged(() => identity.announce());
    void providers.integrations.refreshInstalled();
    void providers.integrations.installDefaults();

    const clients = provide(
        'clients',
        wireClients(machine.handshake, {
            dispatcher,
            areas,
            screenOf: (clientId, sessionId, deliver) => {
                const session = sessions.get(sessionId);
                if (!session?.isAttached(clientId)) {
                    return false;
                }
                session.snapshotFor(clientId, deliver);
                return true;
            },
            requestKeyFrame: (backendId, deviceId) => devices.devices.requestKeyFrame(backendId, deviceId)
        })
    );
    // Before the socket answers, so no client attaches to or writes in a chat that is half moved; the outbox starts after.
    await mover.repair().catch((e) => console.error('Finishing interrupted chat moves failed:', errorText(e)));
    // Once per start, before the outbox runs and never on a clock.
    await pruneHiddenChats({
        hiddenAgents: projects.store.hiddenAgents,
        index: projects.store.index,
        tasks: stores.tasks,
        lineage: stores.lineage,
        chats,
        now: Date.now
    }).catch((e) => console.error('Removing old hidden agent chats failed:', errorText(e)));
    doorway.answer({
        requestStop: () => void shutdown('a request'),
        extensions: extensions.host,
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
        actions: later.actions(),
        tools: buildCatalog(AGENT_TOOLKITS),
        voice,
        artifacts
    });

    // The first read runs now, so a page opened straight after a start already has the plan on it.
    usage.limits.start();
    providers.accounts.start();
    processes.processes.start();

    await work.tasks.recover();
    await work.peerTasks.recover();
    // Before the outbox works, so a routine whose time passed while the machine was off runs once now.
    await routines.routines.start().catch((e: unknown) => console.error('Scheduling routines failed:', errorText(e)));
    work.worker.start();
    work.endChildren.start();
    maintenance.start();
    // Beside the daemon answering: a turn a restart interrupted is taken up again without waiting for a client.
    void chats.recoverInterrupted().catch((e) => console.error('Resuming interrupted turns failed:', errorText(e)));

    void network.brokerSwitch.publish({ host: config.host, port: doorway.port });

    let shuttingDown = false;
    async function shutdown(reason: string): Promise<void> {
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
        // Each on its own: a step that fails must not keep the chats' CLIs, and what they started, running past the daemon.
        for (const phase of STOP_PHASES) {
            for (const step of stopSteps(areas, phase)) {
                try {
                    await step.run();
                } catch (e) {
                    console.error(`${step.label} on shutdown failed:`, errorText(e));
                }
            }
        }
        void doorway.server.stop(true);
        process.exit(0);
    }

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    processes.selfUpdate.start();
    // `always` holds from the start, before any agent has moved.
    power.keepAwake.check();
    // Puts back what a daemon before this one left, and only then decides for the lid.
    void power.closedLid.start();

    const greeting = greetingLines({
        version: VERSION,
        host: doorway.hostname,
        port: doorway.port,
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
