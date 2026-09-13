import type { AgentStatus, ProcessAlert, ProcessAlertKind } from '@ruimte/contracts';

/*
 * When an agent is stuck, judged by laying the hook status beside the measurements of its own tree.
 * Neither says it alone: an idle Claude burns 2 to 4% of a core, and a busy one is silent for minutes
 * while a tool runs. What gives it away is the two disagreeing. Every rule ends at a person with a
 * button; nothing here kills anything, and a measurement that failed never raises a warning.
 */

/* Starting values from the report, not yet calibrated on real sessions; they live here and nowhere else. */
export const STUCK_THRESHOLDS = {
    /* Running by the hooks, no hook event for this long. */
    silentAfterMs: 10 * 60_000,
    /* The CPU a silent tree may use when no idle stretch of its own was measured, percent of one core. */
    silentCpuFloor: 5,
    /* How far above its own idle baseline a tree may still count as silent. */
    silentBaselineMargin: 1.5,
    /* Bytes read and written together over the whole silent stretch. */
    silentDiskBytes: 1024 * 1024,
    /* Idle by the hooks, and one process above this share of a core... */
    busyCpu: 80,
    /* ...for this long. */
    busyForMs: 60_000,
    memoryBytes: 2 * 1024 ** 3,
    memoryGrowthBytes: 512 * 1024 ** 2,
    memoryGrowthWindowMs: 60_000,
    /* A hook that was sent a moment before the reading may name an agent the reading could not see yet. */
    agentGoneGraceMs: 5000,
    /* Twice the timeout of what the daemon starts: git's network steps, the limit probes and the commit message. */
    hungGitMs: 2 * 120_000,
    hungAgentMs: 2 * 60_000,
    /* How far a series may fall short of a window and still cover it, since readings never land on the millisecond. */
    coverageSlackMs: 2000
} as const;

export type StuckThresholds = { [K in keyof typeof STUCK_THRESHOLDS]: number };

export interface AgentState {
    kind: string;
    status: AgentStatus;
    /* The last hook event, or the last event of a chat. */
    updatedAt: number;
    /* Whether the CLI says goodbye with SessionEnd; without it a clean exit and a crash look the same. */
    reportsEnd: boolean;
}

export interface ObservedProcess {
    identity: string;
    pid: number;
    startTime: number;
    ppid: number;
    name: string;
    ownFamily: string | null;
    readable: boolean;
    /* Percent of one core over the interval, null when it could not be measured. */
    cpu: number | null;
    memory: number | null;
    /* Bytes per second, read and written. */
    disk: number | null;
}

export interface ObservedGroup {
    nodeId: string;
    kind: 'terminal' | 'chat';
    agent: AgentState | null;
    processes: ObservedProcess[];
}

export interface Observation {
    at: number;
    /* The awake time since the observation before; null for the first one. */
    durationMs: number | null;
    groups: ObservedGroup[];
    daemonPid: number;
    /* The daemon and what it started that is not a node. */
    daemon: ObservedProcess[];
    /* The parent of every process alive now, by identity. */
    alive: Map<string, number>;
    /* Processes under launchd whose environment names a session this daemon no longer runs. */
    strays: { process: ObservedProcess; nodeId: string }[];
}

interface NodePoint {
    at: number;
    durationMs: number;
    cpu: number | null;
    disk: number | null;
    spawned: boolean;
}

interface ProcessPoint {
    at: number;
    durationMs: number;
    cpu: number | null;
    memory: number | null;
}

const LAUNCHD_PID = 1;
const IDLE_BASELINE_POINTS = 30;
const AGENT_KINDS = new Set(['claude', 'codex', 'gemini', 'copilot']);

/* The points that cover the last `windowMs`, or null when the series does not reach back that far. */
const covering = <T extends { at: number; durationMs: number }>(points: readonly T[], at: number, windowMs: number, slackMs: number): T[] | null => {
    const start = at - windowMs;
    const inside = points.filter((point) => point.at > start);
    const first = inside[0];
    if (first === undefined || first.at - first.durationMs > start + slackMs) {
        return null;
    }
    return inside;
};

const weighted = (points: readonly { durationMs: number; value: number }[]): number => {
    const total = points.reduce((sum, point) => sum + point.durationMs, 0);
    return total === 0 ? 0 : points.reduce((sum, point) => sum + point.value * point.durationMs, 0) / total;
};

