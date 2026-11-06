import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import type { ChatCore } from '@adecore/agents/chat';
import type { AgentLineageStore, NoticeStore, TaskStore } from '@adecore/agents/coordination';
import { chatIsWorking, type ChatInfo } from '@ruimte/contracts';
import { ChatError } from '../chat/errors.ts';
import { moveChat, type MoveChatDeps } from '../chat/move-chat.ts';
import { chatMoveInfo, type MoveInfoDeps } from '../chat/move-info.ts';
import type { MoveJournal } from '../chat/move-journal.ts';
import { moveRefusal, type MoveRefusalDeps } from '../chat/move-refusal.ts';
import { repairInterruptedMoves, type MoveRepairDeps } from '../chat/move-repair.ts';
import { ownFolderOf } from '../chat/own-files.ts';
import type { MachineHome } from '../disk/machine-home.ts';
import { gitOrThrow, readGit } from '../git/run.ts';
import { repositoryRoot } from '../git/status.ts';
import type { PrWatchStore } from '../github/pr-watch.ts';
import type { ChatMoveHandlers } from '../handlers/chat.ts';
import type { OutboxStore } from '../outbox/outbox.ts';
import type { ProjectProposals } from '../projects/project-proposals.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { SnoozeStore } from '../push/snoozes.ts';

export interface ChatMoveWiring {
    chats: ChatCore;
    store: ProjectStore;
    lineage: AgentLineageStore;
    tasks: TaskStore;
    outbox: OutboxStore;
    notices: NoticeStore;
    prWatches: PrWatchStore;
    machineHome: Pick<MachineHome, 'refuse'>;
    journal: MoveJournal;
    snoozes: SnoozeStore;
    /* The suggestions that hold a chat at `needs-you`, and that a move settles. */
    proposals: Pick<ProjectProposals, 'stands' | 'moved' | 'pauseHold'>;
}

/* Whether the chat is a chat view of the Chats project. */
export function chatIsInChats(store: Pick<ProjectStore, 'index' | 'scratchFolder'>, chatId: string): boolean {
    const place = store.index.locate(chatId);
    return (
        place !== null &&
        place.folder === store.scratchFolder &&
        place.canvasId === null &&
        (store.index.viewsOf(place.projectId) ?? []).some((view) => view.id === chatId && view.kind === 'chat')
    );
}

