import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServiceController, type ServiceControllerDeps } from './controller';
import type { BuildIdentity, MachineWork } from '@ruimte/contracts';
import type { ServiceManager } from '@ruimte/service';
import type { ServiceSupport, ShellServiceState } from '@ruimte/desktop-bridge';
import { keepRunningSetting, serviceSupport, type KeepRunningSetting } from './settings';

const EXPECTED: BuildIdentity = { version: '0.1.0', build: 'new' };

/* What the app writes; `installed` puts it on disk, `onDisk` something else in its place. */
const DEFINITION = '<plist/>';

const COMMAND_LINE_PROGRAM = '/Users/bas/.ruimte/bin/ruimte';

function fakeManager(options: { installed?: boolean; onDisk?: string; running?: BuildIdentity | null; refuseStart?: string } = {}) {
    const calls: string[] = [];
    const service = { definition: options.onDisk ?? (options.installed ? DEFINITION : null), running: options.running ?? null };
    const manager: ServiceManager = {
        kind: 'launchd',
        path: '/fake/app.ruimte.daemon.plist',
        isInstalled: () => service.definition !== null,
        read: () => service.definition,
        install: (definition) => {
            calls.push('install');
            const changed = service.definition !== definition;
            service.definition = definition;
            return changed;
        },
        start: () => {
            calls.push('start');
            if (options.refuseStart) {
                throw new Error(options.refuseStart);
            }
            if (service.definition === null) {
                throw new Error('No service definition');
            }
            service.running = EXPECTED;
        },
        restart: async () => {
            calls.push('restart');
            if (service.definition === null) {
                throw new Error('No service definition');
            }
            service.running = EXPECTED;
        },
        stop: () => {
            calls.push('stop');
            service.running = null;
        },
        uninstall: () => {
            calls.push('uninstall');
            service.definition = null;
        }
    };
    return { calls, service, manager };
}

function memorySetting(initial: boolean): KeepRunningSetting & { value: boolean } {
    const setting = {
        value: initial,
        read: () => setting.value,
        write: (next: boolean) => {
            setting.value = next;
        }
    };
    return setting;
}

