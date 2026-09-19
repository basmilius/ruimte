import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import {
    LAUNCH_AGENT_LABEL,
    definitionRunsProgram,
    diskFiles,
    launchAgentPlist,
    launchdManager,
    runCommand,
    systemdManager,
    systemdUnit,
    type ServiceFiles,
    type ServiceManager,
    type ServiceSpec
} from '@ruimte/service';
import { buildFileOf, readBuildFile } from '../service/self-update.ts';
import { describeError } from '../error-text.ts';

/*
 * `ruimte service install|uninstall|status`: the background service for a machine without the app.
 * The service never points at the binary that ran the command, since `npx` runs it out of a cache
 * that npm clears whenever it likes. It runs a copy under `$RUIMTE_HOME/bin` instead, and a later
 * install replaces that copy, which the daemon under the service notices through `ruimte.build`.
 */

/* What travels with the daemon: `ruimte-context` goes on every session's PATH, `ruimte.build` is how an update is seen. */
export const BINARY_FILES = ['ruimte', 'ruimte-context', 'ruimte.build'] as const;

export interface ServiceFacts {
    platform: NodeJS.Platform;
    home: string;
    ruimteHome: string;
    /* The binary running this command; in a checkout that is Bun itself. */
    executable: string;
    compiled: boolean;
    /* The PATH of the shell the command runs in, which is what the service's terminals should find. */
    path: string | undefined;
    port: number;
    /* The daemon flags after the action, written into the definition as they were typed. */
    flags: string[];
}

export interface ServicePlan {
    kind: 'launchd' | 'systemd';
    binDir: string;
    program: string;
    definition: string;
}

/*
 * `npx` and `bunx` put their own `node_modules/.bin` folders in front of PATH, and those are gone
 * once the cache is cleared; a service that kept them would look for tools in folders that are not there.
 */
export const servicePath = (path: string | undefined): string => {
    const kept = (path ?? '').split(':').filter((entry) => entry !== '' && !entry.includes('node_modules/.bin') && !entry.includes('/_npx/'));
    const unique = [...new Set(kept)];
    return unique.length > 0 ? unique.join(':') : '/usr/local/bin:/usr/bin:/bin';
};

export const serviceKindOf = (platform: NodeJS.Platform): 'launchd' | 'systemd' | null => {
    if (platform === 'darwin') {
        return 'launchd';
    }
    if (platform === 'linux') {
        return 'systemd';
    }
    return null;
};

export const servicePlan = (facts: ServiceFacts): ServicePlan | string => {
    const kind = serviceKindOf(facts.platform);
    if (kind === null) {
        return 'The background service runs on macOS and Linux only.';
    }
    const binDir = join(facts.ruimteHome, 'bin');
    const program = join(binDir, 'ruimte');
    const spec: ServiceSpec = {
        label: LAUNCH_AGENT_LABEL,
        program,
        args: facts.flags,
        // `RUIMTE_SERVICE` tells the daemon that something starts it again when it exits, so it may update itself.
        environment: { RUIMTE_HOME: facts.ruimteHome, PATH: servicePath(facts.path), RUIMTE_SERVICE: '1' },
        workingDirectory: facts.home,
        // The same log the app's service writes, so one place to look whichever installed it.
        logFile: join(facts.home, 'Library', 'Logs', 'Ruimte', 'daemon.log')
    };
    return { kind, binDir, program, definition: kind === 'launchd' ? launchAgentPlist(spec) : systemdUnit(spec) };
};

export interface Health {
    version: string;
    build: string | null;
}

export interface ServiceDeps {
    manager: ServiceManager;
    files: ServiceFiles;
    /* Copies the binary files from the folder of the running one into the service's folder. */
    copyBinaries(from: string, to: string): void;
    removeBinaries(dir: string): void;
    health(port: number): Promise<Health | null>;
    /* The build id beside the binary in a folder, null when there is none. */
    readBuild(dir: string): string | null;
    user: string;
    out(line: string): void;
    err(line: string): void;
}

const APP_OWNS =
    'The background service on this machine runs another Ruimte, most likely the desktop app. Turn it off there (Settings, This machine) before installing this one.';

const ownedBy = (deps: ServiceDeps, plan: ServicePlan): 'none' | 'this' | 'other' => {
    const existing = deps.files.read(deps.manager.path);
    if (existing === null) {
        return 'none';
    }
    return definitionRunsProgram(existing, plan.program) ? 'this' : 'other';
};

const lingerNote = (deps: ServiceDeps): void => {
    if (!deps.manager.linger || deps.manager.linger.enabled()) {
        return;
    }
    deps.out('');
    deps.out('systemd stops your services when you log out, and starts this one again at your next login.');
    deps.out('To keep the machine running while nobody is logged in, allow lingering for your user:');
    deps.out(`  loginctl enable-linger ${deps.user}`);
};

