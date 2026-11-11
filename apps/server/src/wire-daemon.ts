import { createServerActions } from './actions/server-actions.ts';
import { AGENT_FEATURES, AGENT_TOOLKITS } from './agent-features/list.ts';
import { runStop, type Area } from './area.ts';
import { bestEffort } from './best-effort.ts';
import { dropEmptyMark } from './chat/scratch-project.ts';
import { ConnectedClients } from './clients/connected-clients.ts';
import { removeRetiredFiles } from './disk/retired-files.ts';
import { Dispatcher } from './dispatcher.ts';
import { errorText } from './error-text.ts';
import { buildCatalog } from './mcp/catalog.ts';
import { countUsages } from './stats/usage-stats.ts';
import { noteActivity } from './telemetry/activity.ts';
import { noteMoment, recordRequestDuration, type Launcher } from './telemetry/reporter.ts';
import { COMPILED as compiled } from './version.ts';
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
import type { HttpInput } from './wiring/http.ts';
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
import type { DaemonRuntime } from './wiring/runtime.ts';
import type { DaemonSeams } from './wiring/seams.ts';
import { wireSettingPorts } from './wiring/setting-ports.ts';
import { wireTemplates } from './wiring/templates.ts';
import { wireTunnels } from './wiring/tunnels.ts';
import { wireUsageStats } from './wiring/usage-stats.ts';
import { wireUsage } from './wiring/usage.ts';
import { wireVoice } from './wiring/voice.ts';

interface WireInput {
    runtime: DaemonRuntime;
    launcher: Launcher;
    seams: DaemonSeams;
    /* Ends the daemon for a reason it logs; the self update asks it when a newer build is on disk. */
    shutdown(reason: string): Promise<void>;
}

/* The daemon wired, not yet answering anyone: its bundles, its requests and the steps that bring it up and take it down. */
interface WiredDaemon {
    readonly runtime: DaemonRuntime;
    readonly bundles: DaemonBundles;
    readonly areas: readonly Area[];
    readonly dispatcher: Dispatcher;
    /*
     * Brings the daemon up: finishes what a restart interrupted, hands the routes to `serve` and starts
     * everything that runs on its own. `requestStop` is how a request to the routes ends the daemon.
     */
    start(options: { port: number; requestStop: () => void; serve(input: HttpInput): void }): Promise<void>;
    /* Stops each area in the order of its phases; a step that fails is logged and never keeps the next from running. */
    stop(): Promise<void>;
}

/*
 * Wires every module in boot order, each returning a typed bundle; one that needs a bundle wired after
 * it reaches it through `later` (`wiring/later.ts`), which throws on a call before the daemon wired it
 * instead of answering for a service that is not there. The daemon and the tests of the daemon wire
 * through this one function, so they differ only in the seams they pass.
 */
