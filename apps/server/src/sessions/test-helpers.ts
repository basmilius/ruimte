import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore } from '../agents/agent-store.ts';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
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

export interface Harness {
    manager: SessionManager;
    snapshots: SnapshotStore;
    agents: AgentStore;
    home: string;
    cleanup(): Promise<void>;
}

// A real shell with no login flag and a minimal environment, so the user's profile cannot leak into the screen.
export const SH = '/bin/sh';
export const SH_ARGS: string[] = [];

export const makeHarness = async (extra: Partial<SessionManagerOptions> = {}): Promise<Harness> => {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-test-'));
    const snapshots = new SnapshotStore(home);
    const agents = new AgentStore(home);
    const manager = new SessionManager({
        adapter: new BunPtyAdapter(),
        snapshots,
        agents,
        env: { PATH: process.env.PATH, HOME: home, PS1: '$ ' },
        hookUrl: 'http://127.0.0.1:1/hooks',
        ...extra
    });
    return {
        manager,
        snapshots,
        agents,
        home,
        async cleanup() {
            manager.killAll();
            await waitFor(() => manager.list().every((session) => session.exited), 'every shell to exit').catch(() => undefined);
            await rm(home, { recursive: true, force: true });
        }
    };
};
