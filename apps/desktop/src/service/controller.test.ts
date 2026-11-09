import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchAgentPlist, type ServiceManager } from '@adecore/service';
import type { BuildIdentity, MachineWork } from '@ruimte/contracts';
import type { ServiceSupport, ShellServiceState } from '@ruimte/desktop-bridge';
import { daemonServiceSpec } from '@ruimte/service/host';
import type { ShellProblem } from '../telemetry';
import { createServiceController, type ServiceControllerDeps } from './controller';
import { keepRunningSetting, serviceSupport, type KeepRunningSetting } from './settings';

const EXPECTED: BuildIdentity = { version: '0.1.0', build: 'new' };

const HOME = '/Users/bas/.ruimte';

const COMMAND_LINE_PROGRAM = `${HOME}/bin/ruimte`;

function definitionOf(options: { program?: string; args?: string[]; ruimteHome?: string; path?: string } = {}): string {
    return launchAgentPlist(
        daemonServiceSpec({
            platform: 'darwin',
            program: options.program ?? '/Applications/Ruimte.app/Contents/Resources/bin/ruimte',
            args: options.args ?? ['--port', '4210'],
            home: '/Users/bas',
            ruimteHome: options.ruimteHome ?? HOME,
            path: options.path ?? '/usr/bin:/bin'
        })
    );
}

/* What the app writes; `installed` puts it on disk, `onDisk` something else in its place. */
const DEFINITION = definitionOf();

/* The app's own definition from before the login shell's PATH changed. */
const OLD_PATH = definitionOf({ path: '/opt/homebrew/bin:/usr/bin:/bin' });

