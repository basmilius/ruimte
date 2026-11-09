import { isAbsolutePath, slugOf, type ChatMoveInfoResult, type ChatMoveTarget } from '@ruimte/contracts';

export const NEW_PROJECT = '__new__';

/* Which folder a new project goes in: where the chat worked (by position), a folder made for it, or one the person picked. */
export type FolderChoice = `worked:${number}` | 'new' | 'choose';

export interface MoveForm {
    /* A project id, or `NEW_PROJECT`; null while a person has not picked one. */
    destination: string | null;
    folder: FolderChoice;
    name: string;
    newPath: string;
    initGit: boolean;
    chosenPath: string;
}

export const MAX_WORKED_CARDS = 3;

export function folderSlug(name: string): string {
    return slugOf(name, '');
}

/* Joins in the style of the parent: a machine with backslashes in its paths gets them back. */
export function joinFolder(parent: string, name: string): string {
    if (parent === '') {
        return name;
    }
    const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
    return `${parent.replace(/[\\/]+$/, '')}${separator}${name}`;
}

export function baseName(path: string): string {
    return (
        path
            .replace(/[\\/]+$/, '')
            .split(/[\\/]/)
            .pop() ?? path
    );
}

export function workedCard(info: ChatMoveInfoResult | null, choice: FolderChoice): ChatMoveInfoResult['folders'][number] | null {
    if (info === null || !choice.startsWith('worked:')) {
        return null;
    }
    return info.folders.slice(0, MAX_WORKED_CARDS)[Number(choice.slice('worked:'.length))] ?? null;
}

/*
 * What the form asks the machine for: a project that is there, or a folder with the name of a project
 * to make in it. Null while a field is missing or a folder is no full path. `name` falls back to the
 * given one when only a question is asked, which never makes anything.
 */
export function moveTargetOf(form: MoveForm, info: ChatMoveInfoResult | null, folderText: string, fallbackName = 'project'): ChatMoveTarget | null {
    if (form.destination === null) {
        return null;
    }
    if (form.destination !== NEW_PROJECT) {
        return { projectId: form.destination };
    }
    const worked = workedCard(info, form.folder);
    if (worked?.project) {
        return { projectId: worked.project.projectId };
    }
    const name = form.name.trim() === '' ? fallbackName : form.name.trim();
    const folder = (form.folder === 'new' ? folderText : form.folder === 'choose' ? form.chosenPath : (worked?.path ?? '')).trim();
    if (!isAbsolutePath(folder)) {
        return null;
    }
    return form.folder === 'new' ? { folder, name, createFolder: true, initGit: form.initGit } : { folder, name, createFolder: false, initGit: false };
}

/* What the files the chat made go with by default: into a folder made for them, else they stay. */
export function defaultOwnFiles(form: MoveForm): 'move' | 'leave' {
    return form.destination === NEW_PROJECT && form.folder === 'new' ? 'move' : 'leave';
}