const alertId = (kind: ProcessAlertKind, nodeId: string | null, identity: string | null): string => `${kind}:${nodeId ?? ''}:${identity ?? ''}`;

export class StuckJudge {
    private readonly thresholds: StuckThresholds;
    private readonly nodeSeries = new Map<string, NodePoint[]>();
    private readonly idleSeries = new Map<string, { durationMs: number; value: number }[]>();
    private readonly processSeries = new Map<string, ProcessPoint[]>();
    private readonly members = new Map<string, Map<string, ObservedProcess>>();
    /* What was inside a node that ended, with the moment it was last seen there. */
    private readonly leftBehind = new Map<string, { process: ObservedProcess; nodeId: string; since: number | null }>();
    private readonly memorySince = new Map<string, number>();
    /* A dismissed warning stays quiet until the hook status of its node moves on. */
    private readonly dismissed = new Map<string, number | null>();
    private readonly stamps = new Map<string, number | null>();

    constructor(thresholds: StuckThresholds = STUCK_THRESHOLDS) {
        this.thresholds = thresholds;
    }

    /* After a sleep: the series say nothing about the stretch the machine was away. What a node held still counts. */
    reset(): void {
        this.nodeSeries.clear();
        this.idleSeries.clear();
        this.processSeries.clear();
        this.memorySince.clear();
    }

    dismiss(id: string): void {
        if (this.stamps.has(id)) {
            this.dismissed.set(id, this.stamps.get(id) ?? null);
        }
    }

    observe(observation: Observation): ProcessAlert[] {
        const alerts: { alert: ProcessAlert; stamp: number | null }[] = [];
        const raise = (alert: Omit<ProcessAlert, 'id'>, identity: string | null, stamp: number | null): void => {
            alerts.push({ alert: { id: alertId(alert.kind, alert.nodeId, identity), ...alert }, stamp });
        };

        this.collectLeftBehind(observation);
        for (const group of observation.groups) {
            this.record(observation, group);
            this.judgeGroup(observation, group, raise);
        }
        for (const process of observation.daemon) {
            this.recordProcess(observation, process);
            this.judgeMemory(observation, process, null, raise);
            this.judgeHung(observation, process, raise);
        }
        this.judgeOrphans(observation, raise);
        this.prune(observation);

        this.stamps.clear();
        const visible: ProcessAlert[] = [];
        for (const { alert, stamp } of alerts) {
            this.stamps.set(alert.id, stamp);
            if (this.dismissed.has(alert.id) && this.dismissed.get(alert.id) === stamp) {
                continue;
            }
            this.dismissed.delete(alert.id);
            visible.push(alert);
        }
        for (const id of [...this.dismissed.keys()]) {
            if (!this.stamps.has(id)) {
                this.dismissed.delete(id);
            }
        }
        return visible.sort((a, b) => a.id.localeCompare(b.id));
    }

    private collectLeftBehind(observation: Observation): void {
        const live = new Set(observation.groups.map((group) => group.nodeId));
        for (const [nodeId, processes] of this.members) {
            if (live.has(nodeId)) {
                continue;
            }
            for (const [identity, process] of processes) {
                this.leftBehind.set(identity, { process, nodeId, since: null });
            }
            this.members.delete(nodeId);
        }
    }

    private record(observation: Observation, group: ObservedGroup): void {
        const previous = this.members.get(group.nodeId);
        const spawned = previous !== undefined && group.processes.some((process) => !previous.has(process.identity));
        this.members.set(group.nodeId, new Map(group.processes.map((process) => [process.identity, process])));
        for (const process of group.processes) {
            this.recordProcess(observation, process);
        }
        if (observation.durationMs === null) {
            return;
        }
        const measured = group.processes.every((process) => process.readable && process.cpu !== null && process.disk !== null);
        const point: NodePoint = {
            at: observation.at,
            durationMs: observation.durationMs,
            cpu: measured ? group.processes.reduce((sum, process) => sum + (process.cpu ?? 0), 0) : null,
            disk: measured ? group.processes.reduce((sum, process) => sum + (process.disk ?? 0), 0) : null,
            spawned
        };
        const series = this.nodeSeries.get(group.nodeId) ?? [];
        series.push(point);
        this.nodeSeries.set(group.nodeId, series);
        if (group.agent?.status === 'idle' && point.cpu !== null && !spawned && group.agent.updatedAt <= observation.at - observation.durationMs) {
            const idle = this.idleSeries.get(group.nodeId) ?? [];
            idle.push({ durationMs: point.durationMs, value: point.cpu });
            this.idleSeries.set(group.nodeId, idle.slice(-IDLE_BASELINE_POINTS));
        }
    }

