import { describe, expect, test } from 'bun:test';
import {
    ClosedLid,
    PowerStreamParser,
    adminCancelled,
    adminCommand,
    closedLidHolds,
    closedLidRule,
    closedLidRulePath,
    installRuleScript,
    removeRuleScript,
    sleepDisabledIn,
    sudoSleepCommand,
    watchdogCommand,
    type AdminResult,
    type ClosedLidFacts,
    type ClosedLidSetting,
    type ClosedLidSystem,
    type PowerState
} from './closed-lid.ts';

function setting(patch: Partial<ClosedLidSetting> = {}): ClosedLidSetting {
    return { mode: 'always', onBattery: false, display: false, lidClosed: true, ...patch };
}

const ADAPTER: PowerState = { adapter: true, percent: 80 };
function battery(percent: number | null): PowerState {
    return { adapter: false, percent };
}

function facts(patch: Partial<ClosedLidFacts> = {}): ClosedLidFacts {
    return {
        setting: setting(),
        working: false,
        platform: 'darwin',
        rule: true,
        power: ADAPTER,
        ...patch
    };
}

describe('closedLidHolds', () => {
    test('holds on the adapter while keep awake holds, the switch is on and the rule is there', () => {
        expect(closedLidHolds(facts())).toBe(true);
        expect(closedLidHolds(facts({ setting: setting({ lidClosed: false }) }))).toBe(false);
        expect(closedLidHolds(facts({ rule: false }))).toBe(false);
        expect(closedLidHolds(facts({ platform: 'linux' }))).toBe(false);
    });

    test('follows the mode of keep awake: never when off, and under working only while an agent works', () => {
        expect(closedLidHolds(facts({ setting: setting({ mode: 'off' }) }))).toBe(false);
        expect(closedLidHolds(facts({ setting: setting({ mode: 'working' }), working: false }))).toBe(false);
        expect(closedLidHolds(facts({ setting: setting({ mode: 'working' }), working: true }))).toBe(true);
    });

    test('on battery only when keep awake may hold there, and never below the floor', () => {
        expect(closedLidHolds(facts({ power: battery(90) }))).toBe(false);
        expect(closedLidHolds(facts({ setting: setting({ onBattery: true }), power: battery(20) }))).toBe(true);
        expect(closedLidHolds(facts({ setting: setting({ onBattery: true }), power: battery(19) }))).toBe(false);
        expect(closedLidHolds(facts({ setting: setting({ onBattery: true }), power: battery(null) }))).toBe(false);
    });

    test('nothing holds before the first power reading', () => {
        expect(closedLidHolds(facts({ power: null }))).toBe(false);
    });
});

