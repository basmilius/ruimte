import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definitionRunsProgram, type ServiceFiles, type ServiceManager } from '@adecore/service';
import type { BuildIdentity } from '@ruimte/contracts';
import { copyServiceBinaries, removeServiceBinaries, runServiceAction, servicePath, servicePlan, type ServiceDeps, type ServiceFacts } from './service.ts';

const MAC: ServiceFacts = {
    platform: 'darwin',
    home: '/Users/bas',
    ruimteHome: '/Users/bas/.ruimte',
    executable: '/Users/bas/.npm/_npx/1a2b/node_modules/@ruimte/darwin-arm64/bin/ruimte',
    compiled: true,
    path: '/Users/bas/.npm/_npx/1a2b/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin',
    port: 4210,
    flags: [],
    env: {}
};

const WINDOWS: ServiceFacts = {
    platform: 'win32',
    home: 'C:\\Users\\bas',
    ruimteHome: 'C:\\Users\\bas\\.ruimte',
    executable: 'C:\\Users\\bas\\AppData\\Local\\npm-cache\\_npx\\1a2b\\node_modules\\@ruimte\\win32-x64\\bin\\ruimte.exe',
    compiled: true,
    path: 'C:\\Users\\bas\\AppData\\Local\\npm-cache\\_npx\\1a2b\\node_modules\\.bin;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32',
    port: 4210,
    flags: [],
    env: { LOCALAPPDATA: 'C:\\Users\\bas\\AppData\\Local', COMPUTERNAME: 'PC', USERDOMAIN: 'PC', USERNAME: 'bas' }
};

const LINUX: ServiceFacts = {
    ...MAC,
    platform: 'linux',
    home: '/home/bas',
    ruimteHome: '/home/bas/.ruimte',
    executable: '/home/bas/.npm/_npx/1a2b/node_modules/@ruimte/linux-x64/bin/ruimte',
    path: '/home/bas/.local/bin:/usr/bin:/bin'
};

function planOf(facts: ServiceFacts) {
    const plan = servicePlan(facts);
    if (typeof plan === 'string') {
        throw new Error(plan);
    }
    return plan;
}

/* A manager over an in-memory file, recording the steps it was asked to take. */
function fakeManager(files: ServiceFiles, linger?: boolean): ServiceManager & { steps: string[] } {
    const steps: string[] = [];
    const path = '/fake/app.ruimte.daemon.plist';
    return {
        kind: 'launchd',
        path,
        steps,
        isInstalled: () => files.read(path) !== null,
        read: () => files.read(path),
        install(definition) {
            steps.push('install');
            const previous = files.read(path);
            files.write(path, definition);
            return previous !== null && previous !== definition;
        },
        start: () => void steps.push('start'),
        restart: async () => void steps.push('restart'),
        stop: () => void steps.push('stop'),
        uninstall() {
            steps.push('uninstall');
            files.remove(path);
        },
        ...(linger === undefined ? {} : { linger: { enabled: () => linger, enable: () => void steps.push('enable-linger') } })
    };
}

function setup(options: { existing?: string; linger?: boolean; health?: BuildIdentity | null; build?: string | null; left?: string[] } = {}) {
    const disk = new Map<string, string>();
    const files: ServiceFiles = {
        read: (path) => disk.get(path) ?? null,
        write: (path, text) => void disk.set(path, text),
        remove: (path) => void disk.delete(path),
        makeDirectory: () => undefined
    };
    const manager = fakeManager(files, options.linger);
    if (options.existing !== undefined) {
        disk.set(manager.path, options.existing);
    }
    const out: string[] = [];
    const err: string[] = [];
    const copies: string[] = [];
    const removed: string[] = [];
    const deps: ServiceDeps = {
        manager,
        files,
        copyBinaries: (from, to) => void copies.push(`${from} -> ${to}`),
        removeBinaries: (dir) => {
            removed.push(dir);

            return options.left ?? [];
        },
        health: async () => options.health ?? null,
        readBuild: () => options.build ?? null,
        user: 'bas',
        out: (line) => void out.push(line),
        err: (line) => void err.push(line)
    };
    return { deps, manager, disk, out, err, copies, removed };
}

