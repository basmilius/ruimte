import { isIdle, type BuildIdentity, type MachineWork } from '@ruimte/contracts';
import type { DaemonCrash, DaemonOwner, PendingRestart, ServiceSupport, ShellServiceState } from '@ruimte/desktop-bridge';
import { definitionRunsProgram, type ServiceManager } from '@adecore/service';
import { serviceOwnership } from './ownership';
import type { KeepRunningSetting } from './settings';
import type { ShellProblem } from '../telemetry';

export interface ServiceControllerDeps {
    support: ServiceSupport;
    /* Null wherever `support` is not `supported`, so nothing below can reach a service manager there. */
    manager: ServiceManager | null;
    setting: KeepRunningSetting;
    /* The plist or unit for this app, installed only when it differs from the one on disk. */
    definition(): string;
    /* Makes what the service needs beside its definition, on every start: launchd opens the log but makes no folder for it, and a job whose log cannot open never starts. */
    prepare(): void;
    /* What a service of `ruimte service install` runs, which the app leaves as it finds it. */
    commandLineProgram: string;
    /* The home this installation gives its daemon; a definition with another home is not the app's to touch. */
    ruimteHome: string;
    expected: BuildIdentity;
    /* One ask of `/health`; null when nothing answers. */
    probe(): Promise<BuildIdentity | null>;
    /* One ask of `/machine/work` with the local secret; null when the daemon cannot say or did not prove it holds the secret. */
    work(): Promise<MachineWork | null>;
    /* Whether what answers the port proves it holds the local secret, which an earlier build cannot. */
    verify(): Promise<boolean>;
    /* Asks the person before an earlier build that cannot prove itself is restarted; false means quit instead. */
    askRestart(): Promise<boolean>;
    /* Resolves once `/health` answers and `accept` takes the answer, rejects when it never does. */
    waitForHealth(accept: (health: BuildIdentity) => boolean): Promise<void>;
    /* Starts the app's own daemon; `onExit` runs once it ended, whoever ended it. */
    spawnDaemon(onExit: () => void): void;
    killDaemon(): void;
    /* Before a restart ends a daemon: where ending a process writes nothing, it saves first. */
    settleDaemon?(): Promise<void>;
    now(): number;
    after(ms: number, run: () => void): void;
    /* Every window hears what changed without being asked, such as the app's own daemon ending. */
    publish(state: ShellServiceState): void;
    /* A crash report for what should not happen: the service failing this installation, or its own daemon given up on. */
    report?(problem: ShellProblem): void;
}

