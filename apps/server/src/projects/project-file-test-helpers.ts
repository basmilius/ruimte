import { readFile, writeFile } from 'node:fs/promises';
import { PROJECT_VERSION, mergeFiles, migrateSharedFile, type ProjectChatView, type ProjectDocument, type ProjectPrivateFile } from '@ruimte/contracts';
import { documentPathInFolder, parsePrivateFile, privatePathOf } from './project-files.ts';
import type { ProjectLinks, ProjectStore } from './project-store.ts';
import type { ScratchChatOptions } from './scratch-project.ts';

/* A home the test made in the temp folder, which no checkout holds, without asking git. */
export const OUTSIDE_CHECKOUT: ScratchChatOptions = { insideCheckout: async () => false };

export async function chatViewsOf(store: ProjectStore, projectId: string): Promise<ProjectChatView[]> {
    return (await store.read(projectId)).views.filter((view): view is ProjectChatView => view.kind === 'chat');
}

/*
 * What a project holds on disk, which is both its files put back together. A test asking what was
 * written means the document, not whichever of the two halves a field happened to land in.
 */
export async function documentOnDisk(folder: string, fallback = { name: 'repo', color: '#7c74ff' }): Promise<ProjectDocument> {
    const path = documentPathInFolder(folder);
    const read = migrateSharedFile(JSON.parse(await readFile(path, 'utf8')));
    if (!read) {
        throw new Error(`${path} does not parse as a project`);
    }
    const privateFile = await privateFileOnDisk(folder);
    const merged = mergeFiles(read.file, privateFile, fallback);
    return { version: PROJECT_VERSION, rev: privateFile.rev, ...merged.content, shared: merged.shared };
}

/* The views of the private file exactly as the bytes hold them, which is what a test about an entry
   of an unknown kind has to look at: the parsed shape wraps such an entry, the file never does. */
export async function rawPrivateViews(folder: string): Promise<Record<string, unknown>[]> {
    const file = JSON.parse(await readFile(privatePathOf(documentPathInFolder(folder)), 'utf8')) as { views: Record<string, unknown>[] };
    return file.views;
}

/* Puts a list of views in the private file, which is where a project that shared nothing keeps them. */
export async function setPrivateViews(folder: string, views: readonly unknown[]): Promise<void> {
    const path = privatePathOf(documentPathInFolder(folder));
    const file = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const order = (views as { id: string }[]).map((view) => view.id);
    await writeFile(path, `${JSON.stringify({ ...file, views, order }, null, 2)}\n`);
}

export async function privateFileOnDisk(folder: string): Promise<ProjectPrivateFile> {
    const parsed = parsePrivateFile(await readFile(privatePathOf(documentPathInFolder(folder)), 'utf8'));
    if (parsed.kind !== 'ok') {
        throw new Error(`the private file of ${folder} does not parse`);
    }
    return parsed.document;
}

/*
 * The links of a store whose test reaches none of the services beside it: nothing is tracked, and no
 * session, launch, language server, record or view file follows the store. A test names what it reaches.
 */
export function projectLinks(links: Partial<ProjectLinks> = {}): ProjectLinks {
    return {
        tracked: async () => false,
        endSession: async () => undefined,
        personSaved: async () => undefined,
        launches: { opened: () => undefined, running: () => 0, end: async () => 0 },
        language: { end: async () => undefined },
        provenance: { forget: async () => undefined },
        databases: { closeProject: () => undefined, forgetProject: async () => undefined },
        templates: { closeProject: () => undefined },
        bindings: { machineId: 'machine-a', started: async () => false },
        viewFiles: () => [],
        ...links
    };
}
