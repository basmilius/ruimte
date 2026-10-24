import { chmod, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { downloadScrcpyServer } from '../src/devices/scrcpy-server.ts';
import { placeDatabaseHelper } from './database-helper.ts';

/*
 * Compiles the daemon into one executable per platform, with the `ruimte-context` script next
 * to it, under `dist/<os>-<arch>/`. Git Bash on Windows runs that script too; cmd and PowerShell find
 * `ruimte-context.exe` beside it, the launcher in `apps/context-launcher`. The folder names follow
 * electron-builder's macros, so the desktop build picks the right one with `${os}-${arch}`.
 *
 *   bun scripts/compile.ts                                     the machine it runs on
 *   bun scripts/compile.ts --os mac --arch x64                 cross-compile
 *   bun scripts/compile.ts --target darwin-arm64 --outdir out  the names the npm packages use, into a folder of choice
 */
const { values: flags } = parseArgs({
    args: process.argv.slice(2),
    options: {
        os: { type: 'string', default: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux' },
        arch: { type: 'string', default: process.arch },
        target: { type: 'string' },
        outdir: { type: 'string' }
    },
    strict: true
});

// `--target` speaks Node's names (`darwin-arm64`), which is what the npm packages are called after.
const nodeOs: Record<string, string> = { darwin: 'mac', linux: 'linux', win32: 'win', windows: 'win' };
const [targetOs = '', targetArch = ''] = flags.target?.split('-') ?? [];
const values = flags.target ? { os: nodeOs[targetOs] ?? targetOs, arch: targetArch } : { os: flags.os, arch: flags.arch };

const bunOs: Record<string, string> = { mac: 'darwin', linux: 'linux', win: 'windows' };
const nodePlatform: Record<string, string> = { mac: 'darwin', linux: 'linux', win: 'win32' };
if (!(values.os in bunOs) || !['x64', 'arm64'].includes(values.arch)) {
    console.error(`Unsupported target ${values.os}-${values.arch}`);
    process.exit(1);
}

const root = join(import.meta.dir, '..');
const outDir = flags.outdir ? resolve(flags.outdir) : join(root, 'dist', `${values.os}-${values.arch}`);
const binary = join(outDir, values.os === 'win' ? 'ruimte.exe' : 'ruimte');
await mkdir(outDir, { recursive: true });

const args = [
    'build',
    '--conditions=source',
    '--compile',
    `--target=bun-${bunOs[values.os]}-${values.arch}`,
    // Names stay, and the source map goes into the binary, so Bun maps every stack trace back to the source: in the log and in a crash report.
    '--minify-whitespace',
    '--minify-syntax',
    '--sourcemap',
    join(root, 'src', 'main.ts'),
    // A worker is a module of its own in the binary; `src/fs/grep.ts` finds it at `./fs/grep-worker.ts`.
    join(root, 'src', 'fs', 'grep-worker.ts'),
    join(root, 'src', 'telemetry', 'watchdog-worker.ts'),
    '--outfile',
    binary
];
// A release believes the pinned statement keys and nothing else, whatever its environment holds.
args.push('--define', 'process.env.RUIMTE_PULSAR_TEST_STATEMENT_KEY=""');
if (process.env.RUIMTE_VERSION) {
    args.push('--define', `process.env.RUIMTE_VERSION=${JSON.stringify(process.env.RUIMTE_VERSION)}`);
}
// Only a release reports crashes (`src/telemetry/reporter.ts`); any other compile is stamped silent, whatever runs it later.
args.push('--define', `process.env.RUIMTE_TELEMETRY=${JSON.stringify(process.env.RUIMTE_TELEMETRY === '1' ? '1' : '')}`);
// The same id goes into the binary and into `ruimte.build` beside it, which is how the desktop app
// tells the daemon in its bundle from an older one still running as the background service.
const buildId = `${process.env.RUIMTE_VERSION ?? 'dev'}-${crypto.randomUUID()}`;
args.push('--define', `process.env.RUIMTE_BUILD=${JSON.stringify(buildId)}`);
if (values.os === 'mac' && process.platform !== 'darwin') {
    // Only `codesign` can repair the daemon's signature, so a macOS binary built elsewhere is one the kernel refuses to start.
    console.error('A macOS binary has to be compiled on macOS.');
    process.exit(1);
}

const nativeDir = join(outDir, 'native');
await mkdir(nativeDir, { recursive: true });
const rustTarget = `${values.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
const installedCargo = join(homedir(), '.cargo', 'bin', 'cargo');
const cargo = process.env.CARGO ?? (existsSync(installedCargo) ? installedCargo : 'cargo');

// The daemon and every native helper write to places of their own, so they build side by side.
const builds: Array<Promise<number>> = [
    run(['bun', ...args], root).then(async (exitCode) => {
        if (exitCode !== 0) {
            return exitCode;
        }
        // The binary carries its source map; the copies Bun writes beside it would only ship along.
        for (const map of await readdir(outDir)) {
            if (map.endsWith('.map')) {
                await rm(join(outDir, map));
            }
        }
        if (values.os !== 'mac') {
            return exitCode;
        }
        // Bun 1.4 writes the bundle after signing, which leaves a signature the kernel refuses (SIGKILL on launch); an ad-hoc re-sign fixes it and a release signs again with the real identity anyway.
        return run(['codesign', '--sign', '-', '--force', binary], root, 'ignore');
    })
];

if (values.os === 'mac') {
    if (values.arch === 'arm64') {
        const foundationRoot = resolve(root, '../foundation-models');
        builds.push(
            run(['bun', join(foundationRoot, 'scripts/build.ts')], root).then(async (exitCode) => {
                if (exitCode !== 0) {
                    return exitCode;
                }
                const helper = join(nativeDir, 'ruimte-foundation-models');
                await copyFile(join(foundationRoot, 'dist', 'ruimte-foundation-models'), helper);
                await copyFile(join(foundationRoot, 'dist', 'ruimte-foundation-models.NOTICES'), `${helper}.NOTICES`);
                await chmod(helper, 0o755);
                return 0;
            })
        );
    }

    builds.push(
        run(['bun', resolve(root, '../ios-device-bridge/scripts/build.ts'), '--target', rustTarget, '--outfile', join(nativeDir, 'ios-device-bridge')], root)
    );

    const middleware = Bun.resolveSync('serve-sim/middleware', root);
    await copyFile(join(dirname(middleware), 'native', 'serve-sim-native.node'), join(nativeDir, 'serve-sim-native.node'));
    const axHelper = join(nativeDir, 'serve-sim-ax-settings');
    await copyFile(join(dirname(middleware), 'simax', 'serve-sim-ax-settings'), axHelper);
    await chmod(axHelper, 0o755);
    // Runs inside an iPhone Duo simulator for its hinge and buttons; the 3D preview beside it in the package is not used.
    const duoHelper = join(nativeDir, 'serve-sim-duo-hid');
    await copyFile(join(dirname(middleware), 'simduo', 'serve-sim-duo-hid'), duoHelper);
    await chmod(duoHelper, 0o755);
    // The camera feed of a simulator: the helper writes the frames, and an app launched with the library reads them.
    const cameraHelper = join(nativeDir, 'serve-sim-camera-helper');
    await copyFile(join(dirname(middleware), 'simcam', 'serve-sim-camera-helper'), cameraHelper);
    await chmod(cameraHelper, 0o755);
    await copyFile(join(dirname(middleware), 'simcam', 'libSimCameraInjector.dylib'), join(nativeDir, 'libSimCameraInjector.dylib'));

    /* The speech helper links a prebuilt ONNX Runtime that needs a newer glibc and libstdc++ than
       the Linux build targets, so Speech to Text stays macOS only until that floor moves. A build
       without the helper reports the feature as unavailable. */
    const speechRoot = join(root, '../speech-bridge');
    builds.push(
        run([cargo, 'build', '--release', '--locked', '--target', rustTarget], speechRoot).then(async (exitCode) => {
            if (exitCode !== 0) {
                return exitCode;
            }
            const speechHelper = join(nativeDir, 'speech-bridge');
            await copyFile(join(speechRoot, 'target', rustTarget, 'release', 'speech-bridge'), speechHelper);
            await chmod(speechHelper, 0o755);
            return 0;
        })
    );

    // The desktop build moves `Helpers` out of the daemon's folder into the app's own; see electron-builder.yml.
    builds.push(
        run(
            ['bun', resolve(root, '../computer-use/scripts/build.ts'), '--variant', 'release', '--arch', values.arch, '--outdir', join(outDir, 'Helpers')],
            root
        )
    );
}

if (values.os === 'win') {
    // MSVC is the toolchain of a Windows runner; anywhere else the MinGW one cross-compiles, with `x86_64-w64-mingw32-gcc` installed.
    const launcherRoot = resolve(root, '../context-launcher');
    const launcherTarget = `${values.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-${process.platform === 'win32' ? 'msvc' : 'gnu'}`;
    builds.push(
        run([cargo, 'build', '--release', '--locked', '--target', launcherTarget], launcherRoot).then(async (exitCode) => {
            if (exitCode !== 0) {
                return exitCode;
            }
            await copyFile(join(launcherRoot, 'target', launcherTarget, 'release', 'ruimte-context.exe'), join(outDir, 'ruimte-context.exe'));
            return 0;
        })
    );
}

// Every build settles before the script ends, so a failure never leaves another one running on its own.
const settled = await Promise.allSettled(builds);
for (const result of settled) {
    if (result.status === 'rejected') {
        console.error(result.reason instanceof Error ? result.reason.message : String(result.reason));
        process.exit(1);
    }
    if (result.value !== 0) {
        process.exit(result.value);
    }
}

try {
    await placeDatabaseHelper(root, nativeDir, nodePlatform[values.os]!, values.arch);
} catch (e) {
    console.error(`The database helper could not be placed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
}

if (values.os === 'mac' || values.os === 'linux') {
    // Android devices work the same on both, through the screen server pushed onto them.
    await downloadScrcpyServer(nativeDir);
}

await copyFile(join(root, 'bin', 'ruimte-context'), join(outDir, 'ruimte-context'));
await chmod(join(outDir, 'ruimte-context'), 0o755);
await writeFile(join(outDir, 'ruimte.build'), `${buildId}\n`);
console.log(`Compiled ${binary}`);

/* Runs one build step and settles with its exit code. */
async function run(command: string[], cwd: string, stdout: 'inherit' | 'ignore' = 'inherit'): Promise<number> {
    const child = Bun.spawn(command, { cwd, stdio: ['ignore', stdout, 'inherit'] });
    return await child.exited;
}
