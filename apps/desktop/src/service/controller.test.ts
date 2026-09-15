import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServiceController, type ServiceControllerDeps } from './controller';
import type { BuildIdentity, MachineWork } from './decide';
import type { ServiceManager } from './manager';
import { keepRunningSetting, serviceSupport, type KeepRunningSetting, type ServiceSupport } from './settings';

const EXPECTED: BuildIdentity = { version: '0.1.0', build: 'new' };

/* A service manager that keeps its state in memory and says what was asked of it. */
const fakeManager = (options: { installed?: boolean; running?: BuildIdentity | null; refuseStart?: string } = {}) => {
    const calls: string[] = [];
    const service = { installed: options.installed ?? false, running: options.running ?? null };
    const manager: ServiceManager = {
        kind: 'launchd',
        path: '/fake/app.ruimte.daemon.plist',
        isInstalled: () => service.installed,
        install: () => {
            calls.push('install');
            service.installed = true;
        },
        start: () => {
            calls.push('start');
            if (options.refuseStart) {
                throw new Error(options.refuseStart);
            }
            service.running = EXPECTED;
        },
        restart: async () => {
            calls.push('restart');
            service.running = EXPECTED;
        },
        stop: () => {
            calls.push('stop');
            service.running = null;
        },
        uninstall: () => {
            calls.push('uninstall');
            service.installed = false;
        }
    };
    return { calls, service, manager };
};

const memorySetting = (initial: boolean): KeepRunningSetting & { value: boolean } => {
    const setting = {
        value: initial,
        read: () => setting.value,
        write: (next: boolean) => {
            setting.value = next;
        }
    };
    return setting;
};

const setup = (options: {
    support?: ServiceSupport;
    keepRunning?: boolean;
    fake?: ReturnType<typeof fakeManager>;
    answering?: BuildIdentity | null;
    work?: MachineWork | null;
}) => {
    const fake = options.fake ?? fakeManager();
    const events: string[] = [];
    let child: BuildIdentity | null = null;
    const behindPort = (): BuildIdentity | null => fake.service.running ?? child ?? options.answering ?? null;
    const deps: ServiceControllerDeps = {
        support: options.support ?? 'supported',
        manager: fake.manager,
        setting: memorySetting(options.keepRunning ?? true),
        definition: () => '<plist/>',
        expected: EXPECTED,
        probe: async () => behindPort(),
        work: async () => (options.work === undefined ? { terminals: 0, agents: 0 } : options.work),
        waitForHealth: async (accept) => {
            const health = behindPort();
            if (!health || !accept(health)) {
                throw new Error('The background service did not come up');
            }
        },
        spawnDaemon: () => {
            events.push('spawn');
            child = EXPECTED;
        },
        killDaemon: () => {
            events.push('kill');
            child = null;
        }
    };
    return { controller: createServiceController(deps), fake, events, deps };
};

describe('start', () => {
    test('the same build behind the port is attached to, and nothing is spawned', async () => {
        const { controller, fake, events } = setup({ fake: fakeManager({ installed: true, running: EXPECTED }) });
        await controller.start();
        expect(controller.state().owner).toBe('service');
        expect(fake.calls).toEqual(['install']);
        expect(events).toEqual([]);
    });

    test('an older build is restarted onto the binary in the bundle', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }) });
        await controller.start();
        expect(fake.calls).toEqual(['install', 'restart']);
        expect(controller.state().owner).toBe('service');
    });

    test('an older build with work running is attached to and the restart is left to the person', async () => {
        const old = { version: '0.0.9', build: 'old' };
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: old }), work: { terminals: 2, agents: 1 } });
        await controller.start();
        expect(fake.calls).toEqual(['install']);
        expect(controller.state()).toMatchObject({ owner: 'service', pendingRestart: { work: 3, answered: false } });
    });

    test('an older build that cannot say what runs is asked about too', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }), work: null });
        await controller.start();
        expect(fake.calls).toEqual(['install']);
        expect(controller.state().pendingRestart).toEqual({ work: null, answered: false });
    });

    test('"Restart now" restarts onto the new build and clears the question', async () => {
        const { controller, fake } = setup({
            fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }),
            work: { terminals: 1, agents: 0 }
        });
        await controller.start();
        const next = await controller.restartNow();
        expect(fake.calls).toEqual(['install', 'restart']);
        expect(next).toMatchObject({ owner: 'service', pendingRestart: null });
    });

    test('"When idle" keeps the old build and marks the question answered until the new build answers', async () => {
        const { controller, fake } = setup({
            fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }),
            work: { terminals: 0, agents: 1 }
        });
        await controller.start();
        expect(controller.restartWhenIdle().pendingRestart).toEqual({ work: 1, answered: true });
        expect((await controller.refresh()).pendingRestart).toEqual({ work: 1, answered: true });
        fake.service.running = EXPECTED;
        expect((await controller.refresh()).pendingRestart).toBeNull();
        expect(fake.calls).toEqual(['install']);
    });

    test('nothing answering starts the service', async () => {
        const { controller, fake, events } = setup({});
        await controller.start();
        expect(fake.calls).toEqual(['install', 'start']);
        expect(events).toEqual([]);
        expect(controller.state().owner).toBe('service');
    });

    test('a service that refuses to start leaves the app on its own daemon, with the reason', async () => {
        const { controller, events } = setup({ fake: fakeManager({ refuseStart: 'Bootstrap failed: 5' }) });
        await controller.start();
        expect(events).toEqual(['spawn']);
        expect(controller.state()).toMatchObject({ owner: 'app', failure: 'Bootstrap failed: 5', keepRunning: true });
    });

    test('with the service off the app spawns its own daemon as before', async () => {
        const { controller, fake, events } = setup({ keepRunning: false });
        await controller.start();
        expect(fake.calls).toEqual([]);
        expect(events).toEqual(['spawn']);
        expect(controller.state().owner).toBe('app');
    });

    test('with the service off a definition left on disk is removed and its daemon stopped first', async () => {
        const { controller, fake, events } = setup({ keepRunning: false, fake: fakeManager({ installed: true, running: EXPECTED }) });
        await controller.start();
        expect(fake.calls).toEqual(['uninstall', 'stop']);
        expect(events).toEqual(['spawn']);
    });

    test('with the service off whatever answers is used and never killed', async () => {
        const { controller, events } = setup({ keepRunning: false, answering: { version: '0.0.9', build: 'old' } });
        await controller.start();
        expect(controller.state().owner).toBe('external');
        controller.quit(false);
        expect(events).toEqual([]);
    });
});