function fakeManager(options: { installed?: boolean; onDisk?: string; running?: BuildIdentity | null; refuseStart?: string } = {}) {
    const calls: string[] = [];
    // Like launchd, which never starts a job whose log folder is gone.
    const service = { definition: options.onDisk ?? (options.installed ? DEFINITION : null), running: options.running ?? null, logFolder: true };
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
            if (!service.logFolder) {
                throw new Error('Bootstrap failed: 5');
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
    const reports: ShellProblem[] = [];
    const behindPort = (): BuildIdentity | null => fake.service.running ?? child ?? options.answering ?? null;
    const deps: ServiceControllerDeps = {
        support: options.support ?? 'supported',
        manager: fake.manager,
        setting: options.setting ?? memorySetting(options.keepRunning ?? true),
        definition: () => DEFINITION,
        prepare: () => {
            fake.service.logFolder = true;
        },
        commandLineProgram: COMMAND_LINE_PROGRAM,
        ruimteHome: HOME,
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
        publish: (state) => void published.push(state),
        report: (problem) => void reports.push(problem)
    };
    const crash = (): void => {
        child = null;
        onChildExit?.();
    };
    const advance = async (ms: number): Promise<void> => {
        clock.now += ms;
        const due = clock.timers.filter((timer) => timer.at <= clock.now);
        clock.timers = clock.timers.filter((timer) => timer.at > clock.now);
        for (const timer of due) {
            timer.run();
        }
        await Promise.resolve();
    };
    return { controller: createServiceController(deps), fake, events, deps, machine, clock, published, reports, crash, advance };
}

describe('start', () => {
    test.each([
        ['matching ids and versions', EXPECTED, EXPECTED],
        ['matching ids with different versions', { version: '9.9.9', build: 'new' }, EXPECTED],
        ['matching versions without an expected id', EXPECTED, { version: '0.1.0', build: null }],
        ['matching versions without either id', { version: '0.1.0', build: null }, { version: '0.1.0', build: null }]
    ] as const)('attaches without spawning for %s', async (_label, running, expected) => {
        const { controller, fake, events, deps } = setup({ fake: fakeManager({ installed: true, running }) });
        deps.expected = expected;
        expect(await controller.start()).toBe(true);
        expect(controller.state()).toMatchObject({ owner: 'service', failure: null, pendingRestart: null });
        expect(fake.calls).toEqual([]);
        expect(events).toEqual([]);
    });

    test('waits for the service that still wires itself and starts no second daemon beside it', async () => {
        const { controller, fake, events, deps } = setup({ fake: fakeManager({ installed: true }) });
        let starting = true;
        deps.probe = async () => ({ ...EXPECTED, starting });
        deps.verify = async () => !starting;
        deps.waitForHealth = async () => {
            events.push('wait');
            starting = false;
        };
        expect(await controller.start()).toBe(true);
        expect(events).toEqual(['wait']);
        expect(fake.calls).toEqual([]);
        expect(controller.state().owner).toBe('service');
    });

    test('waits for a daemon the app did not start, that still wires itself, before it asks it for the proof', async () => {
        const { controller, events, deps } = setup({ support: 'dev' });
        let starting = true;
        deps.probe = async () => ({ ...EXPECTED, starting });
        deps.verify = async () => !starting;
        deps.waitForHealth = async () => {
            events.push('wait');
            starting = false;
        };
        expect(await controller.start()).toBe(true);
        expect(events).toEqual(['wait']);
        expect(controller.state().owner).toBe('external');
    });

    test('says the machine is still starting when a daemon is still wiring itself after the wait ran out', async () => {
        const { controller, fake, events, reports, deps } = setup({ fake: fakeManager({ installed: true }) });
        deps.probe = async () => ({ ...EXPECTED, starting: true });
        deps.waitForHealth = async () => {
            throw new Error('Timed out');
        };
        // A booting daemon answers every request but /health with 503, so it cannot show the proof.
        deps.verify = async () => false;
        await expect(controller.start()).rejects.toThrow('This machine is still starting. Open Ruimte again in a moment.');
        expect(controller.state().owner).toBeNull();
        expect(reports).toEqual([]);
        expect(fake.calls).toEqual([]);
        expect(events).toEqual([]);
    });

    test('starts the service when the daemon that was wiring itself crashed during boot', async () => {
        const { controller, fake, events, reports, deps } = setup({ fake: fakeManager({ installed: true }) });
        let crashed = false;
        deps.probe = async () => (crashed ? null : { ...EXPECTED, starting: true });
        deps.waitForHealth = async () => {
            if (!crashed) {
                crashed = true;
                throw new Error('Timed out');
            }
        };
        deps.verify = async () => true;
        expect(await controller.start()).toBe(true);
        expect(controller.state().owner).toBe('service');
        expect(fake.calls).toEqual(['start']);
        expect(events).toEqual([]);
        expect(reports).toEqual([]);
    });

    test('spawns its own daemon when the one that was wiring itself crashed during boot and no service is used', async () => {
        const { controller, events, deps } = setup({ support: 'dev' });
        let crashed = false;
        deps.probe = async () => (crashed ? null : { ...EXPECTED, starting: true });
        deps.waitForHealth = async () => {
            if (!crashed) {
                crashed = true;
                throw new Error('Timed out');
            }
        };
        deps.verify = async () => true;
        expect(await controller.start()).toBe(true);
        expect(controller.state().owner).toBe('app');
        expect(events).toEqual(['spawn']);
    });

    test('a definition already on disk is not installed again, and one that changed is', async () => {
        const unchanged = setup({ fake: fakeManager({ installed: true, running: EXPECTED }) });
        await unchanged.controller.start();
        expect(unchanged.fake.calls).not.toContain('install');
        const changed = setup({ fake: fakeManager({ onDisk: OLD_PATH, running: EXPECTED }), work: { terminals: 1, agents: 0 } });
        await changed.controller.start();
        expect(changed.fake.calls).toEqual(['install']);
        expect(changed.fake.service.definition).toBe(DEFINITION);
    });

    test('an unchanged definition whose log folder is gone still starts the service', async () => {
        const { controller, fake, events } = setup({ fake: fakeManager({ installed: true }) });
        fake.service.logFolder = false;
        await controller.start();
        expect(fake.calls).toEqual(['start']);
        expect(fake.service.logFolder).toBe(true);
        expect(events).toEqual([]);
        expect(controller.state()).toMatchObject({ owner: 'service', failure: null });
    });

    test.each([
        ['an older stamped build', { version: '0.0.9', build: 'old' }, EXPECTED],
        ['a different id with the same version', { version: '0.1.0', build: 'old' }, EXPECTED],
        ['an unstamped build with the same version', { version: '0.1.0', build: null }, EXPECTED],
        ['a different version without either id', { version: '0.0.9', build: null }, { version: '0.1.0', build: null }],
        ['a different version without an expected id', { version: '0.0.9', build: 'old' }, { version: '0.1.0', build: null }]
    ] as const)('restarts %s onto the binary in the bundle', async (_label, running, expected) => {
        const { controller, fake, events, deps } = setup({ fake: fakeManager({ installed: true, running }) });
        deps.expected = expected;
        expect(await controller.start()).toBe(true);
        expect(fake.calls).toEqual(['restart']);
        expect(events).toEqual([]);
        expect(fake.service.running).toEqual(EXPECTED);
        expect(controller.state()).toMatchObject({ owner: 'service', failure: null, pendingRestart: null });
    });

    test.each([
        ['a terminal', { terminals: 1, agents: 0 }],
        ['agents', { terminals: 0, agents: 2 }],
        ['both', { terminals: 2, agents: 1 }]
    ] as const)('an older build running %s is attached to and the restart is left to the person', async (_label, work) => {
        const old = { version: '0.0.9', build: 'old' };
        const { controller, fake, events } = setup({ fake: fakeManager({ installed: true, running: old }), work });
        await controller.start();
        expect(fake.calls).toEqual([]);
        expect(events).toEqual([]);
        expect(fake.service.running).toEqual(old);
        expect(controller.state()).toMatchObject({ owner: 'service', pendingRestart: { work: work.terminals + work.agents, answered: false } });
    });

    test('an older build that cannot say what runs is asked about too', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }), work: null });
        await controller.start();
        expect(fake.calls).toEqual([]);
        expect(controller.state().pendingRestart).toEqual({ work: null, answered: false });
    });

    test('"Restart now" restarts onto the new build and clears the question', async () => {
        const { controller, fake } = setup({
            fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }),
            work: { terminals: 1, agents: 0 }
        });
        await controller.start();
        const next = await controller.restartNow();
        expect(fake.calls).toEqual(['restart']);
        expect(next).toMatchObject({ owner: 'service', pendingRestart: null });
    });

    test('"When idle" keeps the old build and marks the question answered until the new build answers', async () => {
        const { controller, fake } = setup({
            fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }),
            work: { terminals: 0, agents: 1 }
        });
        await controller.start();
        expect(controller.restartWhenIdle().pendingRestart).toEqual({ work: 1, answered: true });
        fake.service.running = null;
        expect((await controller.refresh()).pendingRestart).toEqual({ work: 1, answered: true });
        fake.service.running = { version: EXPECTED.version, build: 'old' };
        expect((await controller.refresh()).pendingRestart).toEqual({ work: 1, answered: true });
        expect(controller.unsettled()).toBe(true);
        fake.service.running = { version: '9.9.9', build: EXPECTED.build };
        expect((await controller.refresh()).pendingRestart).toBeNull();
        expect(controller.unsettled()).toBe(false);
        expect(fake.calls).toEqual([]);
    });

    test('"When idle" restarts onto the new build at the first refresh that finds nothing running', async () => {
        const { controller, fake, machine } = setup({
            fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }),
            work: { terminals: 1, agents: 1 }
        });
        await controller.start();
        controller.restartWhenIdle();
        await controller.refresh();
        expect(fake.calls).toEqual([]);

        machine.work = { terminals: 0, agents: 0 };
        const next = await controller.refresh();
        expect(fake.calls).toEqual(['restart']);
        expect(next).toMatchObject({ owner: 'service', failure: null, pendingRestart: null });
        expect(fake.service.running).toEqual(EXPECTED);
        expect(controller.unsettled()).toBe(false);
    });

    test('"When idle" keeps waiting while the machine cannot say what runs', async () => {
        const { controller, fake } = setup({
            fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }),
            work: null
        });
        await controller.start();
        controller.restartWhenIdle();
        expect((await controller.refresh()).pendingRestart).toEqual({ work: null, answered: true });
        expect(fake.calls).toEqual([]);
    });

    test('an unanswered question never restarts the machine, even once it is idle', async () => {
        const { controller, fake, machine } = setup({
            fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }),
            work: { terminals: 1, agents: 0 }
        });
        await controller.start();
        machine.work = { terminals: 0, agents: 0 };
        expect((await controller.refresh()).pendingRestart).toEqual({ work: 1, answered: false });
        expect(fake.calls).toEqual([]);
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

    test('a service that refuses to start is reported once, and a service that starts is not', async () => {
        const refused = setup({ fake: fakeManager({ refuseStart: 'Bootstrap failed: 5' }) });
        await refused.controller.start();
        expect(refused.reports).toEqual([{ kind: 'service-fallback', step: 'start', reason: 'Bootstrap failed: 5' }]);
        const started = setup({});
        await started.controller.start();
        expect(started.reports).toEqual([]);
    });

    test('a foreign service that is not running leaves the app on its own daemon without a report', async () => {
        const commandLine = definitionOf({ program: COMMAND_LINE_PROGRAM, args: ['--host', '0.0.0.0'] });
        const { controller, reports } = setup({ fake: fakeManager({ onDisk: commandLine }) });
        await controller.start();
        expect(controller.state().owner).toBe('app');
        expect(reports).toEqual([]);
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
        expect(fake.calls).toEqual(['uninstall']);
        expect(fake.service.running).toEqual(EXPECTED);
        expect(events).toEqual([]);
    });

    test('a definition that changed under the same build is read by restarting the service, once nothing runs', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ onDisk: OLD_PATH, running: EXPECTED }) });
        await controller.start();
        expect(fake.calls).toEqual(['install', 'restart']);
        expect(controller.state().owner).toBe('service');
    });

    test('a changed definition waits for the work on the machine, and the next idle refresh restarts it', async () => {
        const { controller, fake, machine, events } = setup({
            fake: fakeManager({ onDisk: OLD_PATH, running: EXPECTED }),
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
        expect(events).toEqual([]);
        expect(controller.state()).toMatchObject({ owner: 'service', failure: null });
    });

    test.each([
        ['the expected stamped build', EXPECTED],
        ['an older stamped build', { version: '0.0.9', build: 'old' }]
    ] as const)('without service support %s is used and never killed', async (_label, answering) => {
        const { controller, events, fake } = setup({ support: 'dev', answering });
        await controller.start();
        expect(controller.state().owner).toBe('external');
        expect(controller.survivesQuit(true)).toBe(true);
        controller.quit(false);
        expect(fake.calls).toEqual([]);
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
        expect(fake.calls).toEqual(['restart']);
        expect(controller.state().owner).toBe('service');
    });

    test('an earlier build that cannot prove itself is left running when the person quits instead', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: OLD }), proves: onlyThisBuild });
        expect(await controller.start()).toBe(false);
        expect(fake.calls).toEqual([]);
        expect(fake.service.running).toEqual(OLD);
    });
});