function setup(options: {
    support?: ServiceSupport;
    keepRunning?: boolean;
    setting?: KeepRunningSetting;
    fake?: ReturnType<typeof fakeManager>;
    answering?: BuildIdentity | null;
    work?: MachineWork | null;
    /* Whether what answers the port proves it holds the local secret; every build of this release does. */
    proves?: (health: BuildIdentity) => boolean;
    /* The answer to the question before an earlier build that cannot prove itself is restarted. */
    restartUnproven?: boolean;
}) {
    const fake = options.fake ?? fakeManager();
    const events: string[] = [];
    let child: BuildIdentity | null = null;
    let onChildExit: (() => void) | null = null;
    const machine = { work: options.work === undefined ? { terminals: 0, agents: 0 } : options.work };
    const clock = { now: 0, timers: [] as { at: number; run: () => void }[] };
    const published: ShellServiceState[] = [];
    const behindPort = (): BuildIdentity | null => fake.service.running ?? child ?? options.answering ?? null;
    const deps: ServiceControllerDeps = {
        support: options.support ?? 'supported',
        manager: fake.manager,
        setting: options.setting ?? memorySetting(options.keepRunning ?? true),
        definition: () => DEFINITION,
        commandLineProgram: COMMAND_LINE_PROGRAM,
        expected: EXPECTED,
        probe: async () => behindPort(),
        work: async () => machine.work,
        verify: async () => {
            const health = behindPort();
            return health !== null && (options.proves ?? (() => true))(health);
        },
        askRestart: async () => {
            events.push('ask');
            return options.restartUnproven ?? false;
        },
        waitForHealth: async (accept) => {
            const health = behindPort();
            if (!health || !accept(health)) {
                throw new Error('The background service did not come up');
            }
        },
        spawnDaemon: (onExit) => {
            events.push('spawn');
            child = EXPECTED;
            onChildExit = onExit;
        },
        killDaemon: () => {
            events.push('kill');
            child = null;
            onChildExit?.();
        },
        now: () => clock.now,
        after: (ms, run) => void clock.timers.push({ at: clock.now + ms, run }),
        publish: (state) => void published.push(state)
    };
    /* The app's own daemon ends by itself, as a crash does. */
    const crash = (): void => {
        child = null;
        onChildExit?.();
    };
    /* Moves the clock on and runs what came due, awaiting what a run started. */
    const advance = async (ms: number): Promise<void> => {
        clock.now += ms;
        const due = clock.timers.filter((timer) => timer.at <= clock.now);
        clock.timers = clock.timers.filter((timer) => timer.at > clock.now);
        for (const timer of due) {
            timer.run();
        }
        await Promise.resolve();
    };
    return { controller: createServiceController(deps), fake, events, deps, machine, clock, published, crash, advance };
}

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

    test('with background use off the service runs until the app quits, without staying installed', async () => {
        const { controller, fake, events } = setup({ keepRunning: false });
        await controller.start();
        expect(fake.calls).toEqual(['install', 'start', 'uninstall']);
        expect(events).toEqual([]);
        expect(controller.state()).toMatchObject({ owner: 'service', keepRunning: false });
        expect(fake.service.definition).toBeNull();
        controller.quit(false);
        expect(fake.calls.at(-1)).toBe('stop');
    });

    test('with background use off an existing service keeps its sessions running until quit', async () => {
        const { controller, fake, events } = setup({
            keepRunning: false,
            fake: fakeManager({ installed: true, running: EXPECTED }),
            work: { terminals: 1, agents: 1 }
        });
        await controller.start();
        expect(fake.calls).toEqual(['install', 'uninstall']);
        expect(fake.service.running).toEqual(EXPECTED);
        expect(events).toEqual([]);
    });

    test('a definition that changed under the same build is read by restarting the service, once nothing runs', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ onDisk: '<plist>old PATH</plist>', running: EXPECTED }) });
        await controller.start();
        expect(fake.calls).toEqual(['install', 'restart']);
        expect(controller.state().owner).toBe('service');
    });

    test('a changed definition waits for the work on the machine, and the next refresh after it restarts', async () => {
        const { controller, fake, machine } = setup({
            fake: fakeManager({ onDisk: '<plist>old PATH</plist>', running: EXPECTED }),
            work: { terminals: 1, agents: 1 }
        });
        await controller.start();
        expect(fake.calls).toEqual(['install']);
        expect(controller.unsettled()).toBe(true);
        await controller.refresh();
        expect(fake.calls).toEqual(['install']);
        machine.work = { terminals: 0, agents: 0 };
        await controller.refresh();
        expect(fake.calls).toEqual(['install', 'restart']);
        expect(controller.unsettled()).toBe(false);
    });

    test('without service support whatever answers is used and never killed', async () => {
        const { controller, events } = setup({ support: 'dev', answering: { version: '0.0.9', build: 'old' } });
        await controller.start();
        expect(controller.state().owner).toBe('external');
        expect(controller.survivesQuit(true)).toBe(true);
        controller.quit(false);
        expect(events).toEqual([]);
    });

    test('before any start, as in the dev app whose daemon `bun dev` runs, a quit ends nothing', () => {
        const { controller } = setup({ support: 'dev' });
        expect(controller.survivesQuit(false)).toBe(true);
        expect(controller.survivesQuit(true)).toBe(true);
    });
});

describe('proving the local secret', () => {
    const OLD = { version: '0.0.9', build: 'old' };
    const onlyThisBuild = (health: BuildIdentity): boolean => health.build === EXPECTED.build;

    test('something that answers health without the proof is not connected to', async () => {
        const { controller } = setup({ keepRunning: false, answering: EXPECTED, proves: () => false });
        await expect(controller.start()).rejects.toThrow('could not prove');
    });

    test('a service that answers as this build without the proof is not connected to either', async () => {
        const { controller } = setup({ fake: fakeManager({ installed: true, running: EXPECTED }), proves: () => false });
        await expect(controller.start()).rejects.toThrow('could not prove');
    });

    test('an earlier build that cannot prove itself is restarted once the person says so', async () => {
        const { controller, fake, events } = setup({
            fake: fakeManager({ installed: true, running: OLD }),
            proves: onlyThisBuild,
            restartUnproven: true
        });
        expect(await controller.start()).toBe(true);
        expect(events).toEqual(['ask']);
        expect(fake.calls).toEqual(['install', 'restart']);
        expect(controller.state().owner).toBe('service');
    });

    test('an earlier build that cannot prove itself is left running when the person quits instead', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: OLD }), proves: onlyThisBuild });
        expect(await controller.start()).toBe(false);
        expect(fake.calls).toEqual(['install']);
        expect(fake.service.running).toEqual(OLD);
    });
});

