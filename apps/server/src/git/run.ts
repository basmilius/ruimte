import { CodedError } from '../coded-error.ts';

export interface GitResult<Output = string> {
    code: number;
    stdout: Output;
    stderr: string;
}

interface GitOptions {
    env?: Record<string, string>;
    stdin?: string;
}

export type GitErrorCode =
    | 'not-a-repo'
    | 'git-failed'
    | 'worktree-not-found'
    | 'worktree-has-work'
    | 'worktree-locked'
    | 'worktree-missing'
    | 'worktree-busy'
    | 'worktree-taken'
    | 'no-branch'
    | 'target-not-checked-out'
    | 'target-busy'
    | 'target-dirty'
    | 'agent-working'
    | 'merge-conflict'
    // A pull that can only fast-forward while both sides have moved on: the person picks how they come together.
    | 'diverged';

export class GitError extends CodedError<GitErrorCode> {}

/* `runGit` with stdout as the bytes git wrote, for content that is not known to be text. A git that
   cannot start reads as code 128, the same code git itself uses for "this is not a repository". */
export const runGitBytes = async (args: string[], cwd: string, options: GitOptions = {}): Promise<GitResult<Uint8Array>> => {
    try {
        const proc = Bun.spawn(['git', ...args], {
            cwd,
            env: options.env ? { ...process.env, ...options.env } : undefined,
            stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
            stdout: 'pipe',
            stderr: 'pipe'
        });
        const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).bytes(), new Response(proc.stderr).text(), proc.exited]);
        return { code, stdout, stderr };
    } catch {
        return { code: 128, stdout: new Uint8Array(), stderr: '' };
    }
};

/* One git call in a directory, with its exit code kept: `check-ignore` answers 1 for "nothing
   matched", which is a result and not a failure. */
export const runGit = async (args: string[], cwd: string, options: GitOptions = {}): Promise<GitResult> => {
    const { code, stdout, stderr } = await runGitBytes(args, cwd, options);
    return { code, stdout: new TextDecoder().decode(stdout), stderr };
};

/* The output of a git that succeeded, or null for every other outcome. */
export const git = async (args: string[], cwd: string, env?: Record<string, string>): Promise<string | null> => {
    const { code, stdout } = await runGit(args, cwd, { env });
    return code === 0 ? stdout : null;
};

/* A git whose failure is the person's problem, not a result: what it wrote to stderr is the message. */
export const gitOrThrow = async (args: string[], cwd: string): Promise<string> => {
    const { code, stdout, stderr } = await runGit(args, cwd);
    if (code !== 0) {
        throw new GitError('git-failed', stderr.trim() || `git ${args[0]} failed`);
    }
    return stdout;
};

/* The repository a directory belongs to, as the path git itself reports. */
export const toplevel = async (cwd: string): Promise<string> => {
    const top = (await git(['rev-parse', '--show-toplevel'], cwd))?.trim();
    if (!top) {
        throw new GitError('not-a-repo', `${cwd} is not inside a git repository`);
    }
    return top;
};

export interface StreamOptions {
    env?: Record<string, string>;
    /* Every line git wrote, stdout and stderr both, trimmed and never empty. */
    onLine?(line: string): void;
    /* The process itself, so a caller that has to cancel can kill it. */
    onSpawn?(kill: () => void): void;
    /* Runs it in a process group of its own, which `kill` ends whole: a hook git started keeps the
       output pipes open after git itself is gone, and the call would never come back. */
    group?: boolean;
}

/*
 * Git writes its progress to stderr, one carriage return at a time, so the reader splits on both
 * line endings and hands every line on while the command runs. Everything it wrote is answered as
 * well: a failure is only readable with its whole output, not with the last line of it.
 */
const pump = async (stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<string> => {
    const decoder = new TextDecoder();
    let pending = '';
    let whole = '';
    for await (const chunk of stream) {
        const text = decoder.decode(chunk, { stream: true });
        whole += text;
        pending += text;
        const lines = pending.split(/\r\n|\r|\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) {
            if (line.trim() !== '') {
                onLine(line.trim());
            }
        }
    }
    if (pending.trim() !== '') {
        onLine(pending.trim());
    }
    return whole;
};

/*
 * One git call whose output is read while it runs, for the actions the panel takes: a push over a
 * slow link says where it is long before it is over. No shell anywhere, the arguments are a list.
 * `GIT_TERMINAL_PROMPT` keeps a credential prompt from stalling the daemon on a socket nobody can
 * type into, and `LC_ALL` keeps the words a summary reads for the ones git writes in C.
 */
export const streamCommand = async (command: string, args: string[], cwd: string, options: StreamOptions = {}): Promise<GitResult> => {
    const onLine = options.onLine ?? ((): void => undefined);
    let proc;
    try {
        proc = Bun.spawn([command, ...args], {
            cwd,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...options.env },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            detached: options.group === true
        });
    } catch {
        return { code: 128, stdout: '', stderr: `${command} could not be started` };
    }
    const started = proc;
    const killGroup = (): void => {
        try {
            process.kill(-started.pid, 'SIGTERM');
        } catch {
            started.kill();
        }
    };
    options.onSpawn?.(options.group === true ? killGroup : () => started.kill());
    const [stdout, stderr, code] = await Promise.all([pump(proc.stdout, onLine), pump(proc.stderr, onLine), proc.exited]);
    return { code, stdout, stderr };
};

export const streamGit = (args: string[], cwd: string, options: StreamOptions = {}): Promise<GitResult> => streamCommand('git', args, cwd, options);
