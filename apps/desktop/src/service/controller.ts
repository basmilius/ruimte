import { decideStart, sameBuild, type BuildIdentity } from './decide';
import type { ServiceManager } from './manager';
import type { KeepRunningSetting, ServiceSupport } from './settings';

/* Who runs the daemon the window talks to. `external` is one the app found answering and does not manage. */
export type DaemonOwner = 'service' | 'app' | 'external';

/* What the client draws in the machine dialog. Mirrored in `apps/client/src/desktop/bridge.ts`. */
export interface BackgroundServiceState {
    support: ServiceSupport;
    keepRunning: boolean;
    /* Null until the start has settled. */
    owner: DaemonOwner | null;
    /* Why the service did not take the daemon this time, when the app fell back to its own. */
    failure: string | null;
    /* Linux only: whether services outlive the session. Null elsewhere. */
    linger: boolean | null;
}

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
    /* Resolves once `/health` answers and `accept` takes the answer, rejects when it never does. */
    waitForHealth(accept: (health: BuildIdentity) => boolean): Promise<void>;
    spawnDaemon(): void;
    killDaemon(): void;
}

export interface ServiceController {
    state(): BackgroundServiceState;
    /* Brings a daemon up behind the port: the service, or the app's own. Rejects when none comes up. */
    start(): Promise<void>;
    /* The switch. The daemon that runs keeps running; the other owner takes over when the app quits. */
    setKeepRunning(keepRunning: boolean): BackgroundServiceState;
    /* Whether the agents outlive this quit, for the question asked before it. */
    survivesQuit(stopMachine: boolean): boolean;
    /* What quitting does to the daemon. `stopMachine` ends the service too, until the next start. */
    quit(stopMachine: boolean): void;
    enableLinger(): BackgroundServiceState;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const createServiceController = (deps: ServiceControllerDeps): ServiceController => {
    let owner: DaemonOwner | null = null;
    let failure: string | null = null;
    const manager = deps.support === 'supported' ? deps.manager : null;
    const keepRunning = (): boolean => manager !== null && deps.setting.read();

    const state = (): BackgroundServiceState => {
        let linger: boolean | null = null;
        if (manager?.linger) {
            try {
                linger = manager.linger.enabled();
            } catch {
                linger = null;
            }
        }
        return { support: deps.support, keepRunning: keepRunning(), owner, failure, linger };
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
                await runService(manager, () => manager.restart());
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
        }
    };
};
