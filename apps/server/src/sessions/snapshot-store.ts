import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isNotFound } from '@adecore/utils/errors';
import { writeAtomic } from '@adecore/utils/fs';
import { errorText } from '../error-text.ts';

const SNAPSHOT_INTERVAL_MS = 10_000;

// The id is chosen by the client, so it is encoded before it becomes a file name: a slash or a
// `..` in an id must never leave the sessions directory.
function fileName(sessionId: string): string {
    return `${encodeURIComponent(sessionId)}.txt`;
}

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

export interface SessionSnapshot {
    sessionId: string;
    screen: string;
    // True once the node was deleted, which may be while this screen is on its way to the disk.
    deleted(): boolean;
    // The write failed, so the next pass takes this session again even if it stays quiet.
    unsaved(): void;
}

interface SnapshotSource {
    snapshotAll(final: boolean): Promise<SessionSnapshot[]>;
}

export interface SnapshotSchedule {
    /* Writes every screen that changed, busy or not; what the shutdown path awaits. */
    flush(): Promise<void>;
    stop(): void;
}

/*
 * A pass on the timer writes the screens that went quiet since the previous one, and a screen that
 * keeps changing only every so many passes (`Session.changedScreen`). One pass runs at a time: a flush
 * that finds a timer pass in flight runs after it, since that pass may have left a busy screen out.
 */
export function scheduleSnapshots(source: SnapshotSource, store: SnapshotStore, intervalMs: number = SNAPSHOT_INTERVAL_MS): SnapshotSchedule {
    let inFlight: { final: boolean; done: Promise<void> } | null = null;

    const pass = async (final: boolean): Promise<void> => {
        const snapshots = await source.snapshotAll(final);
        let failure: unknown = null;
        for (const snapshot of snapshots) {
            if (snapshot.deleted()) {
                continue;
            }
            try {
                await store.write(snapshot.sessionId, snapshot.screen);
                // The delete may have run while the rename was pending, which put the file back.
                if (snapshot.deleted()) {
                    await store.delete(snapshot.sessionId);
                }
            } catch (e) {
                snapshot.unsaved();
                failure ??= e;
            }
        }
        if (failure !== null) {
            throw failure;
        }
    };

    const run = (final: boolean): Promise<void> => {
        if (inFlight !== null && (inFlight.final || !final)) {
            return inFlight.done;
        }
        const done = inFlight === null ? pass(final) : inFlight.done.catch(() => undefined).then(() => pass(final));
        const current = { final, done };
        const settle = (): void => {
            if (inFlight === current) {
                inFlight = null;
            }
        };
        current.done.then(settle, settle);
        inFlight = current;
        return current.done;
    };

    const timer = setInterval(() => {
        run(false).catch((e) => console.error('Snapshot pass failed:', errorText(e)));
    }, intervalMs);

    return {
        flush: () => run(true),
        stop() {
            clearInterval(timer);
        }
    };
}