describe('servicePath', () => {
    test('leaves out the folders npx and bunx put in front', () => {
        expect(servicePath(MAC.path, 'darwin')).toBe('/opt/homebrew/bin:/usr/bin:/bin');
        expect(servicePath('/tmp/bunx-501-ruimte@latest/node_modules/.bin:/usr/bin:/usr/bin', 'linux')).toBe('/usr/bin');
    });

    test('falls back to the system folders when nothing is left', () => {
        expect(servicePath(undefined, 'darwin')).toBe('/usr/local/bin:/usr/bin:/bin');
        expect(servicePath(undefined, 'win32')).toBe('C:\\Windows\\System32;C:\\Windows');
    });

    test('splits a Windows PATH on semicolons and leaves out the npx folders there too', () => {
        expect(servicePath(WINDOWS.path, 'win32')).toBe('C:\\Program Files\\Git\\cmd;C:\\Windows\\System32');
    });
});

describe('servicePlan', () => {
    test('a LaunchAgent that runs the copy under the home, never the npx cache', () => {
        const plan = planOf({ ...MAC, flags: ['--port', '4300'] });
        expect(plan.kind).toBe('launchd');
        expect(plan.program).toBe('/Users/bas/.ruimte/bin/ruimte');
        expect(plan.definition).not.toContain('_npx');
        expect(plan.definition).toContain('<string>--port</string>');
        expect(plan.definition).toContain('<key>RUIMTE_SERVICE</key>');
        expect(definitionRunsProgram(plan.definition, plan.program)).toBe(true);
    });

    test('a systemd user unit on Linux', () => {
        const plan = planOf(LINUX);
        expect(plan.kind).toBe('systemd');
        expect(plan.definition).toContain('ExecStart="/home/bas/.ruimte/bin/ruimte"\n');
        expect(plan.definition).toContain('Environment="RUIMTE_HOME=/home/bas/.ruimte"');
    });

    test('a scheduled task on Windows that runs the copy under the home', () => {
        const plan = planOf(WINDOWS);
        expect(plan.kind).toBe('task-scheduler');
        expect(plan.binDir).toBe('C:\\Users\\bas\\.ruimte\\bin');
        expect(plan.program).toBe('C:\\Users\\bas\\.ruimte\\bin\\ruimte.exe');
        expect(plan.definition).not.toContain('_npx');
        expect(plan.definition).toContain('<UserId>PC\\bas</UserId>');
        expect(plan.definition).toContain('set ^"PATH=C:\\Program^ Files\\Git\\cmd^;C:\\Windows\\System32^"');
        expect(definitionRunsProgram(plan.definition, plan.program)).toBe(true);
    });

    test('no service elsewhere', () => {
        expect(servicePlan({ ...MAC, platform: 'freebsd' })).toBe('The background service runs on macOS, Linux and Windows only.');
    });
});

