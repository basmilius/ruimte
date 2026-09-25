/*
 * Whether the process at `pid` holds the foreground of its terminal, from the terminal's foreground
 * process group as `ps` reports it (`tpgid`, on macOS and Linux alike). A shell leads its own group,
 * so a program it started in front of itself (vim, ssh, a CLI) makes the answer false. Null when
 * `ps` cannot say, which asks the caller to go on as it did before it could ask.
 */
export const holdsForeground = async (pid: number): Promise<boolean | null> => {
    try {
        const child = Bun.spawn(['ps', '-o', 'tpgid=', '-p', String(pid)], { stdout: 'pipe', stderr: 'ignore' });
        const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        return code === 0 ? foregroundOf(output, pid) : null;
    } catch {
        return null;
    }
};

/* Reads the one `tpgid` column `ps` printed for `pid`; -1 or 0 means the process has no terminal. */
export const foregroundOf = (output: string, pid: number): boolean | null => {
    const group = Number.parseInt(output.trim(), 10);
    if (!Number.isInteger(group) || group <= 0) {
        return null;
    }
    return group === pid;
};
