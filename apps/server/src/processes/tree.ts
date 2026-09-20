import type { ProcessGroup, ProcessGroupKind, ProcessRow, ProcessScope, ProcessSort } from '@ruimte/contracts';
import { identityOf, type ProcessRate, type RawProcess, type RawSample } from './sampler.ts';

/* The AI CLIs and apps recognized by name or path, so a `claude` started from iTerm stands out in "All". */
export const AI_FAMILIES = ['claude', 'codex', 'gemini', 'copilot', 'opencode', 'ollama', 'cursor', 'aider'] as const;

// A whole word of the path or name: `~/.local/share/claude/versions/2.1.269`, `Claude.app`, `codex-aarch64`.
const FAMILY_PATTERNS = AI_FAMILIES.map((family) => [family, new RegExp(`(^|[/\\s._@-])${family}([/\\s._-]|$)`, 'i')] as const);

/* Which AI the process itself is, from its path, its name and the script a runtime was given. */
export const ownFamilyOf = (name: string, path: string | null, args: readonly string[] | null = null): string | null => {
    // A native CLI names itself in its path; one on node or bun names itself in the script it runs.
    const haystack = [path ?? '', name, ...(args?.slice(0, 2) ?? [])].join(' ');
    for (const [family, pattern] of FAMILY_PATTERNS) {
        if (pattern.test(haystack)) {
            return family;
        }
    }
    return null;
};

export interface TreeRoots {
    daemonPid: number;
    sessions: readonly { id: string; pid: number }[];
    chats: readonly { id: string; pid: number }[];
}

export interface TreeEntry {
    process: RawProcess;
    identity: string;
    depth: number;
}

export interface IndexedGroup {
    id: string;
    kind: ProcessGroupKind;
    nodeId: string | null;
    entries: TreeEntry[];
}

export interface TreeIndex {
    sample: RawSample;
    byPid: Map<number, RawProcess>;
    /* Every group of Ruimte's own tree, in a stable order. */
    groups: IndexedGroup[];
    /* The identities inside Ruimte's tree. */
    ruimte: Set<string>;
    /* Inherited: a shell under `claude` is `claude` too. */
    family: Map<string, string | null>;
    /* The process's own, which is what "the agent is still there" asks about. */
    ownFamily: Map<string, string | null>;
}

/* Electron's main process, or the app bundle a packaged daemon runs in. */
const looksLikeDesktopApp = (process: RawProcess): boolean => /electron|\.app\/Contents\/MacOS\//i.test(process.path ?? process.name);

/*
 * Sorts the process table into Ruimte's groups: a node per terminal and chat, the desktop app when
 * the daemon runs inside it, and the daemon with whatever else it started (probes, git). A family is
 * inherited up to the root of a group and never past it, so a daemon started from a Claude session
 * does not make every shell on its canvas a Claude.
 */
export const indexTree = (sample: RawSample, roots: TreeRoots, argsOf: (process: RawProcess) => readonly string[] | null = () => null): TreeIndex => {
    const byPid = new Map<number, RawProcess>();
    const children = new Map<number, RawProcess[]>();
    for (const process of sample.processes) {
        byPid.set(process.pid, process);
    }
    for (const process of sample.processes) {
        if (process.ppid === process.pid || !byPid.has(process.ppid)) {
            continue;
        }
        const siblings = children.get(process.ppid);
        if (siblings) {
            siblings.push(process);
        } else {
            children.set(process.ppid, [process]);
        }
    }
    for (const siblings of children.values()) {
        siblings.sort((a, b) => a.pid - b.pid);
    }

    const nodeRoots = new Map<number, { id: string; kind: ProcessGroupKind; nodeId: string }>();
    for (const session of roots.sessions) {
        nodeRoots.set(session.pid, { id: `terminal:${session.id}`, kind: 'terminal', nodeId: session.id });
    }
    for (const chat of roots.chats) {
        nodeRoots.set(chat.pid, { id: `chat:${chat.id}`, kind: 'chat', nodeId: chat.id });
    }

    const walk = (root: RawProcess, skip: (process: RawProcess) => boolean): TreeEntry[] => {
        const entries: TreeEntry[] = [];
        const visit = (process: RawProcess, depth: number): void => {
            entries.push({ process, identity: identityOf(process.pid, process.startTime), depth });
            for (const child of children.get(process.pid) ?? []) {
                if (!skip(child)) {
                    visit(child, depth + 1);
                }
            }
        };
        visit(root, 0);
        return entries;
    };

    const groups: IndexedGroup[] = [];
    for (const [pid, root] of nodeRoots) {
        const process = byPid.get(pid);
        if (process) {
            groups.push({ ...root, entries: walk(process, () => false) });
        }
    }
    const daemon = byPid.get(roots.daemonPid);
    const parent = daemon ? byPid.get(daemon.ppid) : undefined;
    if (parent && parent.pid > 1 && looksLikeDesktopApp(parent)) {
        groups.push({ id: 'app', kind: 'app', nodeId: null, entries: walk(parent, (process) => process.pid === roots.daemonPid) });
    }
    if (daemon) {
        groups.push({ id: 'daemon', kind: 'daemon', nodeId: null, entries: walk(daemon, (process) => nodeRoots.has(process.pid)) });
    }

    const ruimte = new Set<string>();
    const boundaries = new Set<number>([roots.daemonPid, ...nodeRoots.keys()]);
    const ownFamily = new Map<string, string | null>();
    for (const group of groups) {
        for (const entry of group.entries) {
            ruimte.add(entry.identity);
        }
    }
    const own = (process: RawProcess, identity: string): string | null => {
        let family = ownFamily.get(identity);
        if (family === undefined) {
            family = ownFamilyOf(process.name, process.path, ruimte.has(identity) ? argsOf(process) : null);
            ownFamily.set(identity, family);
        }
        return family;
    };
    const family = new Map<string, string | null>();
    const inherited = (process: RawProcess): string | null => {
        const chain: RawProcess[] = [];
        let found: string | null = null;
        let current: RawProcess | undefined = process;
        // Bounded, because a table read while processes exit can hold a stale parent that loops.
        while (current !== undefined && chain.length < 64) {
            const identity = identityOf(current.pid, current.startTime);
            const known = family.get(identity);
            if (known !== undefined) {
                found = known;
                break;
            }
            chain.push(current);
            found = own(current, identity);
            if (found !== null || boundaries.has(current.pid) || current.pid <= 1) {
                break;
            }
            current = byPid.get(current.ppid);
        }
        for (const link of chain) {
            family.set(identityOf(link.pid, link.startTime), found);
        }
        return found;
    };
    for (const process of sample.processes) {
        inherited(process);
    }
    return { sample, byPid, groups, ruimte, family, ownFamily };
};

