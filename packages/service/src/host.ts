import { execFileSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { posix, win32 } from 'node:path';
import { diskFiles, platformServiceManager as createPlatformServiceManager, runCommand, type ServiceManager, type ServiceSpec } from '@adecore/service';

const LAUNCH_AGENT_LABEL = 'app.ruimte.daemon';
const SYSTEMD_UNIT_NAME = 'ruimte-daemon.service';

export type HostEnvironment = Record<string, string | undefined>;

export function pathsOf(platform: NodeJS.Platform): typeof posix {
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

/*
 * The authority of the account this process runs as, from the system. The absolute path, since Git Bash
 * puts a `whoami` of its own first that answers without one. Null when it does not answer.
 */
function systemAuthority(env: HostEnvironment): string | null {
    try {
        const account = execFileSync(win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'), {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 5000
        });
        const separator = account.indexOf('\\');

        // In capitals like `USERDOMAIN`, so a definition does not read as changed between a shell and SSH.
        return separator > 0 ? account.slice(0, separator).toUpperCase() : null;
    } catch {
        return null;
    }
}

/* The account the scheduled task starts for at logon, as `DOMAIN\name`, or the bare name when the system does not say. */
function serviceUser(env: HostEnvironment, authority: (env: HostEnvironment) => string | null): string {
    const name = env.USERNAME || userInfo().username;
    // Only the computer's own name is sure: OpenSSH outside a domain sets the workgroup here, whatever it is called, and no account belongs to that.
    const local = env.USERDOMAIN && env.USERDOMAIN.toUpperCase() === env.COMPUTERNAME?.toUpperCase();
    const domain = local ? env.USERDOMAIN : authority(env);

    return domain ? `${domain}\\${name}` : name;
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
    /* Who answers for the account's authority when the environment cannot; the system when absent. */
    authority?: (env: HostEnvironment) => string | null;
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
        ...(service.platform === 'win32'
            ? { user: serviceUser(env, service.authority ?? systemAuthority), scriptDirectory: win32.dirname(scheduledTaskFile(service.home, env)) }
            : {})
    };
}
