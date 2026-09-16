import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { Worktree } from '@ruimte/contracts';
import { worktreeOfPath } from '@/shell/panels/worktree-rows';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useOptionalConnection } from '@/transport/context';
import type { Transport } from '@/transport/transport';

interface WorktreesStore {
    /* The worktrees of a project folder's repository, per machine and folder. */
    rows: Record<string, readonly Worktree[]>;
    put(key: string, worktrees: readonly Worktree[]): void;
}

export const useWorktreeRows = create<WorktreesStore>((set, get) => ({
    rows: {},
    put(key, worktrees) {
        set({ rows: { ...get().rows, [key]: worktrees } });
    }
}));

const NONE: readonly Worktree[] = [];

// Counting walks every worktree with `git status`, so focus that comes and goes asks at most once in this window.
export const COUNTS_QUIET_MS = 5000;

interface Held {
    count: number;
    // Readers that want the work counted; the list asks with `inspect` while any of them is mounted.
    inspecting: number;
    // When the work was last asked for, on the injected clock.
    inspectedAt: number | null;
    reload(): void;
    stop(): void;
}

/*
 * One list per machine and folder however many readers there are: the git panel, and every node
 * header that wants to know whether it sits in a worktree. The daemon says `git.worktrees` after it
 * made, removed or merged one, and an open socket after a gap asks again, since what changed in
 * between was told to nobody.
 */
export class WorktreeLists {
    private readonly held = new Map<string, Held>();

    private readonly now: () => number;

    constructor(now: () => number = Date.now) {
        this.now = now;
    }

    hold(transport: Transport, endpointId: string, folder: string, inspect: boolean): () => void {
        const key = endpointKey(endpointId, folder);
        let held = this.held.get(key);
        if (!held) {
            let generation = 0;
            const entry: Held = {
                count: 0,
                inspecting: 0,
                inspectedAt: null,
                reload: () => {
                    const asked = ++generation;
                    if (entry.inspecting > 0) {
                        entry.inspectedAt = this.now();
                    }
                    transport
                        .request('git.worktree-list', { repo: folder, ...(entry.inspecting > 0 ? { inspect: true } : {}) })
                        .then((answer) => {
                            if (asked === generation) {
                                useWorktreeRows.getState().put(key, answer.worktrees);
                            }
                        })
                        .catch(() => {
                            if (asked === generation) {
                                useWorktreeRows.getState().put(key, NONE);
                            }
                        });
                },
                stop: () => undefined
            };
            // The event names the repository, not the folder a project sits in, so every list of the machine asks again.
            const offChanged = transport.on('git.worktrees', () => entry.reload());
            const offStatus = transport.subscribeStatus((status) => {
                if (status === 'open') {
                    entry.reload();
                }
            });
            entry.stop = () => {
                offChanged();
                offStatus();
            };
            held = entry;
            this.held.set(key, held);
        }
        const current = held;
        current.count += 1;
        if (inspect) {
            current.inspecting += 1;
        }
        // A reader that wants counts where the list had none asks again; one that only needs the paths reuses what is there.
        if (current.count === 1 || inspect) {
            current.reload();
        }
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            current.count -= 1;
            if (inspect) {
                current.inspecting -= 1;
            }
            if (current.count === 0) {
                current.stop();
                this.held.delete(key);
            }
        };
    }

    reload(endpointId: string, folder: string): void {
        this.held.get(endpointKey(endpointId, folder))?.reload();
    }

    /*
     * Counts the work again for a reader that just came back into view, unless it was counted a moment
     * ago: an event or the Refresh button counts too, and nothing changes a worktree between two clicks.
     */
    refreshCounts(endpointId: string, folder: string): void {
        const held = this.held.get(endpointKey(endpointId, folder));
        if (held === undefined || held.inspecting === 0) {
            return;
        }
        if (held.inspectedAt !== null && this.now() - held.inspectedAt < COUNTS_QUIET_MS) {
            return;
        }
        held.reload();
    }
}

export const worktreeLists = new WorktreeLists();

/* The worktrees of the repository a folder is in, kept fresh while the component is mounted. */
export const useWorktrees = (transport: Transport | null, endpointId: string, folder: string | null, inspect = false): readonly Worktree[] => {
    const key = folder === null ? null : endpointKey(endpointId, folder);
    useEffect(() => {
        if (transport === null || folder === null) {
            return;
        }
        return worktreeLists.hold(transport, endpointId, folder, inspect);
    }, [transport, endpointId, folder, inspect]);
    return useWorktreeRows((s) => (key === null ? NONE : (s.rows[key] ?? NONE)));
};

/*
 * The worktree a node works in, read from the one list of its project's repository. A node without
 * a folder of its own, or in the project folder itself, asks for nothing.
 */
export const useWorktreeOf = (cwd: string | undefined): Worktree | null => {
    const connection = useOptionalConnection();
    const endpointId = useEndpointId();
    const folder = useProject((s) => s.current?.folder ?? null);
    const wanted = cwd !== undefined && folder !== null && cwd !== folder;
    const worktrees = useWorktrees(wanted ? (connection?.transport ?? null) : null, endpointId, wanted ? folder : null);
    return useMemo(() => (wanted ? worktreeOfPath(worktrees, cwd) : null), [wanted, worktrees, cwd]);
};