/* The checkout above a path that may be gone by now, by the nearest folder that still exists. */
async function repositoryAbove(directory: string): Promise<string | null> {
    let current = directory;
    for (;;) {
        if ((await stat(current).catch(() => null))?.isDirectory()) {
            return repositoryRoot(current);
        }
        const parent = dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

async function branchOf(folder: string): Promise<string | null> {
    const branch = (await readGit(['rev-parse', '--abbrev-ref', 'HEAD'], folder))?.trim();
    return branch === undefined || branch === '' || branch === 'HEAD' ? null : branch;
}

function chatMoveRefusalDeps(wiring: ChatMoveWiring): MoveRefusalDeps {
    const { chats, store, lineage, tasks, outbox, notices, prWatches } = wiring;
    return {
        inChats: (chatId) => chatIsInChats(store, chatId),
        working: (chatId) => {
            const session = chats.get(chatId);
            if (session === undefined) {
                return false;
            }
            // The card of its own suggestion holds the chat at needs-you, and the move it asks for must not refuse for that.
            return session.busy || chatIsWorking(session.info, wiring.proposals.stands(chatId));
        },
        lineage,
        tasks,
        outbox,
        notices,
        prWatches
    };
}

/* The info of a chat, loaded from disk when nobody has it. */
async function loadedInfo(chats: ChatCore, chatId: string): Promise<ChatInfo> {
    if (chats.get(chatId) === undefined && (await chats.hasStored(chatId))) {
        await chats.create({ chatId });
    }
    const session = chats.get(chatId);
    if (session === undefined) {
        throw new ChatError('chat-not-found', `No chat ${chatId}`);
    }
    return session.info;
}

/* The chat steps a move and its repair share. */
function sharedChatSteps(chats: ChatCore) {
    return {
        load: (chatId: string) => loadedInfo(chats, chatId),
        relocate: (chatId: string, cwd: string, during: () => Promise<void>) => chats.relocate(chatId, cwd, during),
        deliverNote: (chatId: string, delivery: { noteId: string; note: string; preamble: string }) => chats.deliverNote(chatId, delivery),
        claudeProjectsDirOf: (info: Pick<ChatInfo, 'account' | 'provider'>) => chats.claudeProjectsDirOf(info)
    };
}

/* What the move dialog asks the machine, the move itself, and the repair of a move a restart cut short. */
export interface ChatMover extends ChatMoveHandlers {
    /* Finishes the chat moves the machine stopped in the middle of; once at start, before the outbox runs. */
    repair(): Promise<string[]>;
}

export function chatMover(wiring: ChatMoveWiring): ChatMover {
    const deps = chatMoveDeps(wiring);
    const { chats, store } = wiring;
    const repairDeps: MoveRepairDeps = {
        scratchFolder: store.scratchFolder,
        journal: wiring.journal,
        projects: { known: () => store.known(), mutate: (projectId, apply) => store.mutate(projectId, apply) },
        index: store.index,
        lineage: wiring.lineage,
        snoozes: wiring.snoozes,
        ownFolder: (chatId) => ownFolderOf(store.scratchFolder, chatId),
        chats: sharedChatSteps(chats)
    };

    return {
        info: (payload) => chatMoveInfo(payload, deps.info),
        move: (payload) => moveChat(payload, deps.move),
        repair: () => repairInterruptedMoves(repairDeps)
    };
}

/* The pieces of both requests over the daemon's stores; a test replaces one to make a step fail. */
export function chatMoveDeps(wiring: ChatMoveWiring): { info: MoveInfoDeps; move: MoveChatDeps } {
    const { chats, store } = wiring;
    const refusalDeps = chatMoveRefusalDeps(wiring);
    const registry = async (): Promise<Array<{ projectId: string; name: string; folder: string; available: boolean }>> =>
        await Promise.all(
            (await store.known()).map(async (project) => ({
                ...project,
                available: (await stat(project.folder).catch(() => null))?.isDirectory() ?? false
            }))
        );
    const infoDeps: MoveInfoDeps = {
        home: homedir(),
        ruimteHome: store.home,
        refusal: (chatId) => moveRefusal(chatId, refusalDeps),
        thread: async (chatId) => {
            const stored = await chats.readChat(chatId);
            return stored === null ? null : { cwd: stored.info.cwd, items: stored.items };
        },
        ownFolder: (chatId) => ownFolderOf(store.scratchFolder, chatId),
        chatsInChats: async () => {
            const scratch = (await store.known()).find((project) => project.folder === store.scratchFolder);
            return (store.index.viewsOf(scratch?.projectId ?? '') ?? [])
                .filter((view) => view.kind === 'chat' && refusalDeps.inChats(view.id))
                .map((view) => view.id);
        },
        projects: async () => (await registry()).filter((project) => project.folder !== store.scratchFolder),
        branchOf,
        gitRoot: repositoryAbove,
        refuseFolder: (folder) => wiring.machineHome.refuse(folder)
    };
    const moveDeps: MoveChatDeps = {
        refusal: (chatId, recheck) => moveRefusal(chatId, recheck === true ? { ...refusalDeps, inChats: () => true, working: () => false } : refusalDeps),
        scratchFolder: store.scratchFolder,
        ownFolder: infoDeps.ownFolder,
        refuseFolder: infoDeps.refuseFolder,
        projects: {
            known: () => store.known(),
            make: async (payload) => {
                const { summary } = await store.openProject(payload);
                // Opened for the file, not for a client: the window that follows the move holds it itself.
                if (store.holdersOf(summary.projectId).length === 0) {
                    store.release(summary.projectId);
                }
                return { projectId: summary.projectId, name: summary.name };
            },
            mutate: (projectId, apply) => store.mutate(projectId, apply),
            read: (projectId) => store.read(projectId),
            overlayFieldsOf: (projectId) => store.overlayFieldsOf(projectId),
            summary: async (projectId) => {
                const summary = (await store.list()).find((candidate) => candidate.projectId === projectId);
                if (summary === undefined) {
                    throw new ChatError('move-failed', `The project ${projectId} left the machine's list while the chat moved`);
                }
                return summary;
            }
        },
        initGit: async (folder) => {
            await gitOrThrow(['init'], folder);
        },
        chats: {
            ...sharedChatSteps(chats),
            claim: (chatId) => {
                // The card holds the chat, and a held chat does not relocate: the move it asks for lets go of the hold and puts it back if the move fails.
                const putBack = wiring.proposals.pauseHold(chatId) ?? (() => undefined);
                if (chats.get(chatId)?.relocatable === false) {
                    putBack();
                    return null;
                }
                return putBack;
            }
        },
        lineage: wiring.lineage,
        moved: (chatId) => wiring.proposals.moved(chatId),
        journal: wiring.journal,
        snoozes: wiring.snoozes
    };
    return { info: infoDeps, move: moveDeps };
}
