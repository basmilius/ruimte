import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { LAUNCH_AGENT_LABEL, launchAgentPlist, systemdUnit, type ServiceSpec } from './definitions';
import { launchdManager, systemdManager, type ServiceManager } from './manager';
import { diskFiles, runCommand } from './system';

/*
 * What the desktop shell and `ruimte service` both need to install the same service: the manager of
 * this platform, the spec of this daemon and the text of its definition. Each of them wrote all
 * three out, which is how the two ended up pointing at different log files.
 */

/* Null where there is no background service, which is Windows and anything that is neither macOS nor Linux. */
export const platformServiceManager = (platform: NodeJS.Platform): ServiceManager | null => {
    if (platform === 'darwin') {
        return launchdManager({
            uid: process.getuid?.() ?? 0,
            home: homedir(),
            run: runCommand,
            files: diskFiles,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        });
    }
    if (platform === 'linux') {
        return systemdManager({
            configHome: process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
            user: userInfo().username,
            run: runCommand,
            files: diskFiles
        });
    }
    return null;
};

/*
 * The one log to look in, whichever installed the service. launchd only, as the spec says: systemd
 * writes to the journal and its unit never reads this path.
 */
export const serviceLogFile = (home: string): string => join(home, 'Library', 'Logs', 'Ruimte', 'daemon.log');

export interface DaemonService {
    /* The daemon binary and its arguments, absolute. */
    program: string;
    args: string[];
    home: string;
    ruimteHome: string;
    /*
     * What the terminals under this service find. The shell and the command learn it in their own
     * way and that is not duplication: an app started from the dock has no login PATH until it asks
     * a shell for one, while a command already runs in a shell whose PATH may carry an npx cache
     * that is cleared behind its back.
     */
    path: string;
}

export const daemonServiceSpec = (service: DaemonService): ServiceSpec => ({
    label: LAUNCH_AGENT_LABEL,
    program: service.program,
    args: service.args,
    // `RUIMTE_SERVICE` tells the daemon that something starts it again when it exits, so it may update itself.
    environment: { RUIMTE_HOME: service.ruimteHome, PATH: service.path, RUIMTE_SERVICE: '1' },
    workingDirectory: service.home,
    logFile: serviceLogFile(service.home)
});

export const serviceDefinition = (platform: NodeJS.Platform, spec: ServiceSpec): string => (platform === 'darwin' ? launchAgentPlist(spec) : systemdUnit(spec));
