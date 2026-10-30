import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInfo } from '@ruimte/contracts';
import { AgentStore } from '../agents/agent-store.ts';
import { FakePtyAdapter } from '../pty/fake-pty.ts';
import { SessionManager, type SessionEvent, type SessionManagerOptions, type SessionSink } from './manager.ts';
import { SnapshotStore } from './snapshot-store.ts';

const DEFAULT_TIMEOUT_MS = 5000;

// Polls instead of sleeping: a shell answers in milliseconds on a quiet machine and in
// hundreds under CI load, and a fixed sleep is wrong on one of them.
// For a real shell in a test: Git Bash on Windows, which has no `/bin/sh`, and the PATH that finds its tools.
export const testShell = process.platform === 'win32' ? (Bun.which('bash') ?? 'bash') : '/bin/sh';
export const testPath = process.platform === 'win32' ? (process.env.PATH ?? '') : '/usr/bin:/bin';

export async function waitForAsync(check: () => Promise<boolean>, what: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

export function waitFor(check: () => boolean, what: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
    return waitForAsync(async () => check(), what, timeoutMs);
}

export class Recorder {
    readonly events: SessionEvent[] = [];

    get output(): string {
        return this.events
            .filter((event) => event.event === 'session.output')
            .map((event) => event.payload.data)
            .join('');
    }

    statusesOf(sessionId: string): Array<string | null> {
        return this.events
            .filter((event) => event.event === 'session.status' && event.payload.sessionId === sessionId)
            .map((event) => (event.event === 'session.status' ? (event.payload.agent?.status ?? null) : null));
    }

    resyncOf(sessionId: string): string | undefined {
        for (const event of this.events) {
            if (event.event === 'session.resync' && event.payload.sessionId === sessionId) {
                return event.payload.screen;
            }
        }
        return undefined;
    }

    exitOf(sessionId: string): number | undefined {
        for (const event of this.events) {
            if (event.event === 'session.exit' && event.payload.sessionId === sessionId) {
                return event.payload.exitCode;
            }
        }
        return undefined;
    }

    sink(): SessionSink {
        return (event) => {
            this.events.push(event);
        };
    }
}

/*
 * The manager writes an agent record without awaiting it (an exit, a title found later), so a test
 * that reads the record back awaits `settled` instead of guessing how long the write takes.
 */
class TrackedAgentStore extends AgentStore {
    private readonly pending = new Set<Promise<void>>();

    override write(sessionId: string, info: AgentInfo, account?: string): Promise<void> {
        return this.track(super.write(sessionId, info, account));
    }

    override delete(sessionId: string): Promise<void> {
        return this.track(super.delete(sessionId));
    }

    async settled(): Promise<void> {
        while (this.pending.size > 0) {
            await Promise.allSettled([...this.pending]);
        }
    }

    private track(work: Promise<void>): Promise<void> {
        this.pending.add(work);
        const done = (): void => {
            this.pending.delete(work);
        };
        work.then(done, done);
        return work;
    }
}

/* Where a session that types a line starts on Windows; a test's own PATH leads to no Git for Windows. */
export const TEST_GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

export interface Harness {
    manager: SessionManager;
    adapter: FakePtyAdapter;
    snapshots: SnapshotStore;
    agents: TrackedAgentStore;
    home: string;
    /** A session of 80 by 24 in the harness's home, unless `extra` says otherwise. */
    create(sessionId: string, extra?: Partial<Omit<Parameters<SessionManager['create']>[0], 'sessionId'>>): ReturnType<SessionManager['create']>;
    cleanup(): Promise<void>;
}

// A daemon over its own fresh directory, or over the one an earlier harness left behind, which is a
// daemon restarting: the same sessions, the same stores on disk, nothing kept in memory.
export async function makeHarness(extra: Partial<SessionManagerOptions> = {}, over?: string): Promise<Harness> {
    const home = over ?? (await mkdtemp(join(tmpdir(), 'ruimte-test-')));
    const adapter = new FakePtyAdapter();
    const snapshots = new SnapshotStore(home);
    const agents = new TrackedAgentStore(home);
    const manager = new SessionManager({
        adapter,
        snapshots,
        agents,
        env: { PATH: '/usr/bin:/bin', HOME: home },
        hookUrl: 'http://127.0.0.1:1/hooks',
        findGitBash: () => TEST_GIT_BASH,
        personShell: () => TEST_GIT_BASH,
        ...extra
    });
    return {
        manager,
        adapter,
        snapshots,
        agents,
        home,
        create: (sessionId, extra = {}) => manager.create({ sessionId, cols: 80, rows: 24, cwd: home, ...extra }),
        async cleanup() {
            manager.killAll();
            await Promise.all(adapter.spawned.map((pty) => pty.exited));
            await agents.settled();
            await rm(home, { recursive: true, force: true });
        }
    };
}
