import type { Area } from '../area.ts';
import { accountsArea } from '../handlers/accounts.ts';
import { activityArea } from '../handlers/activity.ts';
import { agentRegistryArea } from '../handlers/agent-registry.ts';
import { agentServersArea } from '../handlers/agent-servers.ts';
import { archiveArea } from '../handlers/archive.ts';
import { artifactArea } from '../handlers/artifact.ts';
import { authArea } from '../handlers/auth.ts';
import { browserArea } from '../handlers/browser.ts';
import { bytesArea } from '../handlers/bytes.ts';
import { chatImageArea } from '../handlers/chat-image.ts';
import { chatSearchArea } from '../handlers/chat-search.ts';
import { chatArea } from '../handlers/chat.ts';
import { clientArea } from '../handlers/client.ts';
import { computerArea } from '../handlers/computer.ts';
import { databaseArea, databaseConnectionsLifecycle } from '../handlers/database.ts';
import { deviceArea } from '../handlers/device.ts';
import { diagramArea } from '../handlers/diagram.ts';
import { directArea } from '../handlers/direct.ts';
import { drawingArea } from '../handlers/drawing.ts';
import { editorAssistArea } from '../handlers/editor-assist.ts';
import { extensionsArea } from '../handlers/extensions.ts';
import { fsArea } from '../handlers/fs.ts';
import { gitArea } from '../handlers/git.ts';
import { languageArea } from '../handlers/language.ts';
import { launchesArea } from '../handlers/launches.ts';
import { planArea } from '../handlers/plan.ts';
import { processesArea } from '../handlers/processes.ts';
import { proposalsArea } from '../handlers/project-proposals.ts';
import { projectArea } from '../handlers/project.ts';
import { provenanceArea } from '../handlers/provenance.ts';
import { providerDetectArea } from '../handlers/provider-detect.ts';
import { providerKeysArea } from '../handlers/provider-keys.ts';
import { pushArea } from '../handlers/push.ts';
import { reachArea } from '../handlers/reach.ts';
import { routineArea } from '../handlers/routine.ts';
import { secretsArea } from '../handlers/secrets.ts';
import { serverArea } from '../handlers/server.ts';
import { sessionPortsArea } from '../handlers/session-ports.ts';
import { sessionArea } from '../handlers/session.ts';
import { snoozeArea } from '../handlers/snooze.ts';
import { tasksArea } from '../handlers/tasks.ts';
import { templateArea } from '../handlers/template.ts';
import { terminalPrepareArea } from '../handlers/terminal-prepare.ts';
import { tunnelsArea } from '../handlers/tunnels.ts';
import { usageArea } from '../handlers/usage.ts';
import { voiceArea } from '../handlers/voice.ts';
import { remoteArea } from '../peer/giver/area.ts';
import { peerArtifactsArea } from '../peer/worker/area-artifacts.ts';
import { peerLinksArea } from '../peer/worker/area-links.ts';
import { peerTasksArea } from '../peer/worker/area-tasks.ts';
import { VERSION } from '../version.ts';
import { agentWorkLifecycle } from './agent-work-lifecycle.ts';
import { agentsLifecycle } from './agents.ts';
import {
    archiveDeps,
    artifactImporter,
    authDeps,
    bytesDeps,
    chatDeps,
    chatImageDeps,
    chatSearchDeps,
    fsDeps,
    gitDeps,
    peerLinksDeps,
    projectDeps,
    remoteDeps,
    sessionDeps,
    terminalPrepareDeps,
    type AreaInput,
    type AreaLater
} from './area-deps.ts';
import { devicesLifecycle } from './devices.ts';
import { maintenanceLifecycle } from './maintenance.ts';
import { networkLifecycle } from './network.ts';
import { powerLifecycle } from './power.ts';
import { processesLifecycle } from './processes.ts';
import { errorReportsLifecycle, usageCountsLifecycle } from './usage-stats.ts';

/*
 * Every area of the daemon, in one list: what each answers, which events every client hears from it,
 * what it holds for a client and how it stops. A request, a source or a stop step is added in the
 * area's own module; only a new area is a line here. Within a shutdown phase the steps run in the
 * order of this list (`area.ts`), so what must outlive another comes after it: the chats are written
 * before the computer and the terminals end, and the counts and the channels to other machines go last.
 */
