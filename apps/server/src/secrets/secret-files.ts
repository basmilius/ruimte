import { randomBytes } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '@adecore/utils/fs';
import type { Reclaimed } from '../maintenance/maintenance.ts';
import { sweepFolder } from '../maintenance/sweep-folder.ts';

/* How long the commands of the agent that asked can read a value it asked for as a file. */
export const SECRET_FILE_MS = 24 * 60 * 60 * 1000;

function filesDir(home: string): string {
    return join(home, 'secrets', 'files');
}

/*
 * The values a person saved for an agent's own commands, one 0600 file each in a 0700 folder under
 * `$RUIMTE_HOME/secrets`, named at random so a path says nothing about what it holds. The agent gets
 * the path and reads the file in the command that needs it; no tool or client file request reaches
 * the folder (`disk/machine-home.ts`), and the hourly sweep takes a file once it is a day old.
 */
export class SecretFiles {
    private readonly dir: string;

    constructor(home: string) {
        this.dir = filesDir(home);
    }

    async write(value: string): Promise<string> {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        // A folder an earlier version or a person made keeps its mode through `mkdir`.
        await chmod(this.dir, 0o700);

        const path = join(this.dir, randomBytes(16).toString('hex'));

        await writeAtomic(path, value, 0o600, { durable: true });

        return path;
    }
}

export function sweepSecretFiles(home: string, now: number, signal: AbortSignal): Promise<Reclaimed> {
    return sweepFolder(filesDir(home), { expired: (_name, modifiedMs) => now - modifiedMs >= SECRET_FILE_MS, signal });
}
