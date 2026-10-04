import { useEffect, useRef, useState } from 'react';
import { dirnameOf } from '@/shell/panels/files-tree';
import { useGitSignal } from '@/state/git-watch';
import { useEndpointId } from '@/state/keys';
import { useTransport } from '@/transport/context';

/*
 * What the file is compared against in the editor's margin: its text in the last commit, or null when
 * it is not in a repository or the machine cannot say. A file that no commit or index entry differs
 * from is its own base, so an untouched file shows nothing.
 */
export function useGitBase(path: string, disk: string): string | null {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const key = `${endpointId}\u0000${path}`;
    const [repo, setRepo] = useState<{ key: string; root: string | null } | null>(null);
    const [held, setHeld] = useState<{ key: string; base: string | null } | null>(null);
    const latestDisk = useRef(disk);
    const root = repo?.key === key ? repo.root : null;
    // Goes up when the checkout moved: a commit, a stage or a write of this file all do.
    const signal = useGitSignal(root);

    useEffect(() => {
        latestDisk.current = disk;
    }, [disk]);

    useEffect(() => {
        let alive = true;
        transport
            .request('git.status', { cwd: dirnameOf(path) })
            .then((status) => {
                if (alive) {
                    setRepo({ key, root: status.repo ? status.root : null });
                }
            })
            .catch(() => {
                if (alive) {
                    setRepo({ key, root: null });
                }
            });
        return () => {
            alive = false;
        };
    }, [transport, key, path]);

    useEffect(() => {
        if (root === null || !path.startsWith(`${root}/`)) {
            return;
        }
        let alive = true;
        const relative = path.slice(root.length + 1);
        const read = (staged: boolean) => transport.request('git.diff', { cwd: root, path: relative, scope: 'worktree', staged }).catch(() => null);
        // The commit's text is the old side of the staged diff when something is staged, else the index's is.
        void Promise.all([read(true), read(false)]).then(([staged, unstaged]) => {
            if (!alive) {
                return;
            }
            const unchanged = staged?.diff === '' && unstaged?.diff === '' && staged.omitted === undefined && unstaged.omitted === undefined;
            setHeld({ key, base: staged?.oldText ?? unstaged?.oldText ?? (unchanged ? latestDisk.current : null) });
        });
        return () => {
            alive = false;
        };
    }, [transport, key, path, root, signal]);

    return held?.key === key ? held.base : null;
}
