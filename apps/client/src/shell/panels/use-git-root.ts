import { useEffect, useState } from 'react';
import { dirnameOf } from '@/shell/panels/files-tree';
import { useEndpointId } from '@/state/keys';
import { useTransport } from '@/transport/context';

/* The root of the repository a file is in: null for a file in none, undefined while the machine is still being asked. */
export function useGitRoot(path: string): string | null | undefined {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const key = `${endpointId}\u0000${path}`;
    const [repo, setRepo] = useState<{ key: string; root: string | null } | null>(null);

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

    return repo?.key === key ? repo.root : undefined;
}
