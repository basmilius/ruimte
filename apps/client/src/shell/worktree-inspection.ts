import type { Worktree } from '@ruimte/contracts';
import type { WorktreeNode } from '@/state/worktrees';
import type { Transport } from '@/transport-api/transport';

/* The worktrees at these paths with their work counted now, in the order asked; one the machine no longer lists is left out. */
export async function inspectWorktrees(transport: Transport, folder: string, paths: readonly string[]): Promise<Worktree[]> {
    const answer = await transport.request('git.worktree-list', { repo: folder, inspect: true });
    return paths.map((path) => answer.worktrees.find((entry) => entry.path === path)).filter((entry) => entry !== undefined);
}

/* The nodes as a sentence names them. */
export function nodeNames(nodes: readonly Pick<WorktreeNode, 'title' | 'kind'>[]): string {
    return nodes.map((node) => node.title || node.kind).join(', ');
}
