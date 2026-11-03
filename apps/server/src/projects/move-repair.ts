import type { AgentLineageStore } from '@adecore/agents/coordination';
import type { ChatInfo, ProjectView } from '@ruimte/contracts';
import { isInside } from '../tools/project-paths.ts';
import type { moveClaudeTranscript } from '../chat/claude-move.ts';
import { ChatError } from '../chat/errors.ts';
import { errorText } from '../error-text.ts';
import type { SnoozeStore } from '../push/snoozes.ts';
import { fileTranscript } from './move-chat.ts';
import type { MoveJournal } from './move-journal.ts';
import { ownFileNames } from './move-info.ts';
import { movedNote } from './move-note.ts';
import type { MutationApply } from './project-store.ts';

export interface MoveRepairDeps {
    scratchFolder: string;
    journal: Pick<MoveJournal, 'pending' | 'end'>;
    projects: {
        known(): Promise<Array<{ projectId: string; name: string; folder: string }>>;
        mutate<T>(projectId: string, apply: MutationApply<T>): Promise<T>;
    };
    index: {
        viewsOf(projectId: string): readonly ProjectView[] | null;
        projectsPlacing(id: string): string[];
    };
    lineage: Pick<AgentLineageStore, 'projectOf' | 'rehome'>;
    /* A snooze on the chat goes with it, as in a move that ran through. */
    snoozes?: Pick<SnoozeStore, 'list' | 'set'>;
    ownFolder(chatId: string): string;
    chats: {
        deliverNote(chatId: string, delivery: { noteId: string; note: string; preamble: string }): Promise<boolean>;
        /* The record's info, loaded from disk when nobody has it; throws `chat-not-found` for a chat with no record. */
        load(chatId: string): Promise<ChatInfo>;
        relocate(chatId: string, cwd: string, during: () => Promise<void>): Promise<ChatInfo>;
        claudeProjectsDirOf(info: Pick<ChatInfo, 'account' | 'provider'>): string;
    };
    moveTranscript?: typeof moveClaudeTranscript;
}

async function loadOrNull(deps: MoveRepairDeps, chatId: string): Promise<ChatInfo | null> {
    try {
        return await deps.chats.load(chatId);
    } catch (e) {
        if (e instanceof ChatError && e.code === 'chat-not-found') {
            return null;
        }
        throw e;
    }
}

async function repairOne(deps: MoveRepairDeps, chatsId: string, chatId: string, targetId: string): Promise<void> {
    const target = (await deps.projects.known()).find((project) => project.projectId === targetId);
    const placedByTarget = (deps.index.viewsOf(targetId) ?? []).some((view) => view.id === chatId);
    if (target === undefined || !placedByTarget) {
        // The target never took the chat, so the move stopped before its first write: only the conversation may have gone ahead.
        const info = await loadOrNull(deps, chatId);
        if (info !== null) {
            await fileTranscript(deps.chats, info, info.cwd, deps.moveTranscript);
        }
        return;
    }

    if (deps.lineage.projectOf(chatId) === chatsId) {
        await deps.lineage.rehome(chatId, targetId);
    }
    const snooze = deps.snoozes?.list().find((entry) => entry.nodeId === chatId);
    if (snooze !== undefined && snooze.projectId !== targetId) {
        deps.snoozes?.set(targetId, chatId, snooze.until);
    }
    if ((deps.index.viewsOf(chatsId) ?? []).some((view) => view.id === chatId)) {
        await deps.projects.mutate(chatsId, (content) => ({
            content: { ...content, views: content.views.filter((view) => view.id !== chatId) },
            result: undefined
        }));
    }
    const info = await loadOrNull(deps, chatId);
    // Anywhere else the record already took the new folder. The own files stay where they are.
    if (info !== null && isInside(deps.scratchFolder, info.cwd)) {
        await deps.chats.relocate(chatId, target.folder, async () => {
            await fileTranscript(deps.chats, info, target.folder, deps.moveTranscript);
        });
    }
    // The agent hears where it works now, once: the id is the one a move that ran through uses.
    const ownFolder = deps.ownFolder(chatId);
    const leftAt = (await ownFileNames(ownFolder)).length > 0 ? ownFolder : null;
    await deps.chats
        .deliverNote(chatId, { noteId: `moved-${targetId}`, ...movedNote({ name: target.name, folder: target.folder, leftAt }) })
        .catch((e: unknown) => console.error(`Leaving the note of a repaired chat move failed: ${errorText(e)}`));
}

/*
 * Finishes a chat move the machine stopped in the middle of, once at start before anything is owed
 * to the chat: a chat that two projects place is taken out of Chats, and a record that still works
 * in the folder of Chats goes to the folder of the project. Without it opening the target fails with
 * `project-ids-taken` for as long as Chats places the chat as well. A failure leaves the entry for
 * the next start. Returns the chats it finished.
 */
export async function repairInterruptedMoves(deps: MoveRepairDeps): Promise<string[]> {
    const chats = (await deps.projects.known()).find((project) => project.folder === deps.scratchFolder);
    if (chats === undefined) {
        return [];
    }
    const wanted = new Map(deps.journal.pending().map((intent) => [intent.chatId, intent.to]));
    for (const view of deps.index.viewsOf(chats.projectId) ?? []) {
        const other = view.kind === 'chat' && !wanted.has(view.id) ? deps.index.projectsPlacing(view.id).find((id) => id !== chats.projectId) : undefined;
        if (other !== undefined) {
            wanted.set(view.id, other);
        }
    }
    const repaired: string[] = [];
    for (const [chatId, targetId] of wanted) {
        try {
            await repairOne(deps, chats.projectId, chatId, targetId);
            await deps.journal.end(chatId);
            repaired.push(chatId);
        } catch (e) {
            console.error(`Finishing the move of chat ${chatId} failed: ${errorText(e)}`);
        }
    }
    return repaired;
}