describe('a service the command line installed', () => {
    const COMMAND_LINE = definitionOf({ program: COMMAND_LINE_PROGRAM, args: ['--host', '0.0.0.0'] });

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

    test("a definition of an app elsewhere with this home is the app's own and is rewritten", async () => {
        const { controller, fake } = setup({
            fake: fakeManager({ onDisk: definitionOf({ program: '/Volumes/Ruimte/Ruimte.app/Contents/Resources/bin/ruimte' }) })
        });
        await controller.start();
        expect(fake.calls).toEqual(['install', 'start']);
        expect(fake.service.definition).toBe(DEFINITION);
        expect(controller.state()).toMatchObject({ commandLineService: false, failure: null });
    });
});

describe('a service of another installation', () => {
    const OTHER_HOME = definitionOf({ ruimteHome: '/Users/bas/.ruimte-other' });
    const FOREIGN: [string, string][] = [
        ['the app with another home', OTHER_HOME],
        ['the command line with another home', definitionOf({ program: '/another/home/bin/ruimte', ruimteHome: '/another/home' })],
        [
            'a definition that names no home',
            '<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>app.ruimte.daemon</string><key>ProgramArguments</key><array><string>/Applications/Ruimte.app/Contents/Resources/bin/ruimte</string></array></dict></plist>'
        ]
    ];

    for (const [name, definition] of FOREIGN) {
        test(`${name} is used as it runs and never written, started, stopped or removed`, async () => {
            const { controller, fake, events } = setup({ fake: fakeManager({ onDisk: definition, running: EXPECTED }) });
            await controller.start();
            expect(controller.state()).toMatchObject({ owner: 'external', keepRunning: false, commandLineService: false });
            expect(controller.state().failure).toContain(fake.manager.path);
            expect(controller.setKeepRunning(true).keepRunning).toBe(false);
            controller.setKeepRunning(false);
            expect(controller.survivesQuit(true)).toBe(true);
            controller.quit(true);
            expect(fake.calls).toEqual([]);
            expect(fake.service.definition).toBe(definition);
            expect(events).toEqual([]);
        });

        test(`${name} that is not running leaves the app on its own daemon, with the switch off`, async () => {
            const { controller, fake, events } = setup({ keepRunning: false, fake: fakeManager({ onDisk: definition }) });
            await controller.start();
            controller.quit(false);
            expect(events).toEqual(['spawn', 'kill']);
            expect(fake.calls).toEqual([]);
            expect(fake.service.definition).toBe(definition);
        });
    }

    test('that takes the place of the app\'s own before "Restart now" is not restarted', async () => {
        const { controller, fake } = setup({
            fake: fakeManager({ installed: true, running: { version: '0.0.9', build: 'old' } }),
            work: { terminals: 1, agents: 0 }
        });
        await controller.start();
        fake.service.definition = OTHER_HOME;
        await controller.restartNow();
        expect(fake.calls).toEqual([]);
        expect(fake.service.definition).toBe(OTHER_HOME);
    });

    test("that takes the place of the app's own is not stopped when the machine stops", async () => {
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: EXPECTED }) });
        await controller.start();
        fake.service.definition = OTHER_HOME;
        controller.quit(true);
        expect(fake.calls).toEqual([]);
        expect(fake.service.running).toEqual(EXPECTED);
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
        const { controller, events, clock, published, crash, advance } = setup({ support: 'dev' });
        await controller.start();
        for (let i = 0; i < 5; i++) {
            crash();
            await advance(clock.timers[0]!.at - clock.now);
        }
        crash();
        expect(clock.timers).toEqual([]);
        expect(events.filter((event) => event === 'spawn')).toHaveLength(6);
        expect(controller.state().crash).toEqual({ total: 6, restarting: false });
        expect(published.at(-1)?.crash).toEqual({ total: 6, restarting: false });
    });

    test('is reported once it is given up on, and not for the ends before', async () => {
        const { controller, clock, crash, advance, reports } = setup({ support: 'dev' });
        await controller.start();
        for (let i = 0; i < 5; i++) {
            crash();
            await advance(clock.timers[0]!.at - clock.now);
        }
        expect(reports).toEqual([]);
        crash();
        expect(reports).toEqual([{ kind: 'daemon-gave-up', ends: 6 }]);
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
        expect(serviceSupport({ packaged: true, platform: 'win32', appImage: undefined })).toBe('supported');
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
        expect(fake.calls).toEqual(['uninstall', 'stop']);
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
            fake: fakeManager({ onDisk: OLD_PATH, running: EXPECTED }),
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
        expect(fake.calls).toEqual(['uninstall', 'install', 'restart', 'uninstall']);
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
        expect(fake.calls).toEqual([]);
        expect(fake.service.running).toEqual(EXPECTED);
    });

    test('stopping the machine ends the service and takes its definition away until the next start', async () => {
        const { controller, fake } = setup({ fake: fakeManager({ installed: true, running: EXPECTED }) });
        await controller.start();
        expect(controller.survivesQuit(true)).toBe(false);
        controller.quit(true);
        expect(fake.calls).toEqual(['stop', 'uninstall']);
        expect(controller.state().keepRunning).toBe(true);
        await controller.start();
        expect(fake.calls.slice(2)).toEqual(['install', 'start']);
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
