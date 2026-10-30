import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { serviceDefinition as definitionFor, type ServiceManager } from '@adecore/service';
import { buildIdentityOf, MACHINE_HEALTH_PATH, type BuildIdentity } from '@ruimte/contracts';
import type { BackgroundServiceState, MachineMode, MachineStopPreview, ServiceSupport } from '@ruimte/desktop-bridge';
import { commandLineServiceProgram, daemonServiceSpec, platformServiceManager, serviceLogFile } from '@ruimte/service/host';
import { askDaemonWork, proveDaemon, stopDaemonGently, type DaemonPort } from '../daemon-proof';
import { openDaemonLog, type DaemonLog } from '../daemon-log';
import { askLoginShellPath, fileLoginPathCache, loadLoginPath } from '../login-path';
import { removeOwnDefinition, secretFor, tildeHome } from '../machine-mode';
import { createServiceController, type ServiceController } from '../service/controller';
import { keepRunningSetting, serviceSupport } from '../service/settings';
import { createSecretGate } from '../startup';
import type { DaemonStartupDiagnostics } from '../telemetry';
import { electron } from './electron';
import type { AppIpc } from './ipc';
import { reportShellProblem } from './telemetry';

const { app, dialog } = electron;

export interface MachineOptions {
    ipc: AppIpc;
    port: number;
    /* The home the daemon runs with, where its local secret lives. */
    ruimteHome: string;
    repoRoot: string;
    /* Under `bun dev`, which runs the daemon itself. */
    devUrl: string | null;
    /* Without a local machine no page gets the secret or a say over the service. */
    mode: MachineMode;
    /* To every window. */
    publish(state: BackgroundServiceState): void;
}

/* The daemon behind the port: the background service, the app's own child, or one `bun dev` runs. */
export interface Machine {
    readonly support: ServiceSupport;
    readonly controller: ServiceController;
    readonly daemonPort: DaemonPort;
    /* Brings a daemon up behind the port that proved it holds the local secret; false when the person chose to quit. */
    start(): Promise<boolean>;
    /* Hands the page the local secret from now on, and watches a restart that is still pending. */
    ready(): void;
    /* "Stop the machine", which is a quit that takes the service down with it. */
    stopAndQuit(): void;
    stopsOnQuit(): boolean;
    /* On Windows, where ending a process writes nothing: what a daemon this quit ends still has to save. */
    settleBeforeQuit(): Promise<void>;
    /* A quit that was turned down stops nothing at the next one. */
    keepOnQuit(): void;
    /* Whether the next quit takes the machine down, set without quitting. */
    stopOnQuit(stop: boolean): void;
    /* Takes the definition of this installation away when the app ran its own daemon; throws when it cannot. */
    removeOwnService(): void;
    /* What a switch to `none` ends. */
    stopPreview(): Promise<MachineStopPreview>;
}

const MISSING_DAEMON = 'The background service is missing. Run the desktop app from the repository or install a release.';

/* Asked before restarting a daemon of an earlier build, which cannot prove it holds the local secret. A window may stand already, still without the secret. */
async function askRestartUnproven(): Promise<boolean> {
    const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Restart Now', 'Quit'],
        defaultId: 1,
        cancelId: 1,
        message: 'Ruimte was updated. Restart the machine to keep working.',
        detail: 'Restarting ends the terminals and agents running on it. If you quit instead, the machine restarts by itself once nothing runs on it.'
    });
    return response === 0;
}

/* The id `apps/server/scripts/compile.ts` wrote beside the binary this bundle carries. */
function bundledBuild(): string | null {
    if (!app.isPackaged) {
        return null;
    }
    try {
        return readFileSync(join(process.resourcesPath, 'bin', 'ruimte.build'), 'utf8').trim() || null;
    } catch {
        return null;
    }
}

