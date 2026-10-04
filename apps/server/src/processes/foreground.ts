/* What `ps -o tpgid=` printed for `pid`, or null when it could not run or failed. */
export type TpgidReader = (pid: number) => Promise<string | null>;

async function readTpgid(pid: number): Promise<string | null> {
    try {
        const child = Bun.spawn(['ps', '-o', 'tpgid=', '-p', String(pid)], { stdout: 'pipe', stderr: 'ignore' });
        const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        return code === 0 ? output : null;
    } catch {
        return null;
    }
}

/*
 * Whether the process at `pid` holds the foreground of its terminal, from the terminal's foreground
 * process group as `ps` reports it (`tpgid`, on macOS and Linux alike). A shell leads its own group,
 * so a program it started in front of itself (vim, ssh, a CLI) makes the answer false. Null when
 * `ps` cannot say, which asks the caller to go on as it did before it could ask.
 */
export async function holdsForeground(pid: number, read: TpgidReader = readTpgid): Promise<boolean | null> {
    const group = await foregroundGroup(pid, read);
    return group === null ? null : group === pid;
}

/* The process group holding the foreground of the terminal `pid` runs in; null when `ps` cannot say. */
export async function foregroundGroup(pid: number, read: TpgidReader = readTpgid): Promise<number | null> {
    const output = await read(pid);
    return output === null ? null : groupOf(output);
}

/* Reads the one `tpgid` column `ps` printed; -1 or 0 means the process has no terminal. */
function groupOf(output: string): number | null {
    const group = Number.parseInt(output.trim(), 10);
    return Number.isInteger(group) && group > 0 ? group : null;
}
