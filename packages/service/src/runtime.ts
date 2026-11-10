import { homedir } from 'node:os';
import { join } from 'node:path';

/*
 * What every program that talks to a daemon on this computer agrees on: where it listens, where its home
 * is and what its service is called. No dependency beyond `node:`, so a build script or a Vite config can
 * import it. The places that cannot import (`package.json` scripts, the installer's PowerShell) are held to
 * it by `runtime.test.ts`.
 */

/* An installed Ruimte. */
export const DEFAULT_PORT = 4210;

/* A checkout's daemon, so it never meets an installed Ruimte on `DEFAULT_PORT`. */
export const DEV_PORT = 4211;

/* The Vite dev server of the client, beside the daemons instead of Vite's own 5173. */
export const CLIENT_DEV_PORT = 4212;

export const HOME_FOLDER_NAME = '.ruimte';
export const DEV_HOME_FOLDER_NAME = '.ruimte-dev';

/* The service's name in launchd and the Windows Task Scheduler. */
export const SERVICE_LABEL = 'app.ruimte.daemon';

/* The file beside the daemon's binary that holds its build id, which is how an update is seen. */
export const BUILD_FILE = 'ruimte.build';

type Environment = Record<string, string | undefined>;

export function ruimteHome(env: Environment = process.env, userHome: string = homedir()): string {
    return env.RUIMTE_HOME ?? join(userHome, HOME_FOLDER_NAME);
}

/* A checkout's home, `$RUIMTE_DEV_HOME` else `~/.ruimte-dev`; an empty variable is no home. */
export function devRuimteHome(env: Environment = process.env, userHome: string = homedir()): string {
    return env.RUIMTE_DEV_HOME || join(userHome, DEV_HOME_FOLDER_NAME);
}
