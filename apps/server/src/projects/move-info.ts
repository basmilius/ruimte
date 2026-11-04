import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { entryExists } from '@adecore/utils/fs';
import type { ChatItem, ChatMoveInfoPayload, ChatMoveInfoResult, ChatMoveRefusal, ChatMoveTarget } from '@ruimte/contracts';
import { workedFolders } from '../chat/worked-folders.ts';
import { referencedIds } from '../context/references.ts';
import { isInside } from '../tools/project-paths.ts';
import { IGNORED_OWN_NAMES } from './own-files.ts';

const MAX_FOLDERS = 5;
const MAX_NAMES = 5;

export interface MoveInfoDeps {
    home: string;
    ruimteHome: string;
    refusal(chatId: string): ChatMoveRefusal | null;
    /* The chat's folder and thread, stored or loaded; null when the machine has no such chat. */
    thread(chatId: string): Promise<{ cwd: string; items: readonly ChatItem[] } | null>;
    ownFolder(chatId: string): string;
    /* The chat views of the Chats project. */
    chatsInChats(): Promise<string[]>;
    /* The registry's projects without Chats. */
    projects(): Promise<Array<{ projectId: string; name: string; folder: string; available: boolean }>>;
    branchOf(folder: string): Promise<string | null>;
    gitRoot(directory: string): Promise<string | null>;
    /* Throws for a folder that holds the machine's own state (`MachineHome.refuse`). */
    refuseFolder(folder: string): Promise<void>;
}

/* The top-level names in a folder, hidden ones included; a folder that is not there holds nothing. */
export async function ownFileNames(folder: string): Promise<string[]> {
    try {
        return (await readdir(folder)).filter((name) => !IGNORED_OWN_NAMES.includes(name)).sort();
    } catch {
        return [];
    }
}

/* The folder a target stands for, or null when it names a project the registry does not have. */
export function targetFolder(target: ChatMoveTarget, projects: ReadonlyArray<{ projectId: string; folder: string }>): string | null {
    return 'projectId' in target ? (projects.find((project) => project.projectId === target.projectId)?.folder ?? null) : resolve(target.folder);
}

/* The names among `names` (as `ownFileNames` lists them) that are already in the target folder. */
export async function ownFileConflicts(names: readonly string[], folder: string | null, limit = MAX_NAMES): Promise<string[]> {
    const taken: string[] = [];
    if (folder === null) {
        return taken;
    }
    for (const name of names) {
        if (taken.length >= limit) {
            break;
        }
        if (await entryExists(join(folder, name))) {
            taken.push(name);
        }
    }
    return taken;
}

/* The folder most projects of the registry sit in, which is where a new one is expected. */
function commonParent(folders: readonly string[], fallback: string): string {
    const counts = new Map<string, number>();
    for (const folder of folders) {
        counts.set(dirname(folder), (counts.get(dirname(folder)) ?? 0) + 1);
    }
    let best = fallback;
    let most = 0;
    for (const [parent, count] of counts) {
        if (count > most) {
            best = parent;
            most = count;
        }
    }
    return best;
}

/* The chats of Chats linked to this one with `@` or `#`, in either direction. */
async function linkedChats(chatId: string, items: readonly ChatItem[], deps: MoveInfoDeps): Promise<number> {
    const inChats = new Set(await deps.chatsInChats());
    const linked = new Set(referencedIds(items).filter((id) => inChats.has(id)));
    linked.delete(chatId);
    const others = [...inChats].filter((id) => id !== chatId);
    const threads = await Promise.all(others.map((id) => deps.thread(id)));
    others.forEach((id, i) => {
        if (referencedIds(threads[i]?.items ?? []).includes(chatId)) {
            linked.add(id);
        }
    });
    return linked.size;
}

/*
 * What the dialog needs to move a chat out of Chats: where it worked, what its own folder holds and
 * whether that clashes with the target, who links to it and why it cannot go. Paths, names and counts only.
 */
export async function chatMoveInfo(payload: ChatMoveInfoPayload, deps: MoveInfoDeps): Promise<ChatMoveInfoResult> {
    const { chatId } = payload;
    const projects = await deps.projects();
    const refusal = deps.refusal(chatId);
    const newFolderParent = commonParent(
        projects.filter((project) => project.available && !isInside(deps.ruimteHome, project.folder)).map((project) => project.folder),
        deps.home
    );
    // Nothing is read for an id that is no chat of Chats: it may name any folder.
    if (refusal?.reason === 'not-in-chats') {
        return { folders: [], ownFiles: { folder: '', count: 0, names: [] }, conflicts: [], references: 0, newFolderParent, refusal };
    }
    const thread = await deps.thread(chatId);
    const target = payload.to === undefined ? null : targetFolder(payload.to, projects);
    if (target !== null) {
        await deps.refuseFolder(target);
    }
    const items = thread?.items ?? [];
    const ownFolder = deps.ownFolder(chatId);
    const names = await ownFileNames(ownFolder);

    const worked = await workedFolders(items, { cwd: thread?.cwd ?? ownFolder, home: deps.home, ruimteHome: deps.ruimteHome, gitRoot: deps.gitRoot });
    const folders = await Promise.all(
        worked.slice(0, MAX_FOLDERS).map(async (folder) => {
            const project = projects.find((candidate) => candidate.folder === folder.path);
            return {
                path: folder.path,
                project: project === undefined ? null : { projectId: project.projectId, name: project.name },
                branch: await deps.branchOf(folder.path),
                files: folder.files
            };
        })
    );

    return {
        folders,
        ownFiles: { folder: ownFolder, count: names.length, names: names.slice(0, MAX_NAMES) },
        conflicts: payload.to === undefined ? [] : await ownFileConflicts(names, target),
        references: await linkedChats(chatId, items, deps),
        newFolderParent,
        refusal
    };
}