export function daemonAreas(input: AreaInput, later: AreaLater): Area[] {
    const { runtime, machine, stores, providers, agents, projects, templates, artifacts, databases, work, launches, routines, devices } = input;
    const { usage, processes, language, push, voice, power, network, computer, extensions, stats, maintenance } = input;
    const { connected, tunnels } = input;
    const store = projects.store;
    const streamingAllowed = (): boolean => machine.identity.streamingAllowed;

    return [
        processesLifecycle(processes),
        powerLifecycle(power),
        tunnelsArea({
            service: tunnels.service,
            proposals: tunnels.proposals,
            credentials: tunnels.credentials,
            consent: tunnels.consent,
            listener: tunnels.listener,
            changes: tunnels.sinks,
            changed: () => {
                tunnels.sinks.emit({ event: 'tunnel.changed', payload: {} });
                // A revoked credential leaves the list of connected clients at once.
                connected.externalChanged();
            }
        }),
        clientArea({ connected, auth: machine.auth, external: () => tunnels.credentials.active() }),
        maintenanceLifecycle(maintenance),
        extensionsArea({ host: extensions.host, ...extensions.handlerDeps(), readChat: extensions.readChat }),
        voiceArea(voice),
        serverArea({ version: VERSION, home: runtime.config.home, model: input.machineModel }),
        authArea(authDeps(input, later)),
        pushArea({ auth: machine.auth, push, changed: () => push.subscriptionsChanged() }),
        providerKeysArea({ nanogpt: providers.nanogpt, claudeApi: providers.claudeApi }),
        providerDetectArea({ providers: providers.providers, accounts: providers.accounts, feed: providers.feed, now: Date.now }),
        agentServersArea({ servers: providers.servers }),
        agentRegistryArea({ agents: providers.registryAgents, versions: providers.versions }),
        snoozeArea({ snoozes: work.snoozes, locate: (nodeId) => store.index.locate(nodeId) }),
        activityArea({ activity: work.activity }),
        gitArea(gitDeps(input)),
        agentWorkLifecycle(work),
        agentsLifecycle(agents),
        usageCountsLifecycle(stats),
        usageArea({ usage: usage.usage, limits: usage.limits }),
        accountsArea({ accounts: providers.accounts }),
        processesArea({ monitor: processes.processes }),
        sessionPortsArea({ ports: processes.sessionPorts }),
        terminalPrepareArea(terminalPrepareDeps(input)),
        tasksArea({ tasks: stores.tasks, children: work.endChildren.children }),
        planArea({ plans: agents.plans }),
        chatImageArea(chatImageDeps(input)),
        chatSearchArea(chatSearchDeps(input)),
        proposalsArea({ proposals: agents.proposals }),
        secretsArea({ secrets: launches.secrets }),
        artifactArea({ artifacts: artifacts.artifacts, importer: artifactImporter(input) }),
        peerArtifactsArea({ links: store.peers, artifacts: artifacts.artifacts }),
        peerLinksArea(peerLinksDeps(input)),
        peerTasksArea({ links: store.peers, tasks: work.peerTasks }),
        remoteArea(remoteDeps(input)),
        routineArea({ routines: routines.routines, watchers: routines.watchers, skills: (payload) => routines.skills(payload) }),
        browserArea({ browsers: devices.browsers, pages: devices.browserPages, streamingAllowed }),
        devicesLifecycle(devices),
        deviceArea({ devices: devices.devices, control: devices.deviceControl, watch: devices.deviceWatch, streamingAllowed, home: runtime.config.home }),
        projectArea(projectDeps(input)),
        drawingArea({ store: projects.drawings }),
        diagramArea({ store: projects.diagrams }),
        launchesArea({ store: launches.store, runner: launches.runner }),
        databaseConnectionsLifecycle(databases.connections),
        templateArea({ store: templates.store }),
        databaseArea({ service: databases.service, connections: databases.connections, agents: databases.agents, sql: databases.sqlAnalysis }),
        languageArea({ host: language.host }),
        editorAssistArea({ model: language.editorAssist }),
        provenanceArea({ provenance: language.provenance, machineHome: machine.machineHome }),
        fsArea(fsDeps(input)),
        archiveArea(archiveDeps(input)),
        bytesArea(bytesDeps(input)),
        chatArea(chatDeps(input)),
        computerArea({ computer }),
        sessionArea(sessionDeps(input)),
        errorReportsLifecycle(),
        directArea({ peers: network.peers }),
        reachArea({ reach: network.reach }),
        networkLifecycle(network)
    ];
}
