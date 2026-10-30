import { CodedError } from '@adecore/agents';
import { nativePath } from './native-path.ts';

export interface GitResult<Output = string> {
    code: number;
    stdout: Output;
    stderr: string;
    /* Only set by a call that was given `timeoutMs`: git was ended for taking longer. */
    timedOut?: boolean;
}

interface GitOptions {
    env?: Record<string, string>;
    stdin?: string;
    /* Ends git after this long, for a question about a folder that may sit on a slow or stuck volume. */
    timeoutMs?: number;
}

type GitErrorCode =
    | 'not-a-repo'
    | 'clone-refused'
    | 'outside-checkout'
    | 'git-failed'
    | 'worktree-not-found'
    | 'worktree-has-work'
    | 'worktree-refused'
    | 'worktree-locked'
    | 'worktree-missing'
    | 'worktree-busy'
    | 'worktree-taken'
    | 'no-branch'
    | 'ref-not-found'
    | 'gh-missing'
    | 'folder-missing'
    | 'pr-watch-refused'
    | 'pr-watch-limit'
    | 'gh-unauthenticated'
    | 'gh-failed'
    | 'issue-not-found'
    | 'pr-not-found'
    | 'branch-exists'
    | 'target-not-checked-out'
    | 'target-busy'
    | 'target-dirty'
    | 'agent-working'
    | 'merge-conflict'
    // A pull that can only fast-forward while both sides have moved on: the person picks how they come together.
    | 'diverged'
    | 'bundle-too-large'
    | 'bundle-limit'
    | 'bundle-offset'
    | 'bundle-uploads-busy'
    | 'peer-bundle-limit'
    | 'bundle-missing'
    | 'bundle-corrupt'
    | 'bundle-unverified';

export class GitError extends CodedError<GitErrorCode> {}

// A branch name or a subject may hold anything but a control character, so this one never appears inside a field.
export const FIELD = '\u001f';

/* Ends a process started `detached` and whatever it started. Windows has no process groups, so there taskkill walks the tree. */
function killGroup(proc: Bun.Subprocess, signal: NodeJS.Signals): void {
    if (process.platform === 'win32') {
        void Bun.spawn(['taskkill', '/PID', String(proc.pid), '/T', '/F'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', windowsHide: true }).exited;
        return;
    }
    try {
        process.kill(-proc.pid, signal);
    } catch {
        proc.kill(signal);
    }
}

/* `runGit` with stdout as the bytes git wrote, for content that is not known to be text. A git that
   cannot start reads as code 128, the same code git itself uses for "this is not a repository". */
export async function runGitBytes(args: string[], cwd: string, options: GitOptions = {}): Promise<GitResult<Uint8Array>> {
    const timed = options.timeoutMs !== undefined;
    try {
        const proc = Bun.spawn(['git', ...args], {
            cwd,
            env: options.env ? { ...process.env, ...options.env } : undefined,
            stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
            stdout: 'pipe',
            stderr: 'pipe',
            // A group of its own, so the end takes a credential helper or an alias with it: whatever git started holds the pipes until it is gone.
            detached: timed
        });
        let timedOut = false;
        const timer = timed
            ? setTimeout(() => {
                  timedOut = true;
                  killGroup(proc, 'SIGKILL');
              }, options.timeoutMs)
            : null;
        try {
            const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).bytes(), new Response(proc.stderr).text(), proc.exited]);
            return { code, stdout, stderr, ...(timedOut ? { timedOut: true } : {}) };
        } finally {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
    } catch {
        return { code: 128, stdout: new Uint8Array(), stderr: '' };
    }
}

/* One git call in a directory, with its exit code kept: `check-ignore` answers 1 for "nothing
   matched", which is a result and not a failure. */
export async function runGit(args: string[], cwd: string, options: GitOptions = {}): Promise<GitResult> {
    const result = await runGitBytes(args, cwd, options);
    return { ...result, stdout: new TextDecoder().decode(result.stdout) };
}

/* The output of a git that succeeded, or null for every other outcome. */
export async function git(args: string[], cwd: string, env?: Record<string, string>): Promise<string | null> {
    const { code, stdout } = await runGit(args, cwd, { env });
    return code === 0 ? stdout : null;
}

// A status read is a question, not a change: without this git refreshes the index and takes its lock, which fails a commit running beside it.
export const READ_ONLY_GIT = { GIT_OPTIONAL_LOCKS: '0' };

/* `git` for a read that must not take `index.lock`. */
export function readGit(args: string[], cwd: string): Promise<string | null> {
    return git(args, cwd, READ_ONLY_GIT);
}