describe('runServiceAction', () => {
    test('install copies the binary out of the cache, writes the definition and starts it', async () => {
        const { deps, manager, out, copies } = setup();
        expect(await runServiceAction('install', MAC, deps)).toBe(0);
        expect(copies).toEqual(['/Users/bas/.npm/_npx/1a2b/node_modules/@ruimte/darwin-arm64/bin -> /Users/bas/.ruimte/bin']);
        expect(manager.steps).toEqual(['install', 'start']);
        expect(out[0]).toBe('Installed the background service: /fake/app.ruimte.daemon.plist');
    });

    test('install again with other flags restarts, since the job only reads its definition when it starts', async () => {
        const first = planOf(MAC);
        const { deps, manager } = setup({ existing: first.definition });
        expect(await runServiceAction('install', { ...MAC, flags: ['--no-broker'] }, deps)).toBe(0);
        expect(manager.steps).toEqual(['install', 'restart']);
    });

    test('install over a newer binary leaves the running daemon to switch when idle', async () => {
        const { deps, out } = setup({ health: { version: '0.1.0', build: 'old' }, build: 'new' });
        await runServiceAction('install', MAC, deps);
        expect(out).toContain('A daemon from an earlier install is still running; it switches to this one as soon as nothing is running on it.');
    });

    test('install refuses to take over the service of the desktop app', async () => {
        const app = planOf({ ...MAC, ruimteHome: '/Applications/Ruimte.app/Contents/Resources' });
        const { deps, manager, err, copies } = setup({ existing: app.definition });
        expect(await runServiceAction('install', MAC, deps)).toBe(1);
        expect(err[0]).toContain('runs another Ruimte');
        expect(manager.steps).toEqual([]);
        expect(copies).toEqual([]);
    });

    test('install refuses a checkout, whose executable is Bun itself', async () => {
        const { deps, err } = setup();
        expect(await runServiceAction('install', { ...MAC, compiled: false, executable: '/opt/homebrew/bin/bun' }, deps)).toBe(1);
        expect(err[0]).toContain('needs the compiled binary');
    });

    test('install on Linux explains lingering and never enables it', async () => {
        const { deps, manager, out } = setup({ linger: false });
        expect(await runServiceAction('install', LINUX, deps)).toBe(0);
        expect(out).toContain('  loginctl enable-linger bas');
        expect(manager.steps).not.toContain('enable-linger');
    });

    test('install says nothing about lingering when it is on', async () => {
        const { deps, out } = setup({ linger: true });
        await runServiceAction('install', LINUX, deps);
        expect(out.some((line) => line.includes('enable-linger'))).toBe(false);
    });

    test('uninstall stops the service and removes the definition and the copy', async () => {
        const plan = planOf(MAC);
        const { deps, manager, disk, removed } = setup({ existing: plan.definition });
        expect(await runServiceAction('uninstall', MAC, deps)).toBe(0);
        expect(manager.steps).toEqual(['stop', 'uninstall']);
        expect(disk.size).toBe(0);
        expect(removed).toEqual(['/Users/bas/.ruimte/bin']);
    });

    test('uninstall leaves the service of the desktop app alone', async () => {
        const { deps, manager } = setup({ existing: '<string>/Applications/Ruimte.app/Contents/Resources/bin/ruimte</string>' });
        expect(await runServiceAction('uninstall', MAC, deps)).toBe(1);
        expect(manager.steps).toEqual([]);
    });

    test('status reports the definition, the build and whether it answers', async () => {
        const plan = planOf(LINUX);
        const { deps, out } = setup({ existing: plan.definition, health: { version: '0.2.0', build: 'b' }, build: 'b', linger: false });
        expect(await runServiceAction('status', LINUX, deps)).toBe(0);
        expect(out).toEqual([
            'Installed: /fake/app.ruimte.daemon.plist',
            'Binary: /home/bas/.ruimte/bin/ruimte (build b)',
            'Running: version 0.2.0 on port 4210',
            'Lingering: off, it stops when you log out (loginctl enable-linger bas)'
        ]);
    });

    test('status exits 1 when nothing is installed', async () => {
        const { deps, out } = setup();
        expect(await runServiceAction('status', MAC, deps)).toBe(1);
        expect(out[0]).toBe('Not installed. `npx ruimte service install` sets it up.');
    });

    test('an unknown action prints the usage', async () => {
        const { deps, err } = setup();
        expect(await runServiceAction('restart', MAC, deps)).toBe(1);
        expect(err[0]).toContain('Usage');
    });

    test('a failing step is a message and exit 1', async () => {
        const { deps, manager, err } = setup();
        manager.start = () => {
            throw new Error('launchctl bootstrap failed (5): Input/output error');
        };
        expect(await runServiceAction('install', MAC, deps)).toBe(1);
        expect(err[0]).toBe('launchctl bootstrap failed (5): Input/output error');
    });
});

