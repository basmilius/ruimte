import { useEffect, useState } from 'react';
import { dirnameOf } from '@/shell/panels/files-tree';
import { useGitSignal } from '@/state/git-watch';
import { useEndpointId } from '@/state/keys';
import { useTransport } from '@/transport/context';

/* The branch of the checkout a file is in, or null outside a repository and on a detached head. */
export function useFileBranch(path: string): string | null {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const key = `${endpointId}\u0000${path}`;
    const [found, setFound] = useState<{ key: string; root: string | null; branch: string | null } | null>(null);
    const root = found?.key === key ? found.root : null;
    // Goes up when a commit, a checkout or a stage moved the repository.
    const signal = useGitSignal(root);

    useEffect(() => {
        let alive = true;
        transport
            .request('git.status', { cwd: dirnameOf(path) })
            .then((status) => {
                if (alive) {
                    setFound({ key, root: status.repo ? status.root : null, branch: status.repo ? status.branch : null });
                }
            })
            .catch(() => {
                if (alive) {
                    setFound({ key, root: null, branch: null });
                }
            });
        return () => {
            alive = false;
        };
    }, [transport, key, path, signal]);

    return found?.key === key ? found.branch : null;
}
