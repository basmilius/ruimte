import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isNotFound, writeAtomic } from '../fs.ts';
import { errorText } from '../error-text.ts';

const SNAPSHOT_INTERVAL_MS = 30_000;

// The id is chosen by the client, so it is encoded before it becomes a file name: a slash or a
// `..` in an id must never leave the sessions directory.
const fileName = (sessionId: string): string => `${encodeURIComponent(sessionId)}.txt`;

export class SnapshotStore {
    readonly dir: string;

    constructor(home: string) {
        this.dir = join(home, 'sessions');
    }

    async write(sessionId: string, screen: string): Promise<void> {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, fileName(sessionId)), screen);
    }

    async read(sessionId: string): Promise<string | null> {
        try {
            return await readFile(join(this.dir, fileName(sessionId)), 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return null;
            }
            throw e;
        }
    }

    async delete(sessionId: string): Promise<void> {
        await rm(join(this.dir, fileName(sessionId)), { force: true });
    }
}

interface SnapshotSource {
    snapshotAll(): Promise<Array<{ sessionId: string; screen: string }>>;
}

interface SnapshotSchedule {
    flush(): Promise<void>;
    stop(): void;
}

// One snapshot pass in flight at a time: the timer and the shutdown path may both ask for it.
export const scheduleSnapshots = (source: SnapshotSource, store: SnapshotStore, intervalMs: number = SNAPSHOT_INTERVAL_MS): SnapshotSchedule => {
    let inFlight: Promise<void> | null = null;

    const flush = (): Promise<void> => {
        if (inFlight) {
            return inFlight;
        }
        inFlight = (async () => {
            try {
                const snapshots = await source.snapshotAll();
                for (const { sessionId, screen } of snapshots) {
                    await store.write(sessionId, screen);
                }
            } finally {
                inFlight = null;
            }
        })();
        return inFlight;
    };

    const timer = setInterval(() => {
        flush().catch((e) => console.error('Snapshot pass failed:', errorText(e)));
    }, intervalMs);

    return {
        flush,
        stop() {
            clearInterval(timer);
        }
    };
};
