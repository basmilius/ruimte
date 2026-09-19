import type { BuildIdentity, MachineWork } from '@ruimte/contracts';
import type { DaemonOwner, PendingRestart, ServiceSupport, ShellServiceState } from '@ruimte/desktop-bridge';
import { decideRestart, decideStart, sameBuild } from './decide';
import type { ServiceManager } from '@ruimte/service';
import type { KeepRunningSetting } from './settings';

export interface ServiceControllerDeps {
    support: ServiceSupport;
    /* Null wherever `support` is not `supported`, so nothing below can reach a service manager there. */
    manager: ServiceManager | null;
    setting: KeepRunningSetting;
    /* The plist or unit for this app, built when it is needed: the login shell's PATH is asked once. */
    definition(): string;
    expected: BuildIdentity;
    /* One ask of `/health`; null when nothing answers. */
    probe(): Promise<BuildIdentity | null>;
    /* One ask of `/machine/work` with the local secret; null when the daemon cannot say. */
    work(): Promise<MachineWork | null>;
    /* Resolves once `/health` answers and `accept` takes the answer, rejects when it never does. */
    waitForHealth(accept: (health: BuildIdentity) => boolean): Promise<void>;
    spawnDaemon(): void;
    killDaemon(): void;
}

export interface ServiceController {
    state(): ShellServiceState;
    /* Brings a daemon up behind the port: the service, or the app's own. Rejects when none comes up. */
    start(): Promise<void>;
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
    /* Asks the port again, and drops a pending restart once the new build answers. */
    refresh(): Promise<ShellServiceState>;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const createServiceController = (deps: ServiceControllerDeps): ServiceController => {
    let owner: DaemonOwner | null = null;
    let failure: string | null = null;
    let pendingRestart: PendingRestart | null = null;
    const manager = deps.support === 'supported' ? deps.manager : null;
    const keepRunning = (): boolean => manager !== null && deps.setting.read();

    const state = (): ShellServiceState => {
        let linger: boolean | null = null;
        if (manager?.linger) {
            try {
                linger = manager.linger.enabled();
            } catch {
                linger = null;
            }
        }
        return { support: deps.support, keepRunning: keepRunning(), owner, failure, linger, pendingRestart };
    };

    const spawn = async (): Promise<void> => {
        deps.spawnDaemon();
        owner = 'app';
        await deps.waitForHealth(() => true);
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

    return {
        state,
        async start() {
            failure = null;
            const serviceOn = keepRunning();
            if (manager) {
                try {
                    if (serviceOn) {
                        manager.install(deps.definition());
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
            } else if (decision === 'attach-external') {
                owner = 'external';
            } else if (decision === 'spawn' || !manager) {
                await spawn();
            } else if (decision === 'restart-service') {
                const work = await deps.work();
                if (decideRestart(work) === 'restart') {
                    await runService(manager, () => manager.restart());
                } else {
                    // The old daemon keeps the port for now: a restart would end what runs on it without a word.
                    owner = 'service';
                    pendingRestart = { work: work === null ? null : work.terminals + work.agents, answered: false };
                }
            } else {
                await runService(manager, () => manager.start());
            }
        },
        setKeepRunning(next) {
            if (!manager) {
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
            if (stopMachine) {
                return false;
            }
            if (owner === 'external') {
                return true;
            }
            return owner === 'service' && keepRunning();
        },
        quit(stopMachine) {
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
            if (pendingRestart === null) {
                return state();
            }
            const health = await deps.probe();
            if (health !== null && sameBuild(health, deps.expected)) {
                pendingRestart = null;
            }
            return state();
        }
    };
};