describe('the dev app', () => {
    test('never touches a service manager, whatever the setting says', async () => {
        const fake = fakeManager();
        const { controller, events } = setup({ support: 'dev', keepRunning: true, fake });
        await controller.start();
        controller.setKeepRunning(true);
        controller.quit(false);
        expect(fake.calls).toEqual([]);
        expect(events).toEqual(['spawn', 'kill']);
        expect(controller.state()).toMatchObject({ support: 'dev', keepRunning: false, owner: 'app' });
    });

    test('an unpackaged app has no service support, on every platform', () => {
        for (const platform of ['darwin', 'linux', 'win32'] as const) {
            expect(serviceSupport({ packaged: false, platform, appImage: undefined })).toBe('dev');
        }
    });

    test('support per packaged platform', () => {
        expect(serviceSupport({ packaged: true, platform: 'darwin', appImage: undefined })).toBe('supported');
        expect(serviceSupport({ packaged: true, platform: 'linux', appImage: undefined })).toBe('supported');
        expect(serviceSupport({ packaged: true, platform: 'linux', appImage: '/home/bas/Ruimte.AppImage' })).toBe('appimage');
        expect(serviceSupport({ packaged: true, platform: 'win32', appImage: undefined })).toBe('windows');
    });
});

describe('the setting', () => {
    test('off while the service runs removes the definition now and stops the daemon at quit', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: EXPECTED }) });
        await controller.start();
        expect(controller.setKeepRunning(false)).toMatchObject({ keepRunning: false, owner: 'service' });
        expect(fake.service.installed).toBe(false);
        expect(fake.service.running).toEqual(EXPECTED);
        expect(controller.survivesQuit(false)).toBe(false);
        controller.quit(false);
        expect(fake.calls).toEqual(['install', 'uninstall', 'stop']);
    });

    test('on while the app runs its own daemon installs the service, which takes over at quit', async () => {
        const { controller, fake, events } = setup({ keepRunning: false });
        await controller.start();
        controller.setKeepRunning(true);
        expect(fake.calls).toEqual(['install']);
        expect(controller.survivesQuit(false)).toBe(false);
        controller.quit(false);
        expect(events).toEqual(['spawn', 'kill']);
        expect(fake.calls).toEqual(['install', 'start']);
    });

    test('on while the service runs: quitting leaves it running', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: EXPECTED }) });
        await controller.start();
        expect(controller.survivesQuit(false)).toBe(true);
        controller.quit(false);
        expect(fake.calls).toEqual(['install']);
        expect(fake.service.running).toEqual(EXPECTED);
    });

    test('stopping the machine ends the service and takes its definition away until the next start', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: EXPECTED }) });
        await controller.start();
        expect(controller.survivesQuit(true)).toBe(false);
        controller.quit(true);
        expect(fake.calls).toEqual(['install', 'stop', 'uninstall']);
        expect(controller.state().keepRunning).toBe(true);
        await controller.start();
        expect(fake.calls.slice(3)).toEqual(['install', 'start']);
    });

    test('stopping the machine while the app runs its own daemon does not hand it to the service', async () => {
        const { controller, fake, events } = setup({ keepRunning: false });
        await controller.start();
        controller.setKeepRunning(true);
        controller.quit(true);
        expect(events).toEqual(['spawn', 'kill']);
        expect(fake.calls).toEqual(['install']);
    });
});

describe('keepRunningSetting', () => {
    let dir: string | null = null;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true, force: true });
        }
        dir = null;
    });

    test('on by default for a packaged app, and remembered once set', () => {
        dir = mkdtempSync(join(tmpdir(), 'ruimte-service-'));
        const setting = keepRunningSetting(join(dir, 'background-service.json'), 'supported');
        expect(setting.read()).toBe(true);
        setting.write(false);
        expect(setting.read()).toBe(false);
    });

    test('always off where there is no service', () => {
        dir = mkdtempSync(join(tmpdir(), 'ruimte-service-'));
        const path = join(dir, 'background-service.json');
        keepRunningSetting(path, 'supported').write(true);
        expect(keepRunningSetting(path, 'dev').read()).toBe(false);
        expect(keepRunningSetting(path, 'windows').read()).toBe(false);
    });
});
