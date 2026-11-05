import { isBusyRename } from '@adecore/utils/fs';

// Waits between attempts; together about a second before the move fails as it would have.
const WAITS_MS = [20, 50, 100, 200, 400];

interface BusyRetrySeams {
    platform: NodeJS.Platform;
    wait(ms: number): Promise<void>;
}

const SYSTEM_SEAMS: BusyRetrySeams = {
    platform: process.platform,
    wait: (ms) => new Promise((done) => setTimeout(done, ms))
};

/* A rename that tries again a few times on Windows while another process holds the file; one try elsewhere. */
export function retryingRename(
    rename: (from: string, to: string) => Promise<void>,
    seams: BusyRetrySeams = SYSTEM_SEAMS
): (from: string, to: string) => Promise<void> {
    if (seams.platform !== 'win32') {
        return rename;
    }
    return async (from, to) => {
        for (const waitMs of WAITS_MS) {
            try {
                return await rename(from, to);
            } catch (e) {
                if (!isBusyRename(e)) {
                    throw e;
                }
            }
            await seams.wait(waitMs);
        }
        return await rename(from, to);
    };
}
