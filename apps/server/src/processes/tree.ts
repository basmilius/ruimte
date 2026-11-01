import type { ProcessGroup, ProcessGroupKind, ProcessRow, ProcessScope, ProcessSort } from '@ruimte/contracts';
import { identityOf, type ProcessRate, type RawProcess, type RawSample } from './sampler.ts';

/* The AI CLIs and apps recognized by name or path, so a `claude` started from iTerm stands out in "All". */
const AI_FAMILIES = ['claude', 'codex', 'antigravity', 'copilot', 'grok', 'opencode', 'ollama', 'cursor', 'aider'] as const;

// The words a family goes by besides its own name: Antigravity's CLI installs as `agy`.
const FAMILY_WORDS: Partial<Record<(typeof AI_FAMILIES)[number], string>> = { antigravity: 'antigravity|agy' };

// A whole word of the path or name: `~/.local/share/claude/versions/2.1.269`, `Claude.app`, `codex-aarch64`.
const FAMILY_PATTERNS = AI_FAMILIES.map((family) => [family, new RegExp(`(^|[/\\s._@-])(${FAMILY_WORDS[family] ?? family})([/\\s._-]|$)`, 'i')] as const);

/* Which AI the process itself is, from its path, its name and the script a runtime was given. */
export function ownFamilyOf(name: string, path: string | null, args: readonly string[] | null = null): string | null {
    // A native CLI names itself in its path; one on node or bun names itself in the script it runs.
    let haystack = `${path ?? ''} ${name}`;

    if (args !== null && args.length > 0) {
        haystack += ` ${args[0] ?? ''}`;

        if (args.length > 1) {
            haystack += ` ${args[1] ?? ''}`;
        }
    }

    for (const [family, pattern] of FAMILY_PATTERNS) {
        if (pattern.test(haystack)) {
            return family;
        }
    }

    return null;
}

interface TreeRoots {
    daemonPid: number;
    // A label for a session no node stands for, such as a launch.
    sessions: readonly { id: string; pid: number; label?: string }[];
    chats: readonly { id: string; pid: number }[];
}

export interface TreeEntry {
    process: RawProcess;
    identity: string;
    depth: number;
}

interface IndexedGroup {
    id: string;
    kind: ProcessGroupKind;
    nodeId: string | null;
    label?: string;
    entries: TreeEntry[];
}

export interface TreeIndex {
    sample: RawSample;
    byPid: Map<number, RawProcess>;
    /* Every group of Ruimte's own tree, in a stable order. */
    groups: IndexedGroup[];
    ruimte: Set<string>;
    /* Inherited: a shell under `claude` is `claude` too. */
    family: Map<string, string | null>;
    /* The process's own, which is what "the agent is still there" asks about. */
    ownFamily: Map<string, string | null>;
}

/* Electron's main process, or the app bundle a packaged daemon runs in. */
function looksLikeDesktopApp(process: RawProcess): boolean {
    return /electron|\.app\/Contents\/MacOS\//i.test(process.path ?? process.name);
}

/*
 * Sorts the process table into Ruimte's groups: a node per terminal and chat, the desktop app when
 * the daemon runs inside it, and the daemon with whatever else it started (probes, git). A family is
 * inherited up to the root of a group and never past it, so a daemon started from a Claude session
 * does not make every shell on its canvas a Claude.
 */
export function indexTree(sample: RawSample, roots: TreeRoots, argsOf: (process: RawProcess) => readonly string[] | null = () => null): TreeIndex {
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

    const nodeRoots = new Map<number, { id: string; kind: ProcessGroupKind; nodeId: string; label?: string }>();
    for (const session of roots.sessions) {
        nodeRoots.set(session.pid, {
            id: `terminal:${session.id}`,
            kind: 'terminal',
            nodeId: session.id,
            ...(session.label === undefined ? {} : { label: session.label })
        });
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
        const chain: string[] = [];
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
            chain.push(identity);
            found = own(current, identity);
            if (found !== null || boundaries.has(current.pid) || current.pid <= 1) {
                break;
            }
            current = byPid.get(current.ppid);
        }
        for (const link of chain) {
            family.set(link, found);
        }
        return found;
    };
    for (const process of sample.processes) {
        inherited(process);
    }
    return { sample, byPid, groups, ruimte, family, ownFamily };
}

/* Read and write together, or null when neither could be read. */
export function diskOf(rate: Pick<ProcessRate, 'diskRead' | 'diskWrite'>): number | null {
    return rate.diskRead === null && rate.diskWrite === null ? null : (rate.diskRead ?? 0) + (rate.diskWrite ?? 0);
}

