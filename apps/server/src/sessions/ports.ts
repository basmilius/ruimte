import { SESSION_PORT_VERIFY_MAX_AGE_MS, type SessionPort, type SessionPortsResult, type SessionPortVerification } from '@ruimte/contracts';
import { RequestError } from '../dispatcher.ts';
import type { ListenerProbe, TcpListener } from '../processes/listeners.ts';
import type { ProcessSampler, RawProcess } from '../processes/sampler.ts';

export interface PortSession {
    id: string;
    pid: number;
}

interface Options {
    sampler: ProcessSampler | null;
    probe: ListenerProbe | null;
    sessions(): PortSession[];
    current(id: string): PortSession | undefined;
    uid: number;
    machineId: string;
    now?: () => number;
}

type Owner = { startTime: number; uid: number };
const UNKNOWN: SessionPortsResult = { status: 'unknown' };
const INTERVAL_MS = 5000;
const VERIFY_INTERVAL_MS = 1000;
const MAX_TREE_PROCESSES = 2048;
const MAX_SESSIONS = 128;
const MAX_PORTS = 128;

export function sessionTree(
    table: readonly RawProcess[],
    root: PortSession,
    owner: Owner,
    otherRoots: ReadonlySet<number> = new Set()
): Map<number, RawProcess> {
    const byPid = new Map(table.map((entry) => [entry.pid, entry]));
    const process = byPid.get(root.pid);
    if (!process || process.startTime !== owner.startTime || process.uid !== owner.uid) {
        throw new Error('Session process identity changed');
    }
    const children = new Map<number, RawProcess[]>();
    for (const entry of table) {
        const siblings = children.get(entry.ppid) ?? [];
        siblings.push(entry);
        children.set(entry.ppid, siblings);
    }
    const found = new Map<number, RawProcess>();
    const pending = [process];
    while (pending.length > 0) {
        const entry = pending.pop()!;
        if (found.has(entry.pid) || found.size >= MAX_TREE_PROCESSES || entry.startTime <= 0 || entry.uid !== owner.uid) {
            throw new Error('Session tree cannot be verified');
        }
        found.set(entry.pid, entry);
        pending.push(...(children.get(entry.pid) ?? []).filter((child) => !otherRoots.has(child.pid)));
    }
    return found;
}

export class SessionPorts {
    private readonly options: Options;
    private readonly owners = new WeakMap<PortSession, Owner | null>();
    private readonly cache = new Map<PortSession, SessionPortsResult>();
    private pending: Promise<void> | null = null;
    private controller: AbortController | null = null;
    private scannedAt = -Infinity;
    private verifiedAt = -Infinity;

    constructor(options: Options) {
        this.options = options;
    }

    // Pin at spawn, never on first discovery: a recycled PID cannot become this session's root.
    track(session: PortSession): void {
        let owner: Owner | null = null;
        try {
            owner = this.options.sampler?.inspect(session.pid) ?? null;
        } catch {
            owner = null;
        }
        this.owners.set(session, owner?.uid === this.options.uid && owner.startTime > 0 ? owner : null);
    }

    forget(session: PortSession): void {
        this.owners.delete(session);
        this.cache.delete(session);
        if (!this.options.sessions().some((entry) => entry !== session)) {
            this.controller?.abort();
        }
    }

    stop(): void {
        this.controller?.abort();
        this.cache.clear();
    }

    async list(id: string): Promise<SessionPortsResult> {
        const session = this.options.current(id);
        if (!session) {
            return { status: 'closed' };
        }
        if (!this.options.probe) {
            return { status: 'unavailable' };
        }
        if (!this.options.sampler) {
            return UNKNOWN;
        }
        const now = this.now();
        if (this.pending) {
            await this.pending;
        } else if (now - this.scannedAt >= INTERVAL_MS) {
            const pending = this.scan();
            this.pending = pending;
            try {
                await pending;
            } finally {
                this.pending = null;
                this.scannedAt = this.now();
            }
        }
        return this.options.current(id) === session ? (this.cache.get(session) ?? UNKNOWN) : { status: 'closed' };
    }

    async verify(id: string, listener: SessionPort): Promise<SessionPortVerification> {
        const session = this.options.current(id);
        const now = this.now();
        if (!session) {
            throw new RequestError('session-port-closed', 'This session has ended');
        }
        // Verification always reads afresh, with one global scan and no unbounded queue of clicks.
        if (this.pending || now - this.verifiedAt < VERIFY_INTERVAL_MS) {
            throw new RequestError('session-port-busy', 'Port verification is busy. Try again');
        }
        this.verifiedAt = now;
        const pending = this.scan({ session, port: listener.port });
        this.pending = pending;
        try {
            await pending;
        } finally {
            this.pending = null;
        }
        const result = this.cache.get(session);
        if (
            !listener.bindAddress ||
            this.options.current(id) !== session ||
            result?.status !== 'ready' ||
            !result.ports.some((entry) => sameListener(entry, listener))
        ) {
            throw new RequestError('session-port-unverified', 'This listener could not be verified for this session');
        }
        return { url: `http://${listener.host}:${listener.port}/`, machineId: this.options.machineId, validForMs: SESSION_PORT_VERIFY_MAX_AGE_MS };
    }

