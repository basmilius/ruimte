export interface GitResult {
    code: number;
    stdout: string;
}

interface GitOptions {
    env?: Record<string, string>;
    stdin?: string;
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
        const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        return { code, stdout };
    } catch {
        return { code: 128, stdout: '' };
    }
};

/* The output of a git that succeeded, or null for every other outcome. */
export const git = async (args: string[], cwd: string, env?: Record<string, string>): Promise<string | null> => {
    const { code, stdout } = await runGit(args, cwd, { env });
    return code === 0 ? stdout : null;
};
