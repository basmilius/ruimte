import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { buildIdentityOf, MACHINE_HEALTH_PATH, type BuildIdentity } from '@ruimte/contracts';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { definitionRunsProgram, diskFiles, serviceDefinition, type ServiceFiles, type ServiceManager } from '@adecore/service';
import { commandLineServiceProgram, daemonServiceSpec, pathsOf, platformServiceManager, type HostEnvironment } from '@ruimte/service/host';
import { buildFileOf, readBuildFile } from '../service/self-update.ts';
import { describeError } from '../error-text.ts';
import { replaceSync, tempNameFor } from '@adecore/agents';

/*
 * `ruimte service install|uninstall|status`: the background service for a machine without the app.
 * The service never points at the binary that ran the command, since `npx` runs it out of a cache
 * that npm clears whenever it likes. It runs a copy under `$RUIMTE_HOME/bin` instead, and a later
 * install replaces that copy, which the daemon under the service notices through `ruimte.build`.
 */

/* What travels with the daemon: `ruimte-context` goes on every session's PATH, `ruimte.build` is how an update is seen. */
function binaryFiles(platform: NodeJS.Platform): string[] {
    if (platform === 'win32') {
        return ['ruimte.exe', 'ruimte-context', 'ruimte-context.exe', 'ruimte.build'];
    }
    return ['ruimte', 'ruimte-context', 'ruimte.build'];
}

/* What an earlier release copied and this one no longer does; a copy left behind would answer in place of the new one. */
const FORMER_FILES = ['ruimte-context.cmd'];

/* Windows will not replace an executable that runs, but lets it be renamed; what is left is removed once it ended. */
const RETIRED_SUFFIX = '.retired';

/* The helpers the daemon finds beside its binary, such as the Android screen server it pushes onto a device. */
const NATIVE_DIR = 'native';

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
    /* Where Windows names the profile's local folder and the account the task starts for. */
    env: HostEnvironment;
}

interface ServicePlan {
    kind: 'launchd' | 'systemd' | 'task-scheduler';
    binDir: string;
    program: string;
    definition: string;
}

/*
 * `npx` and `bunx` put their own `node_modules/.bin` folders in front of PATH, and those are gone
 * once the cache is cleared; a service that kept them would look for tools in folders that are not there.
 */
export function servicePath(path: string | undefined, platform: NodeJS.Platform = process.platform): string {
    const windows = platform === 'win32';
    const delimiter = windows ? ';' : ':';
    const kept = (path ?? '').split(delimiter).filter((entry) => {
        const slashed = windows ? entry.replace(/\\/g, '/') : entry;
        return entry !== '' && !slashed.includes('node_modules/.bin') && !slashed.includes('/_npx/');
    });
    const unique = [...new Set(kept)];
    if (unique.length > 0) {
        return unique.join(delimiter);
    }
    return windows ? 'C:\\Windows\\System32;C:\\Windows' : '/usr/local/bin:/usr/bin:/bin';
}

const UNSUPPORTED_PLATFORM = 'The background service runs on macOS, Linux and Windows only.';

const SERVICE_KINDS: Partial<Record<NodeJS.Platform, ServicePlan['kind']>> = { darwin: 'launchd', linux: 'systemd', win32: 'task-scheduler' };

export function servicePlan(facts: ServiceFacts): ServicePlan | string {
    const kind = SERVICE_KINDS[facts.platform];
    if (kind === undefined) {
        return UNSUPPORTED_PLATFORM;
    }
    const program = commandLineServiceProgram(facts.ruimteHome, facts.platform);
    const binDir = pathsOf(facts.platform).dirname(program);
    const spec = daemonServiceSpec({
        platform: facts.platform,
        program,
        args: facts.flags,
        home: facts.home,
        ruimteHome: facts.ruimteHome,
        path: servicePath(facts.path, facts.platform),
        env: facts.env
    });
    return { kind, binDir, program, definition: serviceDefinition(facts.platform, spec) };
}

export interface ServiceDeps {
    manager: ServiceManager;
    files: ServiceFiles;
    copyBinaries(from: string, to: string): void;
    removeBinaries(dir: string): string[];
    health(port: number): Promise<BuildIdentity | null>;
    /* The build id beside the binary in a folder, null when there is none. */
    readBuild(dir: string): string | null;
    user: string;
    out(line: string): void;
    err(line: string): void;
}

const APP_OWNS =
    'The background service on this machine runs another Ruimte, most likely the desktop app. Turn it off there (Settings, This machine) before installing this one.';

function ownedBy(deps: ServiceDeps, plan: ServicePlan): 'none' | 'this' | 'other' {
    const existing = deps.files.read(deps.manager.path);
    if (existing === null) {
        return 'none';
    }
    return definitionRunsProgram(existing, plan.program) ? 'this' : 'other';
}

function lingerNote(deps: ServiceDeps): void {
    if (!deps.manager.linger || deps.manager.linger.enabled()) {
        return;
    }
    deps.out('');
    deps.out('systemd stops your services when you log out, and starts this one again at your next login.');
    deps.out('To keep the machine running while nobody is logged in, allow lingering for your user:');
    deps.out(`  loginctl enable-linger ${deps.user}`);
}

