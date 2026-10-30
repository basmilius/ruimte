import { existsSync } from 'node:fs';
import { constants } from 'node:os';
import { basename, win32 } from 'node:path';
import type { TerminalShell } from '@ruimte/contracts';

export interface PtySpawnOptions {
    shell: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: Record<string, string>;
}

export interface PtyProcess {
    readonly pid: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: NodeJS.Signals): void;
    // Settles once a kill still running is done, so a daemon going down outlives a taskkill on Windows.
    killSettled?(): Promise<void>;
    onData(callback: (data: Uint8Array) => void): void;
    onExit(callback: (exitCode: number) => void): void;
}

// The one seam between the session layer and the runtime that owns the PTY, so a test
// can feed a fake and a future runtime (a different spawn API, a remote host) slots in.
export interface PtyAdapter {
    spawn(options: PtySpawnOptions): PtyProcess;
}

export function defaultShell(
    env: Record<string, string | undefined> = process.env,
    platform: string = process.platform,
    which: (program: string) => string | null = (program) => Bun.which(program, { PATH: env.PATH ?? env.Path ?? '' }),
    exists: (path: string) => boolean = existsSync
): string {
    // Before $SHELL: a daemon started from Git Bash inherits one that is no Windows path.
    if (platform === 'win32') {
        return windowsShell(env, which, exists);
    }
    const fromEnv = env.SHELL?.trim();
    if (fromEnv) {
        return fromEnv;
    }
    return platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

/* The shell of a new terminal: on Windows what a person chose, while it is there; elsewhere the login shell. */
export function personShell(
    choice: TerminalShell | null,
    env: Record<string, string | undefined> = process.env,
    platform: string = process.platform,
    which: (program: string) => string | null = (program) => Bun.which(program, { PATH: env.PATH ?? env.Path ?? '' })
): string {
    const fallback = defaultShell(env, platform, which);
    if (platform !== 'win32') {
        return fallback;
    }
    switch (choice) {
        case 'git-bash':
            return gitBash(env, which) ?? fallback;
        case 'cmd':
            return env.COMSPEC ?? 'cmd.exe';
        case 'wsl':
            return which('wsl') ?? fallback;
        default:
            return fallback;
    }
}

/* What a person on Windows knows comes first. Git Bash only runs what the daemon types (`shellFor`). */
function windowsShell(env: Record<string, string | undefined>, which: (program: string) => string | null, exists: (path: string) => boolean): string {
    return which('pwsh') ?? which('powershell') ?? gitBash(env, which, exists) ?? env.COMSPEC ?? 'cmd.exe';
}

/*
 * The `bash.exe` of Git for Windows, or null without it. Every line the daemon types on Windows (an
 * agent's start, a resume with `||`, a long line through `eval`, a launch) is POSIX and runs here.
 */
export function gitBash(
    env: Record<string, string | undefined> = process.env,
    which: (program: string) => string | null = (program) => Bun.which(program, { PATH: env.PATH ?? env.Path ?? '' }),
    exists: (path: string) => boolean = existsSync
): string | null {
    const git = which('git');
    const roots = [
        git === null ? null : win32.resolve(win32.dirname(git), '..'),
        env.ProgramFiles === undefined ? null : win32.join(env.ProgramFiles, 'Git'),
        env.LOCALAPPDATA === undefined ? null : win32.join(env.LOCALAPPDATA, 'Programs', 'Git')
    ];
    for (const root of roots) {
        if (root === null) {
            continue;
        }
        // `git.exe` lives in `cmd` or in `mingw64/bin`, so the root is one or two levels up.
        for (const candidate of [win32.join(root, 'bin', 'bash.exe'), win32.join(root, '..', 'bin', 'bash.exe')]) {
            if (exists(candidate)) {
                return win32.normalize(candidate);
            }
        }
    }
    return null;
}

// Shells that understand -l. A PTY already makes them interactive; the login flag is what
// makes them read the profile that sets PATH, which a daemon started from launchd or systemd lacks.
const LOGIN_CAPABLE = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'ksh']);

/*
 * Reports the cwd the way Git Bash does (OSC 7) and then draws the person's own prompt. Their profile
 * has run by then, so it wraps whatever prompt they set. A location off the file system or a UNC path reads as unknown.
 */
const POWERSHELL_INTEGRATION = String.raw`
$global:RuimtePrompt = $function:prompt
function global:prompt {
    $location = Get-Location
    $path = $location.ProviderPath
    if ($location.Provider.Name -eq 'FileSystem' -and $path -match '^[A-Za-z]:') {
        $encoded = ($path -replace '\\', '/') -replace '%', '%25' -replace '#', '%23' -replace '\?', '%3F' -replace ' ', '%20'
        [Console]::Write([char]27 + "]7;file://localhost/$encoded" + [char]7)
    } else {
        [Console]::Write([char]27 + ']7;unknown' + [char]7)
    }
    & $global:RuimtePrompt
}`;

export function defaultShellArgs(shell: string): string[] {
    const name = shellName(shell);
    if (name === 'pwsh' || name === 'powershell') {
        // An encoded command is no script, so an execution policy that blocks scripts lets it through, and nothing needs quoting.
        return ['-NoLogo', '-NoExit', '-EncodedCommand', Buffer.from(POWERSHELL_INTEGRATION, 'utf16le').toString('base64')];
    }
    return LOGIN_CAPABLE.has(name) ? ['-l'] : [];
}

/* The shell's own name, without a folder in either separator or the `.exe` of Windows. */
export function shellName(shell: string): string {
    return win32.basename(basename(shell)).replace(/\.exe$/i, '');
}

export function signalExitCode(signal: string, signals: Record<string, number> = constants.signals as Record<string, number>): number {
    return 128 + (signals[signal] ?? 0);
}
