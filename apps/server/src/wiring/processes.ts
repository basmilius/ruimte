import { isIdle, type MachineWork } from '@ruimte/contracts';
import { HOOK_EVENTS } from '../agents/hooks.ts';
import type { ServerConfig } from '../config.ts';
import { holdsForeground } from '../processes/foreground.ts';
import { DarwinListenerProbe } from '../processes/listeners.ts';
import { ProcessMonitor } from '../processes/monitor.ts';
import { createSampler } from '../processes/sampler.ts';
import { WindowsListenerProbe } from '../processes/windows.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { SelfUpdater, buildFileOf, readBuildFile } from '../service/self-update.ts';
import { childCounter, workOf } from '../service/work.ts';
import { SessionPorts } from '../sessions/ports.ts';
import { BUILD } from '../version.ts';
import type { AgentsBundle } from './agents.ts';
import type { AgentWorkBundle } from './agent-work.ts';
import type { LaunchesBundle } from './launches.ts';

/* The processes behind sessions and chats, and the build that waits for them to be idle. */
export interface ProcessesBundle {
    sessionPorts: SessionPorts;
    processes: ProcessMonitor;
    selfUpdate: SelfUpdater;
    /* One reading of the process table per question, taken only when a question is asked. */
    machineWork(): MachineWork;
}

interface ProcessesInput {
    config: ServerConfig;
    machineId: string;
    agents: AgentsBundle;
    work: AgentWorkBundle;
    launches: LaunchesBundle;
    projects: ProjectStore;
    /* Ends the daemon for a reason it logs. */
    shutdown(reason: string): Promise<void>;
}

export async function wireProcesses({ config, machineId, agents, work, launches, projects, shutdown }: ProcessesInput): Promise<ProcessesBundle> {
    const { sessions, chats } = agents;
    const sampler = await createSampler(process.platform, config.home);
    const sessionPorts = new SessionPorts({
        machineId,
        sampler,
        probe: process.platform === 'darwin' ? new DarwinListenerProbe() : process.platform === 'win32' ? new WindowsListenerProbe() : null,
        sessions: () => sessions.list().flatMap(({ sessionId }) => sessions.live(sessionId) ?? []),
        current: (id) => sessions.live(id),
        uid: process.getuid?.() ?? -1
    });
    sessions.observeLifecycle((session, phase) => {
        if (phase === 'created') {
            sessionPorts.track(session);
        } else {
            sessionPorts.forget(session);
        }
    });
    const processes = new ProcessMonitor({
        sampler,
        sessions: () =>
            sessions.list().map((session) => ({
                id: session.sessionId,
                pid: session.pid,
                exited: session.exited,
                agent: session.agent ?? null,
                label: launches.runner.labelOf(session.sessionId) ?? sessions.labelOf(session.sessionId) ?? undefined
            })),
        chats: () => chats.processTargets(),
        contextUrl: () => sessions.contextUrl,
        projectOf: (nodeId) => projects.index.locate(nodeId)?.projectId ?? null,
        // Without a SessionEnd a clean exit and a crash look the same, so only these CLIs can be missed.
        reportsEnd: (kind) => HOOK_EVENTS[kind]?.includes('SessionEnd') === true
    });
    const machineWork = (): MachineWork => {
        let children: ((pid: number) => number) | null = null;
        try {
            children = sampler === null ? null : childCounter(sampler.sample().processes);
        } catch {
            children = null;
        }
        const list = sessions.list().map((session) => ({ ...session, launch: launches.runner.labelOf(session.sessionId) !== null }));
        return workOf({ sessions: list, chats: chats.list(), children });
    };
    const selfUpdate = new SelfUpdater({
        underService: config.underService,
        running: BUILD,
        readOnDisk: () => readBuildFile(buildFileOf(process.execPath)),
        idle: () => isIdle(machineWork()),
        exit: () => void shutdown('a newer build on disk'),
        log: (line) => console.log(line)
    });
    sessions.onProcessChange = (sessionId, phase) => {
        if (phase === 'before-kill') {
            processes.beforeKill();
            return;
        }
        processes.nudge();
        selfUpdate.nudge();
        if (sessions.get(sessionId)?.exited !== false) {
            work.tasks.terminals.ended(sessionId);
        }
    };
    sessions.isAgentGone = (sessionId) => processes.isAgentGone(sessionId);
    sessions.holdsForeground = holdsForeground;
    return { sessionPorts, processes, selfUpdate, machineWork };
}
