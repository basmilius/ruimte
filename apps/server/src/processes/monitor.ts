import type {
    AgentInfo,
    AgentKind,
    AgentStatus,
    ProcessAlert,
    ProcessMachine,
    ProcessPoint,
    ProcessScope,
    ProcessSort,
    ProcessesSampleEvent,
    ProcessesSignalPayload,
    ProcessesSubscribePayload,
    ProcessesSubscribeResult
} from '@ruimte/contracts';
import type { SessionSink } from '../sessions/manager.ts';
import {
    identityOf,
    machineRate,
    processRates,
    sleptBetween,
    type CommandLine,
    type ProcessRate,
    type ProcessSampler,
    type RawProcess,
    type RawSample
} from './sampler.ts';
import { StuckJudge, type ObservedGroup, type ObservedProcess, type Observation, type StuckThresholds } from './stuck.ts';
import { groupsFor, indexTree, machineDisk, ruimteTotals, type TreeEntry, type TreeIndex } from './tree.ts';

export const FINE_INTERVAL_MS = 2000;
export const COARSE_INTERVAL_MS = 5 * 60_000;
/* Ten minutes at two seconds, a day at five minutes. */
export const FINE_POINTS = 300;
export const COARSE_POINTS = 288;
/* Rows of the rest of the machine per sample in "All"; the other 1,500 stay on the daemon. */
export const OTHER_LIMIT = 50;
/* A moment for a killed tree to reparent or exit before the reading that is meant to see it. */
const NUDGE_DELAY_MS = 300;

type ProcessErrorCode = 'processes-unsupported' | 'process-gone' | 'process-foreign' | 'process-refused';

export class ProcessError extends Error {
    readonly code: ProcessErrorCode;

    constructor(code: ProcessErrorCode, message: string) {
        super(message);
        this.name = 'ProcessError';
        this.code = code;
    }
}

export interface ProcessMonitorOptions {
    sampler: ProcessSampler | null;
    sessions(): { id: string; pid: number; exited: boolean; agent: AgentInfo | null }[];
    chats(): { id: string; pid: number; provider: AgentKind; status: AgentStatus; updatedAt: number }[];
    /* What this daemon's sessions carry as `RUIMTE_CONTEXT_URL`, so a stray of another daemon on the machine is not ours. */
    contextUrl(): string | null;
    reportsEnd(kind: AgentKind): boolean;
    daemonPid?: number;
    uid?: number;
    thresholds?: StuckThresholds;
    signal?: (pid: number, signal: ProcessesSignalPayload['signal']) => void;
}

interface Latest {
    index: TreeIndex;
    rates: Map<string, ProcessRate>;
    machine: ProcessMachine;
    at: number;
}

/*
 * The process table of this machine, for the panel and for the warnings. With a panel open anywhere
 * it reads every two seconds; with none it reads every five minutes, which is enough for the
 * warnings and for a day of coarse history, plus a reading out of rhythm whenever a turn ends, a
 * shell exits or a session is killed. Nothing is written to disk: after a restart the history is empty.
 */
export class ProcessMonitor {
    private readonly options: ProcessMonitorOptions;
    private readonly sampler: ProcessSampler | null;
    private readonly daemonPid: number;
    private readonly uid: number;
    private readonly judge: StuckJudge;
    private readonly sinks = new Map<string, SessionSink>();
    private readonly followers = new Map<string, ProcessesSubscribePayload>();
    private readonly fine: ProcessPoint[] = [];
    private readonly coarse: ProcessPoint[] = [];
    private live: RawSample | null = null;
    private finePrevious: RawSample | null = null;
    private coarsePrevious: RawSample | null = null;
    private latest: Latest | null = null;
    private published: ProcessAlert[] = [];
    // Arguments and environments by identity: read once per process, since neither changes.
    private commandLines = new Map<string, CommandLine | null>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private failureLogged = false;

    constructor(options: ProcessMonitorOptions) {
        this.options = options;
        this.sampler = options.sampler;
        this.daemonPid = options.daemonPid ?? process.pid;
        this.uid = options.uid ?? process.getuid?.() ?? -1;
        this.judge = new StuckJudge(options.thresholds);
    }