function sortValue(rate: Pick<ProcessRate, 'cpu' | 'memory' | 'diskRead' | 'diskWrite'> | undefined, sort: ProcessSort): number {
    if (rate === undefined) {
        return -1;
    }
    if (sort === 'cpu') {
        return rate.cpu ?? -1;
    }
    if (sort === 'memory') {
        return rate.memory ?? -1;
    }
    return diskOf(rate) ?? -1;
}

function rowOf(index: TreeIndex, rates: Map<string, ProcessRate>, entry: TreeEntry): ProcessRow {
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
}

function groupOf({ id, kind, nodeId, label }: Pick<IndexedGroup, 'id' | 'kind' | 'nodeId' | 'label'>, rows: ProcessRow[], hidden = 0): ProcessGroup {
    let cpu: number | null = null;
    let memory: number | null = null;
    let diskRead: number | null = null;
    let diskWrite: number | null = null;

    for (const row of rows) {
        if (row.cpu !== null) {
            cpu = (cpu ?? 0) + row.cpu;
        }

        if (row.memory !== null) {
            memory = (memory ?? 0) + row.memory;
        }

        if (row.diskRead !== null) {
            diskRead = (diskRead ?? 0) + row.diskRead;
        }

        if (row.diskWrite !== null) {
            diskWrite = (diskWrite ?? 0) + row.diskWrite;
        }
    }

    return {
        id,
        kind,
        nodeId,
        ...(label === undefined ? {} : { label }),
        cpu,
        memory,
        diskRead,
        diskWrite,
        processes: rows,
        hidden
    };
}

const GROUP_ORDER: Record<ProcessGroupKind, number> = { terminal: 0, chat: 0, app: 1, daemon: 2, other: 3 };

function otherGroup(index: TreeIndex, rates: Map<string, ProcessRate>, sort: ProcessSort, limit: number): ProcessGroup {
    const rest: (TreeEntry & { value: number })[] = [];

    for (const process of index.sample.processes) {
        if (process.pid <= 0) {
            continue;
        }

        const identity = identityOf(process.pid, process.startTime);

        if (!index.ruimte.has(identity)) {
            rest.push({ process, identity, depth: 0, value: sortValue(rates.get(identity), sort) });
        }
    }

    rest.sort((a, b) => b.value - a.value);
    const shown = rest.filter((entry, position) => (position < limit && entry.process.readable) || (index.ownFamily.get(entry.identity) ?? null) !== null);

    return groupOf(
        { id: 'other', kind: 'other', nodeId: null },
        shown.map((entry) => rowOf(index, rates, entry)),
        rest.length - shown.length
    );
}

/*
 * What the panel draws for one scope. "All" adds the rest of the machine, but only the top of it on
 * the chosen sort plus every AI process, never 1,500 rows every two seconds.
 */
export function groupsFor(index: TreeIndex, rates: Map<string, ProcessRate>, scope: ProcessScope, sort: ProcessSort, limit: number): ProcessGroup[] {
    const groups = index.groups.map((group) =>
        groupOf(
            group,
            group.entries.map((entry) => rowOf(index, rates, entry))
        )
    );
    groups.sort((a, b) => GROUP_ORDER[a.kind] - GROUP_ORDER[b.kind] || (GROUP_ORDER[a.kind] === 0 ? sortValue(b, sort) - sortValue(a, sort) : 0));

    if (scope === 'all') {
        groups.push(otherGroup(index, rates, sort, limit));
    }

    return groups;
}

/* The share of Ruimte for the charts: percent of one core summed, bytes, bytes per second. */
export function ruimteTotals(index: TreeIndex, rates: Map<string, ProcessRate>): { cpu: number | null; memory: number | null; disk: number | null } {
    let cpu: number | null = null;
    let memory: number | null = null;
    let disk: number | null = null;

    for (const identity of index.ruimte) {
        const rate = rates.get(identity);

        if (rate === undefined) {
            continue;
        }

        if (rate.cpu !== null) {
            cpu = (cpu ?? 0) + rate.cpu;
        }

        if (rate.memory !== null) {
            memory = (memory ?? 0) + rate.memory;
        }

        const throughput = diskOf(rate);

        if (throughput !== null) {
            disk = (disk ?? 0) + throughput;
        }
    }

    return { cpu, memory, disk };
}

/* Disk throughput of the whole machine as far as it can be read, the sum of every readable process. */
export function machineDisk(rates: Map<string, ProcessRate>): { read: number | null; write: number | null } {
    let read: number | null = null;
    let write: number | null = null;

    for (const rate of rates.values()) {
        if (rate.diskRead !== null) {
            read = (read ?? 0) + rate.diskRead;
        }

        if (rate.diskWrite !== null) {
            write = (write ?? 0) + rate.diskWrite;
        }
    }

    return { read, write };
}