export async function wireDaemon({ runtime, launcher, seams, shutdown }: WireInput): Promise<WiredDaemon> {
    const { config } = runtime;
    const { home } = config;
    await bestEffort('retired files', removeRetiredFiles(home));
    const { later, provide } = lateness<DaemonBundles>();
    // The port the API answers on, which is not `config.port` when the system picked one; known once `start` is given it.
    let servedPort: number | null = null;
    provide('actions', createServerActions(AGENT_FEATURES));
    const catalog = buildCatalog(AGENT_TOOLKITS);
    const extensions = provide('extensions', wireExtensions(home, later));

    const machineModel = seams.machine.model();
    const machine = provide('machine', await wireMachine(config, later));
    const { identity } = machine;
    seams.redactions.secret(machine.access.localSecret);
    const stores = provide('stores', await loadAgentStores(home, seams.clock));
    const computer = provide('computer', createComputer(runtime, stores.computerStore, stores.lifecycle, later));
    const stats = provide('stats', await wireUsageStats(home, identity, machine.auth, launcher));
    const providers = provide('providers', await wireProviders(config, () => computer.start(), stats.flush, seams));
    const agents = provide('agents', await wireAgents({ runtime, identity, stores, providers, computer, machineHome: machine.machineHome, seams, later }));
    const projects = provide('projects', await wireProjects({ home, machineId: identity.id, machineHome: machine.machineHome, stores, agents, seams, later }));
    const templates = provide('templates', wireTemplates(home, projects));
    seams.redactions.projects(projects.store);
    const artifacts = provide(
        'artifacts',
        await wireArtifacts({ home, machineId: identity.id, machineHome: machine.machineHome, stores, agents, projects, later })
    );
    const databases = provide('databases', await wireDatabases(home, machine.machineHome, projects.store, later));
    const remote = provide('remote', await wireRemote({ home, identity, machine, outbox: stores.outbox, later }));
    const work = provide('work', wireAgentWork({ home, identity, stores, agents, projects: projects.store, remote, providers, seams, later }));
    const launches = provide('launches', wireLaunches({ home, stores, agents, work, projects: projects.store, later }));
    const routines = provide('routines', await wireRoutines({ home, machineId: identity.id, stores, agents, projects, launches, artifacts }));
    // Before the socket answers, so an agent whose project nobody opened since the restart still reads its links.
    await projects.store.warmIndex();
    const git = provide('git', wireGit(home, identity, machine.machineHome, agents, work, projects.store.peers, seams));
    const devices = provide('devices', wireDevices(runtime, computer, stores.lifecycle, machine.machineHome, seams));
    const usage = provide('usage', wireUsage(config, providers, agents, projects.store, seams));
    const processes = provide(
        'processes',
        await wireProcesses({
            config,
            machineId: identity.id,
            agents,
            launches,
            projects: projects.store,
            lifecycle: stores.lifecycle,
            shutdown
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
    const connected = provide('connected', new ConnectedClients(() => seams.clock.now()));
    const tunnels = provide(
        'tunnels',
        await wireTunnels({
            config,
            canvasHost,
            agents,
            projects,
            processes,
            artifacts,
            stores,
            launches,
            routines,
            machineId: identity.id,
            actions: later.actions(),
            tools: catalog,
            externalUsed: () => connected.externalChanged(),
            later: { apiPort: () => servedPort ?? config.port }
        })
    );

    const { sessions, chats } = agents;
    const push = provide('push', wirePush(home, machine.auth, identity, agents, projects.store, work.snoozes, usage));
    sessions.observe((event) => push.consume(event));
    sessions.observe((event) => work.tasks.terminals.sessionEvent(event));
    chats.observe((event) => push.consume(event));
    sessions.observe((event) => work.activity.consume(event));
    chats.observe((event) => work.activity.consume(event));
    processes.processes.observeAlerts((alerts) => push.processAlerts(alerts));
    const voice = provide(
        'voice',
        wireVoice({ config, projects: projects.store, machine: identity, canvasHost, actions: later.actions(), chats, live: seams.voiceLive })
    );
    const power = provide('power', wirePower(home, identity, agents, seams.power));
    sessions.observe((event) => computer.observe(event));
    chats.observe((event) => computer.observe(event));
    chats.observe((event) => launches.secrets.observe(event));
    chats.observe((event) => extensions.host.forwardEvent(event.event, event.payload));
    sessions.observe((event) => extensions.host.forwardEvent(event.event, event.payload));
    chats.observe((event) => agents.proposals.observe(event));
    chats.observe((event) => tunnels.proposals.observe(event));
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
            providers,
            seams,
            git
        })
    );
    const network = provide('network', wireNetwork(config, compiled, machine, later));
    const settingPorts = provide('settingPorts', wireSettingPorts({ stats, providers, agents, devices, power, network }));
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
            sessionFs: await seams.machine.sessionFs(),
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
            settingPorts,
            actions: later.actions(),
            canvasHost,
            extensions,
            connected,
            tunnels
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

    const bundles: DaemonBundles = {
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
        settingPorts,
        clients,
        actions: later.actions(),
        canvasHost,
        extensions,
        connected,
        tunnels
    };

    return {
        runtime,
        bundles,
        areas,
        dispatcher,
        start: async ({ port, requestStop, serve }) => {
            servedPort = port;
            noteMoment('daemon.boot', 'wired');
            void extensions.host.startAutostarted();
            // Only from here on has the identity everything its announce describes; a CLI found sooner took the daemon down.
            providers.integrations.onChanged(() => identity.announce());
            void providers.integrations.refreshInstalled();
            void providers.integrations.installDefaults();

            // Before the socket answers, so no client attaches to or writes in a chat that is half moved; the outbox starts after.
            await mover.repair().catch((e) => console.error('Finishing interrupted chat moves failed:', errorText(e)));
            // Once per start, before the outbox runs and never on a clock.
            await pruneHiddenChats({
                hiddenAgents: projects.store.hiddenAgents,
                index: projects.store.index,
                tasks: stores.tasks,
                lineage: stores.lineage,
                chats: agents.chatManager,
                now: () => seams.clock.now()
            }).catch((e) => console.error('Removing old hidden agent chats failed:', errorText(e)));
            serve({
                requestStop,
                extensions: extensions.host,
                runtime,
                machine,
                stores,
                agents,
                providers: providers.providers,
                projects,
                devices,
                processes,
                power,
                network,
                clients,
                canvasHost,
                actions: later.actions(),
                tools: catalog,
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

            void network.brokerSwitch.publish({ host: config.host, port });
            // After the API answers, so the deny list of the tunnels knows its port.
            await tunnels.service.resume().catch((e: unknown) => console.error('Bringing the tunnels back failed:', errorText(e)));
            processes.selfUpdate.start();
            // `always` holds from the start, before any agent has moved.
            power.keepAwake.check();
            // Puts back what a daemon before this one left, and only then decides for the lid.
            void power.closedLid.start();
        },
        stop: () => runStop(areas, (label, e) => console.error(`${label} on shutdown failed:`, errorText(e)))
    };
}
