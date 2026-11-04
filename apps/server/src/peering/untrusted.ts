import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentLineageStore } from '@adecore/agents/coordination';
import type { AgentKind } from '@ruimte/contracts';
import { providerFor } from '../providers/registry.ts';
import { isInside } from '../tools/project-paths.ts';

interface UntrustedFoldersDeps {
    lineage: Pick<AgentLineageStore, 'peerOf' | 'startedBy' | 'forkedFrom'>;
    /* The folders made from work another machine sent. */
    folders(): readonly string[];
    /* Where a chat or a terminal started, for the node that is one; null for none. */
    cwdOf(nodeId: string): string | null;
}

// Far past any chain of agents; a loop in the records ends here instead of never.
const MAX_CHAIN = 32;

function realOrSelf(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return resolve(path);
    }
}

/*
 * What came from another machine is never run on its own configuration: the files in a folder it sent
 * carry settings, hooks and tools that machine chose. A node is untrusted when it was given by such a
 * machine or opened by one that was, however many agents lie in between, and when it works in a folder
 * made from that machine's work.
 */
export class UntrustedFolders {
    private readonly deps: UntrustedFoldersDeps;

    constructor(deps: UntrustedFoldersDeps) {
        this.deps = deps;
    }

    /* Whether this node or an agent above it was given by another machine. */
    fromPeer(nodeId: string): boolean {
        const { lineage } = this.deps;
        const seen = new Set<string>();
        let current: string | null = nodeId;
        while (current !== null && !seen.has(current) && seen.size < MAX_CHAIN) {
            seen.add(current);
            if (lineage.peerOf(current) !== null || current.startsWith('peer:')) {
                return true;
            }
            // A fork carries the files and the conversation of the chat it was cut from.
            current = lineage.startedBy(current) ?? lineage.forkedFrom(current);
        }
        return false;
    }

    /* Whether this path lies inside a folder made from another machine's work. */
    inFolder(path: string): boolean {
        const folders = this.deps.folders();
        if (folders.length === 0) {
            return false;
        }
        const real = realOrSelf(path);
        return folders.some((folder) => isInside(realOrSelf(folder), real));
    }

    /* The question every start and every turn asks of a node. */
    node(nodeId: string): boolean {
        if (this.fromPeer(nodeId)) {
            return true;
        }
        const cwd = this.deps.cwdOf(nodeId);
        return cwd !== null && this.inFolder(cwd);
    }
}

/* What keeps a provider from being started in an untrusted place, or null when it can be. */
export function untrustedStartProblem(provider: AgentKind, terminal: boolean): string | null {
    if (terminal) {
        return 'A terminal agent cannot run there: it cannot be kept from loading the settings, hooks and tools of files that came from another machine';
    }
    const { name, ignoresProjectConfig } = providerFor(provider);
    return ignoresProjectConfig === true
        ? null
        : `${name} cannot run there: it cannot be kept from loading the settings, hooks and tools of files that came from another machine. Use a Claude agent instead`;
}