    private async scan(target?: { session: PortSession; port: number }): Promise<void> {
        const { sampler, probe } = this.options;
        this.dropCached(target);
        if (!sampler || !probe) {
            return;
        }
        const allSessions = this.options.sessions();
        const sessions = target ? [target.session] : allSessions;
        if (sessions.length === 0 || allSessions.length > MAX_SESSIONS) {
            return;
        }
        const controller = new AbortController();
        this.controller = controller;
        try {
            const before = sampler.sample().processes;
            const trees = new Map<PortSession, Map<number, RawProcess>>();
            const roots = new Set(allSessions.map((session) => session.pid));
            for (const session of sessions) {
                const owner = this.owners.get(session);
                if (owner) {
                    try {
                        trees.set(session, sessionTree(before, session, owner, roots));
                    } catch {
                        this.cache.set(session, UNKNOWN);
                    }
                }
            }
            const pids = [...new Set([...trees.values()].flatMap((tree) => [...tree.keys()]))];
            if (pids.length === 0) {
                return;
            }
            const listeners = await probe.read(pids, controller.signal, target?.port);
            const after = sampler.sample().processes;
            for (const [session, tree] of trees) {
                const owner = this.owners.get(session);
                if (controller.signal.aborted || this.options.current(session.id) !== session || !owner) {
                    continue;
                }
                try {
                    const ports = portsOf(sampler, listeners, tree, sessionTree(after, session, owner, roots), owner);
                    this.cache.set(session, { status: 'ready', ports });
                } catch {
                    this.cache.set(session, UNKNOWN);
                }
            }
        } catch {
            this.dropCached(target);
        } finally {
            if (this.controller === controller) {
                this.controller = null;
            }
        }
    }

    private dropCached(target: { session: PortSession } | undefined): void {
        if (target) {
            this.cache.delete(target.session);
        } else {
            this.cache.clear();
        }
    }

    private now(): number {
        return (this.options.now ?? Date.now)();
    }
}

/*
 * The loopback listeners of one session tree, read between two readings of the table. Throws when
 * another process could take the same destination or an owner changed in between.
 */
function portsOf(
    sampler: ProcessSampler,
    listeners: readonly TcpListener[],
    before: Map<number, RawProcess>,
    after: Map<number, RawProcess>,
    owner: Owner
): SessionPort[] {
    const ports: SessionPort[] = [];
    for (const listener of listeners) {
        const process = before.get(listener.pid);
        if (!process || !isLoopbackBinding(listener)) {
            continue;
        }
        if (listeners.some((other) => other.pid !== listener.pid && competesForDestination(listener, other))) {
            throw new Error('Another process can receive this listener destination');
        }
        const fresh = after.get(listener.pid);
        const identity = sampler.inspect(listener.pid);
        if (!fresh || fresh.startTime !== process.startTime || identity?.startTime !== process.startTime || identity.uid !== owner.uid) {
            throw new Error('Listener owner changed during discovery');
        }
        const port = { ...listener, startTime: process.startTime };
        if (!ports.some((entry) => sameListener(entry, port))) {
            ports.push(port);
        }
    }
    if (ports.length > MAX_PORTS) {
        throw new Error('Too many session listeners');
    }
    return ports.sort((one, other) => one.port - other.port || one.pid - other.pid);
}

function sameListener(one: SessionPort, other: SessionPort): boolean {
    return (
        one.pid === other.pid &&
        one.startTime === other.startTime &&
        one.host === other.host &&
        one.port === other.port &&
        one.bindAddress === other.bindAddress
    );
}

function isLoopbackBinding(listener: TcpListener): boolean {
    return ['*', '0.0.0.0', '[::]', listener.host].includes(listener.bindAddress);
}

function competesForDestination(target: TcpListener, other: TcpListener): boolean {
    if (target.port !== other.port) {
        return false;
    }
    // An IPv6 wildcard may accept IPv4 too; lsof cannot prove IPV6_V6ONLY, so refuse ambiguity.
    return (
        other.bindAddress === '*' ||
        other.bindAddress === '[::]' ||
        other.bindAddress === '0.0.0.0' ||
        other.bindAddress === target.host ||
        (target.host === '127.0.0.1' && /^\[::ffff:(127\.0\.0\.1|7f00:1)\]$/i.test(other.bindAddress))
    );
}