export interface ServiceController {
    state(): ShellServiceState;
    /*
     * Brings a daemon up behind the port: the service, or the app's own. Rejects when none comes up or
     * what answers cannot prove it holds the local secret, and is false when the person chose to quit.
     */
    start(): Promise<boolean>;
    /* The running service stays in place, so toggling background use does not end its sessions. */
    setKeepRunning(keepRunning: boolean): ShellServiceState;
    /* Whether the agents outlive this quit, for the question asked before it. */
    survivesQuit(stopMachine: boolean): boolean;
    /* What quitting does to the daemon. `stopMachine` ends the service too, until the next start. */
    quit(stopMachine: boolean): void;
    enableLinger(): ShellServiceState;
    /* "Restart now": the service moves onto the binary in this bundle, ending what runs on it. */
    restartNow(): Promise<ShellServiceState>;
    /* "When idle": the old daemon stays for this session and restarts itself once nothing runs. */
    restartWhenIdle(): ShellServiceState;
    /* Asks the port again: drops a pending restart once the new build answers, and restarts onto a changed definition once nothing runs. */
    refresh(): Promise<ShellServiceState>;
    /* Whether `refresh` still has something to settle. */
    unsettled(): boolean;
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function foreignService(path: string): string {
    return `The background service in ${path} was set up by another Ruimte or by hand, so Ruimte leaves it alone. Remove that file to let Ruimte keep this machine running when it quits.`;
}

const UNPROVEN =
    'Something else answers where this machine should be, and it could not prove that it belongs to you, so Ruimte does not connect to it. If it is an earlier Ruimte started from a terminal, stop or update it and open Ruimte again.';

/* A daemon that ends this often in a row, each time within a minute of its start, is not started again. */
const RESPAWNS = 5;
const STAYED_UP_MS = 60_000;
const FIRST_PAUSE_MS = 1000;

type StartDecision = 'attach' | 'attach-external' | 'restart-service' | 'start-service' | 'spawn';

/* Build ids distinguish compiles of the same version; an unstamped daemon cannot match a stamped bundle. */
function sameBuild(running: BuildIdentity, expected: BuildIdentity): boolean {
    return expected.build !== null ? running.build === expected.build : running.version === expected.version;
}

/* Unknown work must wait too: a silent restart could end a terminal or agent. */
function decideRestart(work: MachineWork | null): 'restart' | 'ask' {
    return work !== null && isIdle(work) ? 'restart' : 'ask';
}

function decideStart(health: BuildIdentity | null, expected: BuildIdentity, serviceOn: boolean): StartDecision {
    if (health === null) {
        return serviceOn ? 'start-service' : 'spawn';
    }
    if (!serviceOn) {
        return 'attach-external';
    }
    return sameBuild(health, expected) ? 'attach' : 'restart-service';
}

export function createServiceController(deps: ServiceControllerDeps): ServiceController {
    let owner: DaemonOwner | null = null;
    let failure: string | null = null;
    let pendingRestart: PendingRestart | null = null;
    // launchd and systemd read a definition only when they start the job, so a new PATH waits for a restart.
    let staleDefinition = false;
    let quitting = false;
    let crash: DaemonCrash | null = null;
    let endsInARow = 0;
    let spawnedAt = 0;
    const manager = deps.support === 'supported' ? deps.manager : null;
    const onDisk = (): string | null => manager?.read() ?? null;
    const commandLineService = (): boolean => {
        const definition = onDisk();
        return definition !== null && definitionRunsProgram(definition, deps.commandLineProgram);
    };
    // Whatever is not this installation's stays as it is found: never installed over, started, stopped or removed.
    const foreign = (): boolean => serviceOwnership(onDisk(), deps) === 'other';
    const managed = (): boolean => manager !== null && !foreign();
    const keepRunning = (): boolean => managed() && deps.setting.read();

    const state = (): ShellServiceState => {
        let linger: boolean | null = null;
        if (manager?.linger) {
            try {
                linger = manager.linger.enabled();
            } catch {
                linger = null;
            }
        }
        const commandLine = commandLineService();
        const unknown = manager !== null && !commandLine && foreign() ? foreignService(manager.path) : null;
        return {
            support: deps.support,
            keepRunning: keepRunning(),
            owner,
            failure: failure ?? unknown,
            linger,
            pendingRestart,
            commandLineService: commandLine,
            crash
        };
    };

    const uninstallWhenOff = (): void => {
        if (!manager || serviceOwnership(onDisk(), deps) !== 'this' || deps.setting.read()) {
            return;
        }
        try {
            // A loaded service keeps running without its file, while the next login starts nothing.
            manager.uninstall();
        } catch (e) {
            failure = messageOf(e);
        }
    };

    const spawn = async (): Promise<void> => {
        spawnedAt = deps.now();
        deps.spawnDaemon(ended);
        owner = 'app';
        await deps.waitForHealth(() => true);
    };

    /* The app's own daemon ended. Unless a quit ended it, it is started again, with a longer pause each time it ends again soon. */
    const ended = (): void => {
        if (quitting || owner !== 'app') {
            return;
        }
        endsInARow = deps.now() - spawnedAt >= STAYED_UP_MS ? 1 : endsInARow + 1;
        const restarting = endsInARow <= RESPAWNS;
        crash = { total: (crash?.total ?? 0) + 1, restarting };
        deps.publish(state());
        if (!restarting) {
            deps.report?.({ kind: 'daemon-gave-up', ends: endsInARow });
        } else {
            deps.after(FIRST_PAUSE_MS * 2 ** (endsInARow - 1), () => {
                if (!quitting) {
                    spawn().catch(() => undefined);
                }
            });
        }
    };

    /* The service did not come up: it is stopped so it cannot fight the app for the port, and the app runs its own daemon. */
    const fallBack = async (service: ServiceManager, step: 'start' | 'restart', e: unknown): Promise<void> => {
        failure = messageOf(e);
        deps.report?.({ kind: 'service-fallback', step, reason: failure });
        try {
            service.stop();
        } catch {
            // Stopping a service that never started has nothing to report.
        }
        if (await deps.probe()) {
            owner = 'external';
            return;
        }
        await spawn();
    };

    const runService = async (service: ServiceManager, what: 'start' | 'restart', step: () => void | Promise<void>): Promise<void> => {
        if (foreign()) {
            return;
        }
        try {
            if (!service.isInstalled()) {
                service.install(deps.definition());
            }
            if (what === 'restart') {
                await deps.settleDaemon?.();
            }
            await step();
            await deps.waitForHealth((health) => sameBuild(health, deps.expected));
            owner = 'service';
        } catch (e) {
            await fallBack(service, what, e);
        } finally {
            uninstallWhenOff();
        }
    };

    /* Restarts the service onto the definition on disk, unless that would end what runs on it. */
    const applyDefinition = async (service: ServiceManager): Promise<void> => {
        staleDefinition = decideRestart(await deps.work()) === 'ask';
        if (!staleDefinition) {
            await runService(service, 'restart', () => service.restart());
        }
    };

    return {
        state,
        async start() {
            failure = null;
            staleDefinition = false;
            const managedService = managed();
            let definitionChanged = false;
            // A service of the command line or another installation is used as it is, the way that command leaves the app's alone.
            if (manager && managedService) {
                try {
                    deps.prepare();
                    const definition = deps.definition();
                    // Use the service even with background use off, so turning it on needs no daemon restart.
                    if (onDisk() !== definition) {
                        definitionChanged = manager.install(definition);
                    }
                } catch (e) {
                    failure = messageOf(e);
                    deps.report?.({ kind: 'service-fallback', step: 'install', reason: failure });
                }
            }
            const decision = decideStart(await deps.probe(), deps.expected, managedService && failure === null);
            if (decision === 'attach') {
                owner = 'service';
                if (manager && definitionChanged) {
                    await applyDefinition(manager);
                }
            } else if (decision === 'attach-external') {
                owner = 'external';
            } else if (decision === 'spawn' || !manager) {
                await spawn();
            } else if (decision === 'restart-service') {
                if (!(await deps.verify())) {
                    // A build from before the proof cannot show it is ours, and nothing is sent to it or loaded from it until it restarted.
                    if (!(await deps.askRestart())) {
                        uninstallWhenOff();
                        return false;
                    }
                    await runService(manager, 'restart', () => manager.restart());
                } else {
                    const work = await deps.work();
                    if (decideRestart(work) === 'restart') {
                        await runService(manager, 'restart', () => manager.restart());
                    } else {
                        // The old daemon keeps the port for now: a restart would end what runs on it without a word.
                        owner = 'service';
                        pendingRestart = { work: work === null ? null : work.terminals + work.agents, answered: false };
                    }
                }
            } else {
                await runService(manager, 'start', () => manager.start());
            }
            uninstallWhenOff();
            if (!(await deps.verify())) {
                throw new Error(UNPROVEN);
            }
            return true;
        },
        setKeepRunning(next) {
            if (!manager || foreign()) {
                return state();
            }
            deps.setting.write(next);
            try {
                if (next) {
                    manager.install(deps.definition());
                } else {
                    manager.uninstall();
                }
                if (owner !== 'app') {
                    failure = null;
                }
            } catch (e) {
                failure = messageOf(e);
            }
            return state();
        },
        survivesQuit(stopMachine) {
            // A daemon the app never ran, such as the one `bun dev` runs, is not the app's to end.
            if (owner === null || owner === 'external') {
                return true;
            }
            return !stopMachine && owner === 'service' && keepRunning();
        },
        quit(stopMachine) {
            quitting = true;
            if (owner === 'app') {
                deps.killDaemon();
                // The switch went on while the app ran its own daemon: the service takes over now. It may find the
                // port still held for a moment, and then exits and is started again by its keep-alive.
                if (manager && keepRunning() && !stopMachine) {
                    try {
                        manager.start();
                    } catch (e) {
                        console.error('The background service did not start', e);
                    }
                }
                return;
            }
            if (owner !== 'service' || !manager || foreign()) {
                return;
            }
            if (stopMachine) {
                // Until the next start, which installs it again while the switch is on.
                manager.stop();
                manager.uninstall();
                return;
            }
            if (!keepRunning()) {
                manager.stop();
            }
        },
        enableLinger() {
            if (manager?.linger) {
                try {
                    manager.linger.enable();
                    failure = null;
                } catch (e) {
                    failure = messageOf(e);
                }
            }
            return state();
        },
        async restartNow() {
            if (!manager || pendingRestart === null) {
                return state();
            }
            pendingRestart = null;
            failure = null;
            await runService(manager, 'restart', () => manager.restart());
            return state();
        },
        restartWhenIdle() {
            if (pendingRestart !== null) {
                pendingRestart = { ...pendingRestart, answered: true };
            }
            return state();
        },
        async refresh() {
            if (staleDefinition && manager && owner === 'service') {
                await applyDefinition(manager);
            }
            if (pendingRestart === null) {
                return state();
            }
            const health = await deps.probe();
            if (health !== null && sameBuild(health, deps.expected)) {
                pendingRestart = null;
            }
            return state();
        },
        unsettled() {
            return pendingRestart !== null || (staleDefinition && owner === 'service');
        }
    };
}
