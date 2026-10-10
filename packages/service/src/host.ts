import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { diskFiles, platformServiceManager as createPlatformServiceManager, runCommand, type ServiceManager, type ServiceSpec } from '@adecore/service';

const LAUNCH_AGENT_LABEL = 'app.ruimte.daemon';
const SYSTEMD_UNIT_NAME = 'ruimte-daemon.service';

function serviceLogFile(home: string): string {
    return join(home, 'Library', 'Logs', 'Ruimte', 'daemon.log');
}

export function platformServiceManager(platform: NodeJS.Platform): ServiceManager | null {
    const home = homedir();
    return createPlatformServiceManager(platform, {
        launchd: {
            uid: process.getuid?.() ?? 0,
            home,
            label: LAUNCH_AGENT_LABEL,
            logFile: serviceLogFile(home),
            run: runCommand,
            files: diskFiles,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        },
        systemd: {
            configHome: process.env.XDG_CONFIG_HOME || join(home, '.config'),
            user: userInfo().username,
            unitName: SYSTEMD_UNIT_NAME,
            run: runCommand,
            files: diskFiles
        }
    });
}

export function commandLineServiceProgram(ruimteHome: string): string {
    return join(ruimteHome, 'bin', 'ruimte');
}

export interface DaemonService {
    program: string;
    args: string[];
    home: string;
    ruimteHome: string;
    path: string;
}

export function daemonServiceSpec(service: DaemonService): ServiceSpec {
    return {
        label: LAUNCH_AGENT_LABEL,
        description: 'Ruimte machine',
        program: service.program,
        args: service.args,
        // Service ownership controls daemon self-updates and must survive the package migration.
        environment: { RUIMTE_HOME: service.ruimteHome, PATH: service.path, RUIMTE_SERVICE: '1' },
        workingDirectory: service.home,
        logFile: serviceLogFile(service.home)
    };
}