async function install(facts: ServiceFacts, plan: ServicePlan, deps: ServiceDeps): Promise<number> {
    if (!facts.compiled) {
        deps.err('`ruimte service install` needs the compiled binary; run it through `npx ruimte service install`.');
        return 1;
    }
    const owner = ownedBy(deps, plan);
    if (owner === 'other') {
        deps.err(APP_OWNS);
        return 1;
    }
    const sourceDir = pathsOf(facts.platform).dirname(facts.executable);
    if (sourceDir !== plan.binDir) {
        deps.copyBinaries(sourceDir, plan.binDir);
    }
    const changed = deps.manager.install(plan.definition);
    if (owner === 'this' && changed) {
        // The flags or the PATH changed, and a service manager only reads a definition when it starts the job.
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
    deps.out('Next: `npx ruimte login` puts this machine on your account, and `npx ruimte status` says how clients reach it.');
    return 0;
}

function uninstall(plan: ServicePlan, deps: ServiceDeps): number {
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
    const left = deps.removeBinaries(plan.binDir);
    deps.out('Stopped and removed the background service. Your projects and the devices you let in stay where they were.');
    if (left.length > 0) {
        deps.out(`A program still running keeps ${left.join(', ')} in ${plan.binDir}. A later install or uninstall removes it, or delete it once it ended.`);
    }
    return 0;
}

async function status(facts: ServiceFacts, plan: ServicePlan, deps: ServiceDeps): Promise<number> {
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
}

export async function runServiceAction(action: string, facts: ServiceFacts, deps: ServiceDeps): Promise<number> {
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
}

/*
 * Each file lands under a temporary name first, so a daemon reading `ruimte.build` never sees half a
 * file. The helpers go first and whole, since a new `ruimte.build` is what restarts the daemon onto them.
 */
export function copyServiceBinaries(from: string, to: string, platform: NodeJS.Platform = process.platform): void {
    mkdirSync(to, { recursive: true });
    const native = join(to, NATIVE_DIR);
    rmSync(native, { recursive: true, force: true });
    if (existsSync(join(from, NATIVE_DIR))) {
        const temporary = tempNameFor(native);
        cpSync(join(from, NATIVE_DIR), temporary, { recursive: true });
        replaceSync(temporary, native);
    }
    removeLeftovers(to);
    for (const name of binaryFiles(platform)) {
        const target = join(to, name);
        const temporary = tempNameFor(target);
        copyFileSync(join(from, name), temporary);
        chmodSync(temporary, name === 'ruimte.build' ? 0o644 : 0o755);
        if (platform === 'win32' && name.endsWith('.exe') && existsSync(target)) {
            renameSync(target, `${tempNameFor(target)}${RETIRED_SUFFIX}`);
        }
        replaceSync(temporary, target);
    }
}

/*
 * Former files and retired executables, best effort: one another process holds open, such as a retired
 * executable that still runs, stays until a later copy or removal and never stops an install or an uninstall.
 */
function removeLeftovers(dir: string): void {
    const retired = existsSync(dir) ? readdirSync(dir).filter((entry) => entry.endsWith(RETIRED_SUFFIX)) : [];
    for (const name of [...FORMER_FILES, ...retired]) {
        try {
            rmSync(join(dir, name), { force: true });
        } catch {
            continue;
        }
    }
}

/* Removes the copy, and answers with what must stay: on Windows the executable this very command runs from, moved aside. */
export function removeServiceBinaries(dir: string, platform: NodeJS.Platform = process.platform): string[] {
    for (const name of binaryFiles(platform)) {
        const target = join(dir, name);
        try {
            rmSync(target, { force: true });
        } catch (e) {
            if (platform !== 'win32' || !name.endsWith('.exe')) {
                throw e;
            }
            renameSync(target, `${tempNameFor(target)}${RETIRED_SUFFIX}`);
        }
    }
    rmSync(join(dir, NATIVE_DIR), { recursive: true, force: true });
    removeLeftovers(dir);

    return existsSync(dir) ? readdirSync(dir).filter((entry) => entry.endsWith(RETIRED_SUFFIX)) : [];
}

async function health(port: number): Promise<BuildIdentity | null> {
    try {
        const response = await fetch(`http://127.0.0.1:${port}${MACHINE_HEALTH_PATH}`, { signal: AbortSignal.timeout(2000) });
        return buildIdentityOf(await response.json());
    } catch {
        return null;
    }
}

export async function runService(args: string[], options: { port: number; ruimteHome: string; compiled: boolean }): Promise<number> {
    const manager = platformServiceManager(process.platform);
    if (manager === null) {
        console.error(UNSUPPORTED_PLATFORM);
        return 1;
    }
    return runServiceAction(
        args[0] ?? '',
        {
            platform: process.platform,
            home: homedir(),
            ruimteHome: options.ruimteHome,
            executable: process.execPath,
            compiled: options.compiled,
            path: process.env.PATH,
            port: options.port,
            flags: args.slice(1),
            env: process.env
        },
        {
            manager,
            files: diskFiles,
            copyBinaries: copyServiceBinaries,
            removeBinaries: removeServiceBinaries,
            health,
            readBuild: (dir) => readBuildFile(buildFileOf(join(dir, 'ruimte'))),
            user: userInfo().username,
            out: (line) => console.log(line),
            err: (line) => console.error(line)
        }
    );
}
