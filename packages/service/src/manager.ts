import { join } from 'node:path';
import { LAUNCH_AGENT_LABEL, SYSTEMD_UNIT_NAME } from './definitions';

/*
 * The service manager of the platform behind one small interface, so the app's decisions are tested
 * against a fake and never against launchctl or systemctl. The commands go through a runner and the
 * file through a file system, and the tests of this file check which commands a step runs.
 */

export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}

/* Runs a command to completion, bounded by a timeout. Synchronous, because quitting cannot wait on a promise. */
export type CommandRunner = (command: string, args: string[]) => CommandResult;

export interface ServiceFiles {
    read(path: string): string | null;
    write(path: string, text: string): void;
    remove(path: string): void;
}

export interface ServiceManager {
    readonly kind: 'launchd' | 'systemd';
    /* Where the definition lives, for the documentation and the error a person reads. */
    readonly path: string;
    isInstalled(): boolean;
    /* Puts the definition on disk, so the service starts with the person's session. A running daemon keeps running. */
    install(definition: string): void;
    /* Starts the daemon from the definition on disk; nothing when it already runs. */
    start(): void;
    /* Ends the running daemon and starts it from the definition on disk, which is how a new binary takes over. */
    restart(): Promise<void>;
    /* Ends the running daemon. The definition stays. */
    stop(): void;
    /* Takes the definition away, so nothing starts it again. A running daemon keeps running until `stop`. */
    uninstall(): void;
    /* Linux only: whether the person's services outlive their session, and the step that makes them. */
    linger?: { enabled(): boolean; enable(): void };
}

const describe = (result: CommandResult, what: string): string => `${what} failed (${result.code}): ${(result.stderr || result.stdout).trim() || 'no output'}`;

const expectSuccess = (result: CommandResult, what: string): void => {
    if (result.code !== 0) {
        throw new Error(describe(result, what));
    }
};

export interface LaunchdOptions {
    uid: number;
    home: string;
    run: CommandRunner;
    files: ServiceFiles;
    sleep(ms: number): Promise<void>;
    label?: string;
}

/*
 * A plist in ~/Library/LaunchAgents, loaded with `launchctl bootstrap` into the person's GUI domain.
 * SMAppService (Electron's `agentService`) was the other way: it wants a plist that is sealed inside
 * the bundle, where the login shell's PATH and a log path in the home cannot be written.
 */
export const launchdManager = (options: LaunchdOptions): ServiceManager => {
    const label = options.label ?? LAUNCH_AGENT_LABEL;
    const path = join(options.home, 'Library', 'LaunchAgents', `${label}.plist`);
    const domain = `gui/${options.uid}`;
    const target = `${domain}/${label}`;
    const launchctl = (...args: string[]): CommandResult => options.run('/bin/launchctl', args);
    const isLoaded = (): boolean => launchctl('print', target).code === 0;

    const bootstrap = (): void => {
        expectSuccess(launchctl('bootstrap', domain, path), 'launchctl bootstrap');
    };

    return {
        kind: 'launchd',
        path,
        isInstalled: () => options.files.read(path) !== null,
        install(definition) {
            if (options.files.read(path) !== definition) {
                options.files.write(path, definition);
            }
        },
        start() {
            if (isLoaded()) {
                expectSuccess(launchctl('kickstart', target), 'launchctl kickstart');
                return;
            }
            bootstrap();
        },
        async restart() {
            if (isLoaded()) {
                launchctl('bootout', target);
                // A bootout returns before launchd has let go of the label, and a bootstrap in that
                // window fails with an I/O error; wait for the job to be gone, a few seconds at most.
                for (let attempt = 0; attempt < 25 && isLoaded(); attempt++) {
                    await options.sleep(200);
                }
            }
            bootstrap();
        },
        stop() {
            if (isLoaded()) {
                launchctl('bootout', target);
            }
        },
        uninstall() {
            options.files.remove(path);
        }
    };
};

export interface SystemdOptions {
    configHome: string;
    run: CommandRunner;
    files: ServiceFiles;
    user: string;
    unitName?: string;
}

/* A user unit under ~/.config/systemd/user, enabled for `default.target`. */
export const systemdManager = (options: SystemdOptions): ServiceManager => {
    const unit = options.unitName ?? SYSTEMD_UNIT_NAME;
    const path = join(options.configHome, 'systemd', 'user', unit);
    const systemctl = (...args: string[]): CommandResult => options.run('systemctl', ['--user', ...args]);

    const reload = (): void => {
        expectSuccess(systemctl('daemon-reload'), 'systemctl daemon-reload');
    };

    return {
        kind: 'systemd',
        path,
        isInstalled: () => options.files.read(path) !== null,
        install(definition) {
            if (options.files.read(path) !== definition) {
                options.files.write(path, definition);
                reload();
            }
            expectSuccess(systemctl('enable', unit), 'systemctl enable');
        },
        start() {
            expectSuccess(systemctl('start', unit), 'systemctl start');
        },
        async restart() {
            reload();
            expectSuccess(systemctl('restart', unit), 'systemctl restart');
        },
        stop() {
            systemctl('stop', unit);
        },
        uninstall() {
            systemctl('disable', unit);
            options.files.remove(path);
            // A running unit stays loaded without its file, so `stop` still reaches it afterwards.
            systemctl('daemon-reload');
        },
        linger: {
            enabled: () => options.run('loginctl', ['show-user', options.user, '--property=Linger', '--value']).stdout.trim() === 'yes',
            enable() {
                expectSuccess(options.run('loginctl', ['enable-linger', options.user]), 'loginctl enable-linger');
            }
        }
    };
};
