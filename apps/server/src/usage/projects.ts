import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export interface KnownProject {
    projectId: string;
    name: string;
    folder: string;
}

export interface ResolvedProject {
    folder: string;
    name: string;
    projectId: string | null;
}

/*
 * A checkout that is a worktree keeps its `.git` in a file pointing back into the repository it
 * belongs to. The work done there is the same repository's work, so both fold to the one folder.
 */
const mainCheckoutOf = async (gitPath: string): Promise<string | null> => {
    const text = await readFile(gitPath, 'utf8');
    const match = /^gitdir:\s*(.+)$/m.exec(text);
    const gitDir = match?.[1]?.trim();
    const at = gitDir?.indexOf('/.git/worktrees/') ?? -1;
    return gitDir !== undefined && at > 0 ? gitDir.slice(0, at) : null;
};

/*
 * Which folder a directory's work belongs to: the repository it sits in, or the directory itself
 * when it is in none. Every answer is remembered, because one scan asks about the same handful of
 * directories tens of thousands of times.
 */
export class ProjectResolver {
    private readonly known: Map<string, KnownProject>;
    private readonly roots = new Map<string, string>();

    constructor(known: readonly KnownProject[]) {
        this.known = new Map(known.flatMap((project) => (project.folder === '' ? [] : [[project.folder, project] as const])));
    }

    async resolve(cwd: string): Promise<ResolvedProject> {
        const folder = cwd === '' ? '' : await this.rootOf(cwd);
        const project = this.known.get(folder);
        return { folder, name: project?.name ?? (folder === '' ? 'Elsewhere' : basename(folder)), projectId: project?.projectId ?? null };
    }

    private async rootOf(cwd: string): Promise<string> {
        const cached = this.roots.get(cwd);
        if (cached !== undefined) {
            return cached;
        }
        let root = cwd;
        for (let at = cwd; at !== dirname(at); at = dirname(at)) {
            try {
                const info = await stat(join(at, '.git'));
                root = (info.isFile() ? await mainCheckoutOf(join(at, '.git')) : null) ?? at;
                break;
            } catch {
                // Not a checkout at this level; the one above it may be.
            }
        }
        this.roots.set(cwd, root);
        return root;
    }
}