    get supported(): boolean {
        return this.sampler !== null;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
            }
            this.unfollow(clientId);
        };
    }

    start(): void {
        this.running = true;
        this.schedule();
    }

    stop(): void {
        this.running = false;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.nudgeTimer !== null) {
            clearTimeout(this.nudgeTimer);
            this.nudgeTimer = null;
        }
    }

    /* A panel opened (or changed its scope or sort): the tempo goes up and the history comes back at once. */
    follow(clientId: string, payload: ProcessesSubscribePayload): ProcessesSubscribeResult {
        const wasIdle = this.followers.size === 0;
        this.followers.set(clientId, payload);
        const base = { fineIntervalMs: FINE_INTERVAL_MS, coarseIntervalMs: COARSE_INTERVAL_MS };
        if (this.sampler === null) {
            return { supported: false, ...base, fine: [], coarse: [], sample: null };
        }
        if (wasIdle || this.latest === null) {
            // Seeds the fine series, so the first point two seconds from now has a rate.
            this.sampleNow(true);
            this.schedule();
        }
        return {
            supported: true,
            ...base,
            fine: [...this.fine],
            coarse: [...this.coarse],
            sample: this.latest === null ? null : this.sampleFor(this.latest, payload.scope, payload.sort, null, null, false)
        };
    }

    unfollow(clientId: string): void {
        if (!this.followers.delete(clientId) || this.followers.size > 0) {
            return;
        }
        // The fine series keeps what it has, but its next point must not average over the closed stretch.
        this.finePrevious = null;
        this.schedule();
    }

    alerts(): ProcessAlert[] {
        return this.published;
    }

    dismiss(id: string): void {
        this.judge.dismiss(id);
        if (this.published.some((alert) => alert.id === id)) {
            this.publish(this.published.filter((alert) => alert.id !== id));
        }
    }

    isAgentGone(sessionId: string): boolean {
        return this.published.some((alert) => alert.kind === 'agent-gone' && alert.nodeId === sessionId);
    }

    /* A reading soon, out of rhythm, after something changed a tree. Several in a row fold into one. */
    nudge(): void {
        if (this.sampler === null || !this.running || this.nudgeTimer !== null) {
            return;
        }
        this.nudgeTimer = setTimeout(() => {
            this.nudgeTimer = null;
            this.sampleNow(false);
        }, NUDGE_DELAY_MS);
    }

    /* Right before a session is killed: this reading is the last one that sees what was inside it. */
    beforeKill(): void {
        if (this.running) {
            this.sampleNow(false);
        }
    }

    signal(payload: ProcessesSignalPayload): void {
        if (this.sampler === null) {
            throw new ProcessError('processes-unsupported', 'This machine does not support process monitoring');
        }
        if (payload.pid <= 1 || payload.pid === this.daemonPid) {
            throw new ProcessError('process-refused', 'Ruimte does not send signals to itself or to system processes');
        }
        const found = this.sampler.inspect(payload.pid);
        if (found === null || found.startTime !== payload.startTime) {
            throw new ProcessError('process-gone', 'That process has ended');
        }
        if (found.uid !== this.uid) {
            throw new ProcessError('process-foreign', 'That process belongs to another user');
        }
        try {
            (this.options.signal ?? ((pid, signal) => process.kill(pid, signal)))(payload.pid, payload.signal);
        } catch {
            throw new ProcessError('process-gone', 'That process has ended');
        }
        this.nudge();
    }

    /* One reading. `onRhythm` is a tick of the timer; a nudge reads out of rhythm and adds no fine point. */
    sampleNow(onRhythm: boolean): void {
        if (this.sampler === null) {
            return;
        }
        let raw: RawSample;
        try {
            raw = this.sampler.sample();
        } catch (e) {
            if (!this.failureLogged) {
                this.failureLogged = true;
                console.error('Reading the process table failed', e);
            }
            return;
        }
        let reset = false;
        if (this.live !== null && sleptBetween(this.live, raw)) {
            // Rates across a sleep are fiction, and the series would draw a line through the night.
            reset = true;
            this.fine.length = 0;
            this.coarse.length = 0;
            this.live = null;
            this.finePrevious = null;
            this.coarsePrevious = null;
            this.judge.reset();
        }

        const sessions = this.options.sessions().filter((session) => !session.exited);
        const chats = this.options.chats();
        const lines = new Map<string, CommandLine | null>();
        const commandLineOf = (process: RawProcess): CommandLine | null => {
            const identity = identityOf(process.pid, process.startTime);
            let line = lines.get(identity) ?? this.commandLines.get(identity);
            if (line === undefined) {
                line = process.uid === this.uid && process.startTime !== 0 ? this.sampler!.commandLine(process.pid) : null;
            }
            lines.set(identity, line);
            return line;
        };
        const rates = processRates(this.live, raw);
        const index = indexTree(raw, { daemonPid: this.daemonPid, sessions, chats }, (process) => commandLineOf(process)?.args ?? null);
        const disk = machineDisk(rates);
        const machine: ProcessMachine = {
            cores: raw.machine.cores,
            cpu: machineRate(this.live, raw).cpu,
            memoryUsed: raw.machine.memoryUsed,
            memoryTotal: raw.machine.memoryTotal,
            diskRead: disk.read,
            diskWrite: disk.write,
            diskFree: raw.machine.diskFree,
            diskTotal: raw.machine.diskTotal
        };

        let finePoint: ProcessPoint | null = null;
        if (onRhythm && this.followers.size > 0) {
            if (this.finePrevious !== null && raw.awakeMs - this.finePrevious.awakeMs <= FINE_INTERVAL_MS * 3) {
                finePoint = this.pointOf(this.finePrevious, raw, index, this.finePrevious === this.live ? rates : null);
                this.fine.push(finePoint);
                this.fine.splice(0, Math.max(0, this.fine.length - FINE_POINTS));
            }
            this.finePrevious = raw;
        }
        let coarsePoint: ProcessPoint | null = null;
        if (this.coarsePrevious === null) {
            this.coarsePrevious = raw;
        } else if (raw.at - this.coarsePrevious.at >= COARSE_INTERVAL_MS - FINE_INTERVAL_MS / 2) {
            coarsePoint = this.pointOf(this.coarsePrevious, raw, index, this.coarsePrevious === this.live ? rates : null);
            this.coarse.push(coarsePoint);
            this.coarse.splice(0, Math.max(0, this.coarse.length - COARSE_POINTS));
            this.coarsePrevious = raw;
        }

        const durationMs = this.live === null ? null : raw.awakeMs - this.live.awakeMs;
        this.live = raw;
        const latest: Latest = { index, rates, machine, at: raw.at };
        this.latest = latest;

        const live = new Set(sessions.map((session) => session.id));
        const contextUrl = this.options.contextUrl();
        const strays: Observation['strays'] = [];
        for (const process of raw.processes) {
            if (process.ppid !== 1 || process.uid !== this.uid || contextUrl === null) {
                continue;
            }
            const env = commandLineOf(process)?.env;
            const sessionId = env?.RUIMTE_SESSION_ID;
            if (sessionId !== undefined && env?.RUIMTE_CONTEXT_URL === contextUrl && !live.has(sessionId)) {
                strays.push({ process: this.observed(latest, { process, identity: identityOf(process.pid, process.startTime), depth: 0 }), nodeId: sessionId });
            }
        }
        this.commandLines = lines;

        const sessionsById = new Map(sessions.map((session) => [session.id, session]));
        const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
        const observation: Observation = {
            at: raw.at,
            durationMs,
            daemonPid: this.daemonPid,
            groups: index.groups.flatMap((group): ObservedGroup[] => {
                if ((group.kind !== 'terminal' && group.kind !== 'chat') || group.nodeId === null) {
                    return [];
                }
                const processes = group.entries.map((entry) => this.observed(latest, entry));
                if (group.kind === 'terminal') {
                    const agent = sessionsById.get(group.nodeId)?.agent;
                    const state =
                        agent && agent.live
                            ? { kind: agent.kind, status: agent.status, updatedAt: agent.updatedAt, reportsEnd: this.options.reportsEnd(agent.kind) }
                            : null;
                    return [{ nodeId: group.nodeId, kind: 'terminal', agent: state, processes }];
                }
                const chat = chatsById.get(group.nodeId);
                const state = chat ? { kind: chat.provider, status: chat.status, updatedAt: chat.updatedAt, reportsEnd: false } : null;
                return [{ nodeId: group.nodeId, kind: 'chat', agent: state, processes }];
            }),
            daemon: (index.groups.find((group) => group.kind === 'daemon')?.entries ?? []).map((entry) => this.observed(latest, entry)),
            alive: new Map(raw.processes.map((process) => [identityOf(process.pid, process.startTime), process.ppid])),
            strays
        };
        this.publish(this.judge.observe(observation));

        const built = new Map<string, ProcessesSampleEvent>();
        for (const [clientId, follower] of this.followers) {
            const key = `${follower.scope}:${follower.sort}`;
            let event = built.get(key);
            if (event === undefined) {
                event = this.sampleFor(latest, follower.scope, follower.sort, finePoint, coarsePoint, reset);
                built.set(key, event);
            }
            this.sinks.get(clientId)?.({ event: 'processes.sample', payload: event });
        }
    }

    private observed(latest: Latest, entry: TreeEntry): ObservedProcess {
        const rate = latest.rates.get(entry.identity);
        const { process } = entry;
        return {
            identity: entry.identity,
            pid: process.pid,
            startTime: process.startTime,
            ppid: process.ppid,
            name: process.name,
            ownFamily: latest.index.ownFamily.get(entry.identity) ?? null,
            readable: process.readable,
            cpu: rate?.cpu ?? null,
            memory: rate?.memory ?? null,
            disk: rate === undefined || (rate.diskRead === null && rate.diskWrite === null) ? null : (rate.diskRead ?? 0) + (rate.diskWrite ?? 0)
        };
    }

    private pointOf(before: RawSample, after: RawSample, index: TreeIndex, known: Map<string, ProcessRate> | null): ProcessPoint {
        const rates = known ?? processRates(before, after);
        const ruimte = ruimteTotals(index, rates);
        const disk = machineDisk(rates);
        const cores = after.machine.cores;
        return {
            at: after.at,
            cpu: machineRate(before, after).cpu,
            cpuRuimte: ruimte.cpu === null ? null : ruimte.cpu / cores,
            memory: after.machine.memoryUsed,
            memoryRuimte: ruimte.memory,
            disk: disk.read === null && disk.write === null ? null : (disk.read ?? 0) + (disk.write ?? 0),
            diskRuimte: ruimte.disk
        };
    }

    private sampleFor(
        latest: Latest,
        scope: ProcessScope,
        sort: ProcessSort,
        fine: ProcessPoint | null,
        coarse: ProcessPoint | null,
        reset: boolean
    ): ProcessesSampleEvent {
        return { at: latest.at, scope, machine: latest.machine, groups: groupsFor(latest.index, latest.rates, scope, sort, OTHER_LIMIT), fine, coarse, reset };
    }

    private publish(alerts: ProcessAlert[]): void {
        const before = this.published;
        this.published = alerts;
        if (JSON.stringify(before) === JSON.stringify(alerts)) {
            return;
        }
        const fresh = alerts.filter((alert) => alert.kind === 'probe-hung' && !before.some((old) => old.id === alert.id));
        for (const alert of fresh) {
            // A probe that hangs is a bug in Ruimte itself, so it belongs in the log as well as on screen.
            console.warn(`Process ${alert.pid} (${alert.name}) started by the daemon has run for ${Math.round((alert.value ?? 0) / 1000)} s`);
        }
        for (const sink of this.sinks.values()) {
            sink({ event: 'processes.alerts', payload: { alerts } });
        }
    }

    private schedule(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.sampler === null || !this.running) {
            return;
        }
        const delay =
            this.followers.size > 0
                ? FINE_INTERVAL_MS
                : this.coarsePrevious === null
                  ? 1000
                  : Math.max(1000, this.coarsePrevious.at + COARSE_INTERVAL_MS - Date.now());
        this.timer = setTimeout(() => {
            this.timer = null;
            this.sampleNow(true);
            this.schedule();
        }, delay);
    }
}
