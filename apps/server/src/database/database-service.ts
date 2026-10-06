import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseHost, helperPath, spawnHelper, type DatabaseHost, type HelperProcess } from '@adecore/database/host';
import type { ConnectionConfig, DatabaseResponse } from '@adecore/database/protocol';
import type { MachineHome } from '../fs/machine-home.ts';

const HELPER_FILE = process.platform === 'win32' ? 'adecore-database.exe' : 'adecore-database';

/* The database helper this daemon starts: the override, the one packaged beside the daemon, the installed package's, or a linked checkout's own build. Null without one. */
export function databaseHelperPath(): string | null {
    if (process.env.RUIMTE_DATABASE_HELPER) {
        return process.env.RUIMTE_DATABASE_HELPER;
    }
    const packaged = join(dirname(process.execPath), 'native', HELPER_FILE);
    if (existsSync(packaged)) {
        return packaged;
    }
    return helperPath() ?? linkedHelperPath();
}

/* A linked ADE CORE checkout has no platform package with a binary in it, only what `helper:build` left in its target folder. */
function linkedHelperPath(): string | null {
    try {
        const entry = fileURLToPath(import.meta.resolve('@adecore/database/host'));
        const built = join(dirname(entry), '..', '..', 'helper', 'target', 'release', HELPER_FILE);
        return existsSync(built) ? built : null;
    } catch {
        return null;
    }
}

/* Never a request in the log: `open` and `test` carry the password. */
function startHelper(): HelperProcess {
    const path = databaseHelperPath();
    if (path === null) {
        throw new Error('This machine has no database helper');
    }
    return spawnHelper(path, { env: { PATH: process.env.PATH ?? '' }, onLog: (line) => console.error(`[database] ${line}`) });
}

export interface DatabaseServiceOptions {
    machineHome: Pick<MachineHome, 'refuse'>;
    /* Starts the helper; the real one when left out. */
    start?: () => HelperProcess;
}

/*
 * The one database host of the daemon, between the clients and the helper. An owner is a socket's
 * client id, or a name of the caller's own for an owner that is no socket. A session belongs to the
 * owner that opened it and closes when it is released.
 */
export class DatabaseService {
    private readonly host: DatabaseHost;
    private readonly machineHome: Pick<MachineHome, 'refuse'>;
    // The owners whose socket presented the local secret: only a person on this machine picks a file to export to or import from.
    private readonly localOwners = new Set<string>();

    constructor(options: DatabaseServiceOptions) {
        this.machineHome = options.machineHome;
        this.host = createDatabaseHost({
            start: options.start ?? startHelper,
            authorize: (connection) => this.mayOpen(connection),
            authorizeFile: (path, _access, owner) => this.localOwners.has(owner) && this.outsideMachineState(path),
            // The containers of a person's own machine, which the panel offers to add with their credentials.
            authorizeDiscovery: () => true
        });
    }

    /* `local` is only ever true for a socket that presented the local secret; every other owner is refused a file. */
    handle(request: unknown, owner: string, local = false): Promise<DatabaseResponse> {
        if (local) {
            this.localOwners.add(owner);
        }
        return this.host.handle(request, owner);
    }

    release(owner: string): Promise<void> {
        this.localOwners.delete(owner);
        return this.host.release(owner).catch(() => undefined);
    }

    dispose(): Promise<void> {
        this.localOwners.clear();
        return this.host.dispose();
    }

    /* Any server, through any tunnel: a person connects to their own. A SQLite file only outside the machine's own state. */
    private async mayOpen(connection: ConnectionConfig): Promise<boolean> {
        return connection.engine !== 'sqlite' || this.outsideMachineState(connection.path);
    }

    /*
     * The line `fs.write` stops at. The folder is judged as well, since a file that does not exist yet
     * has no real path of its own, and a folder that is a link into `$RUIMTE_HOME` would land it there.
     */
    private async outsideMachineState(path: string): Promise<boolean> {
        try {
            await Promise.all([this.machineHome.refuse(path), this.machineHome.refuse(dirname(path))]);
            return true;
        } catch {
            return false;
        }
    }
}