describe('the copy the service runs', () => {
    let dir: string;
    let binDir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'ruimte-service-bin-'));
        binDir = join(dir, 'home', 'bin');
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    const packageBin = (root: string, build: string, helpers: string[], executables = ['ruimte', 'ruimte-context']): string => {
        const bin = join(root, 'package', 'bin');
        mkdirSync(join(bin, 'native'), { recursive: true });
        for (const name of executables) {
            writeFileSync(join(bin, name), `#!${name}`, { mode: 0o755 });
        }
        writeFileSync(join(bin, 'ruimte.build'), build);
        for (const helper of helpers) {
            writeFileSync(join(bin, 'native', helper), helper, { mode: 0o755 });
        }
        return bin;
    };

    test('takes the native helpers along, and an update drops the ones its package no longer has', () => {
        copyServiceBinaries(packageBin(join(dir, 'first'), 'one', ['scrcpy-server', 'ruimte-foundation-models']), binDir, 'darwin');
        expect(readFileSync(join(binDir, 'native', 'scrcpy-server'), 'utf8')).toBe('scrcpy-server');
        if (process.platform !== 'win32') {
            expect(statSync(join(binDir, 'native', 'ruimte-foundation-models')).mode & 0o111).not.toBe(0);
        }

        copyServiceBinaries(packageBin(join(dir, 'second'), 'two', ['scrcpy-server']), binDir, 'darwin');
        expect(readFileSync(join(binDir, 'ruimte.build'), 'utf8')).toBe('two');
        expect(existsSync(join(binDir, 'native', 'ruimte-foundation-models'))).toBe(false);

        removeServiceBinaries(binDir, 'darwin');
        expect(existsSync(join(binDir, 'native'))).toBe(false);
        expect(existsSync(join(binDir, 'ruimte'))).toBe(false);
    });

    test('on Windows the running executable is renamed out of the way, and removed by the next copy', () => {
        const executables = ['ruimte.exe', 'ruimte-context', 'ruimte-context.exe'];
        copyServiceBinaries(packageBin(join(dir, 'first'), 'one', [], executables), binDir, 'win32');
        expect(readdirSync(binDir).filter((name) => name.endsWith('.retired'))).toEqual([]);

        // An agent may be running `ruimte-context.exe` as well, so both executables move aside.
        copyServiceBinaries(packageBin(join(dir, 'second'), 'two', [], executables), binDir, 'win32');
        expect(readdirSync(binDir).filter((name) => name.endsWith('.retired'))).toHaveLength(2);
        expect(readFileSync(join(binDir, 'ruimte.build'), 'utf8')).toBe('two');
        expect(readFileSync(join(binDir, 'ruimte-context.exe'), 'utf8')).toBe('#!ruimte-context.exe');

        copyServiceBinaries(packageBin(join(dir, 'third'), 'three', [], executables), binDir, 'win32');
        expect(readdirSync(binDir).filter((name) => name.endsWith('.retired'))).toHaveLength(2);

        removeServiceBinaries(binDir, 'win32');
        expect(readdirSync(binDir)).toEqual([]);
    });

    test('on Windows an executable that cannot be removed moves aside, and an uninstall says so', () => {
        copyServiceBinaries(packageBin(join(dir, 'first'), 'one', [], ['ruimte.exe', 'ruimte-context', 'ruimte-context.exe']), binDir, 'win32');
        // A folder under the name refuses a plain remove as a running executable does.
        rmSync(join(binDir, 'ruimte.exe'));
        mkdirSync(join(binDir, 'ruimte.exe', 'held'), { recursive: true });

        const left = removeServiceBinaries(binDir, 'win32');
        expect(left).toEqual(readdirSync(binDir));
        expect(left).toEqual([expect.stringMatching(/ruimte\.exe.*\.retired$/)]);
    });

    test('an uninstall that leaves a running executable behind says where', async () => {
        const plan = planOf(MAC);
        const { deps, out } = setup({ existing: plan.definition, left: ['ruimte.exe.1.retired'] });
        expect(await runServiceAction('uninstall', MAC, deps)).toBe(0);
        expect(out.at(-1)).toContain('ruimte.exe.1.retired');
    });

    test('on Windows the ruimte-context.cmd of an earlier release goes, so cmd and PowerShell find the executable', () => {
        mkdirSync(binDir, { recursive: true });
        writeFileSync(join(binDir, 'ruimte-context.cmd'), '@echo off');
        copyServiceBinaries(packageBin(join(dir, 'first'), 'one', [], ['ruimte.exe', 'ruimte-context', 'ruimte-context.exe']), binDir, 'win32');
        expect(existsSync(join(binDir, 'ruimte-context.cmd'))).toBe(false);
        expect(existsSync(join(binDir, 'ruimte-context.exe'))).toBe(true);

        writeFileSync(join(binDir, 'ruimte-context.cmd'), '@echo off');
        removeServiceBinaries(binDir, 'win32');
        expect(readdirSync(binDir)).toEqual([]);
    });
});
