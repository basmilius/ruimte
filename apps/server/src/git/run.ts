export interface GitResult {
    code: number;
    stdout: string;
    stderr: string;
}

interface GitOptions {
    env?: Record<string, string>;
    stdin?: string;
}

export type GitErrorCode = 'not-a-repo' | 'git-failed' | 'worktree-not-found' | 'worktree-has-work' | 'worktree-locked';

export class GitError extends Error {
    readonly code: GitErrorCode;

    constructor(code: GitErrorCode, message: string) {
        super(message);
        this.name = 'GitError';
        this.code = code;
    }
}

/* One git call in a directory, with its exit code kept: `check-ignore` answers 1 for "nothing
   matched", which is a result and not a failure. A git that cannot start reads as code 128, the
   same code git itself uses for "this is not a repository". */
export const runGit = async (args: string[], cwd: string, options: GitOptions = {}): Promise<GitResult> => {
    try {
        const proc = Bun.spawn(['git', ...args], {
            cwd,
            env: options.env ? { ...process.env, ...options.env } : undefined,
            stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
            stdout: 'pipe',
            stderr: 'pipe'
        });
        const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        return { code, stdout, stderr };
    } catch {
        return { code: 128, stdout: '', stderr: '' };
    }
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
            stderr: 'pipe'
        });
    } catch {
        return { code: 128, stdout: '', stderr: `${command} could not be started` };
    }
    options.onSpawn?.(() => proc.kill());
    const [stdout, stderr, code] = await Promise.all([pump(proc.stdout, onLine), pump(proc.stderr, onLine), proc.exited]);
    return { code, stdout, stderr };
};

export const streamGit = (args: string[], cwd: string, options: StreamOptions = {}): Promise<GitResult> => streamCommand('git', args, cwd, options);
