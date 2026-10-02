import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import type { LaunchConfigKind, LaunchHeld, LaunchStartResult, LaunchState, LaunchStatus } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { LaunchError, type LaunchStore, type ResolvedLaunch } from './store.ts';

// How long a stop waits after the interrupt before it sends SIGTERM.
export const STOP_GRACE_MS = 5_000;
// How often a service that has not answered yet is asked again.
export const PROBE_INTERVAL_MS = 500;
// How long a restart, or a start that replaces another launch, waits for what it stops.
export const STOP_WAIT_MS = 10_000;

/* The sessions a launch runs in: `SessionManager`, with the signals a stop needs. */
export interface LaunchSessions {
    create(options: { sessionId: string; cwd: string; exec: string; env: Record<string, string> }): Promise<void>;
    /* Ctrl+C, typed into the terminal, so it reaches whatever holds its foreground. */
    interrupt(sessionId: string): void;
    signal(sessionId: string, signal: 'SIGTERM' | 'SIGKILL'): Promise<void>;
    /* Ends the session if it runs and forgets it with its screen. */
    remove(sessionId: string): Promise<void>;
    observeExit(listener: (sessionId: string, exitCode: number) => void): () => void;
}

export interface LaunchClock {
    now(): number;
    set(run: () => void, ms: number): () => void;
}

export const realClock: LaunchClock = {
    now: () => Date.now(),
    set: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    }
};

/* Whether something takes a connection on this port. */
export type LaunchProbe = (host: string, port: number) => Promise<boolean>;

// A server that binds 0.0.0.0 or only one of the two loopbacks answers on one of these.
const LOOPBACKS = ['127.0.0.1', '::1'];

const connects = (host: string, port: number): Promise<boolean> =>
    new Promise((resolve) => {
        const socket = connect({ host, port, timeout: 1_000 });
        const done = (open: boolean): void => {
            socket.destroy();
            resolve(open);
        };
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });

export const tcpProbe: LaunchProbe = async (host, port) => {
    const hosts = ['localhost', '0.0.0.0', '127.0.0.1', '::1', '[::1]'].includes(host) ? LOOPBACKS : [host];
    const answers = await Promise.all(hosts.map((candidate) => connects(candidate, port)));
    return answers.includes(true);
};

/* Who asked, which decides what a start may approve and what a stop may do. */
export type LaunchActor = 'person' | 'agent';

export interface LaunchStartOptions {
    actor: LaunchActor;
    approve?: boolean;
    replace?: boolean;
}

interface Run {
    projectId: string;
    launchId: string;
    name: string;
    sessionId: string;
    kind: LaunchConfigKind;
    state: LaunchState;
    exitCode: number | null;
    startedAt: number;
    endedAt: number | null;
    port: number | null;
    url: string | null;
    host: string | null;
    stopped: boolean;
    exited: Promise<void>;
    markExited: () => void;
    cancelProbe: (() => void) | null;
    cancelTerm: (() => void) | null;
}

/* The same id for the same launch of the same project, so a client finds its output again after a reload. */
export const launchSessionIdOf = (projectId: string, launchId: string): string =>
    `launch-${createHash('sha256')
        .update(JSON.stringify([projectId, launchId]))
        .digest('hex')
        .slice(0, 20)}`;

const hostOf = (url: string | null): string | null => {
    if (url === null) {
        return null;
    }
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
};

const isLive = (run: Run): boolean => run.state === 'starting' || run.state === 'running';

/*
 * Runs a project's launches, one session each. The daemon only watches what it started: a launch
 * that exits stays exited, and nothing starts again on a clock.
 */
export class LaunchRunner {
    private readonly store: LaunchStore;
    private readonly sessions: LaunchSessions;
    private readonly checkCwd: (folder: string, cwd: string) => Promise<unknown>;
    private readonly clock: LaunchClock;
    private readonly probe: LaunchProbe;
    private readonly sinks = new ClientSinks();
    private readonly runs = new Map<string, Run>();
    // The projects whose autostart already ran since they were opened, so a second client opening one starts nothing.
    private readonly autostarted = new Set<string>();
    private readonly stopExit: () => void;

