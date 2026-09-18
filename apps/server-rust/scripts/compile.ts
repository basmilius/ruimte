import { access, chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { arch, homedir, platform } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cargoExecutables } from '../../../scripts/rust-build';

const serverRoot = resolve(import.meta.dir, '..');
const repository = resolve(serverRoot, '../..');
const host = { os: platform() === 'darwin' ? 'mac' : platform() === 'linux' ? 'linux' : platform(), arch: arch() };
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        os: { type: 'string' },
        arch: { type: 'string' },
        target: { type: 'string' },
        outdir: { type: 'string' },
        version: { type: 'string' },
        'web-assets': { type: 'string' }
    },
    strict: true
});

const targetNames: Record<string, string> = { darwin: 'mac', mac: 'mac', linux: 'linux' };
const targetParts = values.target?.split('-') ?? [];
const target = values.target
    ? { os: targetNames[targetParts[0] ?? ''] ?? '', arch: targetParts[1] ?? '' }
    : { os: values.os ?? host.os, arch: values.arch ?? host.arch };
if (!['mac', 'linux'].includes(target.os) || !['arm64', 'x64'].includes(target.arch)) {
    throw new Error(`Unsupported target ${target.os}-${target.arch}; native builds support mac-arm64, mac-x64, linux-arm64 and linux-x64`);
}
if (target.os !== host.os || target.arch !== host.arch) {
    throw new Error(`Cross compilation is not supported: requested ${target.os}-${target.arch}, running on ${host.os}-${host.arch}`);
}

const version = values.version ?? process.env.RUIMTE_VERSION ?? '0.0.0';
const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
    version
);
const invalidNumericPrerelease = semanticVersion?.[4]?.split('.').some((part) => /^0\d+$/.test(part)) ?? false;
if (!semanticVersion || invalidNumericPrerelease) {
    throw new Error(`Invalid version ${JSON.stringify(version)}; pass a semantic version with --version or RUIMTE_VERSION`);
}
const buildId = `${version}-${crypto.randomUUID()}`;

const cargo = process.env.CARGO || Bun.which('cargo') || join(homedir(), '.cargo', 'bin', 'cargo');
await access(cargo).catch(() => {
    throw new Error('Cargo is required to compile the native daemon');
});
const metadata = Bun.spawnSync([cargo, 'metadata', '--format-version', '1', '--no-deps', '--manifest-path', join(repository, 'Cargo.toml')], {
    cwd: repository,
    stdout: 'pipe',
    stderr: 'inherit'
});
if (metadata.exitCode !== 0) {
    throw new Error(`Cargo metadata failed with exit code ${metadata.exitCode}`);
}
const metadataValue = JSON.parse(metadata.stdout.toString()) as { target_directory?: unknown };
if (typeof metadataValue.target_directory !== 'string') {
    throw new Error('Cargo metadata did not report a target directory');
}

const requestedOut = resolve(values.outdir ?? join(serverRoot, 'dist', `${target.os}-${target.arch}`));
const cargoTarget = resolve(metadataValue.target_directory);
const existingAncestor = async (path: string): Promise<string> => {
    let candidate = path;
    while (
        !(await lstat(candidate)
            .then(() => true)
            .catch(() => false))
    ) {
        const parent = dirname(candidate);
        if (parent === candidate) {
            break;
        }
        candidate = parent;
    }
    const actual = await realpath(candidate);
    return resolve(actual, relative(candidate, path));
};
const actualOut = await existingAncestor(requestedOut);
const protects = await Promise.all([repository, homedir(), cargoTarget].map(existingAncestor));
const contains = (parent: string, child: string): boolean => {
    const path = relative(parent, child);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};
if (actualOut === resolve('/') || protects.some((path) => contains(actualOut, path)) || contains(protects[2]!, actualOut)) {
    throw new Error(`Refusing unsafe output directory ${requestedOut}`);
}
const outputEntry = await lstat(requestedOut).catch(() => null);
if (outputEntry?.isSymbolicLink()) {
    throw new Error(`Refusing symlink output directory ${requestedOut}`);
}
if (outputEntry) {
    if (!outputEntry.isDirectory()) {
        throw new Error(`Refusing to replace non-directory output ${requestedOut}`);
    }
    const marker = await readFile(join(requestedOut, 'ruimte.bundle.json'), 'utf8')
        .then((text) => JSON.parse(text) as unknown)
        .catch(() => null);
    if (
        typeof marker !== 'object' ||
        marker === null ||
        !('format' in marker) ||
        marker.format !== 1 ||
        !('buildId' in marker) ||
        typeof marker.buildId !== 'string'
    ) {
        throw new Error(`Refusing to replace ${requestedOut}: it is not a native Ruimte bundle`);
    }
}

const cargoEnvironment = {
    ...process.env,
    RUIMTE_BUILD_VERSION: version,
    RUIMTE_BUILD_ID: buildId,
    RUIMTE_PULSAR_TEST_STATEMENT_KEY: ''
};
const build = Bun.spawnSync(
    [
        cargo,
        'build',
        '--manifest-path',
        join(repository, 'Cargo.toml'),
        '--release',
        '--locked',
        '--package',
        'ruimte_server',
        '--bin',
        'ruimte-server',
        '--package',
        'ruimte_cli',
        '--bin',
        'ruimte-context',
        '--message-format=json-render-diagnostics'
    ],
    {
        cwd: repository,
        env: cargoEnvironment,
        stdio: ['ignore', 'pipe', 'inherit']
    }
);
if (build.exitCode !== 0) {
    process.exit(build.exitCode);
}
const executables = cargoExecutables(build.stdout.toString());
const serverExecutable = executables.get('ruimte-server');
const contextExecutable = executables.get('ruimte-context');
if (!serverExecutable || !contextExecutable) {
    throw new Error('Cargo did not report both native executables');
}