describe('the commands', () => {
    test('sleep is switched with sudo -n, which fails instead of asking for a password', () => {
        expect(sudoSleepCommand(true)).toEqual(['/usr/bin/sudo', '-n', '/usr/bin/pmset', '-a', 'disablesleep', '1']);
        expect(sudoSleepCommand(false)).toEqual(['/usr/bin/sudo', '-n', '/usr/bin/pmset', '-a', 'disablesleep', '0']);
    });

    test('the rule lets one user run exactly the two commands without a password, in a file sudo does not skip', () => {
        expect(closedLidRulePath(501)).toBe('/etc/sudoers.d/ruimte-closed-lid-501');
        expect(closedLidRulePath(501).split('/').at(-1)).not.toContain('.');
        const rule = closedLidRule('bas');
        expect(rule.split('\n').filter((line) => line !== '' && !line.startsWith('#'))).toEqual([
            'bas ALL = (root) NOPASSWD: /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0'
        ]);
        expect(() => closedLidRule('bas, ALL')).toThrow();
        expect(() => closedLidRule('root ALL=(ALL) ALL #')).toThrow();
    });

    test('installing writes under a name sudo skips, checks it with visudo, and only then moves it into place as root:wheel 0440', () => {
        const script = installRuleScript('bas', 501);
        const steps = script.split('\n');
        expect(steps[0]).toBe('set -e');
        expect(steps.findIndex((step) => step.startsWith('/usr/sbin/visudo -c -q -f '))).toBeLessThan(steps.findIndex((step) => step.startsWith('/bin/mv')));
        expect(script).toContain(`> '/etc/sudoers.d/ruimte-closed-lid-501.new'`);
        expect(script).toContain(`/usr/sbin/chown root:wheel '/etc/sudoers.d/ruimte-closed-lid-501.new'`);
        expect(script).toContain(`/bin/chmod 0440 '/etc/sudoers.d/ruimte-closed-lid-501.new'`);
        expect(steps.at(-1)).toBe(`/bin/mv -f '/etc/sudoers.d/ruimte-closed-lid-501.new' '/etc/sudoers.d/ruimte-closed-lid-501'`);
        expect(script).toContain(`'bas ALL = (root) NOPASSWD: /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0'`);
    });

    test('removing turns sleep back on before the rule goes', () => {
        expect(removeRuleScript(501).split('\n')).toEqual(['/usr/bin/pmset -a disablesleep 0', `/bin/rm -f '/etc/sudoers.d/ruimte-closed-lid-501'`]);
    });

    test('the administrator dialog takes the script and its line as arguments, never quoted into AppleScript', () => {
        const command = adminCommand(`echo "it's"`, 'Ruimte wants "this"');
        expect(command.slice(0, 7)).toEqual([
            '/usr/bin/osascript',
            '-e',
            'on run argv',
            '-e',
            'do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges',
            '-e',
            'end run'
        ]);
        expect(command.slice(7)).toEqual([`echo "it's"`, 'Ruimte wants "this"']);
        expect(adminCancelled('0:94: execution error: User canceled. (-128)')).toBe(true);
        expect(adminCancelled('0:94: execution error: No user interaction allowed. (-1713)')).toBe(false);
    });

    test('the watchdog waits for the end of its pipe and then turns sleep back on, deaf to a terminal signal', () => {
        expect(watchdogCommand()).toEqual([
            '/bin/sh',
            '-c',
            `trap '' HUP INT TERM; while read -r line; do :; done; exec '/usr/bin/sudo' '-n' '/usr/bin/pmset' '-a' 'disablesleep' '0'`
        ]);
        expect(watchdogCommand(['/usr/bin/touch', "/tmp/it's here"])[2]).toEndWith(`exec '/usr/bin/touch' '/tmp/it'\\''s here'`);
    });

    test('SleepDisabled is read from the system-wide settings of pmset -g', () => {
        const output = (value: number): string =>
            `System-wide power settings:\n SleepDisabled\t\t${value}\nCurrently in use:\n standby              1\n sleep                1\n`;
        expect(sleepDisabledIn(output(1))).toBe(true);
        expect(sleepDisabledIn(output(0))).toBe(false);
        expect(sleepDisabledIn('Currently in use:\n sleep 1\n')).toBe(false);
    });
});

describe('PowerStreamParser', () => {
    const header = 'Logging IORegisterForSystemPower sleep/wake messages\npmset is in logging mode now. Hit ctrl-c to exit.\n';
    const block = (source: string, charge?: string): string =>
        `2026-10-04 11:27:48 +0200 IOPSNotificationCreateRunLoopSource\nNow drawing from '${source}'\n${charge === undefined ? '' : ` -InternalBattery-0 (id=23527523)\t${charge}; present: true\n`}`;

    test('reads the source and the charge of every block, and says only what changed', () => {
        const parser = new PowerStreamParser();
        expect(parser.feed(header + block('Battery Power', '62%; discharging; 16:52 remaining'))).toEqual([battery(null), battery(62)]);
        expect(parser.feed(block('Battery Power', '62%; discharging; 16:40 remaining'))).toEqual([]);
        expect(parser.feed(block('Battery Power', '61%; discharging; 16:30 remaining'))).toEqual([battery(61)]);
        expect(parser.feed(block('AC Power', '61%; charging; 1:10 until full'))).toEqual([{ adapter: true, percent: 61 }]);
    });

    test('a line cut across two pieces is read once it is whole', () => {
        const parser = new PowerStreamParser();
        const text = block('AC Power', '100%; charged; 0:00 remaining');
        const cut = text.indexOf('Power') + 2;
        expect(parser.feed(text.slice(0, cut))).toEqual([]);
        expect(parser.feed(text.slice(cut))).toEqual([
            { adapter: true, percent: null },
            { adapter: true, percent: 100 }
        ]);
    });

    test('a UPS counts as battery, and a Mac without a battery has no charge', () => {
        const parser = new PowerStreamParser();
        expect(parser.feed(block('AC Power'))).toEqual([{ adapter: true, percent: null }]);
        expect(parser.feed(block('UPS Power'))).toEqual([battery(null)]);
    });
});

