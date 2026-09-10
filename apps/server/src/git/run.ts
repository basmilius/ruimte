export interface GitResult {
    code: number;
    stdout: string;
    stderr: string;
}

interface GitOptions {
    env?: Record<string, string>;
    stdin?: string;
}

export type GitErrorCode = 'not-a-repo' | 'git-failed' | 'worktree-not-found';

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
