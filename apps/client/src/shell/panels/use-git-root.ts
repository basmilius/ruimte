import { useEffect, useState } from 'react';
import { useGitSignal } from '@/controllers/git-watch';
import { dirnameOf } from '@/paths/file-path';
import { useEndpointId } from '@/state/current-endpoint';
import { useTransport } from '@/workspace/context';

interface Checkout {
    root: string | null;
    branch: string | null;
}

/*
 * The checkout a file is in, undefined while the machine is still being asked. With `follow` it is
 * asked again whenever a commit, a checkout or a stage moved that repository.
 */
function useCheckoutOf(path: string, follow: boolean): Checkout | undefined {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const key = `${endpointId}\u0000${path}`;
    const [found, setFound] = useState<(Checkout & { key: string }) | null>(null);
    const current = found?.key === key ? found : undefined;
    const signal = useGitSignal(follow ? (current?.root ?? null) : null);

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

    return current;
}

/* The root of the repository a file is in: null for a file in none, undefined while the machine is still being asked. */
export function useGitRoot(path: string): string | null | undefined {
    return useCheckoutOf(path, false)?.root;
}

/* The branch of the checkout a file is in, or null outside a repository and on a detached head. */
export function useFileBranch(path: string): string | null {
    return useCheckoutOf(path, true)?.branch ?? null;
}
