import type { BuildIdentity, MachineWork } from '@ruimte/contracts';
import type { DaemonCrash, DaemonOwner, PendingRestart, ServiceSupport, ShellServiceState } from '@ruimte/desktop-bridge';
import { decideRestart, decideStart, sameBuild } from './decide';
import { definitionRunsProgram, type ServiceManager } from '@ruimte/service';
import type { KeepRunningSetting } from './settings';

export interface ServiceControllerDeps {
    support: ServiceSupport;
    /* Null wherever `support` is not `supported`, so nothing below can reach a service manager there. */
    manager: ServiceManager | null;
    setting: KeepRunningSetting;
    /* The plist or unit for this app, built when it is needed: the login shell's PATH is asked once. */
    definition(): string;
    /* What a service of `ruimte service install` runs, which the app leaves as it finds it. */
    commandLineProgram: string;
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
    now(): number;
    after(ms: number, run: () => void): void;
    /* Every window hears what changed without being asked, such as the app's own daemon ending. */
    publish(state: ShellServiceState): void;
}

export interface ServiceController {
    state(): ShellServiceState;
    /*
     * Brings a daemon up behind the port: the service, or the app's own. Rejects when none comes up or
     * what answers cannot prove it holds the local secret, and is false when the person chose to quit.
     */
    start(): Promise<boolean>;
    /* The switch. The daemon that runs keeps running; the other owner takes over when the app quits. */
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

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const UNPROVEN =
    'Something else answers where this machine should be, and it could not prove that it belongs to you, so Ruimte does not connect to it. If it is an earlier Ruimte started from a terminal, stop or update it and open Ruimte again.';

/* A daemon that ends this often in a row, each time within a minute of its start, is not started again. */
const RESPAWNS = 5;
const STAYED_UP_MS = 60_000;
const FIRST_PAUSE_MS = 1000;

export const createServiceController = (deps: ServiceControllerDeps): ServiceController => {
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
    const commandLineService = (): boolean => {
        const onDisk = manager?.read() ?? null;
        return onDisk !== null && definitionRunsProgram(onDisk, deps.commandLineProgram);
    };
    const keepRunning = (): boolean => manager !== null && !commandLineService() && deps.setting.read();

    const state = (): ShellServiceState => {
        let linger: boolean | null = null;
        if (manager?.linger) {
            try {
                linger = manager.linger.enabled();
            } catch {
                linger = null;
            }
        }
        return { support: deps.support, keepRunning: keepRunning(), owner, failure, linger, pendingRestart, commandLineService: commandLineService(), crash };
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
        if (restarting) {
            deps.after(FIRST_PAUSE_MS * 2 ** (endsInARow - 1), () => {
                if (!quitting) {
                    spawn().catch(() => undefined);
                }
            });
        }
    };

    /* The service did not come up: it is stopped so it cannot fight the app for the port, and the app runs its own daemon as before. */
    const fallBack = async (service: ServiceManager, e: unknown): Promise<void> => {
        failure = messageOf(e);
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

    const runService = async (service: ServiceManager, step: () => void | Promise<void>): Promise<void> => {
        try {
            await step();
            await deps.waitForHealth((health) => sameBuild(health, deps.expected));
            owner = 'service';
        } catch (e) {
            await fallBack(service, e);
        }
    };

    /* Restarts the service onto the definition on disk, unless that would end what runs on it. */
    const applyDefinition = async (service: ServiceManager): Promise<void> => {
        staleDefinition = decideRestart(await deps.work()) === 'ask';
        if (!staleDefinition) {
            await runService(service, () => service.restart());
        }
    };

    return {
        state,
        async start() {
            failure = null;
            staleDefinition = false;
            const serviceOn = keepRunning();
            let definitionChanged = false;
            // A service of the command line is used as it is, the way that command leaves the app's alone.
            if (manager && !commandLineService()) {
                try {
                    if (serviceOn) {
                        definitionChanged = manager.install(deps.definition());
                    } else if (manager.isInstalled()) {
                        // Off, yet a definition is on disk: a quit that never ran after the switch. Removed and stopped
                        // here, before the port is asked, so the answer is not a service about to go.
                        manager.uninstall();
                        manager.stop();
                    }
                } catch (e) {
                    failure = messageOf(e);
                }
            }
            const decision = decideStart(await deps.probe(), deps.expected, manager !== null && serviceOn && failure === null);
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
                        return false;
                    }
                    await runService(manager, () => manager.restart());
                } else {
                    const work = await deps.work();
                    if (decideRestart(work) === 'restart') {
                        await runService(manager, () => manager.restart());
                    } else {
                        // The old daemon keeps the port for now: a restart would end what runs on it without a word.
                        owner = 'service';
                        pendingRestart = { work: work === null ? null : work.terminals + work.agents, answered: false };
                    }
                }
            } else {
                await runService(manager, () => manager.start());
            }
            if (!(await deps.verify())) {
                throw new Error(UNPROVEN);
            }
            return true;
        },
        setKeepRunning(next) {
            if (!manager || commandLineService()) {
                return state();
            }
            deps.setting.write(next);
            try {
                if (next) {
                    manager.install(deps.definition());
                } else {
                    manager.uninstall();
                }
                failure = null;
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
            if (owner !== 'service' || !manager) {
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
            await runService(manager, () => manager.restart());
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
};
