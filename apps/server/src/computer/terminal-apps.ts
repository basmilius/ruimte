export interface ProcessRow {
    pid: number;
    ppid: number;
    /* The controlling terminal, such as `ttys003`; null for a process that has none. */
    tty: string | null;
}

export type ProcessTable = () => Promise<ProcessRow[]>;

const NO_TTY = new Set(['??', '-', '']);

/* `ps -A -o pid=,ppid=,tty=`: three columns, no header. */
export function parseProcessTable(text: string): ProcessRow[] {
    return text.split('\n').flatMap((line) => {
        const [pid, ppid, tty = ''] = line.trim().split(/\s+/);
        if (pid === undefined || ppid === undefined || !/^\d+$/.test(pid) || !/^\d+$/.test(ppid)) {
            return [];
        }
        return [{ pid: Number(pid), ppid: Number(ppid), tty: NO_TTY.has(tty) ? null : tty }];
    });
}

export async function readProcessTable(): Promise<ProcessRow[]> {
    const child = Bun.spawn(['ps', '-A', '-o', 'pid=,ppid=,tty='], { stdout: 'pipe', stderr: 'ignore' });
    const text = await new Response(child.stdout).text();
    await child.exited;
    return parseProcessTable(text);
}

/*
 * Terminal apps by bundle id, lowercased. A window of one may run no shell yet, as one just opened
 * does, and it is a terminal all the same; any other app counts once it runs shells.
 */
const KNOWN_TERMINALS: ReadonlySet<string> = new Set([
    'com.apple.terminal',
    'com.googlecode.iterm2',
    'com.mitchellh.ghostty',
    'com.github.wez.wezterm',
    'org.alacritty',
    'net.kovidgoyal.kitty',
    'dev.warp.warp-stable',
    'dev.warp.warp-preview',
    'co.zeit.hyper',
    'org.tabby',
    'com.termius.mac'
]);

export function isKnownTerminal(bundleId: string): boolean {
    return KNOWN_TERMINALS.has(bundleId.toLowerCase());
}

/* How far below an app a shell may sit: a terminal that starts its shells under a pty host of its own puts them two or three levels down. */
export const SHELL_DEPTH = 3;

/*
 * Whether an app runs shells, read off what its own process does and never off its name. A terminal
 * starts every shell (or the `login` in front of one) on a pty it opened, so a process below it has a
 * controlling terminal that the app itself does not share. An app started from a shell passes that
 * shell's terminal on to what it starts, which then shares it and does not count.
 */
export function runsShells(pid: number, rows: readonly ProcessRow[], depth: number = SHELL_DEPTH): boolean {
    const own = rows.find((row) => row.pid === pid)?.tty ?? null;
    let level = [pid];
    for (let step = 0; step < depth && level.length > 0; step++) {
        const parents = new Set(level);
        const below = rows.filter((row) => parents.has(row.ppid));
        if (below.some((row) => row.tty !== null && row.tty !== own)) {
            return true;
        }
        level = below.map((row) => row.pid);
    }
    return false;
}