/* A Mac that never runs anything: each call is written down in order, and the answers are set by the test. */
function fakeSystem() {
    const calls: string[] = [];
    const state = {
        rule: true,
        sleepDisabled: false,
        marker: false,
        sudoWorks: true,
        admin: { ok: true } as AdminResult,
        power: null as ((power: PowerState | null) => void) | null,
        watchdogs: 0
    };
    const system: ClosedLidSystem = {
        rulePresent: async () => state.rule,
        sleepDisabled: async () => {
            calls.push('read sleep');
            return state.sleepDisabled;
        },
        setSleepDisabled: async (disabled) => {
            calls.push(`sudo pmset ${disabled ? 1 : 0}`);
            if (state.sudoWorks) {
                state.sleepDisabled = disabled;
            }
            return state.sudoWorks;
        },
        enableSleepNow: () => {
            calls.push('sudo pmset 0 now');
            if (state.sudoWorks) {
                state.sleepDisabled = false;
            }
            return state.sudoWorks;
        },
        startWatchdog: () => {
            calls.push('watchdog up');
            state.watchdogs += 1;
            return {
                dismiss: () => {
                    calls.push('watchdog dismissed');
                    state.watchdogs -= 1;
                }
            };
        },
        watchPower: (listener) => {
            calls.push('power stream');
            state.power = listener;
            return {
                stop: () => {
                    calls.push('power stream stopped');
                    state.power = null;
                }
            };
        },
        runAsAdmin: async (script) => {
            calls.push(script.includes('/bin/mv') ? 'admin install' : 'admin remove');
            if (state.admin.ok) {
                state.rule = script.includes('/bin/mv');
            }
            return state.admin;
        },
        marker: {
            present: async () => state.marker,
            write: async () => {
                calls.push('marker written');
                state.marker = true;
            },
            remove: async () => {
                calls.push('marker removed');
                state.marker = false;
            },
            removeNow: () => {
                calls.push('marker removed now');
                state.marker = false;
            }
        }
    };
    return { calls, state, system };
}

function lidOf(options: { setting: ClosedLidSetting; working?: boolean }) {
    const fake = fakeSystem();
    const current = { setting: options.setting, working: options.working ?? false };
    const changes: boolean[] = [];
    const lid = new ClosedLid({
        platform: 'darwin',
        uid: 501,
        user: 'bas',
        setting: () => current.setting,
        working: () => current.working,
        system: fake.system,
        ruleChanged: (present) => changes.push(present),
        log: () => undefined
    });
    // A reading from the stream, followed by what it set in motion.
    const reading = async (power: PowerState | null): Promise<void> => {
        fake.state.power?.(power);
        await lid.settled();
    };
    const recheck = async (): Promise<void> => {
        lid.check();
        await lid.settled();
    };
    return { ...fake, current, changes, lid, reading, recheck };
}

