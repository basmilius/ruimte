import { copyFile, mkdir, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

/*
 * Builds the helper with Swift Package Manager and assembles the app around it.
 *
 *   bun scripts/build.ts                                         the dev app for this Mac into dist/, with `cu` inside and dist/cu beside it
 *   bun scripts/build.ts --variant release --arch arm64 --outdir <dir>
 *
 * Signs with the first Apple Development identity in the keychain, so the Accessibility and Screen
 * Recording grants survive a rebuild; `--identity` or RUIMTE_COMPUTER_USE_IDENTITY picks another,
 * and `-` signs ad hoc. A release is signed again by electron-builder with the app's Developer ID.
 */
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        variant: { type: 'string', default: 'dev' },
        arch: { type: 'string', default: process.arch },
        outdir: { type: 'string' },
        identity: { type: 'string' }
    },
    strict: true
});

if (process.platform !== 'darwin') {
    console.log('Skipped the computer use helper: it is macOS only.');
    process.exit(0);
}

const swiftArch: Record<string, string> = { arm64: 'arm64', x64: 'x86_64' };
if (!['dev', 'release'].includes(values.variant) || !(values.arch in swiftArch)) {
    console.error('Usage: bun scripts/build.ts [--variant dev|release] [--arch arm64|x64] [--outdir <dir>] [--identity <name|hash|->]');
    process.exit(1);
}

const development = values.variant === 'dev';
const root = resolve(import.meta.dir, '..');
const outDir = resolve(values.outdir ?? join(root, 'dist'));
const name = development ? 'Ruimte Computer Use Dev' : 'Ruimte Computer Use';
const bundleId = development ? 'app.ruimte.computer-use.dev' : 'app.ruimte.computer-use';
const app = join(outDir, `${name}.app`);
const executable = 'RuimteComputerUse';
const entitlements = join(root, 'Resources', 'entitlements.plist');

const run = (command: string[], capture = false): string => {
    const result = Bun.spawnSync(command, { cwd: root, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
    if (result.exitCode !== 0) {
        console.error(`${command.join(' ')} exited with ${result.exitCode}`);
        process.exit(result.exitCode || 1);
    }
    return capture ? result.stdout.toString().trim() : '';
};

const signingIdentity = (): { identity: string; label: string } => {
    const explicit = values.identity ?? process.env.RUIMTE_COMPUTER_USE_IDENTITY;
    if (explicit) {
        return { identity: explicit, label: explicit === '-' ? 'ad hoc' : explicit };
    }
    const listing = Bun.spawnSync(['security', 'find-identity', '-v', '-p', 'codesigning']).stdout.toString();
    const match = listing.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(Apple Development: [^"]+)"/m);
    if (match?.[1] && match[2]) {
        return { identity: match[1], label: match[2] };
    }
    console.warn('No Apple Development identity in the keychain, so the helper is signed ad hoc: macOS asks for its grants again after every build.');
    return { identity: '-', label: 'ad hoc' };
};

const swiftBuild = ['swift', 'build', '-c', 'release', '--arch', swiftArch[values.arch] ?? values.arch];
const products = development ? [executable, 'cu'] : [executable];
for (const product of products) {
    run([...swiftBuild, '--product', product]);
}
const binPath = run([...swiftBuild, '--show-bin-path'], true);

// A dev helper still running keeps the old build until it quits.
const previousCu = join(app, 'Contents', 'MacOS', 'cu');
if (existsSync(previousCu)) {
    Bun.spawnSync([previousCu, 'quit'], { stdio: ['ignore', 'ignore', 'ignore'] });
}

await rm(app, { recursive: true, force: true });
const contents = join(app, 'Contents');
await mkdir(join(contents, 'MacOS'), { recursive: true });
await mkdir(join(contents, 'Resources'), { recursive: true });

const plist = join(contents, 'Info.plist');
await copyFile(join(root, 'Resources', 'Info.plist'), plist);
// A bundle version is numbers only, so a prerelease tag keeps its numeric part.
const version = process.env.RUIMTE_VERSION?.match(/^\d+\.\d+\.\d+/)?.[0] ?? '0.0.0';
const plistStrings: Record<string, string> = {
    CFBundleIdentifier: bundleId,
    CFBundleName: name,
    CFBundleDisplayName: name,
    CFBundleShortVersionString: version,
    CFBundleVersion: version
};
for (const [key, value] of Object.entries(plistStrings)) {
    run(['plutil', '-replace', key, '-string', value, plist]);
}

await copyFile(join(binPath, executable), join(contents, 'MacOS', executable));
if (development) {
    await copyFile(join(binPath, 'cu'), join(contents, 'MacOS', 'cu'));
}
// System Settings lists the helper by this icon when a person grants it access.
const icon = join(root, '..', 'desktop', 'build', 'icon', 'AppIcon.icns');
if (existsSync(icon)) {
    await copyFile(icon, join(contents, 'Resources', 'AppIcon.icns'));
    run(['plutil', '-replace', 'CFBundleIconFile', '-string', 'AppIcon', plist]);
}

const { identity, label } = signingIdentity();
const sign = ['codesign', '--force', '--options', 'runtime', '--timestamp=none', '--entitlements', entitlements, '--sign', identity];
if (development) {
    run([...sign, '--identifier', `${bundleId}.cu`, join(contents, 'MacOS', 'cu')]);
}
run([...sign, app]);
run(['codesign', '--verify', '--strict', '--deep', app]);

if (development) {
    const link = join(outDir, 'cu');
    await rm(link, { force: true });
    await symlink(join(`${name}.app`, 'Contents', 'MacOS', 'cu'), link);
}
console.log(`Built ${app} (${bundleId}, signed ${label})`);
