import { rmSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileExists, writeAtomic } from '@ruimte/agents/fs';
import { runProcess } from '@ruimte/agents/run-process';
import {
    POWER_STREAM_COMMAND,
    PMSET,
    PowerStreamParser,
    adminCancelled,
    adminCommand,
    closedLidRulePath,
    sleepDisabledIn,
    sudoSleepCommand,
    watchdogCommand,
    type ClosedLidSystem,
    type Dismissable,
    type PowerState,
    type Stoppable
} from './closed-lid.ts';

/* Where a home notes that it turned sleep off, kept beside nothing a client can read. */
export const closedLidMarkerPath = (home: string): string => join(home, 'power', 'closed-lid-held');

export interface Watchdog extends Dismissable {
    readonly pid: number;
    readonly exited: Promise<number>;
}

/*
 * Starts a watchdog detached in a session of its own, holding the write end of its stdin for as long as
 * the returned handle lives. Dismissing sends a SIGKILL, which it cannot ignore, so it never runs its command then.
 */
export const spawnWatchdog = (command: string[]): Watchdog => {
    const watchdog = Bun.spawn(command, { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore', detached: true });
    watchdog.unref();
    return {
        pid: watchdog.pid,
        exited: watchdog.exited,
        dismiss: () => {
            watchdog.kill('SIGKILL');
        }
    };
};

/* `pmset -g pslog` as readings; its own end without a stop is a null. */
export const streamPower = (listener: (power: PowerState | null) => void): Stoppable => {
    const stream = Bun.spawn(POWER_STREAM_COMMAND, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const parser = new PowerStreamParser();
    const decoder = new TextDecoder();
    let stopped = false;
    void (async () => {
        try {
            for await (const chunk of stream.stdout) {
                if (stopped) {
                    break;
                }
                parser.feed(decoder.decode(chunk, { stream: true })).forEach(listener);
            }
        } catch {
            // A stream that breaks off ends like one that closed.
        }
        await stream.exited;
        if (!stopped) {
            listener(null);
        }
    })();
    return {
        stop: () => {
            stopped = true;
            stream.kill();
        }
    };
};

/* The closed lid on a real Mac: sudo, pmset, osascript and the marker under `$RUIMTE_HOME`. */
export const macClosedLidSystem = (home: string, uid: number): ClosedLidSystem => {
    const marker = closedLidMarkerPath(home);
    return {
        rulePresent: () => fileExists(closedLidRulePath(uid)),
        sleepDisabled: async () => sleepDisabledIn((await runProcess([PMSET, '-g'])).stdout),
        setSleepDisabled: async (disabled) => (await runProcess(sudoSleepCommand(disabled)).catch(() => null))?.exitCode === 0,
        enableSleepNow: () => Bun.spawnSync(sudoSleepCommand(false), { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).exitCode === 0,
        startWatchdog: () => spawnWatchdog(watchdogCommand()),
        watchPower: streamPower,
        runAsAdmin: async (script, prompt) => {
            const result = await runProcess(adminCommand(script, prompt));
            if (result.exitCode === 0) {
                return { ok: true };
            }
            return {
                ok: false,
                cancelled: adminCancelled(result.stderr),
                message: result.stderr.trim() || `osascript ended with ${result.exitCode ?? 'a signal'}`
            };
        },
        marker: {
            present: () => fileExists(marker),
            write: async () => {
                await mkdir(dirname(marker), { recursive: true, mode: 0o700 });
                // Durable: a power cut right after sleep went off must still find it at the next start.
                await writeAtomic(marker, `${JSON.stringify({ pid: process.pid, since: new Date().toISOString() })}\n`, 0o600, { durable: true });
            },
            remove: () => rm(marker, { force: true }),
            removeNow: () => rmSync(marker, { force: true })
        }
    };
};