describe('ClosedLid', () => {
    test('holds with the marker and the watchdog up before sleep goes off, and lets go in the reverse order', async () => {
        const { lid, calls, state, reading, recheck, current } = lidOf({ setting: setting() });
        await lid.start();
        expect(calls).toEqual(['read sleep', 'power stream']);
        await reading(ADAPTER);
        expect(calls.slice(2)).toEqual(['marker written', 'watchdog up', 'sudo pmset 1']);
        expect([lid.holding, state.sleepDisabled, state.marker]).toEqual([true, true, true]);

        current.setting = setting({ lidClosed: false });
        await recheck();
        expect(calls.slice(5)).toEqual(['power stream stopped', 'sudo pmset 0', 'watchdog dismissed', 'marker removed']);
        expect([lid.holding, state.sleepDisabled, state.marker, state.watchdogs]).toEqual([false, false, false, 0]);
    });

    test('lets go when no agent works under working, and holds again when one starts', async () => {
        const { lid, state, reading, recheck, current } = lidOf({ setting: setting({ mode: 'working' }), working: true });
        await lid.start();
        await reading(ADAPTER);
        expect(state.sleepDisabled).toBe(true);
        current.working = false;
        await recheck();
        expect(state.sleepDisabled).toBe(false);
        current.working = true;
        await recheck();
        expect(state.sleepDisabled).toBe(true);
    });

    test('lets go when the adapter comes out, unless battery is allowed, and then below the floor', async () => {
        const onAdapter = lidOf({ setting: setting() });
        await onAdapter.lid.start();
        await onAdapter.reading(ADAPTER);
        await onAdapter.reading(battery(95));
        expect(onAdapter.state.sleepDisabled).toBe(false);

        const onBattery = lidOf({ setting: setting({ onBattery: true }) });
        await onBattery.lid.start();
        await onBattery.reading(battery(21));
        expect(onBattery.state.sleepDisabled).toBe(true);
        await onBattery.reading(battery(20));
        expect(onBattery.state.sleepDisabled).toBe(true);
        await onBattery.reading(battery(19));
        expect(onBattery.state.sleepDisabled).toBe(false);
        await onBattery.reading({ adapter: true, percent: 19 });
        expect(onBattery.state.sleepDisabled).toBe(true);
    });

    test('a power stream that ends lets go, and starts again only at the next change', async () => {
        const { lid, calls, state, reading, recheck } = lidOf({ setting: setting() });
        await lid.start();
        await reading(ADAPTER);
        await reading(null);
        expect(state.sleepDisabled).toBe(false);
        expect(calls.filter((call) => call === 'power stream')).toHaveLength(1);
        await recheck();
        expect(calls.filter((call) => call === 'power stream')).toHaveLength(2);
    });

    test('the stream runs only while the switch, the rule and a mode other than off ask for it', async () => {
        const { lid, calls, recheck, current } = lidOf({ setting: setting({ lidClosed: false }) });
        await lid.start();
        expect(calls).not.toContain('power stream');
        current.setting = setting({ mode: 'off' });
        await recheck();
        expect(calls).not.toContain('power stream');
        current.setting = setting({ mode: 'working' });
        await recheck();
        expect(calls).toContain('power stream');
    });

    test('a daemon that stops turns sleep back on before it goes and dismisses the watchdog', async () => {
        const { lid, calls, state, reading } = lidOf({ setting: setting() });
        await lid.start();
        await reading(ADAPTER);
        lid.stop();
        expect(calls.slice(-4)).toEqual(['power stream stopped', 'sudo pmset 0 now', 'watchdog dismissed', 'marker removed now']);
        expect([state.sleepDisabled, state.marker, state.watchdogs]).toEqual([false, false, 0]);
        lid.check();
        await lid.settled();
        expect(state.sleepDisabled).toBe(false);
    });

    test('a release that sudo refuses leaves the watchdog and the marker for one more try', async () => {
        const { lid, state, reading, current, recheck } = lidOf({ setting: setting() });
        await lid.start();
        await reading(ADAPTER);
        state.sudoWorks = false;
        current.setting = setting({ mode: 'off' });
        await recheck();
        expect([lid.holding, state.marker, state.watchdogs]).toEqual([false, true, 1]);
    });

    test('a hold sudo refuses makes the rule unusable until it is installed again, without trying on every change', async () => {
        const { lid, calls, state, reading, recheck, changes } = lidOf({ setting: setting() });
        await lid.start();
        state.sudoWorks = false;
        await reading(ADAPTER);
        expect([lid.holding, lid.ruleInstalled, state.marker, state.watchdogs]).toEqual([false, false, false, 0]);
        expect(changes).toEqual([true]);
        const tries = calls.filter((call) => call === 'sudo pmset 1').length;
        await recheck();
        await reading(battery(50));
        await reading(ADAPTER);
        expect(calls.filter((call) => call === 'sudo pmset 1')).toHaveLength(tries);

        state.sudoWorks = true;
        await lid.setRule(true, 'prompt');
        await reading(ADAPTER);
        expect([lid.ruleInstalled, state.sleepDisabled]).toEqual([true, true]);
    });

    describe('at start', () => {
        test('sleep left off by this home before goes back on at once, and the marker with it', async () => {
            const { lid, calls, state } = lidOf({ setting: setting({ lidClosed: false }) });
            state.marker = true;
            state.sleepDisabled = true;
            await lid.start();
            expect(calls).toEqual(['read sleep', 'sudo pmset 0', 'marker removed']);
            expect([state.sleepDisabled, state.marker]).toEqual([false, false]);
        });

        test('sleep that somebody else turned off is left alone', async () => {
            const { lid, calls, state } = lidOf({ setting: setting({ lidClosed: false }) });
            state.sleepDisabled = true;
            await lid.start();
            expect(calls).toEqual(['read sleep']);
            expect(state.sleepDisabled).toBe(true);
        });

        test('a marker the watchdog already answered is only cleared', async () => {
            const { lid, calls, state } = lidOf({ setting: setting({ lidClosed: false }) });
            state.marker = true;
            await lid.start();
            expect(calls).toEqual(['read sleep', 'marker removed']);
        });

        test('a marker whose sleep cannot be turned on again stays for the next start', async () => {
            const { lid, state } = lidOf({ setting: setting({ lidClosed: false }) });
            state.marker = true;
            state.sleepDisabled = true;
            state.sudoWorks = false;
            await lid.start();
            expect([state.sleepDisabled, state.marker]).toEqual([true, true]);
        });

        test('nothing is decided before start, and nothing at all off a Mac', async () => {
            const fake = fakeSystem();
            const lid = new ClosedLid({
                platform: 'linux',
                uid: 1000,
                user: 'bas',
                setting: () => setting(),
                working: () => true,
                system: fake.system,
                ruleChanged: () => undefined,
                log: () => undefined
            });
            lid.check();
            await lid.start();
            lid.check();
            expect([lid.available, await lid.refreshRule(), fake.calls]).toEqual([false, false, []]);
            await expect(lid.setRule(true, 'prompt')).rejects.toMatchObject({ code: 'closed-lid-unavailable' });
        });
    });

    describe('the rule', () => {
        test('a rule that came or went is announced once and decided on', async () => {
            const { lid, state, changes, reading } = lidOf({ setting: setting() });
            state.rule = false;
            await lid.start();
            expect(await lid.refreshRule()).toBe(false);
            state.rule = true;
            expect(await lid.refreshRule()).toBe(true);
            expect(await lid.refreshRule()).toBe(true);
            expect(changes).toEqual([true]);
            await reading(ADAPTER);
            expect(state.sleepDisabled).toBe(true);
            state.rule = false;
            await lid.refreshRule();
            await lid.settled();
            expect([changes, state.sleepDisabled]).toEqual([[true, false], false]);
        });

        test('removing lets go while sudo still takes the rule, and only then asks for an administrator', async () => {
            const { lid, calls, reading, changes } = lidOf({ setting: setting() });
            await lid.start();
            await reading(ADAPTER);
            await lid.setRule(false, 'prompt');
            const release = calls.indexOf('sudo pmset 0');
            expect(release).toBeGreaterThan(-1);
            expect(release).toBeLessThan(calls.indexOf('admin remove'));
            expect([lid.ruleInstalled, lid.holding, changes]).toEqual([false, false, [false]]);
        });

        test('a cancelled removal holds again and says it was cancelled', async () => {
            const { lid, state, reading } = lidOf({ setting: setting() });
            await lid.start();
            await reading(ADAPTER);
            state.admin = { ok: false, cancelled: true, message: 'User canceled. (-128)' };
            await expect(lid.setRule(false, 'prompt')).rejects.toMatchObject({ code: 'closed-lid-cancelled' });
            await lid.settled();
            expect([lid.ruleInstalled, state.sleepDisabled]).toEqual([true, true]);
        });

        test('a failed install says why and how to do it from a terminal', async () => {
            const { lid, state } = lidOf({ setting: setting() });
            state.rule = false;
            await lid.start();
            state.admin = { ok: false, cancelled: false, message: 'No user interaction allowed. (-1713)' };
            const failure = lid.setRule(true, 'prompt');
            await expect(failure).rejects.toMatchObject({ code: 'closed-lid-failed' });
            await expect(failure).rejects.toThrow('ruimte closed-lid install');
        });
    });
});
