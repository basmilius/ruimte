import { CLOSED_LID_BATTERY_FLOOR } from '@ruimte/contracts';
import { CodedError } from '@ruimte/agents/coded-error';
import { errorText } from '../error-text.ts';
import { keepAwakeAvailable, keepAwakeWanted, type KeepAwakeSetting } from './keep-awake.ts';

/*
 * Keep awake with the lid closed. The block keep awake holds does not cover a lid: macOS sleeps on a
 * closed lid whatever assertion is held, unless an external display and the power adapter are there.
 * The one general way is `pmset -a disablesleep 1`, which needs root. The daemon never holds root: a
 * person installs, once and on purpose, a sudoers rule that lets this user run exactly the two pmset
 * commands below without a password, and the daemon runs them with `sudo -n`.
 */

export const PMSET = '/usr/bin/pmset';
export const SUDO = '/usr/bin/sudo';

export type ClosedLidErrorCode = 'closed-lid-unavailable' | 'closed-lid-cancelled' | 'closed-lid-failed';

export class ClosedLidError extends CodedError<ClosedLidErrorCode> {}

export interface ClosedLidSetting extends KeepAwakeSetting {
    lidClosed: boolean;
}

/* What the power source stream last said. */
export interface PowerState {
    adapter: boolean;
    /* Charge of the internal battery in percent; null on a Mac without one. */
    percent: number | null;
}

/* Only a Mac turns sleep off this way. */
export const closedLidAvailable = keepAwakeAvailable;

export const sleepCommand = (disabled: boolean): string[] => [PMSET, '-a', 'disablesleep', disabled ? '1' : '0'];

/* `-n` fails instead of asking for a password, so a missing rule is an answer and never a prompt nobody sees. */
export const sudoSleepCommand = (disabled: boolean): string[] => [SUDO, '-n', ...sleepCommand(disabled)];

export interface ClosedLidFacts {
    setting: ClosedLidSetting;
    working: boolean;
    platform: NodeJS.Platform;
    rule: boolean;
    power: PowerState | null;
}

/*
 * Holds only while keep awake itself would, and never without a power reading: on the adapter, or on
 * battery when keep awake may hold there and the charge is not below the floor.
 */
export const closedLidHolds = (facts: ClosedLidFacts): boolean => {
    if (!closedLidAvailable(facts.platform) || !facts.rule || !facts.setting.lidClosed || !keepAwakeWanted(facts.setting, facts.working, facts.platform)) {
        return false;
    }
    if (facts.power === null) {
        return false;
    }
    if (facts.power.adapter) {
        return true;
    }
    return facts.setting.onBattery && facts.power.percent !== null && facts.power.percent >= CLOSED_LID_BATTERY_FLOOR;
};

/* sudo skips a file in its includedir whose name has a dot, so the rule is named after the uid and not the user. */
export const closedLidRulePath = (uid: number): string => `/etc/sudoers.d/ruimte-closed-lid-${uid}`;