/* A git whose failure is the person's problem, not a result: what it wrote to stderr is the message. */
export async function gitOrThrow(args: string[], cwd: string, env?: Record<string, string>): Promise<string> {
    const { code, stdout, stderr } = await runGit(args, cwd, { env });
    if (code !== 0) {
        throw new GitError('git-failed', stderr.trim() || `git ${args[0]} failed`);
    }
    return stdout;
}

/* The top of the working tree `cwd` is in, as the path git itself reports, or null outside a repository. */
export async function repositoryRoot(cwd: string): Promise<string | null> {
    const top = (await git(['rev-parse', '--show-toplevel'], cwd))?.trim();
    return top ? nativePath(top) : null;
}

export async function toplevel(cwd: string): Promise<string> {
    const top = await repositoryRoot(cwd);
    if (top === null) {
        throw new GitError('not-a-repo', `${cwd} is not inside a git repository`);
    }
    return top;
}

/* The object a revision names, or null when it names none. A revision may come from a client, so it never parses as an option. */
export async function verifyRev(rev: string, cwd: string): Promise<string | null> {
    return (await git(['rev-parse', '--verify', '--quiet', '--end-of-options', rev], cwd))?.trim() || null;
}

export interface StreamOptions {
    env?: Record<string, string>;
    /* Every line git wrote, stdout and stderr both, trimmed and never empty. */
    onLine?(line: string): void;
    /* The process itself, so a caller that has to cancel can kill it. */
    onSpawn?(kill: () => void): void;
    /* Runs it in a process group of its own, which `kill` ends whole: a hook git started keeps the
       output pipes open after git itself is gone, and the call would never come back. */
    group?: boolean;
    /* What the command reads on stdin; without it stdin is closed. */
    stdin?: string;
}

/*
 * Git writes its progress to stderr, one carriage return at a time, so the reader splits on both
 * line endings and hands every line on while the command runs. Everything it wrote is answered as
 * well: a failure is only readable with its whole output, not with the last line of it.
 */
async function pump(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<string> {
    const decoder = new TextDecoder();
    let pending = '';
    let whole = '';

    const emit = (line: string): void => {
        const trimmed = line.trim();
        if (trimmed !== '') {
            onLine(trimmed);
        }
    };

    for await (const chunk of stream) {
        const text = decoder.decode(chunk, { stream: true });
        whole += text;
        pending += text;
        const lines = pending.split(/\r\n|\r|\n/);
        pending = lines.pop() ?? '';
        lines.forEach(emit);
    }
    emit(pending);

    return whole;
}

/*
 * One command whose output is read while it runs, for the actions the panel takes: a push over a
 * slow link says where it is long before it is over. No shell anywhere, the arguments are a list.
 * `GIT_TERMINAL_PROMPT` keeps a credential prompt from stalling the daemon on a socket nobody can
 * type into, and `LC_ALL` keeps the words a summary reads for the ones git writes in C.
 */
export async function streamCommand(command: string, args: string[], cwd: string, options: StreamOptions = {}): Promise<GitResult> {
    const onLine = options.onLine ?? ((): void => undefined);
    let proc;
    try {
        proc = Bun.spawn([command, ...args], {
            cwd,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...options.env },
            stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
            stdout: 'pipe',
            stderr: 'pipe',
            detached: options.group === true
        });
    } catch {
        return { code: 128, stdout: '', stderr: `${command} could not be started` };
    }
    const started = proc;
    options.onSpawn?.(options.group === true ? () => killGroup(started, 'SIGTERM') : () => started.kill());
    const [stdout, stderr, code] = await Promise.all([pump(proc.stdout, onLine), pump(proc.stderr, onLine), proc.exited]);
    return { code, stdout, stderr };
}

/*
 * A command that is ended once it runs past `timeoutMs`, for a one-shot agent CLI a person waits on.
 * The end is one SIGTERM to its group and never a SIGKILL: a stuck process gets no signal a person did
 * not press.
 */
export async function streamWithTimeout(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
    options: Pick<StreamOptions, 'onSpawn' | 'stdin' | 'env'> = {}
): Promise<GitResult> {
    let kill: (() => void) | null = null;
    const timer = setTimeout(() => kill?.(), timeoutMs);
    try {
        return await streamCommand(command, args, cwd, {
            ...options,
            onSpawn: (stop) => {
                kill = stop;
                options.onSpawn?.(stop);
            },
            group: true
        });
    } finally {
        clearTimeout(timer);
    }
}

export function streamGit(args: string[], cwd: string, options: StreamOptions = {}): Promise<GitResult> {
    return streamCommand('git', args, cwd, options);
}
