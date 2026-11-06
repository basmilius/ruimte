import type { Area } from '../area.ts';
import { stopTelemetry } from '../telemetry/reporter.ts';
import { sendEvent } from '../wire.ts';
import type { DaemonBundles } from './bundles.ts';

/*
 * Every area of the daemon, in one list: what each answers, which events every client hears from
 * it, what it holds for a client and how it stops. A request, a source or a stop step is added in
 * the area's own module; only a new area is a line here. Within a shutdown phase the steps run in
 * the order of this list (`area.ts`), so what must outlive another comes after it.
 */
export function daemonAreas(bundles: Omit<DaemonBundles, 'clients'> & { maintenance: { stop(): Promise<void> } }): Area[] {
    const {
        stats,
        providers,
        agents,
        projects,
        templates,
        databases,
        work,
        launches,
        git,
        devices,
        usage,
        processes,
        language,
        voice,
        power,
        network,
        computer,
        extensions
    } = bundles;
    const { sessions, chats } = agents;
    const { push } = bundles;

    return [
        // The events every client hears, until each area names its own.
        {
            name: 'events',
            sources: [
                sessions,
                chats,
                devices.browsers,
                devices.browserPages,
                devices.devices,
                devices.deviceControl,
                bundles.machine.identity,
                power.updates,
                projects.store,
                projects.drawings,
                projects.diagrams,
                launches.store,
                launches.runner,
                extensions.host,
                databases.connections,
                databases.agents,
                language.host,
                databases.sqlAnalysis,
                git.folders,
                git.statuses,
                usage.usage,
                usage.limits,
                providers.accounts,
                providers.feed,
                processes.processes,
                bundles.stores.tasks,
                git.worktrees,
                agents.plans,
                language.provenance,
                computer,
                launches.secrets,
                agents.proposals,
                work.snoozes,
                work.prWatches,
                projects.store.peers,
                bundles.remote.status,
                voice.preferences,
                bundles.artifacts.artifacts,
                bundles.routines.watchers,
                templates.store
            ],
            holders: [sessions, chats, devices.browsers, devices.browserPages, devices.devices, git.folders, git.statuses],
            connect: ({ client, access, gate }) => [
                push.connected(access.sessionId),
                () => push.reportPresence(client.id, false),
                push.observeAttention((entry) => sendEvent(client, 'push.attention', entry)),
                push.observeNotification((alert) => sendEvent(client, 'push.notification', alert)),
                sessions.observeScreens(client.id, (sessionId) => gate.screenTaken(sessionId))
            ],
            closed: (clientId, access) => {
                if (access.peer !== undefined) {
                    work.peerTasks.channelClosed(clientId);
                } else {
                    voice.sessions.channelClosed(clientId);
                }

                return databases.service.release(clientId);
            }
        },
        {
            name: 'processes and power',
            stop: [
                { phase: 'halt', label: 'Stopping the self update', run: () => processes.selfUpdate.stop() },
                { phase: 'halt', label: 'Stopping keep awake', run: () => power.keepAwake.stop() },
                { phase: 'halt', label: 'Stopping the closed-lid rule', run: () => power.closedLid.stop() },
                { phase: 'halt', label: 'Stopping the process monitor', run: () => processes.processes.stop() },
                { phase: 'halt', label: 'Stopping the port monitor', run: () => processes.sessionPorts.stop() }
            ]
        },
        {
            name: 'agent work',
            stop: [
                { phase: 'halt', label: 'Stopping snoozes', run: () => work.snoozes.stop() },
                { phase: 'halt', label: 'Closing the pull request watches', run: () => work.prWatches.close() },
                { phase: 'halt', label: 'Stopping the outbox worker', run: () => work.worker.stop() },
                { phase: 'halt', label: 'Stopping the task coordinator', run: () => work.tasks.coordinator.stop() },
                { phase: 'halt', label: 'Stopping waiting tasks', run: () => work.tasks.waiting.stop() },
                { phase: 'halt', label: 'Stopping summaries', run: () => work.summaries.coordinator.stop() },
                { phase: 'drain', label: 'Settling tasks', run: () => work.tasks.coordinator.settled() }
            ]
        },
        {
            name: 'usage and providers',
            stop: [
                { phase: 'halt', label: 'Stopping usage', run: () => usage.usage.stop() },
                { phase: 'halt', label: 'Stopping limits', run: () => usage.limits.stop() },
                { phase: 'halt', label: 'Stopping accounts', run: () => providers.accounts.stop() }
            ]
        },
        {
            name: 'maintenance',
            stop: [{ phase: 'drain', label: 'Stopping maintenance', run: () => bundles.maintenance.stop() }]
        },
        {
            name: 'extensions',
            stop: [{ phase: 'drain', label: 'Stopping extensions', run: () => extensions.host.stopAll() }]
        },
        {
            name: 'voice',
            // Before the sessions go: a Voice session left open at OpenAI keeps costing.
            stop: [{ phase: 'drain', label: 'Ending Voice sessions', run: () => voice.sessions.stopAll() }]
        },
        {
            name: 'agents',
            stop: [
                { phase: 'halt', label: 'Stopping the terminal snapshots', run: () => agents.snapshotSchedule.stop() },
                // Before anything is awaited: a `bun --watch` reload restarts the module during the first await, so a turn in flight would otherwise never reach its file.
                { phase: 'halt', label: 'Writing chats at once', run: () => chats.persistAllSync() },
                { phase: 'drain', label: 'Writing terminal snapshots', run: () => agents.snapshotSchedule.flush() },
                { phase: 'drain', label: 'Writing chats', run: () => chats.shutdown() },
                { phase: 'drain', label: 'Stopping computer use', run: () => computer.stop() },
                { phase: 'drain', label: 'Ending terminals', run: () => sessions.killAllSettled() }
            ]
        },
        {
            name: 'devices',
            stop: [
                { phase: 'end', label: 'Closing browsers', run: () => devices.browsers.closeAll() },
                { phase: 'end', label: 'Stopping visual previews', run: () => devices.visualRenderer.stop() },
                { phase: 'end', label: 'Releasing devices', run: () => devices.deviceDriver.releaseAll() },
                { phase: 'end', label: 'Stopping device control', run: () => devices.deviceControl.stop() },
                { phase: 'end', label: 'Closing devices', run: () => devices.devices.closeAll() }
            ]
        },
        {
            name: 'projects',
            stop: [
                { phase: 'end', label: 'Closing projects', run: () => projects.store.closeAll() },
                { phase: 'end', label: 'Closing drawings', run: () => projects.drawings.closeAll() },
                { phase: 'end', label: 'Closing diagrams', run: () => projects.diagrams.closeAll() },
                { phase: 'end', label: 'Closing launches', run: () => launches.runner.close() },
                { phase: 'end', label: 'Closing launch files', run: () => launches.store.closeAll() },
                { phase: 'end', label: 'Closing templates', run: () => templates.store.closeAll() }
            ]
        },
        {
            name: 'databases',
            stop: [
                { phase: 'end', label: 'Closing database connections', run: () => databases.connections.closeAll() },
                { phase: 'end', label: 'Closing database agents', run: () => databases.agents.close() },
                { phase: 'end', label: 'Stopping the database helper', run: () => databases.service.dispose() }
            ]
        },
        {
            name: 'language',
            stop: [
                { phase: 'end', label: 'Stopping language servers', run: () => language.host.close() },
                { phase: 'end', label: 'Stopping editor model requests', run: () => language.editorAssist.dispose() }
            ]
        },
        {
            name: 'telemetry',
            stop: [
                { phase: 'last', label: 'Writing the usage counts', run: () => stats.stop() },
                { phase: 'last', label: 'Sending error reports', run: () => stopTelemetry() }
            ]
        },
        {
            name: 'network',
            stop: [
                { phase: 'last', label: 'Closing direct channels', run: () => network.peers.closeAll() },
                { phase: 'last', label: 'Stopping the local network door', run: () => network.lanDoor.stop() },
                { phase: 'last', label: 'Leaving the broker', run: () => network.brokerSwitch.stop() }
            ]
        }
    ];
}
