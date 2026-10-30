import { homedir, userInfo } from 'node:os';
import { posix, win32, type PlatformPath } from 'node:path';
import { diskFiles, platformServiceManager as createPlatformServiceManager, runCommand, type ServiceManager, type ServiceSpec } from '@adecore/service';

const LAUNCH_AGENT_LABEL = 'app.ruimte.daemon';
const SYSTEMD_UNIT_NAME = 'ruimte-daemon.service';

export type HostEnvironment = Record<string, string | undefined>;

export function pathsOf(platform: NodeJS.Platform): PlatformPath {
    return platform === 'win32' ? win32 : posix;
}

function localAppData(home: string, env: HostEnvironment): string {
    return env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local');
}

export function serviceLogFile(home: string, platform: NodeJS.Platform = process.platform, env: HostEnvironment = process.env): string {
    if (platform === 'win32') {
        return win32.join(localAppData(home, env), 'Ruimte', 'logs', 'daemon.log');
    }
    return posix.join(home, 'Library', 'Logs', 'Ruimte', 'daemon.log');
}

/* The copy of the scheduled task's definition that `schtasks /Create` registers from. */
export function scheduledTaskFile(home: string, env: HostEnvironment = process.env): string {
    return win32.join(localAppData(home, env), 'Ruimte', 'service', `${LAUNCH_AGENT_LABEL}.xml`);
}

/* The account the scheduled task starts for at logon, as `DOMAIN\name`. */
function serviceUser(env: HostEnvironment): string {
    const name = env.USERNAME || userInfo().username;
    // OpenSSH on a machine outside a domain sets the workgroup here, which is no authority an account belongs to.
    return env.USERDOMAIN && env.USERDOMAIN.toUpperCase() !== 'WORKGROUP' ? `${env.USERDOMAIN}\\${name}` : name;
}

export function platformServiceManager(platform: NodeJS.Platform, env: HostEnvironment = process.env): ServiceManager | null {
    const home = homedir();
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    return createPlatformServiceManager(platform, {
        launchd: {
            uid: process.getuid?.() ?? 0,
            home,
            label: LAUNCH_AGENT_LABEL,
            logFile: serviceLogFile(home, platform, env),
            run: runCommand,
            files: diskFiles,
            sleep
        },
        systemd: {
            configHome: env.XDG_CONFIG_HOME || posix.join(home, '.config'),
            user: userInfo().username,
            unitName: SYSTEMD_UNIT_NAME,
            run: runCommand,
            files: diskFiles
        },
        taskScheduler: {
            // A stop finds the task's processes by the label of its spec, so the task carries that name.
            taskName: LAUNCH_AGENT_LABEL,
            definitionFile: scheduledTaskFile(home, env),
            logFile: serviceLogFile(home, platform, env),
            run: runCommand,
            files: diskFiles,
            sleep
        }
    });
}

export function commandLineServiceProgram(ruimteHome: string, platform: NodeJS.Platform = process.platform): string {
    return pathsOf(platform).join(ruimteHome, 'bin', platform === 'win32' ? 'ruimte.exe' : 'ruimte');
}

export interface DaemonService {
    platform: NodeJS.Platform;
    program: string;
    args: string[];
    home: string;
    ruimteHome: string;
    path: string;
    /* Where Windows names the profile's local folder and the account; the process's own when absent. */
    env?: HostEnvironment;
}

export function daemonServiceSpec(service: DaemonService): ServiceSpec {
    const env = service.env ?? process.env;
    return {
        label: LAUNCH_AGENT_LABEL,
        description: 'Ruimte machine',
        program: service.program,
        args: service.args,
        // RUIMTE_SERVICE tells the daemon a service starts it again, which decides how it updates itself.
        environment: { RUIMTE_HOME: service.ruimteHome, PATH: service.path, RUIMTE_SERVICE: '1' },
        workingDirectory: service.home,
        logFile: serviceLogFile(service.home, service.platform, env),
        ...(service.platform === 'win32' ? { user: serviceUser(env), scriptDirectory: win32.dirname(scheduledTaskFile(service.home, env)) } : {})
    };
}
