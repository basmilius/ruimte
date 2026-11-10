import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/* The compiled daemon's own copy of a file of the serve-sim package, in `native/` beside it. */
export function besideDaemon(name: string): string {
    return join(dirname(process.execPath), 'native', name);
}

export function serveSimFolder(folder: string): string | null {
    try {
        return join(dirname(Bun.resolveSync('serve-sim/middleware', import.meta.dir)), folder);
    } catch {
        return null;
    }
}

/* A file of the serve-sim package: beside the compiled daemon, else in the installed package's `folder`; null when neither has it. */
export function serveSimFile(name: string, folder: string): string | null {
    const beside = besideDaemon(name);
    if (existsSync(beside)) {
        return beside;
    }
    const packaged = serveSimFolder(folder);
    return packaged !== null && existsSync(join(packaged, name)) ? join(packaged, name) : null;
}