    private recordProcess(observation: Observation, process: ObservedProcess): void {
        if (observation.durationMs === null) {
            return;
        }
        const series = this.processSeries.get(process.identity) ?? [];
        series.push({ at: observation.at, durationMs: observation.durationMs, cpu: process.cpu, memory: process.memory });
        this.processSeries.set(process.identity, series);
    }

    private judgeGroup(
        observation: Observation,
        group: ObservedGroup,
        raise: (alert: Omit<ProcessAlert, 'id'>, identity: string | null, stamp: number | null) => void
    ): void {
        const limits = this.thresholds;
        const { at } = observation;
        const agent = group.agent;
        const stamp = agent?.updatedAt ?? null;
        const agentProcess = agent === null ? undefined : group.processes.find((process) => process.ownFamily === agent.kind);

        if (agent?.status === 'running' && at - agent.updatedAt >= limits.silentAfterMs) {
            const points = covering(this.nodeSeries.get(group.nodeId) ?? [], at, limits.silentAfterMs, limits.coverageSlackMs);
            const complete = points !== null && points.every((point) => point.cpu !== null && point.disk !== null && !point.spawned);
            if (points !== null && complete) {
                const cpu = weighted(points.map((point) => ({ durationMs: point.durationMs, value: point.cpu! })));
                const diskBytes = points.reduce((sum, point) => sum + (point.disk! * point.durationMs) / 1000, 0);
                const idle = this.idleSeries.get(group.nodeId);
                const ceiling = idle && idle.length > 0 ? Math.max(weighted(idle) * limits.silentBaselineMargin, 1) : limits.silentCpuFloor;
                if (cpu <= ceiling && diskBytes <= limits.silentDiskBytes) {
                    const target = agentProcess ?? group.processes[0];
                    raise(
                        {
                            kind: 'silent',
                            nodeId: group.nodeId,
                            pid: target?.pid ?? null,
                            startTime: target?.startTime ?? null,
                            name: target?.name ?? null,
                            since: agent.updatedAt,
                            value: cpu
                        },
                        null,
                        stamp
                    );
                }
            }
        }

        if (agent !== null && (agent.status === 'idle' || agent.status === 'needs-you')) {
            for (const process of group.processes) {
                const points = covering(this.processSeries.get(process.identity) ?? [], at, limits.busyForMs, limits.coverageSlackMs);
                if (points === null || !points.every((point) => point.cpu !== null && point.cpu >= limits.busyCpu)) {
                    continue;
                }
                const start = points[0]!.at - points[0]!.durationMs;
                // The stretch has to lie after the turn ended, or the work of the turn itself counts.
                if (start < agent.updatedAt - limits.coverageSlackMs) {
                    continue;
                }
                const cpu = weighted(points.map((point) => ({ durationMs: point.durationMs, value: point.cpu! })));
                raise(
                    {
                        kind: 'busy-after-turn',
                        nodeId: group.nodeId,
                        pid: process.pid,
                        startTime: process.startTime,
                        name: process.name,
                        since: Math.max(start, agent.updatedAt),
                        value: cpu
                    },
                    process.identity,
                    stamp
                );
            }
        }

        for (const process of group.processes) {
            this.judgeMemory(observation, process, group.nodeId, raise, stamp);
        }

        if (
            group.kind === 'terminal' &&
            agent !== null &&
            agent.reportsEnd &&
            (agent.status === 'running' || agent.status === 'needs-you') &&
            at - agent.updatedAt >= limits.agentGoneGraceMs &&
            group.processes.length > 0 &&
            group.processes.every((process) => process.readable) &&
            agentProcess === undefined
        ) {
            raise({ kind: 'agent-gone', nodeId: group.nodeId, pid: null, startTime: null, name: agent.kind, since: agent.updatedAt, value: null }, null, stamp);
        }
    }

