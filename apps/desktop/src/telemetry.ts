import { blankQuoted, createDailyDedupe, createScrubber, type DedupeStore } from '@ruimte/telemetry';
import type { RendererMemoryReport } from './renderer-memory';

/* What the shell reports besides an error nothing caught and a native crash. Every message is fixed text; a reason is scrubbed. */
export type ShellProblem =
    | { kind: 'process-gone'; process: string; reason: string; exitCode: number; memory?: RendererMemoryReport | null }
    | { kind: 'daemon-start-failed'; reason: string; daemon?: DaemonStartupDiagnostics }
    | { kind: 'daemon-spawn-failed'; code: string }
    | { kind: 'daemon-gave-up'; ends: number }
    | { kind: 'service-fallback'; step: 'install' | 'start' | 'restart'; reason: string }
    | { kind: 'session-cleared'; reason: 'no-key' | 'unauthorized' | 'bad-request' | 'bad-signature' }
    | { kind: 'session-key-unreadable' };

interface ShellEvent {
    message: string;
    level: 'error' | 'fatal';
    fingerprint: string[];
    tags: Record<string, string>;
    extra: Record<string, string | number | string[]>;
}

export interface DaemonStartupDiagnostics {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    output: string[];
}

interface ShellIdentity {
    readonly home: string;
    readonly username: string;
    readonly hostname: string;
}

const TAGS = ['process', 'platform', 'arch', 'electron', 'package', 'problem', 'exit_reason', 'step'];
const EXTRAS = ['exit_code', 'reason', 'ends', 'signal', 'startup_output', 'memory_mb', 'peak_memory_mb', 'uptime_min', 'guests'];

interface ShellRuntime {
    readonly platform: NodeJS.Platform;
    readonly arch: string;
    readonly electron: string;
    /* `APPIMAGE`, which the AppImage runtime sets to the image's own path. */
    readonly appImage: string | undefined;
}

/*
 * The tags every report of the shell carries. A native crash is only read against the symbols of the
 * Electron it ran on, and on Linux an AppImage runs without the AppArmor profile the deb and rpm install.
 */
export function shellTags(runtime: ShellRuntime): Record<string, string> {
    const tags: Record<string, string> = { process: 'main', platform: runtime.platform, arch: runtime.arch, electron: runtime.electron };

    if (runtime.platform === 'linux') {
        tags.package = runtime.appImage ? 'appimage' : 'installed';
    }

    return tags;
}

/* A crash or running out of memory; an exit the app asked for, a kill or a clean exit is no report. */
export function isCrash(reason: string): boolean {
    return reason === 'crashed' || reason === 'oom';
}

/* `GPU` and `Sandbox helper` as Electron names a child, as a tag value. */
export function processTag(type: string): string {
    return type.toLowerCase().replace(/\s+/g, '-');
}

export function problemEvent(problem: ShellProblem): ShellEvent {
    switch (problem.kind) {
        case 'process-gone':
            return {
                message: `The ${problem.process} process is gone (${problem.reason})`,
                level: 'fatal',
                fingerprint: ['process-gone', problem.process, problem.reason],
                tags: { problem: problem.kind, process: problem.process, exit_reason: problem.reason },
                extra: {
                    exit_code: problem.exitCode,
                    ...(problem.memory
                        ? {
                              memory_mb: problem.memory.memoryMb,
                              peak_memory_mb: problem.memory.peakMemoryMb,
                              uptime_min: problem.memory.uptimeMin,
                              guests: problem.memory.guests
                          }
                        : {})
                }
            };
        case 'daemon-start-failed': {
            const extra: ShellEvent['extra'] = { reason: problem.reason };
            if (problem.daemon) {
                const { exitCode, signal, output } = problem.daemon;
                if (exitCode !== null) {
                    extra.exit_code = exitCode;
                }
                if (signal !== null) {
                    extra.signal = signal;
                }
                if (output.length > 0) {
                    // Startup errors can quote source text from a private file.
                    extra.startup_output = output.map(blankQuoted);
                }
            }
            return {
                message: 'The machine did not start',
                level: 'error',
                fingerprint: ['daemon-start-failed', problem.reason],
                tags: { problem: problem.kind },
                extra
            };
        }
        case 'daemon-spawn-failed':
            return {
                message: `The machine could not be spawned (${problem.code})`,
                level: 'error',
                fingerprint: ['daemon-spawn-failed', problem.code],
                tags: { problem: problem.kind },
                extra: {}
            };
        case 'daemon-gave-up':
            return {
                message: 'The machine kept ending and is not started again',
                level: 'error',
                fingerprint: ['daemon-gave-up'],
                tags: { problem: problem.kind },
                extra: { ends: problem.ends }
            };
        case 'service-fallback':
            return {
                message: `The background service did not ${problem.step}, so the app runs the machine itself`,
                level: 'error',
                fingerprint: ['service-fallback', problem.step],
                tags: { problem: problem.kind, step: problem.step },
                extra: { reason: problem.reason }
            };
        case 'session-cleared':
            return {
                message: `The account session was cleared (${problem.reason})`,
                level: 'error',
                fingerprint: ['session-cleared', problem.reason],
                tags: { problem: problem.kind, reason: problem.reason },
                extra: {}
            };
        case 'session-key-unreadable':
            return {
                message: 'The keychain did not hand over the key of the account session',
                level: 'error',
                fingerprint: ['session-key-unreadable'],
                tags: { problem: problem.kind },
                extra: {}
            };
    }
}

/*
 * The scrubber, then the dedupe. A minidump carries its stack only in the attachment, so the dedupe
 * cannot tell two native crashes apart: one per process a day goes out.
 */
export function shellBeforeSend(identity: ShellIdentity, store: DedupeStore, now?: () => number): <T extends object>(event: T) => T | null {
    const scrubber = createScrubber({ ...identity, tags: TAGS, extras: EXTRAS });
    const dedupe = createDailyDedupe({ store, ...(now ? { now } : {}) });
    return (event) => {
        const scrubbed = scrubber.scrubEvent(withProcessTag(event));
        if (scrubbed === null) {
            return null;
        }
        const native = (scrubbed as { platform?: unknown }).platform === 'native';
        const process = (scrubbed as { tags?: Record<string, unknown> }).tags?.process;
        return dedupe.admit(native ? { fingerprint: ['native-crash', String(process ?? 'unknown')] } : scrubbed) ? scrubbed : null;
    };
}

/* The SDK names the process of a native crash `event.process`; the reports name it `process`. */
function withProcessTag<T extends object>(event: T): T {
    const tags = (event as { tags?: Record<string, unknown> }).tags;
    const named = tags?.['event.process'];
    if (tags === undefined || typeof named !== 'string') {
        return event;
    }
    return { ...event, tags: { ...tags, process: processTag(named) } };
}
