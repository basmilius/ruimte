export interface ProcessRow {
    pid: number;
    ppid: number;
    /* The controlling terminal, such as `ttys003`; null for a process that has none. */
    tty: string | null;
}

export type ProcessTable = () => Promise<ProcessRow[]>;

const NO_TTY = new Set(['??', '-', '']);

/* `ps -A -o pid=,ppid=,tty=`: three columns, no header. */
export const parseProcessTable = (text: string): ProcessRow[] =>
    text.split('\n').flatMap((line) => {
        const [pid, ppid, tty = ''] = line.trim().split(/\s+/);
        if (pid === undefined || ppid === undefined || !/^\d+$/.test(pid) || !/^\d+$/.test(ppid)) {
            return [];
        }
        return [{ pid: Number(pid), ppid: Number(ppid), tty: NO_TTY.has(tty) ? null : tty }];
    });

export const readProcessTable: ProcessTable = async () => {
    const child = Bun.spawn(['ps', '-A', '-o', 'pid=,ppid=,tty='], { stdout: 'pipe', stderr: 'ignore' });
    const text = await new Response(child.stdout).text();
    await child.exited;
    return parseProcessTable(text);
};

/*
 * Whether an app runs shells, read off what its own process does and never off its name. A terminal
 * starts every shell (or the `login` in front of one) itself, on a pty it opened, so one of its direct
 * children has a controlling terminal that the app itself does not share. Only direct children count:
 * the Ruimte desktop app has shells under its daemon, one step further down, and an app started from
 * a shell passes that shell's terminal on to its children, which share it.
 */
export const runsShells = (pid: number, rows: readonly ProcessRow[]): boolean => {
    const own = rows.find((row) => row.pid === pid)?.tty ?? null;
    return rows.some((row) => row.ppid === pid && row.tty !== null && row.tty !== own);
};
