import { existsSync, watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { hasOwnedProcessMembers, scheduleForcedStop, stopOwnedProcess } from './dev-processes';
import { cargoExecutables, rustProfileDirectory, rustServerExecutable, rustTargetDirectory, rustWorkspaceBuildArguments } from './rust-build';

const root = resolve(import.meta.dir, '..');
const profile = process.env.RUIMTE_RUST_PROFILE ?? 'dev';
const cargoInHome = join(homedir(), '.cargo', 'bin', 'cargo');
const cargo = process.env.RUIMTE_CARGO ?? (existsSync(cargoInHome) ? cargoInHome : 'cargo');
const targetRoot = rustTargetDirectory(root);
const targetDir = join(targetRoot, rustProfileDirectory(profile));
const explicitExecutable = process.env.RUIMTE_RUST_EXECUTABLE;
let executable = explicitExecutable ?? rustServerExecutable(root, profile);
const schemaGenerator = process.env.RUIMTE_RUST_SCHEMA_GENERATOR ?? join(root, 'packages/contracts/scripts/generate-rust-schema.ts');
const schemaOutput = resolve(process.env.RUIMTE_RUST_SCHEMA_OUTPUT ?? join(root, 'apps/server-rust/schema/contracts.json'));
const daemonArgs = process.argv.slice(2);
const environment = {
    ...process.env,
    PATH: `${targetDir}:${process.env.PATH ?? ''}`
};
const detached = process.platform !== 'win32';

let daemon: ChildProcess | null = null;
let activeBuild: ChildProcess | null = null;
let queued = false;
let running = false;
let stopping = false;
let started = false;
let schemaDirty = true;
let schemaGeneration: Promise<boolean> | null = null;
let generatedSchema: Buffer | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
const watchers: FSWatcher[] = [];
const intentionalStops = new WeakSet<ChildProcess>();

interface FileVersion {
    change: bigint;
    device: bigint;
    inode: bigint;
    modified: bigint;
    size: bigint;
}

const fileVersion = async (path: string): Promise<FileVersion | null> => {
    const value = await stat(path, { bigint: true }).catch(() => null);
    return value ? { change: value.ctimeNs, device: value.dev, inode: value.ino, modified: value.mtimeNs, size: value.size } : null;
};

const sameFileVersion = (left: FileVersion | null, right: FileVersion | null): boolean =>
    left !== null &&
    right !== null &&
    left.change === right.change &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.modified === right.modified &&
    left.size === right.size;

const groupDrained = (child: ChildProcess): boolean => (child.exitCode !== null || child.signalCode !== null) && !hasOwnedProcessMembers(child);

const stopChild = async (child: ChildProcess, signal: NodeJS.Signals): Promise<void> => {
    intentionalStops.add(child);
    stopOwnedProcess(child, signal);
    const forced = scheduleForcedStop([child]);
    const deadline = Date.now() + 6000;
    while (!groupDrained(child) && Date.now() < deadline) {
        await Bun.sleep(25);
    }
    if (groupDrained(child)) {
        clearTimeout(forced);
    }
};

const stop = async (signal: NodeJS.Signals, exitCode: number): Promise<never> => {
    if (stopping) {
        await new Promise<never>(() => {});
    }
    stopping = true;
    for (const watcher of watchers) {
        watcher.close();
    }
    if (debounce !== null) {
        clearTimeout(debounce);
    }
    const children = [activeBuild, daemon].filter((child): child is ChildProcess => child !== null);
    await Promise.all(children.map((child) => stopChild(child, signal)));
    process.exit(exitCode);
};

const runBuildCommand = async (command: string, args: string[], label: string): Promise<boolean> => {
    const child = spawn(command, args, {
        cwd: root,
        env: environment,
        stdio: 'inherit',
        detached
    });
    activeBuild = child;
    return await new Promise<boolean>((resolveResult) => {
        let settled = false;
        const finish = (success: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (activeBuild === child) {
                activeBuild = null;
            }
            resolveResult(success);
        };
        child.once('error', (error) => {
            console.error(`Could not run ${label}: ${error.message}`);
            finish(false);
        });
        child.once('exit', (code) => {
            void stopChild(child, 'SIGTERM').then(() => finish(code === 0));
        });
    });
};

const runCargoBuild = async (): Promise<{ executables: Map<string, string>; success: boolean }> => {
    const child = spawn(cargo, rustWorkspaceBuildArguments(root, profile), {
        cwd: root,
        env: environment,
        stdio: ['ignore', 'pipe', 'inherit'],
        detached
    });
    activeBuild = child;
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
        output += chunk;
    });
    const success = await new Promise<boolean>((resolveResult) => {
        let settled = false;
        const finish = (result: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (activeBuild === child) {
                activeBuild = null;
            }
            resolveResult(result);
        };
        child.once('error', (error) => {
            console.error(`Could not run Cargo: ${error.message}`);
            finish(false);
        });
        child.once('exit', (code) => {
            void stopChild(child, 'SIGTERM').then(() => finish(code === 0));
        });
    });
    return { executables: cargoExecutables(output), success };
};

const generateSchema = async (): Promise<boolean> => {
    const generation = runBuildCommand(process.execPath, [schemaGenerator], 'the Rust schema generator');
    schemaGeneration = generation;
    const generated = await generation;
    generatedSchema = await readFile(schemaOutput).catch(() => null);
    if (schemaGeneration === generation) {
        schemaGeneration = null;
    }
    return generated;
};

