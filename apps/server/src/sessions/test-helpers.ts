import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentInfo } from '@ruimte/contracts';
import { AgentStore } from '../agents/agent-store.ts';
import { FakePtyAdapter } from '../pty/fake-pty.ts';
import { SessionManager, type SessionEvent, type SessionManagerOptions, type SessionSink } from './manager.ts';
import { SnapshotStore } from './snapshot-store.ts';

export const DEFAULT_TIMEOUT_MS = 5000;

// Polls instead of sleeping: a shell answers in milliseconds on a quiet machine and in
// hundreds under CI load, and a fixed sleep is wrong on one of them.
export const waitForAsync = async (check: () => Promise<boolean>, what: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

export const waitFor = (check: () => boolean, what: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> =>
    waitForAsync(async () => check(), what, timeoutMs);

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
export class TrackedAgentStore extends AgentStore {
    private readonly pending = new Set<Promise<void>>();

    override write(sessionId: string, info: AgentInfo): Promise<void> {
        return this.track(super.write(sessionId, info));
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

export interface Harness {
    manager: SessionManager;
    adapter: FakePtyAdapter;
    snapshots: SnapshotStore;
    agents: TrackedAgentStore;
    home: string;
    cleanup(): Promise<void>;
}

// A daemon over its own fresh directory, or over the one an earlier harness left behind, which is a
// daemon restarting: the same sessions, the same stores on disk, nothing kept in memory.
export const makeHarness = async (extra: Partial<SessionManagerOptions> = {}, over?: string): Promise<Harness> => {
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
        ...extra
    });
    return {
        manager,
        adapter,
        snapshots,
        agents,
        home,
        async cleanup() {
            manager.killAll();
            await Promise.all(adapter.spawned.map((pty) => pty.exited));
            await agents.settled();
            await rm(home, { recursive: true, force: true });
        }
    };
};