    constructor(options: {
        store: LaunchStore;
        sessions: LaunchSessions;
        checkCwd: (folder: string, cwd: string) => Promise<unknown>;
        clock?: LaunchClock;
        probe?: LaunchProbe;
    }) {
        this.store = options.store;
        this.sessions = options.sessions;
        this.checkCwd = options.checkCwd;
        this.clock = options.clock ?? realClock;
        this.probe = options.probe ?? tcpProbe;
        this.stopExit = this.sessions.observeExit((sessionId, exitCode) => this.exited(sessionId, exitCode));
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    list(): LaunchStatus[] {
        return [...this.runs.values()].map(statusOf);
    }

    /* The name to show for a session no node stands for, in Processes. */
    labelOf(sessionId: string): string | null {
        return this.runs.get(sessionId)?.name ?? null;
    }

    /* The session a launch last ran in, for an agent that reads its screen. */
    sessionOf(projectId: string, launchId: string): string | null {
        const sessionId = launchSessionIdOf(projectId, launchId);
        return this.runs.has(sessionId) ? sessionId : null;
    }

    async start(projectId: string, launchId: string, options: LaunchStartOptions): Promise<LaunchStartResult> {
        return this.run(projectId, launchId, options, false);
    }

    /* Stops what runs of the launch and starts it again; a launch that did not run just starts. */
    async restart(projectId: string, launchId: string, options: LaunchStartOptions): Promise<LaunchStartResult> {
        return this.run(projectId, launchId, options, true);
    }

    /*
     * Stops a launch, or every launch of a group, and says how many ran; `launch.status` tells when
     * they are gone. Force is a person's SIGKILL; anyone else gets Ctrl+C and, after the grace
     * period, SIGTERM.
     */
    async stop(projectId: string, launchId: string, options: { force?: boolean } = {}): Promise<number> {
        const members = await this.membersOf(projectId, launchId);
        const running = members.flatMap((member) => {
            const run = this.runs.get(launchSessionIdOf(projectId, member.launch.id));
            return run && run.state !== 'exited' ? [run] : [];
        });
        for (const run of running) {
            void this.stopRun(run, options.force === true);
        }
        return running.length;
    }

    /* A client put the project on screen: the approved launches that start with it do, once per opening. */
    async opened(projectId: string): Promise<void> {
        if (this.autostarted.has(projectId)) {
            return;
        }
        this.autostarted.add(projectId);
        let launches: ResolvedLaunch[];
        try {
            launches = await this.store.resolveAll(projectId);
        } catch (e) {
            console.error(`Reading the launches of ${projectId} failed:`, errorText(e));
            return;
        }
        for (const resolved of launches.filter((candidate) => candidate.launch.autostart === true)) {
            try {
                // As an agent's start would: nothing is approved on the way, and a held launch stays put.
                await this.start(projectId, resolved.launch.id, { actor: 'agent' });
            } catch (e) {
                console.error(`Starting ${resolved.launch.name} with its project failed:`, errorText(e));
            }
        }
    }

    /* How many launches of a project run now, for the confirmation before closing it. */
    running(projectId: string): number {
        return [...this.runs.values()].filter((run) => run.projectId === projectId && run.state !== 'exited').length;
    }

    /* The last client closed the project: its launches end with its sessions. */
    async end(projectId: string): Promise<number> {
        this.autostarted.delete(projectId);
        const runs = [...this.runs.values()].filter((run) => run.projectId === projectId);
        const ended = runs.filter((run) => run.state !== 'exited').length;
        for (const run of runs) {
            this.runs.delete(run.sessionId);
            this.settle(run);
            await this.sessions.remove(run.sessionId).catch(() => undefined);
        }
        this.store.closeProject(projectId);
        return ended;
    }

    close(): void {
        this.stopExit();
        for (const run of this.runs.values()) {
            this.settle(run);
        }
    }

    private async run(projectId: string, launchId: string, options: LaunchStartOptions, restart: boolean): Promise<LaunchStartResult> {
        const members = await this.membersOf(projectId, launchId);
        for (const member of members) {
            await this.checkCwd(member.folder, member.cwd);
        }
        const unapproved = members.filter((member) => !member.approved);
        if (unapproved.length > 0) {
            // Only a person's yes counts; an agent or the project opening gets the question back for the chip to ask.
            if (options.actor !== 'person' || options.approve !== true) {
                return { outcome: 'held', held: unapproved.map(heldOf) };
            }
            await this.store.approve(
                projectId,
                unapproved.map((member) => member.launch.id)
            );
        }

        const own = new Set(members.map((member) => launchSessionIdOf(projectId, member.launch.id)));
        const leaving = new Map<string, Run>();
        for (const member of members) {
            const holder =
                member.port === null
                    ? undefined
                    : [...this.runs.values()].find((run) => run.port === member.port && run.state !== 'exited' && !own.has(run.sessionId));
            if (holder) {
                if (options.replace !== true) {
                    return { outcome: 'busy', busy: { projectId: holder.projectId, launchId: holder.launchId, port: member.port! } };
                }
                leaving.set(holder.sessionId, holder);
            }
        }
        const starting: ResolvedLaunch[] = [];
        for (const member of members) {
            const previous = this.runs.get(launchSessionIdOf(projectId, member.launch.id));
            if (previous && isLive(previous) && !restart) {
                continue;
            }
            if (previous && previous.state !== 'exited') {
                leaving.set(previous.sessionId, previous);
            }
            starting.push(member);
        }
        await this.stopAll([...leaving.values()]);
        for (const member of starting) {
            await this.spawn(member);
        }
        return { outcome: 'started' };
    }

    /* Stops what a start has to replace and waits until it is gone, but not for ever: one that ignores SIGTERM needs a person's Force stop. */
    private async stopAll(runs: Run[]): Promise<void> {
        if (runs.length === 0) {
            return;
        }
        let cancel = (): void => undefined;
        const deadline = new Promise<void>((resolve) => {
            cancel = this.clock.set(resolve, STOP_WAIT_MS);
        });
        await Promise.race([Promise.all(runs.map((run) => this.stopRun(run, false))), deadline]);
        cancel();
        const still = runs.find((run) => run.state !== 'exited');
        if (still) {
            throw new LaunchError('launch-stuck', `${still.name} did not stop within ${STOP_WAIT_MS / 1_000} seconds; Force stop ends it`);
        }
    }

    private async membersOf(projectId: string, launchId: string): Promise<ResolvedLaunch[]> {
        const launch = await this.store.resolve(projectId, launchId);
        if (launch.launch.kind !== 'group') {
            return [launch];
        }
        const all = await this.store.resolveAll(projectId);
        return (launch.launch.launches ?? []).map((id) => all.find((candidate) => candidate.launch.id === id)).filter((member) => member !== undefined);
    }

    private async spawn(resolved: ResolvedLaunch): Promise<void> {
        const sessionId = launchSessionIdOf(resolved.projectId, resolved.launch.id);
        let markExited = (): void => undefined;
        const exited = new Promise<void>((resolve) => {
            markExited = resolve;
        });
        const run: Run = {
            projectId: resolved.projectId,
            launchId: resolved.launch.id,
            name: resolved.launch.name,
            sessionId,
            kind: resolved.launch.kind,
            state: resolved.port === null ? 'running' : 'starting',
            exitCode: null,
            startedAt: this.clock.now(),
            endedAt: null,
            port: resolved.port,
            url: resolved.url,
            host: hostOf(resolved.url),
            stopped: false,
            exited,
            markExited,
            cancelProbe: null,
            cancelTerm: null
        };
        // In the map before the shell exists, since a command that is not found exits at once.
        this.runs.set(sessionId, run);
        try {
            await this.sessions.create({ sessionId, cwd: resolved.cwd, exec: resolved.command, env: resolved.env });
        } catch (e) {
            this.runs.delete(sessionId);
            markExited();
            throw e;
        }
        this.emit(run);
        if (run.state === 'starting') {
            void this.probeRun(run);
        }
    }

    private async probeRun(run: Run): Promise<void> {
        run.cancelProbe = null;
        if (run.state !== 'starting' || this.runs.get(run.sessionId) !== run) {
            return;
        }
        const open = await this.probe(run.host ?? 'localhost', run.port!).catch(() => false);
        if (run.state !== 'starting' || this.runs.get(run.sessionId) !== run) {
            return;
        }
        if (open) {
            run.state = 'running';
            this.emit(run);
            return;
        }
        run.cancelProbe = this.clock.set(() => void this.probeRun(run), PROBE_INTERVAL_MS);
    }

    private stopRun(run: Run, force: boolean): Promise<void> {
        if (run.state === 'exited') {
            return run.exited;
        }
        run.stopped = true;
        if (force) {
            run.cancelTerm?.();
            run.cancelTerm = null;
            void this.sessions.signal(run.sessionId, 'SIGKILL');
        } else if (run.state !== 'stopping') {
            this.sessions.interrupt(run.sessionId);
            run.cancelTerm = this.clock.set(() => {
                run.cancelTerm = null;
                void this.sessions.signal(run.sessionId, 'SIGTERM');
            }, STOP_GRACE_MS);
        }
        if (run.state !== 'stopping') {
            run.cancelProbe?.();
            run.cancelProbe = null;
            run.state = 'stopping';
            this.emit(run);
        }
        return run.exited;
    }

    private exited(sessionId: string, exitCode: number): void {
        const run = this.runs.get(sessionId);
        if (!run || run.state === 'exited') {
            return;
        }
        run.state = 'exited';
        run.exitCode = exitCode;
        run.endedAt = this.clock.now();
        this.settle(run);
        this.emit(run);
    }

    private settle(run: Run): void {
        run.cancelProbe?.();
        run.cancelProbe = null;
        run.cancelTerm?.();
        run.cancelTerm = null;
        run.markExited();
    }

    private emit(run: Run): void {
        this.sinks.emit({ event: 'launch.status', payload: statusOf(run) });
    }
}

const statusOf = (run: Run): LaunchStatus => ({
    projectId: run.projectId,
    launchId: run.launchId,
    sessionId: run.sessionId,
    kind: run.kind,
    state: run.state,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    port: run.port,
    url: run.url,
    stopped: run.stopped
});

const heldOf = (resolved: ResolvedLaunch): LaunchHeld => ({
    launchId: resolved.launch.id,
    command: resolved.command,
    cwd: resolved.cwd,
    ...(Object.keys(resolved.env).length > 0 ? { env: resolved.env } : {})
});
