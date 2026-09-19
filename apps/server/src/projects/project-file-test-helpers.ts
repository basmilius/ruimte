import { readFile, writeFile } from 'node:fs/promises';
import { PROJECT_VERSION, mergeFiles, migrateSharedFile, type ProjectDocument, type ProjectPrivateFile } from '@ruimte/contracts';
import { documentPathInFolder, parsePrivateFile, privatePathOf } from './project-files.ts';

/*
 * What a project holds on disk, which is both its files put back together. A test asking what was
 * written means the document, not whichever of the two halves a field happened to land in.
 */
export const documentOnDisk = async (folder: string, fallback = { name: 'repo', color: '#7c74ff' }): Promise<ProjectDocument> => {
    const path = documentPathInFolder(folder);
    const read = migrateSharedFile(JSON.parse(await readFile(path, 'utf8')));
    if (!read) {
        throw new Error(`${path} does not parse as a project`);
    }
    const parsed = parsePrivateFile(await readFile(privatePathOf(path), 'utf8'));
    if (parsed.kind !== 'ok') {
        throw new Error(`the private file of ${folder} does not parse`);
    }
    const merged = mergeFiles(read.file, parsed.document, fallback);
    return { version: PROJECT_VERSION, rev: parsed.document.rev, ...merged.content, shared: merged.shared };
};

/* The views of the private file exactly as the bytes hold them, which is what a test about an entry
   of an unknown kind has to look at: the parsed shape wraps such an entry, the file never does. */
export const rawPrivateViews = async (folder: string): Promise<Record<string, unknown>[]> => {
    const file = JSON.parse(await readFile(privatePathOf(documentPathInFolder(folder)), 'utf8')) as { views: Record<string, unknown>[] };
    return file.views;
};

/* Puts a list of views in the private file, which is where a project that shared nothing keeps them. */
export const setPrivateViews = async (folder: string, views: readonly unknown[]): Promise<void> => {
    const path = privatePathOf(documentPathInFolder(folder));
    const file = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const order = (views as { id: string }[]).map((view) => view.id);
    await writeFile(path, `${JSON.stringify({ ...file, views, order }, null, 2)}\n`);
};

export const privateFileOnDisk = async (folder: string): Promise<ProjectPrivateFile> => {
    const parsed = parsePrivateFile(await readFile(privatePathOf(documentPathInFolder(folder)), 'utf8'));
    if (parsed.kind !== 'ok') {
        throw new Error(`the private file of ${folder} does not parse`);
    }
    return parsed.document;
};
