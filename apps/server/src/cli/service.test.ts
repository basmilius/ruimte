import { describe, expect, test } from 'bun:test';
import { definitionRunsProgram, type ServiceFiles, type ServiceManager } from '@ruimte/service';
import { runServiceAction, servicePath, servicePlan, type Health, type ServiceDeps, type ServiceFacts } from './service.ts';

const MAC: ServiceFacts = {
    platform: 'darwin',
    home: '/Users/bas',
    ruimteHome: '/Users/bas/.ruimte',
    executable: '/Users/bas/.npm/_npx/1a2b/node_modules/@ruimte/darwin-arm64/bin/ruimte',
    compiled: true,
    path: '/Users/bas/.npm/_npx/1a2b/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin',
    port: 4210,
    flags: []
};

const LINUX: ServiceFacts = {
    ...MAC,
    platform: 'linux',
    home: '/home/bas',
    ruimteHome: '/home/bas/.ruimte',
    executable: '/home/bas/.npm/_npx/1a2b/node_modules/@ruimte/linux-x64/bin/ruimte',
    path: '/home/bas/.local/bin:/usr/bin:/bin'
};

/* A manager over an in-memory file, recording the steps it was asked to take. */
const fakeManager = (files: ServiceFiles, linger?: boolean): ServiceManager & { steps: string[] } => {
    const steps: string[] = [];
    const path = '/fake/app.ruimte.daemon.plist';
    return {
        kind: 'launchd',
        path,
        steps,
        isInstalled: () => files.read(path) !== null,
        install(definition) {
            steps.push('install');
            files.write(path, definition);
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
};

const setup = (options: { existing?: string; linger?: boolean; health?: Health | null; build?: string | null } = {}) => {
    const disk = new Map<string, string>();
    const files: ServiceFiles = {
        read: (path) => disk.get(path) ?? null,
        write: (path, text) => void disk.set(path, text),
        remove: (path) => void disk.delete(path)
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
        removeBinaries: (dir) => void removed.push(dir),
        health: async () => options.health ?? null,
        readBuild: () => options.build ?? null,
        user: 'bas',
        out: (line) => void out.push(line),
        err: (line) => void err.push(line)
    };
    return { deps, manager, disk, out, err, copies, removed };
};

describe('servicePath', () => {
    test('leaves out the folders npx and bunx put in front', () => {
        expect(servicePath(MAC.path)).toBe('/opt/homebrew/bin:/usr/bin:/bin');
        expect(servicePath('/tmp/bunx-501-ruimte@latest/node_modules/.bin:/usr/bin:/usr/bin')).toBe('/usr/bin');
    });

    test('falls back to the system folders when nothing is left', () => {
        expect(servicePath(undefined)).toBe('/usr/local/bin:/usr/bin:/bin');
    });
});

describe('servicePlan', () => {
    test('a LaunchAgent that runs the copy under the home, never the npx cache', () => {
        const plan = servicePlan({ ...MAC, flags: ['--port', '4300'] });
        if (typeof plan === 'string') {
            throw new Error(plan);
        }
        expect(plan.kind).toBe('launchd');
        expect(plan.program).toBe('/Users/bas/.ruimte/bin/ruimte');
        expect(plan.definition).not.toContain('_npx');
        expect(plan.definition).toContain('<string>--port</string>');
        expect(plan.definition).toContain('<key>RUIMTE_SERVICE</key>');
        expect(definitionRunsProgram(plan.definition, plan.program)).toBe(true);
    });

    test('a systemd user unit on Linux', () => {
        const plan = servicePlan(LINUX);
        if (typeof plan === 'string') {
            throw new Error(plan);
        }
        expect(plan.kind).toBe('systemd');
        expect(plan.definition).toContain('ExecStart="/home/bas/.ruimte/bin/ruimte"\n');
        expect(plan.definition).toContain('Environment="RUIMTE_HOME=/home/bas/.ruimte"');
    });

    test('no service on Windows', () => {
        expect(servicePlan({ ...MAC, platform: 'win32' })).toBe('The background service runs on macOS and Linux only.');
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
        const first = servicePlan(MAC);
        if (typeof first === 'string') {
            throw new Error(first);
        }
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
        const app = servicePlan({ ...MAC, ruimteHome: '/Applications/Ruimte.app/Contents/Resources' });
        if (typeof app === 'string') {
            throw new Error(app);
        }
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
        const plan = servicePlan(MAC);
        if (typeof plan === 'string') {
            throw new Error(plan);
        }
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
        const plan = servicePlan(LINUX);
        if (typeof plan === 'string') {
            throw new Error(plan);
        }
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