describe('a service the command line installed', () => {
    const COMMAND_LINE = `<plist><string>${COMMAND_LINE_PROGRAM}</string><string>--host</string><string>0.0.0.0</string></plist>`;

    test('is used as it is with the switch on, and nothing is written, started or stopped', async () => {
        const { controller, fake, events } = setup({ fake: fakeManager({ onDisk: COMMAND_LINE, running: EXPECTED }) });
        await controller.start();
        expect(controller.state()).toMatchObject({ owner: 'external', keepRunning: false, commandLineService: true });
        expect(controller.survivesQuit(false)).toBe(true);
        controller.setKeepRunning(true);
        controller.quit(false);
        expect(fake.calls).toEqual([]);
        expect(fake.service.definition).toBe(COMMAND_LINE);
        expect(events).toEqual([]);
    });

    test('is not removed or stopped with the switch off', async () => {
        const { controller, fake } = setup({ keepRunning: false, fake: fakeManager({ onDisk: COMMAND_LINE, running: EXPECTED }) });
        await controller.start();
        controller.setKeepRunning(false);
        controller.quit(true);
        expect(fake.calls).toEqual([]);
        expect(fake.service.definition).toBe(COMMAND_LINE);
    });

    test('that is not running leaves the app on a daemon of its own, which is not handed to the service at quit', async () => {
        const { controller, fake, events } = setup({ fake: fakeManager({ onDisk: COMMAND_LINE }) });
        await controller.start();
        controller.quit(false);
        expect(events).toEqual(['spawn', 'kill']);
        expect(fake.calls).toEqual([]);
    });

    test("a definition of an app elsewhere is the app's own and is rewritten", async () => {
        const { controller, fake } = setup({
            fake: fakeManager({ onDisk: '<plist><string>/Volumes/Ruimte/Ruimte.app/Contents/Resources/bin/ruimte</string></plist>' })
        });
        await controller.start();
        expect(fake.calls).toEqual(['install', 'start']);
        expect(controller.state().commandLineService).toBe(false);
    });
});