export function createMachine(options: MachineOptions): Machine {
    const { ipc, port, ruimteHome } = options;
    let daemon: ChildProcess | null = null;
    // The login shell's PATH for a packaged app, loaded before the machine starts.
    let loginPath: string | null = null;
    let stopMachineOnQuit = false;
    let starting = false;
    let startupLog: DaemonLog | null = null;
    let startupExit: DaemonStartupDiagnostics | null = null;

    const startupDiagnostics = (): DaemonStartupDiagnostics | undefined => {
        if (startupExit !== null) {
            return startupExit;
        }
        return startupLog === null ? undefined : { exitCode: null, signal: null, output: startupLog.output() };
    };

    const daemonCommand = (): { command: string; args: string[] } => {
        if (app.isPackaged) {
            const bin = join(process.resourcesPath, 'bin');
            return { command: join(bin, process.platform === 'win32' ? 'ruimte.exe' : 'ruimte'), args: ['--port', String(port)] };
        }
        const entry = join(options.repoRoot, 'apps', 'server', 'src', 'main.ts');
        if (!existsSync(entry)) {
            throw new Error(MISSING_DAEMON);
        }
        return { command: 'bun', args: [entry, '--port', String(port)] };
    };

    /* A child that ends with the app, used in development or when the service fails to start. */
    const spawnDaemon = (onExit: () => void): void => {
        const target = daemonCommand();
        const env = { ...process.env };
        if (app.isPackaged && loginPath) {
            env.PATH = loginPath;
            process.env.PATH = loginPath;
        }
        env.RUIMTE_HOME = ruimteHome;
        // Tells the daemon's crash reports it runs as this app's child rather than as the service.
        env.RUIMTE_LAUNCHED_BY = 'desktop';
        // A packaged app has no terminal; the daemon's output goes to the app's log directory instead.
        let stdio: 'inherit' | ['ignore', number, number] = 'inherit';
        let log: DaemonLog | null = null;
        if (app.isPackaged) {
            log = openDaemonLog(join(app.getPath('logs'), 'daemon.log'));
            stdio = ['ignore', log.fd, log.fd];
        }
        startupLog = log;
        try {
            daemon = spawn(target.command, target.args, { stdio, env, windowsHide: true });
        } finally {
            if (log !== null) {
                closeSync(log.fd);
            }
        }
        daemon.on('error', (e: NodeJS.ErrnoException) => {
            reportShellProblem({ kind: 'daemon-spawn-failed', code: e.code ?? 'unknown' });
            dialog.showErrorBox('Ruimte', `The background service could not start: ${e.message}`);
            app.quit();
        });
        daemon.on('exit', (code, signal) => {
            if (starting && startupExit === null) {
                startupExit = { exitCode: code, signal, output: log?.output() ?? [] };
            }
            daemon = null;
            if (!app.isPackaged && code !== 0 && code !== null) {
                console.error(`The daemon exited with code ${code}`);
            }
            onExit();
        });
    };

    /* One ask of the port, bounded, so a daemon that hangs is no answer rather than a start that never ends. */
    const probeDaemon = async (): Promise<BuildIdentity | null> => {
        try {
            const response = await fetch(`http://127.0.0.1:${port}${MACHINE_HEALTH_PATH}`, { signal: AbortSignal.timeout(1000) });
            return response.ok ? buildIdentityOf(await response.json()) : null;
        } catch {
            return null;
        }
    };

    /* Long enough for a daemon that is snapshotting its sessions on the way out of a restart. */
    const waitForDaemon = async (accept: (health: BuildIdentity) => boolean, within = 20_000): Promise<void> => {
        const deadline = Date.now() + within;
        while (Date.now() < deadline) {
            const health = await probeDaemon();
            if (health && accept(health)) {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('The background service did not come up');
    };

    // Read on every ask: the daemon mints it on its first start, which under `bun dev` may come after this window.
    const readLocalSecret = async (): Promise<string | null> => {
        try {
            return (await readFile(join(ruimteHome, 'local.key'), 'utf8')).trim() || null;
        } catch {
            return null;
        }
    };

    const stopGently = async (): Promise<void> => {
        await stopDaemonGently(daemonPort, () => new Promise((resolve) => setTimeout(resolve, 200)));
    };

    const daemonPort: DaemonPort = {
        port,
        readSecret: readLocalSecret,
        fetch: (url, init) => fetch(url, init),
        nonce: () => randomBytes(32).toString('base64url')
    };

    const support = serviceSupport({ packaged: app.isPackaged, platform: process.platform, appImage: process.env.APPIMAGE });

    const serviceDefinition = (): string => {
        const target = daemonCommand();
        const spec = daemonServiceSpec({
            platform: process.platform,
            program: target.command,
            args: target.args,
            home: homedir(),
            ruimteHome,
            // A packaged app inherits the launcher's PATH, which is not the one a terminal of this person finds.
            path: loginPath ?? process.env.PATH ?? '/usr/bin:/bin'
        });
        return definitionFor(process.platform, spec);
    };

    const publish = (state: BackgroundServiceState): BackgroundServiceState => {
        options.publish(state);
        return state;
    };

    // The dev app never touches launchd or systemd, whatever it is asked.
    const manager: ServiceManager | null = support === 'supported' ? platformServiceManager(process.platform) : null;

    const controller = createServiceController({
        support,
        manager,
        setting: keepRunningSetting(join(app.getPath('userData'), 'background-service.json'), support),
        definition: serviceDefinition,
        // systemd writes to the journal, and the Task Scheduler's manager makes its log folder itself.
        prepare: () => {
            if (manager?.kind === 'launchd') {
                mkdirSync(dirname(serviceLogFile(homedir())), { recursive: true });
            }
        },
        commandLineProgram: commandLineServiceProgram(ruimteHome),
        ruimteHome,
        expected: { version: app.getVersion(), build: bundledBuild() },
        probe: probeDaemon,
        work: () => askDaemonWork(daemonPort),
        verify: () => proveDaemon(daemonPort),
        askRestart: askRestartUnproven,
        waitForHealth: waitForDaemon,
        spawnDaemon,
        killDaemon: () => daemon?.kill('SIGTERM'),
        settleDaemon: () => (process.platform === 'win32' ? stopGently() : Promise.resolve()),
        now: () => Date.now(),
        after: (ms, run) => void setTimeout(run, ms),
        publish: (state) => void publish(state),
        report: reportShellProblem
    });

    /*
     * While an older build or an older definition keeps the machine, the port is asked now and then, so
     * the question and the row in the settings go away once the daemon restarted onto the new one.
     */
    const watchPendingRestart = (): void => {
        if (!controller.unsettled()) {
            return;
        }
        const timer = setInterval(() => {
            void controller.refresh().then((state) => {
                if (!controller.unsettled()) {
                    clearInterval(timer);
                    publish(state);
                }
            });
        }, 30_000);
    };

    const stopAndQuit = (): void => {
        stopMachineOnQuit = true;
        app.quit();
    };

    /* Only the app's own page gets the local secret, and only once the daemon on the port proved it holds it (`controller.start`). */
    const localSecret = createSecretGate(readLocalSecret);

    ipc.handle('daemon:local-secret', () => secretFor(options.mode, () => localSecret.read()));
    if (options.mode === 'local') {
        // Once per start, so a second window or a reload does not count as another start.
        let startupTaken = false;
        ipc.handle('usage:startup', () => {
            if (startupTaken) {
                return null;
            }
            startupTaken = true;
            return Math.round(process.uptime() * 1000);
        });
        ipc.handle('service:state', () => controller.state());
        ipc.handle('service:set-keep-running', (_event, keepRunning: boolean) => publish(controller.setKeepRunning(keepRunning === true)));
        ipc.handle('service:enable-linger', () => publish(controller.enableLinger()));
        ipc.handle('service:restart-now', async () => publish(await controller.restartNow()));
        ipc.handle('service:restart-when-idle', () => publish(controller.restartWhenIdle()));
        ipc.on('service:stop-machine', () => stopAndQuit());
    }

    return {
        support,
        controller,
        daemonPort,
        async start() {
            // `bun dev` runs the daemon itself and builds the helpers before it listens, so the page waits
            // for it rather than finding nobody; one that never comes leaves the page's own retry.
            if (options.devUrl) {
                await waitForDaemon(() => true, 120_000).catch(() => undefined);
                return true;
            }
            starting = true;
            startupLog = null;
            startupExit = null;
            try {
                if (app.isPackaged) {
                    const cache = fileLoginPathCache(join(app.getPath('userData'), 'login-path.json'));
                    loginPath = (await loadLoginPath(cache, () => askLoginShellPath(process.env.SHELL, process.platform))).path;
                }
                return await controller.start();
            } catch (e) {
                reportShellProblem({
                    kind: 'daemon-start-failed',
                    reason: e instanceof Error ? e.message : 'The background service did not start',
                    daemon: startupDiagnostics()
                });
                throw e;
            } finally {
                starting = false;
            }
        },
        ready() {
            localSecret.open();
            // A window that asked while the machine came up holds the state from before it.
            publish(controller.state());
            watchPendingRestart();
        },
        stopAndQuit,
        stopOnQuit(stop) {
            stopMachineOnQuit = stop;
        },
        removeOwnService() {
            removeOwnDefinition(manager, { ruimteHome, commandLineProgram: commandLineServiceProgram(ruimteHome) }, controller.state().owner);
        },
        async stopPreview() {
            const home = tildeHome(ruimteHome, homedir());
            if (options.mode !== 'local') {
                return { work: null, home, commandLine: false };
            }
            return { work: await askDaemonWork(daemonPort), home, commandLine: controller.state().commandLineService === true };
        },
        stopsOnQuit: () => stopMachineOnQuit,
        async settleBeforeQuit() {
            if (process.platform === 'win32' && !controller.survivesQuit(stopMachineOnQuit)) {
                await stopGently();
            }
        },
        keepOnQuit() {
            stopMachineOnQuit = false;
        }
    };
}
