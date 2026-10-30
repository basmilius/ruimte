import { chmod, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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

const entries = [
    join(root, 'src', 'main.ts'),
    // A worker is a module of its own in the binary; `src/fs/grep.ts` finds it at `./fs/grep-worker.ts`.
    join(root, 'src', 'fs', 'grep-worker.ts'),
    join(root, 'src', 'telemetry', 'watchdog-worker.ts')
];
const args = [
    'build',
    '--conditions=source',
    '--compile',
    `--target=bun-${bunOs[values.os]}-${values.arch}`,
    // Keep top-level await and dynamic imports while moving JavaScript compilation out of every daemon start.
    '--bytecode',
    '--format=esm',
    // Names stay, so a stack trace reads without a source map.
    '--minify-whitespace',
    '--minify-syntax',
    ...entries
];
// Windows names a program by these wherever it asks a person about it, in the firewall's question among them; Bun writes them only on Windows.
if (values.os === 'win' && process.platform === 'win32') {
    const version = (process.env.RUIMTE_VERSION ?? '0.0.0').split(/[-+]/)[0];
    args.push(
        '--windows-title=Ruimte',
        '--windows-publisher=Bas Milius',
        '--windows-copyright=Copyright © 2026 Bas Milius',
        '--windows-description=Ruimte',
        `--windows-version=${version}.0`,
        `--windows-icon=${resolve(root, '../desktop/build/icon/AppIcon.ico')}`
    );
}
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
// The binary ships without its source map; `scripts/upload-source-map.ts` hands it to Observatory under this id.
const debugId = crypto.randomUUID();
args.push('--define', `process.env.RUIMTE_DEBUG_ID=${JSON.stringify(debugId)}`);
const symbolsDir = `${outDir}.symbols`;
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
    run(['bun', ...args, '--sourcemap=none', '--outfile', binary], root).then(async (exitCode) => {
        if (exitCode !== 0 || values.os !== 'mac') {
            return exitCode;
        }
        // Bun 1.4 writes the bundle after signing, which leaves a signature the kernel refuses (SIGKILL on launch); an ad-hoc re-sign fixes it and a release signs again with the real identity anyway.
        return run(['codesign', '--sign', '-', '--force', binary], root, 'ignore');
    }),
    sourceMap()
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

/*
 * The source map of the binary, from a second build with the same arguments, which lays the bundle out
 * the same way. Bun puts any source map into the binary as well, so that binary is thrown away and
 * only its map is kept, beside the binary's folder rather than in it, under the stamped debug id.
 */
async function sourceMap(): Promise<number> {
    const scratch = `${outDir}.map-build`;
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    try {
        const exitCode = await run(['bun', ...args, '--sourcemap=external', '--outfile', join(scratch, basename(binary))], root);
        if (exitCode !== 0) {
            return exitCode;
        }
        // The workers get maps of their own, named after them; the one named after the binary is the daemon's.
        const name = (await readdir(scratch)).find((file) => file.startsWith('ruimte') && file.endsWith('.map'));
        if (name === undefined) {
            console.error('The source map build wrote no map of the daemon.');
            return 1;
        }
        const map = JSON.parse(await readFile(join(scratch, name), 'utf8')) as Record<string, unknown>;
        await rm(symbolsDir, { recursive: true, force: true });
        await mkdir(symbolsDir, { recursive: true });
        await writeFile(join(symbolsDir, 'ruimte.map'), JSON.stringify({ ...map, debugId, debug_id: debugId }));
        return 0;
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
}

/* Runs one build step and settles with its exit code. */
async function run(command: string[], cwd: string, stdout: 'inherit' | 'ignore' = 'inherit'): Promise<number> {
    const child = Bun.spawn(command, { cwd, stdio: ['ignore', stdout, 'inherit'] });
    return await child.exited;
}