const buildOnce = async (): Promise<{ serverChanged: boolean; success: boolean }> => {
    if (schemaDirty) {
        schemaDirty = false;
        if (!(await generateSchema())) {
            return { serverChanged: false, success: false };
        }
    }
    const before = await fileVersion(executable);
    const build = await runCargoBuild();
    if (!build.success) {
        return { serverChanged: false, success: false };
    }
    const builtExecutable = explicitExecutable ?? build.executables.get('ruimte-server') ?? executable;
    const executableChanged = builtExecutable !== executable;
    executable = builtExecutable;
    const contextExecutable = build.executables.get('ruimte-context');
    const executableDirectory = dirname(contextExecutable ?? executable);
    environment.PATH = `${executableDirectory}:${process.env.PATH ?? ''}`;
    const after = await fileVersion(executable);
    if (after === null) {
        console.error(`Cargo succeeded but did not produce ${executable}`);
        return { serverChanged: false, success: false };
    }
    return { serverChanged: executableChanged || !sameFileVersion(before, after), success: true };
};

const restartDaemon = async (): Promise<boolean> => {
    const previous = daemon;
    daemon = null;
    if (previous !== null) {
        await stopChild(previous, 'SIGTERM');
    }
    if (stopping) {
        return false;
    }
    const child = spawn(executable, daemonArgs, {
        cwd: root,
        env: environment,
        stdio: 'inherit',
        detached
    });
    daemon = child;
    child.once('exit', (code, signal) => {
        if (!stopping && !intentionalStops.has(child)) {
            console.error(`Rust daemon exited with ${signal ?? code}`);
            void stop('SIGTERM', code ?? 1);
        } else if (daemon === child) {
            daemon = null;
        }
    });
    return await new Promise<boolean>((resolveStart) => {
        child.once('spawn', () => resolveStart(true));
        child.once('error', (error) => {
            if (daemon === child) {
                daemon = null;
            }
            console.error(`Could not start the Rust daemon: ${error.message}`);
            resolveStart(false);
        });
    });
};

const runQueuedBuilds = async (): Promise<void> => {
    if (running || stopping) {
        return;
    }
    running = true;
    while (queued && !stopping) {
        queued = false;
        const build = await buildOnce();
        if (!build.success) {
            console.error('Rust build failed; the last successful daemon keeps running.');
            if (!started) {
                await stop('SIGTERM', 1);
            }
            continue;
        }
        if (started && !build.serverChanged) {
            continue;
        }
        const launched = await restartDaemon();
        if (!launched) {
            if (!stopping) {
                await stop('SIGTERM', 1);
            }
            break;
        }
        started = true;
    }
    running = false;
};

const compile = (): void => {
    if (stopping) {
        return;
    }
    queued = true;
    void runQueuedBuilds();
};

const changed = (contracts = false): void => {
    schemaDirty ||= contracts;
    if (debounce !== null) {
        clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
        debounce = null;
        compile();
    }, 150);
};

const ignoredWatchEntry = (filename: string | Buffer | null): boolean =>
    filename !== null &&
    filename
        .toString()
        .split(/[\\/]/)
        .some((part) => part === 'node_modules' || part === 'target');

const watchPath = (path: string, contracts = false, generated = false): void => {
    if (!existsSync(path)) {
        return;
    }
    watchers.push(
        watch(path, { recursive: true }, (_event, filename) => {
            if (ignoredWatchEntry(filename)) {
                return;
            }
            if (generated) {
                void (async () => {
                    const activeGeneration = schemaGeneration;
                    if (activeGeneration !== null) {
                        await activeGeneration;
                    }
                    const current = await readFile(path).catch(() => null);
                    if (current !== null && generatedSchema !== null && current.equals(generatedSchema)) {
                        return;
                    }
                    changed();
                })();
                return;
            }
            changed(contracts);
        })
    );
};

const customWatchPaths = process.env.RUIMTE_RUST_WATCH_PATHS?.split(delimiter).filter(Boolean);
const customContractWatchPaths = process.env.RUIMTE_RUST_CONTRACT_WATCH_PATHS?.split(delimiter).filter(Boolean);
if (customWatchPaths !== undefined || customContractWatchPaths !== undefined) {
    for (const path of customContractWatchPaths ?? []) {
        watchPath(path, true);
    }
    for (const path of customWatchPaths ?? []) {
        watchPath(path);
    }
} else {
    watchPath(join(root, 'Cargo.toml'));
    watchPath(join(root, 'Cargo.lock'));
    watchPath(join(root, '.cargo/config.toml'));
    watchPath(join(root, 'rust-toolchain.toml'));
    watchPath(join(root, 'crates'));
    watchPath(join(root, 'apps/server-rust/src'));
    watchPath(join(root, 'apps/server-rust/vendor'));
    watchPath(join(root, 'apps/server-rust/Cargo.toml'));
    watchPath(schemaGenerator, true);
    watchPath(join(root, 'packages/contracts/src'), true);
}
watchPath(schemaOutput, false, true);

process.on('SIGINT', () => void stop('SIGINT', 0));
process.on('SIGTERM', () => void stop('SIGTERM', 0));
compile();