const install = async (facts: ServiceFacts, plan: ServicePlan, deps: ServiceDeps): Promise<number> => {
    if (!facts.compiled) {
        deps.err('`ruimte service install` needs the compiled binary; run it through `npx ruimte service install`.');
        return 1;
    }
    const owner = ownedBy(deps, plan);
    if (owner === 'other') {
        deps.err(APP_OWNS);
        return 1;
    }
    const sourceDir = dirname(facts.executable);
    if (sourceDir !== plan.binDir) {
        deps.copyBinaries(sourceDir, plan.binDir);
    }
    const previous = deps.files.read(deps.manager.path);
    deps.manager.install(plan.definition);
    if (owner === 'this' && previous !== plan.definition) {
        // The flags or the PATH changed, and launchd and systemd only read a definition when they start the job.
        await deps.manager.restart();
        deps.out('The service now runs with the new definition.');
    } else {
        deps.manager.start();
    }
    deps.out(`Installed the background service: ${deps.manager.path}`);
    deps.out(`It runs ${plan.program} and starts with your session.`);
    const running = await deps.health(facts.port);
    const onDisk = deps.readBuild(plan.binDir);
    if (running && running.build !== null && onDisk !== null && running.build !== onDisk) {
        deps.out('A daemon from an earlier install is still running; it switches to this one as soon as nothing is running on it.');
    }
    lingerNote(deps);
    deps.out('');
    deps.out('Next: `npx ruimte pair` for a pairing link, or `npx ruimte login` to add this machine to your account.');
    return 0;
};

const uninstall = (plan: ServicePlan, deps: ServiceDeps): number => {
    const owner = ownedBy(deps, plan);
    if (owner === 'none') {
        deps.out('No background service is installed.');
        return 0;
    }
    if (owner === 'other') {
        deps.err(APP_OWNS);
        return 1;
    }
    deps.manager.stop();
    deps.manager.uninstall();
    deps.removeBinaries(plan.binDir);
    deps.out('Stopped and removed the background service. Your projects and pairings stay where they were.');
    return 0;
};

const status = async (facts: ServiceFacts, plan: ServicePlan, deps: ServiceDeps): Promise<number> => {
    const owner = ownedBy(deps, plan);
    if (owner === 'none') {
        deps.out('Not installed. `npx ruimte service install` sets it up.');
    } else if (owner === 'other') {
        deps.out(`Installed by another Ruimte, most likely the desktop app: ${deps.manager.path}`);
    } else {
        deps.out(`Installed: ${deps.manager.path}`);
        deps.out(`Binary: ${plan.program} (build ${deps.readBuild(plan.binDir) ?? 'unknown'})`);
    }
    const running = await deps.health(facts.port);
    deps.out(running ? `Running: version ${running.version} on port ${facts.port}` : `Not running on port ${facts.port}`);
    if (deps.manager.linger) {
        deps.out(
            `Lingering: ${deps.manager.linger.enabled() ? 'on, it keeps running after you log out' : `off, it stops when you log out (loginctl enable-linger ${deps.user})`}`
        );
    }
    return owner !== 'none' && running ? 0 : 1;
};

export const runServiceAction = async (action: string, facts: ServiceFacts, deps: ServiceDeps): Promise<number> => {
    const plan = servicePlan(facts);
    if (typeof plan === 'string') {
        deps.err(plan);
        return 1;
    }
    try {
        switch (action) {
            case 'install':
                return await install(facts, plan, deps);
            case 'uninstall':
                return uninstall(plan, deps);
            case 'status':
                return await status(facts, plan, deps);
            default:
                deps.err('Usage: ruimte service install|uninstall|status [daemon flags]');
                return 1;
        }
    } catch (e) {
        deps.err(describeError(e, false));
        return 1;
    }
};

/* Each file lands under a temporary name first, so a daemon reading `ruimte.build` never sees half a file. */
const copyBinaries = (from: string, to: string): void => {
    mkdirSync(to, { recursive: true });
    for (const name of BINARY_FILES) {
        const target = join(to, name);
        const temporary = `${target}.${process.pid}.tmp`;
        copyFileSync(join(from, name), temporary);
        chmodSync(temporary, name === 'ruimte.build' ? 0o644 : 0o755);
        renameSync(temporary, target);
    }
};

const removeBinaries = (dir: string): void => {
    for (const name of BINARY_FILES) {
        rmSync(join(dir, name), { force: true });
    }
};

const health = async (port: number): Promise<Health | null> => {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
        const body = (await response.json()) as { version?: unknown; build?: unknown };
        return typeof body.version === 'string' ? { version: body.version, build: typeof body.build === 'string' ? body.build : null } : null;
    } catch {
        return null;
    }
};

const createManager = (platform: NodeJS.Platform): ServiceManager => {
    if (platform === 'darwin') {
        return launchdManager({
            uid: process.getuid?.() ?? 0,
            home: homedir(),
            run: runCommand,
            files: diskFiles,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        });
    }
    return systemdManager({
        configHome: process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
        user: userInfo().username,
        run: runCommand,
        files: diskFiles
    });
};

export const runService = (args: string[], options: { port: number; ruimteHome: string; compiled: boolean }): Promise<number> =>
    runServiceAction(
        args[0] ?? '',
        {
            platform: process.platform,
            home: homedir(),
            ruimteHome: options.ruimteHome,
            executable: process.execPath,
            compiled: options.compiled,
            path: process.env.PATH,
            port: options.port,
            flags: args.slice(1)
        },
        {
            manager: createManager(process.platform),
            files: diskFiles,
            copyBinaries,
            removeBinaries,
            health,
            readBuild: (dir) => readBuildFile(buildFileOf(join(dir, 'ruimte'))),
            user: userInfo().username,
            out: (line) => console.log(line),
            err: (line) => console.error(line)
        }
    );