describe("the app's own daemon", () => {
    test('that ends by itself is started again after a pause, and every window hears of it', async () => {
        const { controller, events, clock, published, crash, advance } = setup({ support: 'dev' });
        await controller.start();
        crash();
        expect(events).toEqual(['spawn']);
        expect(clock.timers.map((timer) => timer.at)).toEqual([1000]);
        expect(published.at(-1)?.crash).toEqual({ total: 1, restarting: true });
        await advance(1000);
        expect(events).toEqual(['spawn', 'spawn']);
        expect(controller.state()).toMatchObject({ owner: 'app', crash: { total: 1, restarting: true } });
    });

    test('waits longer each time it ends again soon, and starts over once it stayed up', async () => {
        const { controller, clock, crash, advance } = setup({ support: 'dev' });
        await controller.start();
        const pauses: number[] = [];
        for (let i = 0; i < 3; i++) {
            crash();
            pauses.push(clock.timers[0]!.at - clock.now);
            await advance(pauses.at(-1)!);
        }
        expect(pauses).toEqual([1000, 2000, 4000]);
        await advance(120_000);
        crash();
        expect(clock.timers[0]!.at - clock.now).toBe(1000);
    });

    test('is given up on after five ends in a row, which the windows hear too', async () => {
        const { controller, events, clock, crash, advance } = setup({ support: 'dev' });
        await controller.start();
        for (let i = 0; i < 5; i++) {
            crash();
            await advance(clock.timers[0]!.at - clock.now);
        }
        crash();
        expect(clock.timers).toEqual([]);
        expect(events.filter((event) => event === 'spawn')).toHaveLength(6);
        expect(controller.state().crash).toEqual({ total: 6, restarting: false });
    });

    test('that a quit ends is not started again', async () => {
        const { controller, events, clock } = setup({ support: 'dev' });
        await controller.start();
        controller.quit(false);
        expect(events).toEqual(['spawn', 'kill']);
        expect(clock.timers).toEqual([]);
        expect(controller.state().crash).toBeNull();
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
        expect(fake.service.definition).toBeNull();
        expect(fake.service.running).toEqual(EXPECTED);
        expect(controller.survivesQuit(false)).toBe(false);
        controller.quit(false);
        expect(fake.calls).toEqual(['install', 'uninstall', 'stop']);
    });

    test('turning background use on applies immediately and keeps the same daemon and sessions at quit', async () => {
        const { controller, fake, events, machine } = setup({ keepRunning: false, work: { terminals: 2, agents: 1 } });
        await controller.start();
        expect(controller.setKeepRunning(true)).toMatchObject({ keepRunning: true, owner: 'service', failure: null });
        expect(fake.calls).toEqual(['install', 'start', 'uninstall', 'install']);
        expect(controller.survivesQuit(false)).toBe(true);
        controller.quit(false);
        expect(events).toEqual([]);
        expect(fake.calls).toEqual(['install', 'start', 'uninstall', 'install']);
        expect(fake.service.running).toEqual(EXPECTED);
        expect(machine.work).toEqual({ terminals: 2, agents: 1 });
    });

    test('turning background use off and back on keeps the running service, including across refresh', async () => {
        const { controller, fake, events } = setup({ work: { terminals: 1, agents: 1 } });
        await controller.start();
        controller.setKeepRunning(false);
        expect(controller.survivesQuit(false)).toBe(false);
        expect(controller.setKeepRunning(true)).toMatchObject({ keepRunning: true, owner: 'service' });
        await controller.refresh();
        expect(controller.unsettled()).toBe(false);
        expect(controller.survivesQuit(false)).toBe(true);
        expect(fake.calls).toEqual(['install', 'start', 'uninstall', 'install']);
        expect(events).toEqual([]);
    });

    test('a deferred definition update still applies after background use is turned off', async () => {
        const { controller, fake, machine, events } = setup({
            fake: fakeManager({ onDisk: '<plist>old PATH</plist>', running: EXPECTED }),
            work: { terminals: 1, agents: 1 }
        });
        await controller.start();
        controller.setKeepRunning(false);
        await controller.refresh();
        expect(fake.calls).toEqual(['install', 'uninstall']);
        machine.work = { terminals: 0, agents: 0 };
        expect(await controller.refresh()).toMatchObject({ owner: 'service', keepRunning: false, failure: null });
        expect(fake.calls).toEqual(['install', 'uninstall', 'install', 'restart', 'uninstall']);
        expect(fake.service.definition).toBeNull();
        expect(events).toEqual([]);
    });

    test('updating an older daemon after background use is turned off leaves login startup disabled', async () => {
        const { controller, fake, events } = setup({
            fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }),
            work: { terminals: 1, agents: 0 }
        });
        await controller.start();
        controller.setKeepRunning(false);
        expect(await controller.restartNow()).toMatchObject({ owner: 'service', keepRunning: false, failure: null, pendingRestart: null });
        expect(fake.calls).toEqual(['install', 'uninstall', 'install', 'restart', 'uninstall']);
        expect(fake.service.definition).toBeNull();
        expect(events).toEqual([]);
    });

    test('a fallback daemon keeps the service failure visible when background use is turned on', async () => {
        const { controller } = setup({ keepRunning: false, fake: fakeManager({ refuseStart: 'Bootstrap failed: 5' }) });
        await controller.start();
        expect(controller.setKeepRunning(true)).toMatchObject({ keepRunning: true, owner: 'app', failure: 'Bootstrap failed: 5' });
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
        const { controller, fake, events } = setup({ keepRunning: false, fake: fakeManager({ refuseStart: 'Bootstrap failed: 5' }) });
        await controller.start();
        controller.setKeepRunning(true);
        controller.quit(true);
        expect(events).toEqual(['spawn', 'kill']);
        expect(fake.calls).toEqual(['install', 'start', 'stop', 'uninstall', 'install']);
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

    test('a fresh profile starts a background service that survives quitting without changing the setting', async () => {
        dir = mkdtempSync(join(tmpdir(), 'ruimte-service-'));
        const setting = keepRunningSetting(join(dir, 'background-service.json'), 'supported');
        const { controller, fake, events } = setup({ setting });
        await controller.start();
        expect(controller.state()).toMatchObject({ keepRunning: true, owner: 'service' });
        expect(controller.survivesQuit(false)).toBe(true);
        controller.quit(false);
        expect(fake.calls).toEqual(['install', 'start']);
        expect(fake.service.running).toEqual(EXPECTED);
        expect(events).toEqual([]);
    });

    test('always off where there is no service', () => {
        dir = mkdtempSync(join(tmpdir(), 'ruimte-service-'));
        const path = join(dir, 'background-service.json');
        keepRunningSetting(path, 'supported').write(true);
        expect(keepRunningSetting(path, 'dev').read()).toBe(false);
        expect(keepRunningSetting(path, 'windows').read()).toBe(false);
    });
});
