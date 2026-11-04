import { fileExists } from '@adecore/utils/fs';
import { mergeFiles, overlayOfLegacy, privateFileOf, viewShareRefusal, type ProjectContent, type ProjectSharedFile, type ProjectView } from '@ruimte/contracts';
import { privatePathOf } from './project-files.ts';

/*
 * Whether git tracks a path. A version-2 file someone committed was shared on purpose, so migrating
 * it keeps its views in the shared file; one nobody committed becomes that person's own. Injected
 * rather than imported, so a test decides this without a repository and the store stays out of git.
 */
export type TrackedProbe = (path: string) => Promise<boolean>;

/* Both files of a project read as one document; `privateText` is null while the folder has no private file of this daemon's. */
export interface LoadedFiles {
    content: ProjectContent;
    shared: string[];
    // Node fields the private file keeps one person's; handed back to every write so the split puts them in the overlay again.
    overlayFields: string[];
    rev: number;
    privateText: string | null;
}

/*
 * A file from version 1 or 2 held everything at once, so reading one is also the moment the folder is
 * split: what git tracks was committed on purpose and stays shared, and what it does not becomes this
 * person's own. Null when there is nothing to split: once a private file exists, an old-format file git
 * tracks is a colleague's on an older Ruimte, what it holds is theirs and shared, and the private file
 * still holds this person's views, overlay and rev.
 */
export async function splitLegacy(
    path: string,
    read: { file: ProjectSharedFile; legacyRev: number },
    fallback: { name: string; color: string },
    isTracked: TrackedProbe
): Promise<LoadedFiles | null> {
    const tracked = (await isTracked(path)) && read.file.views.length > 0;
    if (tracked && (await fileExists(privatePathOf(path)))) {
        return null;
    }
    // `mergeFiles` drops a shared file view off the folder, so the one this person had stays theirs.
    const own = tracked ? read.file.views.filter((view) => viewShareRefusal(view) === 'path-outside-project') : read.file.views;
    const shared = tracked ? read.file.views.filter((view) => !own.includes(view)).map((view: ProjectView) => view.id) : [];
    const file = { ...privateFileOf(own, read.legacyRev), order: read.file.views.map((view: ProjectView) => view.id) };
    const merged = mergeFiles(read.file, tracked ? { ...file, overlay: overlayOfLegacy(read.file.views) } : file, fallback);
    return { content: merged.content, shared, overlayFields: merged.overlayFields, rev: read.legacyRev, privateText: null };
}
