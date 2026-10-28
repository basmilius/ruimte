import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { designFolderOf, isDesignView, type ProjectView } from '@ruimte/contracts';

async function exists(path: string): Promise<boolean> {
    return (await stat(path).catch(() => null)) !== null;
}

/*
 * The folders of the designs a person's save moved between the two files, moved after them: from
 * `.ruimte/private/designs/` into `.ruimte/designs/` when a design is shared, and back when it is not.
 * One rename per folder, so a folder is on one side or the other and never half. A folder already on
 * the other side is someone's work and stays, and so does the one that would replace it; both show as
 * they are until a person sorts them out. Answers the designs it could not move.
 */
export async function moveDesignFolders(
    projectFolder: string,
    views: readonly ProjectView[],
    moved: readonly string[],
    shared: readonly string[]
): Promise<string[]> {
    const stuck: string[] = [];

    for (const view of views) {
        if (!isDesignView(view) || !moved.includes(view.id) || view.path.includes('/')) {
            continue;
        }

        const nowShared = shared.includes(view.id);
        const from = join(projectFolder, designFolderOf(view, !nowShared));
        const to = join(projectFolder, designFolderOf(view, nowShared));

        if (!(await exists(from))) {
            continue;
        }

        if (await exists(to)) {
            stuck.push(view.id);
            continue;
        }

        await mkdir(dirname(to), { recursive: true });
        await rename(from, to);
    }

    return stuck;
}
