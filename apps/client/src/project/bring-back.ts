import type { GitFetchBundleResult } from '@ruimte/contracts';
import { handOff, type BundleSource, type BundleTarget } from '@/project/bundle-transfer';
import type { Transport } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';

interface BringBackRequest {
    /* The machine the node works on. */
    there: BundleSource & Pick<Transport, 'request'>;
    /* The machine the project lives on. */
    here: BundleTarget & Pick<Transport, 'connection'>;
    cwd: string;
    folder: string;
    projectId: string;
    machine: string;
    title: string;
}

/*
 * The work of a node on another machine as a branch and a worktree here. A checkout with changes is
 * sent as it is, a clean one as its branch, so nothing a person left uncommitted over there stays
 * behind. What this machine already has is left out of the bundle.
 */
export async function bringBack(request: BringBackRequest): Promise<GitFetchBundleResult & { name: string }> {
    const status = await request.there.request('git.status', { cwd: request.cwd });
    if (!status.repo) {
        throw new Error('The node does not work in a git checkout.');
    }
    const dirty = status.files.length > 0;
    const from = dirty ? 'files' : status.branch === null ? 'head' : 'branch';
    const identity = machineAnswers(request.here.connection, 'git.identity')
        ? (await request.here.request('git.identity', { paths: [request.folder] }).catch(() => ({ identities: [] }))).identities[0]
        : undefined;
    const name = status.branch ?? (request.title.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'work');
    const result = await handOff({
        from: request.there,
        to: request.here,
        bundle: {
            path: request.cwd,
            from,
            ...(from === 'branch' ? { branch: status.branch! } : {}),
            haves: identity === undefined || 'error' in identity ? [] : identity.heads,
            name: `Work of ${name} from ${request.machine}`
        },
        projectId: request.projectId,
        branch: name,
        into: 'remote-ref',
        machine: request.machine
    });
    return { ...result, name };
}