const parent = dirname(requestedOut);
await mkdir(parent, { recursive: true });
const stage = await mkdtemp(join(parent, `.${basename(requestedOut)}.stage-`));
const native = join(stage, 'native');
try {
    await copyFile(serverExecutable, join(stage, 'ruimte'));
    await copyFile(contextExecutable, join(stage, 'ruimte-context'));
    await chmod(join(stage, 'ruimte'), 0o755);
    await chmod(join(stage, 'ruimte-context'), 0o755);
    await writeFile(join(stage, 'ruimte.build'), `${buildId}\n`, { mode: 0o644 });
    await writeFile(join(stage, 'ruimte.bundle.json'), `${JSON.stringify({ format: 1, version, buildId, target })}\n`, { mode: 0o644 });

    const reported = Bun.spawnSync([join(stage, 'ruimte'), '--version'], { stdout: 'pipe', stderr: 'pipe' });
    if (reported.exitCode !== 0 || reported.stdout.toString().trim() !== version) {
        throw new Error(`Compiled daemon reported ${JSON.stringify(reported.stdout.toString().trim())}, expected ${version}`);
    }
    const libraryTool = target.os === 'mac' ? ['otool', '-L'] : ['ldd'];
    for (const name of ['ruimte', 'ruimte-context']) {
        const libraries = Bun.spawnSync([...libraryTool, join(stage, name)], { stdout: 'inherit', stderr: 'inherit' });
        if (libraries.exitCode !== 0) {
            throw new Error(`Dynamic library inspection failed for ${name}`);
        }
    }

    if (values['web-assets']) {
        const web = resolve(values['web-assets']);
        if (
            !(await lstat(web)
                .then((entry) => entry.isDirectory())
                .catch(() => false))
        ) {
            throw new Error(`Web assets directory does not exist: ${web}`);
        }
        await cp(web, join(stage, 'web'), { recursive: true });
    }

    if (target.os === 'mac') {
        await mkdir(native, { recursive: true });
        const middleware = Bun.resolveSync('serve-sim/middleware', serverRoot);
        const addon = join(dirname(middleware), 'native', 'serve-sim-native.node');
        const file = Bun.spawnSync(['file', addon], { stdout: 'pipe', stderr: 'pipe' });
        const expected = target.arch === 'arm64' ? 'arm64' : 'x86_64';
        if (file.exitCode !== 0 || !file.stdout.toString().includes(expected)) {
            throw new Error(`serve-sim-native.node does not contain the host ${expected} architecture`);
        }
        await copyFile(addon, join(native, 'serve-sim-native.node'));
        const ax = join(dirname(middleware), 'simax', 'serve-sim-ax-settings');
        const axFile = Bun.spawnSync(['file', ax], { stdout: 'pipe', stderr: 'pipe' });
        if (axFile.exitCode !== 0 || !axFile.stdout.toString().includes(expected)) {
            throw new Error(`serve-sim-ax-settings does not contain the host ${expected} architecture`);
        }
        await copyFile(ax, join(native, 'serve-sim-ax-settings'));
        await chmod(join(native, 'serve-sim-ax-settings'), 0o755);

        const helper = Bun.spawnSync(
            [
                'bun',
                'build',
                '--compile',
                `--target=bun-darwin-${target.arch}`,
                '--minify',
                '--define',
                'process.env.RUIMTE_PULSAR_TEST_STATEMENT_KEY=""',
                join(serverRoot, 'helpers/simulator.ts'),
                '--outfile',
                join(stage, 'ruimte-simulator-helper')
            ],
            { cwd: serverRoot, stdio: ['ignore', 'inherit', 'inherit'] }
        );
        if (helper.exitCode !== 0) {
            throw new Error(`Simulator helper build failed with exit code ${helper.exitCode}`);
        }
        await chmod(join(stage, 'ruimte-simulator-helper'), 0o755);
        const sign = Bun.spawnSync(['codesign', '--sign', '-', '--force', join(stage, 'ruimte-simulator-helper')], {
            stdio: ['ignore', 'ignore', 'inherit']
        });
        if (sign.exitCode !== 0) {
            throw new Error(`Simulator helper signing failed with exit code ${sign.exitCode}`);
        }
        const helperCheck = Bun.spawnSync([join(stage, 'ruimte-simulator-helper')], { stdout: 'pipe', stderr: 'pipe' });
        if (helperCheck.exitCode !== 2 || !helperCheck.stderr.toString().includes('Usage: ruimte-simulator-helper')) {
            throw new Error('Compiled simulator helper did not start correctly');
        }
    }

    const backup = `${requestedOut}.old-${crypto.randomUUID()}`;
    const existed = outputEntry !== null;
    if (existed) {
        await rename(requestedOut, backup);
    }
    try {
        await rename(stage, requestedOut);
    } catch (error) {
        if (existed) {
            await rename(backup, requestedOut);
        }
        throw error;
    }
    if (existed) {
        await rm(backup, { recursive: true, force: true });
    }
    console.log(`Compiled ${requestedOut} (${version}, ${buildId})`);
} catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
}