    private judgeMemory(
        observation: Observation,
        process: ObservedProcess,
        nodeId: string | null,
        raise: (alert: Omit<ProcessAlert, 'id'>, identity: string | null, stamp: number | null) => void,
        stamp: number | null = null
    ): void {
        const limits = this.thresholds;
        if (process.memory === null) {
            return;
        }
        const alert = { kind: 'memory' as const, nodeId, pid: process.pid, startTime: process.startTime, name: process.name, value: process.memory };
        if (process.memory >= limits.memoryBytes) {
            const since = this.memorySince.get(process.identity) ?? observation.at;
            this.memorySince.set(process.identity, since);
            raise({ ...alert, since }, process.identity, stamp);
            return;
        }
        this.memorySince.delete(process.identity);
        const earlier = (this.processSeries.get(process.identity) ?? []).find(
            (point) => point.at < observation.at && point.at >= observation.at - limits.memoryGrowthWindowMs && point.memory !== null
        );
        if (earlier !== undefined && process.memory - earlier.memory! >= limits.memoryGrowthBytes) {
            raise({ ...alert, since: earlier.at }, process.identity, stamp);
        }
    }

    private judgeHung(
        observation: Observation,
        process: ObservedProcess,
        raise: (alert: Omit<ProcessAlert, 'id'>, identity: string | null, stamp: number | null) => void
    ): void {
        if (process.pid === observation.daemonPid || process.startTime === 0) {
            return;
        }
        const limits = this.thresholds;
        const limit = process.name === 'git' ? limits.hungGitMs : process.ownFamily !== null && AGENT_KINDS.has(process.ownFamily) ? limits.hungAgentMs : null;
        const age = observation.at - process.startTime / 1000;
        if (limit !== null && age > limit) {
            raise(
                {
                    kind: 'probe-hung',
                    nodeId: null,
                    pid: process.pid,
                    startTime: process.startTime,
                    name: process.name,
                    since: process.startTime / 1000,
                    value: age
                },
                process.identity,
                null
            );
        }
    }

    private judgeOrphans(observation: Observation, raise: (alert: Omit<ProcessAlert, 'id'>, identity: string | null, stamp: number | null) => void): void {
        for (const [identity, entry] of this.leftBehind) {
            const parent = observation.alive.get(identity);
            if (parent === undefined) {
                this.leftBehind.delete(identity);
                continue;
            }
            if (parent !== LAUNCHD_PID) {
                continue;
            }
            entry.since ??= observation.at;
            const { process } = entry;
            raise(
                { kind: 'orphan', nodeId: entry.nodeId, pid: process.pid, startTime: process.startTime, name: process.name, since: entry.since, value: null },
                identity,
                null
            );
        }
        for (const { process, nodeId } of observation.strays) {
            if (this.leftBehind.has(process.identity)) {
                continue;
            }
            raise(
                { kind: 'orphan', nodeId, pid: process.pid, startTime: process.startTime, name: process.name, since: process.startTime / 1000, value: null },
                process.identity,
                null
            );
        }
    }

    private prune(observation: Observation): void {
        const keepMs = Math.max(this.thresholds.silentAfterMs, this.thresholds.busyForMs, this.thresholds.memoryGrowthWindowMs) + 10 * 60_000;
        const horizon = observation.at - keepMs;
        for (const [identity, series] of this.processSeries) {
            const kept = series.filter((point) => point.at > horizon);
            if (!observation.alive.has(identity) || kept.length === 0) {
                this.processSeries.delete(identity);
            } else {
                this.processSeries.set(identity, kept);
            }
        }
        const live = new Set(observation.groups.map((group) => group.nodeId));
        for (const [nodeId, series] of this.nodeSeries) {
            if (!live.has(nodeId)) {
                this.nodeSeries.delete(nodeId);
                this.idleSeries.delete(nodeId);
            } else {
                this.nodeSeries.set(
                    nodeId,
                    series.filter((point) => point.at > horizon)
                );
            }
        }
        for (const identity of this.memorySince.keys()) {
            if (!observation.alive.has(identity)) {
                this.memorySince.delete(identity);
            }
        }
    }
}
