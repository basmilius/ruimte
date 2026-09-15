#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { accessSync, chmodSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { constants as osConstants } from 'node:os';
import { binaryPathOf, exitCodeOf, LauncherError } from './launcher';

/*
 * `npx ruimte` and `bunx ruimte`: runs the binary from the platform package with the same arguments.
 * Bundled for Node at publish time, so it runs where Bun is not installed.
 */

const require = createRequire(import.meta.url);

let binary: string;
try {
    binary = binaryPathOf({ platform: process.platform, arch: process.arch }, (request) => require.resolve(request));
} catch (e) {
    console.error(e instanceof LauncherError ? e.message : String(e));
    process.exit(1);
}

// A tarball unpacked by a tool that drops the mode leaves the binary unexecutable; restoring it is harmless when it was not.
try {
    accessSync(binary, constants.X_OK);
} catch {
    try {
        chmodSync(binary, 0o755);
    } catch {
        // The spawn below reports what is wrong.
    }
}

const args = process.argv.slice(2);

// Node 22.15 and later replace this process with the binary, so the signals and the exit code are the binary's own.
const execve = (process as { execve?: (file: string, args: string[], env: NodeJS.ProcessEnv) => never }).execve;
if (typeof execve === 'function') {
    try {
        execve(binary, [binary, ...args], process.env);
    } catch {
        // Falls through to a child, which works everywhere.
    }
}

const child = spawn(binary, args, { stdio: 'inherit' });

/*
 * A Ctrl+C reaches the child through the terminal's process group already, and passing it on again
 * would cut short what the first one started (`ruimte login` withdraws its code on SIGINT). The
 * listener only keeps the launcher alive until the child has finished. The rest is what a service
 * manager or `kill` sends to the launcher alone.
 */
const FORWARDED = ['SIGTERM', 'SIGHUP', 'SIGQUIT'] as const;
const ignoreInterrupt = (): void => {};
process.on('SIGINT', ignoreInterrupt);
const forwarders = FORWARDED.map((signal) => {
    const forward = (): void => {
        child.kill(signal);
    };
    process.on(signal, forward);
    return { signal, forward };
});

child.on('error', (e) => {
    console.error(`Could not start ${binary}: ${e.message}`);
    process.exit(1);
});

child.on('exit', (code, signal) => {
    process.off('SIGINT', ignoreInterrupt);
    for (const { signal: name, forward } of forwarders) {
        process.off(name, forward);
    }
    if (signal !== null) {
        // Ending the same way tells the parent shell the child was killed, not that it exited.
        process.kill(process.pid, signal);
    }
    process.exit(exitCodeOf(code, signal === null ? null : osConstants.signals[signal]));
});