// A macOS short name. Anything else would need quoting in sudoers, and the rule refuses it rather than guess.
const SHORT_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/* The whole rule, as it lands in `/etc/sudoers.d` and as the command line and the app show it. */
export const closedLidRule = (user: string): string => {
    if (!SHORT_NAME.test(user)) {
        throw new ClosedLidError('closed-lid-failed', `${user} is not a user name a sudoers rule takes as it is`);
    }
    return [
        '# Installed by Ruimte: lets this user turn sleep off and on again for a closed lid, and nothing else.',
        '# Remove it in Ruimte under Settings, Agents, with `ruimte closed-lid remove`, or by deleting this file.',
        `${user} ALL = (root) NOPASSWD: ${sleepCommand(true).join(' ')}, ${sleepCommand(false).join(' ')}`,
        ''
    ].join('\n');
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/*
 * Runs as root. The rule is written under a name with a dot, which sudo skips, checked by visudo and
 * only then moved into place, so sudo never reads half a rule or one that would break it.
 */
export const installRuleScript = (user: string, uid: number): string => {
    const path = closedLidRulePath(uid);
    const next = shellQuote(`${path}.new`);
    const lines = closedLidRule(user).trimEnd().split('\n');
    return [
        'set -e',
        'umask 077',
        `printf '%s\\n' ${lines.map(shellQuote).join(' ')} > ${next}`,
        `/usr/sbin/visudo -c -q -f ${next} || { /bin/rm -f ${next}; exit 1; }`,
        `/usr/sbin/chown root:wheel ${next}`,
        `/bin/chmod 0440 ${next}`,
        `/bin/mv -f ${next} ${shellQuote(path)}`
    ].join('\n');
};

/* Runs as root. Sleep goes back on first: once the rule is gone, nothing of this user can turn it on again. */
export const removeRuleScript = (uid: number): string => [sleepCommand(false).join(' '), `/bin/rm -f ${shellQuote(closedLidRulePath(uid))}`].join('\n');

/* macOS's own administrator dialog. The script and the line it shows go in as arguments, so neither is ever quoted into AppleScript. */
export const adminCommand = (script: string, prompt: string): string[] => [
    '/usr/bin/osascript',
    '-e',
    'on run argv',
    '-e',
    'do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges',
    '-e',
    'end run',
    script,
    prompt
];

/* The dialog's answer when the person pressed Cancel. */
export const adminCancelled = (stderr: string): boolean => stderr.includes('(-128)');

export const DEFAULT_ADMIN_PROMPT = {
    install: 'Ruimte wants to let this Mac stay awake with its lid closed. It installs a rule that lets it turn sleep off and on again, and nothing else.',
    remove: 'Ruimte wants to remove the rule that lets it keep this Mac awake with its lid closed.'
} as const;

/*
 * The watchdog: a shell that waits on a pipe from the daemon, which nothing ever writes to, and turns
 * sleep back on once it reads the end of it. That end comes when the daemon is gone however it went,
 * a SIGKILL or a crash included, since the kernel closes its side. It ignores the signals a terminal
 * sends its whole group, so a Ctrl+C stops the daemon and not this; the daemon dismisses it with a SIGKILL.
 */
export const watchdogCommand = (release: readonly string[] = sudoSleepCommand(false)): string[] => [
    '/bin/sh',
    '-c',
    `trap '' HUP INT TERM; while read -r line; do :; done; exec ${release.map(shellQuote).join(' ')}`
];

/* `SleepDisabled` among the system-wide settings `pmset -g` prints; false when it is not there. */
export const sleepDisabledIn = (output: string): boolean => /^\s*SleepDisabled\s+1\b/m.test(output);

/* Writes the power source once it starts and again on every change of it, the battery's charge included. */
export const POWER_STREAM_COMMAND = [PMSET, '-g', 'pslog'];

/*
 * Reads `pmset -g pslog`, which comes in blocks like these:
 *     2026-10-04 11:27:48 +0200 IOPSNotificationCreateRunLoopSource
 *     Now drawing from 'Battery Power'
 *      -InternalBattery-0 (id=23527523)	62%; discharging; 16:52 remaining present: true
 * Takes the output in whatever pieces it arrives and answers each reading that differs from the last.
 * A UPS counts as battery, so a Mac on one lets go below the floor or, without a battery of its own, at once.
 */
export class PowerStreamParser {
    private rest = '';
    private adapter: boolean | null = null;
    private percent: number | null = null;
    private last: PowerState | null = null;

    feed(chunk: string): PowerState[] {
        const lines = `${this.rest}${chunk}`.split('\n');
        this.rest = lines.pop() ?? '';
        const readings: PowerState[] = [];
        for (const line of lines) {
            const source = /Now drawing from '([^']+)'/.exec(line);
            if (source) {
                this.adapter = source[1] === 'AC Power';
            }
            const battery = /-InternalBattery-\d+\b.*?\s(\d{1,3})%/.exec(line);
            if (battery) {
                this.percent = Number(battery[1]);
            }
            if (this.adapter === null || (this.last?.adapter === this.adapter && this.last.percent === this.percent)) {
                continue;
            }
            this.last = { adapter: this.adapter, percent: this.percent };
            readings.push(this.last);
        }
        return readings;
    }
}

export interface Dismissable {
    dismiss(): void;
}

export interface Stoppable {
    stop(): void;
}

export type AdminResult = { ok: true } | { ok: false; cancelled: boolean; message: string };

/* Everything outside the process the closed lid touches; a test hands in a fake, so no test runs sudo or pmset. */
export interface ClosedLidSystem {
    rulePresent(): Promise<boolean>;
    /* `pmset -g`: whether sleep is off right now. */
    sleepDisabled(): Promise<boolean>;
    /* `sudo -n pmset -a disablesleep 1` or `0`; false when sudo or pmset refused. */
    setSleepDisabled(disabled: boolean): Promise<boolean>;
    /* The same as `setSleepDisabled(false)`, waited on, for a daemon on its way out. */
    enableSleepNow(): boolean;
    startWatchdog(): Dismissable;
    /* Streams power readings; null once the stream ended without being stopped. */
    watchPower(listener: (power: PowerState | null) => void): Stoppable;
    /* Runs a script as root after macOS's own administrator dialog. */
    runAsAdmin(script: string, prompt: string): Promise<AdminResult>;
    /* Says that this home turned sleep off, kept until it is on again, so a start after a crash or a power cut knows. */
    marker: {
        present(): Promise<boolean>;
        write(): Promise<void>;
        remove(): Promise<void>;
        removeNow(): void;
    };
}

