import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

/*
 * Compiles the daemon into one executable per platform, with the `ruimte-context` script next
 * to it, under `dist/<os>-<arch>/`. The folder names follow electron-builder's macros, so the
 * desktop build picks the right one with `${os}-${arch}`.
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
const nodeOs: Record<string, string> = { darwin: 'mac', linux: 'linux', windows: 'win' };
const [targetOs = '', targetArch = ''] = flags.target?.split('-') ?? [];
const values = flags.target ? { os: nodeOs[targetOs] ?? targetOs, arch: targetArch } : { os: flags.os, arch: flags.arch };

const bunOs: Record<string, string> = { mac: 'darwin', linux: 'linux', win: 'windows' };
if (!(values.os in bunOs) || !['x64', 'arm64'].includes(values.arch)) {
    console.error(`Unsupported target ${values.os}-${values.arch}`);
    process.exit(1);
}

const root = join(import.meta.dir, '..');
const outDir = flags.outdir ? resolve(flags.outdir) : join(root, 'dist', `${values.os}-${values.arch}`);
const binary = join(outDir, values.os === 'win' ? 'ruimte.exe' : 'ruimte');
await mkdir(outDir, { recursive: true });

const args = ['build', '--compile', `--target=bun-${bunOs[values.os]}-${values.arch}`, '--minify', join(root, 'src', 'main.ts'), '--outfile', binary];
// A release believes the pinned statement keys and nothing else, whatever its environment holds.
args.push('--define', 'process.env.RUIMTE_PULSAR_TEST_STATEMENT_KEY=""');
if (process.env.RUIMTE_VERSION) {
    args.push('--define', `process.env.RUIMTE_VERSION=${JSON.stringify(process.env.RUIMTE_VERSION)}`);
}
// The same id goes into the binary and into `ruimte.build` beside it, which is how the desktop app
// tells the daemon in its bundle from an older one still running as the background service.
const buildId = `${process.env.RUIMTE_VERSION ?? 'dev'}-${crypto.randomUUID()}`;
args.push('--define', `process.env.RUIMTE_BUILD=${JSON.stringify(buildId)}`);
const build = Bun.spawnSync(['bun', ...args], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
if (build.exitCode !== 0) {
    process.exit(build.exitCode);
}

if (values.os === 'mac') {
    if (process.platform !== 'darwin') {
        // Only `codesign` can repair the signature below, so a macOS binary built elsewhere is one the kernel refuses to start.
        console.error('A macOS binary has to be compiled on macOS.');
        process.exit(1);
    }
    // Bun 1.4 writes the bundle after signing, which leaves a signature the kernel refuses (SIGKILL on launch); an ad-hoc re-sign fixes it and a release signs again with the real identity anyway.
    const sign = Bun.spawnSync(['codesign', '--sign', '-', '--force', binary], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (sign.exitCode !== 0) {
        process.exit(sign.exitCode);
    }

    const middleware = Bun.resolveSync('serve-sim/middleware', root);
    const nativeDir = join(outDir, 'native');
    await mkdir(nativeDir, { recursive: true });
    const rustTarget = `${values.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
    const deviceBridge = join(nativeDir, 'ios-device-bridge');
    const bridgeBuild = Bun.spawnSync(['bun', resolve(root, '../ios-device-bridge/scripts/build.ts'), '--target', rustTarget, '--outfile', deviceBridge], {
        cwd: root,
        stdio: ['ignore', 'inherit', 'inherit']
    });
    if (bridgeBuild.exitCode !== 0) {
        process.exit(bridgeBuild.exitCode);
    }
    await copyFile(join(dirname(middleware), 'native', 'serve-sim-native.node'), join(nativeDir, 'serve-sim-native.node'));
    const axHelper = join(nativeDir, 'serve-sim-ax-settings');
    await copyFile(join(dirname(middleware), 'simax', 'serve-sim-ax-settings'), axHelper);
    await chmod(axHelper, 0o755);

    /* The speech helper links a prebuilt ONNX Runtime that needs a newer glibc and libstdc++ than
       the Linux build targets, so Speech to Text stays macOS only until that floor moves. A build
       without the helper reports the feature as unavailable. */
    const speechRoot = join(root, '../speech-bridge');
    const installedCargo = join(homedir(), '.cargo', 'bin', 'cargo');
    const speechBuild = Bun.spawnSync(
        [process.env.CARGO ?? (existsSync(installedCargo) ? installedCargo : 'cargo'), 'build', '--release', '--locked', '--target', rustTarget],
        {
            cwd: speechRoot,
            stdio: ['ignore', 'inherit', 'inherit']
        }
    );
    if (speechBuild.exitCode !== 0) {
        process.exit(speechBuild.exitCode);
    }
    const speechHelper = join(nativeDir, 'speech-bridge');
    await copyFile(join(speechRoot, 'target', rustTarget, 'release', 'speech-bridge'), speechHelper);
    await chmod(speechHelper, 0o755);
}

await copyFile(join(root, 'bin', 'ruimte-context'), join(outDir, 'ruimte-context'));
await chmod(join(outDir, 'ruimte-context'), 0o755);
await writeFile(join(outDir, 'ruimte.build'), `${buildId}\n`);
console.log(`Compiled ${binary}`);
