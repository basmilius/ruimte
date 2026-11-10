/* What `ps -o tpgid=` printed for `pid`, or null when it could not run or failed. */
type TpgidReader = (pid: number) => Promise<string | null>;

/* Null on Windows without asking: a console has no process groups, so there is no foreground to read. */
export async function readTpgid(pid: number, platform: string = process.platform): Promise<string | null> {
    if (platform === 'win32') {
        return null;
    }
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

export async function foregroundGroup(pid: number, read: TpgidReader = readTpgid): Promise<number | null> {
    const output = await read(pid);
    return output === null ? null : groupOf(output);
}

/* Reads the one `tpgid` column `ps` printed; -1 or 0 means the process has no terminal. */
function groupOf(output: string): number | null {
    const group = Number.parseInt(output.trim(), 10);
    return Number.isInteger(group) && group > 0 ? group : null;
}