export interface ClosedLidOptions {
    platform: NodeJS.Platform;
    uid: number;
    user: string;
    setting(): ClosedLidSetting;
    working(): boolean;
    system: ClosedLidSystem;
    /* Whether the rule is usable changed, and whether its file is there; every client hears it. */
    ruleChanged(present: boolean): void;
    log(line: string): void;
}

/*
 * The closed-lid half of keep awake. Checked on every change keep awake is checked on, on every power
 * reading and when the rule comes or goes, never on a clock. Sleep goes back on whenever the decision
 * lets go, when the daemon stops, and through the watchdog when the daemon dies without stopping.
 */
export class ClosedLid {
    private readonly options: ClosedLidOptions;
    private started = false;
    private stopped = false;
    private rule = false;
    // sudo refused the rule that is there; it stays unusable until its file changes or it is installed again.
    private refused = false;
    // Lets go for as long as the dialog that removes the rule is up, while sudo still takes it.
    private removing = false;
    private power: PowerState | null = null;
    private powerWatch: Stoppable | null = null;
    private target = false;
    private held: Dismissable | null = null;
    private work: Promise<void> = Promise.resolve();
    private refreshing: Promise<boolean> | null = null;

    constructor(options: ClosedLidOptions) {
        this.options = options;
    }

    get available(): boolean {
        return closedLidAvailable(this.options.platform);
    }

    /* Whether the daemon can turn sleep off: the rule is there and sudo took it the last time it was asked. */
    get ruleInstalled(): boolean {
        return this.rule && !this.refused;
    }

    /* Whether sleep is off right now on this daemon's word. */
    get holding(): boolean {
        return this.held !== null;
    }

    /* Puts back what a daemon before this one left, reads the rule, and only then starts deciding. */
    async start(): Promise<void> {
        if (!this.available || this.started || this.stopped) {
            return;
        }
        try {
            await this.recover();
            this.rule = await this.options.system.rulePresent();
        } catch (e) {
            this.options.log(`Reading whether this Mac may stay awake with its lid closed failed: ${errorText(e)}`);
        }
        this.started = true;
        this.check();
    }

    check(): void {
        if (!this.started || this.stopped) {
            return;
        }
        this.followPower();
        this.decide();
    }

    /* Resolves once every change asked for so far is carried out. */
    settled(): Promise<void> {
        return this.work;
    }

    /* Reads the rule again, which `endpoint.info` and `ruimte status` ask for; only a file that came or went costs more than a stat. */
    refreshRule(): Promise<boolean> {
        if (!this.available) {
            return Promise.resolve(false);
        }
        this.refreshing ??= this.readRule().finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }

    /* Installs or removes the rule through macOS's administrator dialog, which waits on a person. */
    async setRule(install: boolean, prompt: string): Promise<void> {
        if (!this.available) {
            throw new ClosedLidError('closed-lid-unavailable', 'Only a Mac can stay awake with its lid closed');
        }
        const { system } = this.options;
        const script = install ? installRuleScript(this.options.user, this.options.uid) : removeRuleScript(this.options.uid);
        if (!install) {
            this.removing = true;
            this.check();
            await this.settled();
        }
        let result: AdminResult;
        try {
            result = await system.runAsAdmin(script, prompt);
        } finally {
            this.removing = false;
        }
        if (result.ok) {
            this.refused = false;
        }
        await this.readRule(true);
        if (!result.ok) {
            throw result.cancelled
                ? new ClosedLidError('closed-lid-cancelled', 'The administrator dialog was cancelled')
                : new ClosedLidError(
                      'closed-lid-failed',
                      `${result.message} (in a terminal on this Mac, \`ruimte closed-lid ${install ? 'install' : 'remove'}\` does the same)`
                  );
        }
    }

    stop(): void {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        this.powerWatch?.stop();
        this.powerWatch = null;
        if (this.held !== null) {
            this.releaseNow();
        }
    }

    private async readRule(announce = false): Promise<boolean> {
        const before = this.ruleInstalled;
        let present: boolean;
        try {
            present = await this.options.system.rulePresent();
        } catch (e) {
            this.options.log(`Reading the closed-lid rule failed: ${errorText(e)}`);
            return this.ruleInstalled;
        }
        if (present !== this.rule) {
            this.rule = present;
            this.refused = false;
        }
        if (announce || this.ruleInstalled !== before) {
            this.options.ruleChanged(present);
            this.check();
        }
        return this.ruleInstalled;
    }