const sortValue = (rate: Pick<ProcessRate, 'cpu' | 'memory' | 'diskRead' | 'diskWrite'> | undefined, sort: ProcessSort): number => {
    if (rate === undefined) {
        return -1;
    }
    if (sort === 'cpu') {
        return rate.cpu ?? -1;
    }
    if (sort === 'memory') {
        return rate.memory ?? -1;
    }
    return rate.diskRead === null && rate.diskWrite === null ? -1 : (rate.diskRead ?? 0) + (rate.diskWrite ?? 0);
};

const sum = (values: readonly (number | null)[]): number | null => {
    let total: number | null = null;
    for (const value of values) {
        if (value !== null) {
            total = (total ?? 0) + value;
        }
    }
    return total;
};

const rowOf = (index: TreeIndex, rates: Map<string, ProcessRate>, entry: TreeEntry): ProcessRow => {
    const rate = rates.get(entry.identity);
    const { process } = entry;
    return {
        pid: process.pid,
        startTime: process.startTime,
        ppid: process.ppid,
        name: process.name,
        path: process.path,
        readable: process.readable,
        cpu: rate?.cpu ?? null,
        memory: rate?.memory ?? null,
        diskRead: rate?.diskRead ?? null,
        diskWrite: rate?.diskWrite ?? null,
        family: index.family.get(entry.identity) ?? null,
        depth: entry.depth
    };
};

const groupOf = (id: string, kind: ProcessGroupKind, nodeId: string | null, rows: ProcessRow[], hidden = 0): ProcessGroup => ({
    id,
    kind,
    nodeId,
    cpu: sum(rows.map((row) => row.cpu)),
    memory: sum(rows.map((row) => row.memory)),
    diskRead: sum(rows.map((row) => row.diskRead)),
    diskWrite: sum(rows.map((row) => row.diskWrite)),
    processes: rows,
    hidden
});

const GROUP_ORDER: Record<ProcessGroupKind, number> = { terminal: 0, chat: 0, app: 1, daemon: 2, other: 3 };

/*
 * What the panel draws for one scope. "All" adds the rest of the machine, but only the top of it on
 * the chosen sort plus every AI process, never 1,500 rows every two seconds.
 */
export const groupsFor = (index: TreeIndex, rates: Map<string, ProcessRate>, scope: ProcessScope, sort: ProcessSort, limit: number): ProcessGroup[] => {
    const groups = index.groups.map((group) =>
        groupOf(
            group.id,
            group.kind,
            group.nodeId,
            group.entries.map((entry) => rowOf(index, rates, entry))
        )
    );
    groups.sort((a, b) => GROUP_ORDER[a.kind] - GROUP_ORDER[b.kind] || (GROUP_ORDER[a.kind] === 0 ? sortValue(b, sort) - sortValue(a, sort) : 0));
    if (scope === 'all') {
        const rest = index.sample.processes
            .map((process) => ({ process, identity: identityOf(process.pid, process.startTime), depth: 0 }))
            .filter((entry) => entry.process.pid > 0 && !index.ruimte.has(entry.identity));
        rest.sort((a, b) => sortValue(rates.get(b.identity), sort) - sortValue(rates.get(a.identity), sort));
        const shown = rest.filter((entry, position) => (position < limit && entry.process.readable) || (index.ownFamily.get(entry.identity) ?? null) !== null);
        groups.push(
            groupOf(
                'other',
                'other',
                null,
                shown.map((entry) => rowOf(index, rates, entry)),
                rest.length - shown.length
            )
        );
    }
    return groups;
};

/* The share of Ruimte for the charts: percent of one core summed, bytes, bytes per second. */
export const ruimteTotals = (index: TreeIndex, rates: Map<string, ProcessRate>): { cpu: number | null; memory: number | null; disk: number | null } => {
    const members = [...index.ruimte].map((identity) => rates.get(identity)).filter((rate) => rate !== undefined);
    return {
        cpu: sum(members.map((rate) => rate.cpu)),
        memory: sum(members.map((rate) => rate.memory)),
        disk: sum(members.map((rate) => (rate.diskRead === null && rate.diskWrite === null ? null : (rate.diskRead ?? 0) + (rate.diskWrite ?? 0))))
    };
};

/* Disk throughput of the whole machine as far as it can be read, the sum of every readable process. */
export const machineDisk = (rates: Map<string, ProcessRate>): { read: number | null; write: number | null } => {
    const all = [...rates.values()];
    return { read: sum(all.map((rate) => rate.diskRead)), write: sum(all.map((rate) => rate.diskWrite)) };
};