    private followPower(): void {
        const setting = this.options.setting();
        const armed = this.ruleInstalled && setting.lidClosed && setting.mode !== 'off';
        if (armed && this.powerWatch === null) {
            try {
                const watch: Stoppable = this.options.system.watchPower((power) => {
                    if (this.powerWatch === watch) {
                        this.powerChanged(power);
                    }
                });
                this.powerWatch = watch;
            } catch (e) {
                this.options.log(`Following the power source failed: ${errorText(e)}`);
            }
        } else if (!armed && this.powerWatch !== null) {
            this.powerWatch.stop();
            this.powerWatch = null;
            this.power = null;
        }
    }

    private powerChanged(power: PowerState | null): void {
        this.power = power;
        if (power === null) {
            // Without a reading nothing holds; the stream starts again at the next change instead of in a loop.
            this.powerWatch = null;
            this.options.log('The power source stream ended; it starts again at the next change');
        }
        if (this.started && !this.stopped) {
            this.decide();
        }
    }

    private decide(): void {
        const wanted =
            !this.removing &&
            closedLidHolds({
                setting: this.options.setting(),
                working: this.options.working(),
                platform: this.options.platform,
                rule: this.ruleInstalled,
                power: this.power
            });
        if (wanted === this.target) {
            return;
        }
        this.target = wanted;
        this.work = this.work.then(() => this.apply()).catch((e: unknown) => this.options.log(`Switching sleep for the closed lid failed: ${errorText(e)}`));
    }

    private async apply(): Promise<void> {
        if (this.stopped) {
            return;
        }
        if (this.target && this.held === null) {
            await this.hold();
        } else if (!this.target && this.held !== null) {
            await this.release();
        }
    }

    /* The marker and the watchdog are up before sleep goes off, so there is never a moment it is off without both. */
    private async hold(): Promise<void> {
        const { system, log } = this.options;
        try {
            await system.marker.write();
        } catch (e) {
            log(`Keeping this Mac awake with its lid closed failed: ${errorText(e)}`);
            this.target = false;
            return;
        }
        let watchdog: Dismissable;
        try {
            watchdog = system.startWatchdog();
        } catch (e) {
            log(`Keeping this Mac awake with its lid closed failed, since its watchdog did not start: ${errorText(e)}`);
            await system.marker.remove().catch(() => undefined);
            this.target = false;
            return;
        }
        if (!(await system.setSleepDisabled(true))) {
            watchdog.dismiss();
            await system.marker.remove().catch(() => undefined);
            this.target = false;
            this.refused = true;
            log(`sudo did not let this user turn sleep off; the rule in ${closedLidRulePath(this.options.uid)} needs installing again`);
            this.options.ruleChanged(this.rule);
            return;
        }
        this.held = watchdog;
        log('Sleep is off, so this Mac stays awake with its lid closed');
        if (this.stopped) {
            this.releaseNow();
        }
    }

    private async release(): Promise<void> {
        const { system, log } = this.options;
        const watchdog = this.held;
        this.held = null;
        if (await system.setSleepDisabled(false)) {
            watchdog?.dismiss();
            await system.marker.remove().catch((e: unknown) => log(`Removing the closed-lid marker failed: ${errorText(e)}`));
            log('Sleep is back on, so a closed lid sleeps this Mac again');
            return;
        }
        // The watchdog stays, for one more try once the daemon is gone, and so does the marker for the next start.
        log('Turning sleep back on failed; `sudo pmset -a disablesleep 0` lets this Mac sleep again');
    }

    private releaseNow(): void {
        const { system, log } = this.options;
        const watchdog = this.held;
        this.held = null;
        if (system.enableSleepNow()) {
            watchdog?.dismiss();
            try {
                system.marker.removeNow();
            } catch (e) {
                log(`Removing the closed-lid marker failed: ${errorText(e)}`);
            }
            log('Sleep is back on for the daemon stopping');
            return;
        }
        log('Turning sleep back on failed as the daemon stops; its watchdog tries once more when it is gone');
    }

    /*
     * Sleep found off with this home's marker beside it was left by a daemon before this one, through a
     * crash the watchdog missed or a power cut, and goes back on at once. Off without the marker is
     * somebody else's: a person's own `pmset`, or a Ruimte with another home. That is left alone.
     */
    private async recover(): Promise<void> {
        const { system, log } = this.options;
        const ours = await system.marker.present();
        const disabled = await system.sleepDisabled();
        if (!disabled) {
            if (ours) {
                await system.marker.remove();
            }
            return;
        }
        if (!ours) {
            log('Sleep is off on this Mac (SleepDisabled 1), turned off by something other than this machine; it is left as it is');
            return;
        }
        if (await system.setSleepDisabled(false)) {
            await system.marker.remove();
            log('Sleep was still off from before this start, so it is back on');
            return;
        }
        log('Sleep is still off from before this start and could not be turned back on; `sudo pmset -a disablesleep 0` lets this Mac sleep again');
    }
}
