import { basename, dirname, join, resolve } from 'node:path';
import { ChatError as AgentChatError } from '@adecore/agents/chat';
import type { AgentLineageStore } from '@adecore/agents/coordination';
import { entryExists } from '@adecore/utils/fs';
import { isWithin } from '@adecore/utils/path';
import {
    DEFAULT_PROJECT_COLOR,
    initialIconOf,
    type ChatInfo,
    type ChatMovePayload,
    type ChatMoveRefusal,
    type ChatMoveResult,
    type ProjectChatView,
    type ProjectContent,
    type ProjectSummary
} from '@ruimte/contracts';
import { moveClaudeTranscript } from '../chat/claude-move.ts';
import { ChatError } from '../chat/errors.ts';
import { errorText } from '../error-text.ts';
import { realOrNull } from '../fs/real-path.ts';
import type { SnoozeStore } from '../push/snoozes.ts';
import { ownFileConflicts, ownFileNames } from './move-info.ts';
import type { MoveJournal } from './move-journal.ts';
import { movedNote } from './move-note.ts';
import { moveOwnFiles } from './own-files.ts';
import type { MutationApply } from './project-store.ts';

/* The English sentence a refused move carries on its reply; the client writes its own words from the reason. */
const REFUSAL_SENTENCES: Record<ChatMoveRefusal['reason'], string> = {
    'not-in-chats': 'Only a chat in Chats can move to a project',
    working: 'This chat is still working. Stop it or wait for it to finish, then try again',
    agents: 'This chat started agents of its own, or an agent started it. A chat with agents cannot move to a project yet',
    tasks: 'This chat gave a task or has one. A chat with tasks cannot move to a project yet',
    owed: 'The machine still has work queued for this chat. Try again once it is done',
    messages: 'Messages from other chats are waiting for this chat. It reads them in its next turn. Move it after that',
    'pr-watch': 'This chat watches a pull request. Stop watching it first'
};

export interface MoveChatDeps {
    /* `recheck` asks again under the lock of the Chats write: the chat is placed by two projects then and busy by the move itself, so only what the write would end is asked. */
    refusal(chatId: string, recheck?: boolean): ChatMoveRefusal | null;
    /* The folder of the Chats project, which no chat moves into. */
    scratchFolder: string;
    ownFolder(chatId: string): string;
    /* Throws for a folder that holds the machine's own state (`MachineHome.refuse`). */
    refuseFolder(folder: string): Promise<void>;
    projects: {
        known(): Promise<Array<{ projectId: string; name: string; folder: string }>>;
        /* Makes the project of a folder, and the folder when asked; holds nothing, so a failed move leaves no watcher behind. */
        make(payload: { folder: string; name: string; createFolder: boolean }): Promise<{ projectId: string; name: string }>;
        mutate<T>(projectId: string, apply: MutationApply<T>): Promise<T>;
        read(projectId: string): Promise<ProjectContent>;
        overlayFieldsOf(projectId: string): Promise<string[]>;
        summary(projectId: string): Promise<ProjectSummary>;
    };
    /* Starts a repository in a folder. */
    initGit(folder: string): Promise<void>;
    chats: {
        /* The chat's record, loaded from disk when nobody has it; throws `chat-not-found` for an id with no chat. */
        load(chatId: string): Promise<ChatInfo>;
        /* Asks whether the chat can be relocated at all, with the hold of its own suggestion let go. Null when it cannot; else the way back for a move that does not happen. */
        claim(chatId: string): (() => void) | null;
        relocate(chatId: string, cwd: string, during: () => Promise<void>): Promise<ChatInfo>;
        deliverNote(chatId: string, delivery: { noteId: string; note: string; preamble: string }): Promise<boolean>;
        claudeProjectsDirOf(info: Pick<ChatInfo, 'account' | 'provider'>): string;
    };
    lineage: Pick<AgentLineageStore, 'projectOf' | 'rehome'>;
    /* A snooze on the chat goes with it, since the Chats write would drop it. */
    snoozes?: Pick<SnoozeStore, 'list' | 'set'>;
    /* Written before the first step and dropped once the move is whole or put back, so a stop in between is finished at the next start (`move-repair.ts`). */
    journal?: Pick<MoveJournal, 'begin' | 'end'>;
    /* Told once the chat is in its project, also when saving its new folder failed after: the move is done either way. */
    moved?(chatId: string): void;
    /* Seams for a test that makes a step fail; the file system's own by default. */
    moveTranscript?: typeof moveClaudeTranscript;
    moveOwnFiles?: typeof moveOwnFiles;
}

function refuse(deps: MoveChatDeps, chatId: string, recheck = false): void {
    const refusal = deps.refusal(chatId, recheck);
    if (refusal !== null) {
        throw new ChatError('move-refused', REFUSAL_SENTENCES[refusal.reason]);
    }
}

/* The node of a chat view in its new project: it works in the project folder, so it names no folder of its own. */
function movedView(view: ProjectChatView): ProjectChatView {
    const { cwd: _cwd, ...node } = view.node;
    const { empty: _empty, ...rest } = view;
    return { ...rest, node };
}

/* Puts the Claude conversation of a chat under the slug of `folder`; null for a chat that keeps none there. */
export async function fileTranscript(
    chats: Pick<MoveChatDeps['chats'], 'claudeProjectsDirOf'>,
    info: ChatInfo,
    folder: string,
    move: typeof moveClaudeTranscript = moveClaudeTranscript
): Promise<Awaited<ReturnType<typeof moveClaudeTranscript>> | null> {
    // Empty for a provider that does not run Claude Code; one with a config folder of its own has its transcripts there.
    const projectsDir = chats.claudeProjectsDirOf(info);
    if (info.agentSessionId === null || projectsDir === '') {
        return null;
    }
    return move({ projectsDir, sessionId: info.agentSessionId, fromCwd: info.cwd, toCwd: folder });
}

/* A catch handler that runs `undo` and lets the failure through. */
function failWith(undo: () => void): (e: unknown) => never {
    return (e) => {
        undo();
        throw e;
    };
}

function chatViewOf(content: ProjectContent, chatId: string): ProjectChatView {
    const view = content.views.find((entry) => entry.id === chatId);
    if (view?.kind !== 'chat') {
        throw new ChatError('move-refused', REFUSAL_SENTENCES['not-in-chats']);
    }
    return view;
}

async function makeProject(payload: ChatMovePayload, folder: string, deps: MoveChatDeps): Promise<{ projectId: string; name: string }> {
    if (!('folder' in payload.to)) {
        throw new ChatError('move-failed', 'No folder to make a project in');
    }
    const made = await deps.projects.make({ folder, name: payload.to.name, createFolder: payload.to.createFolder });
    if (payload.to.initGit && !(await entryExists(join(folder, '.git')))) {
        await deps.initGit(folder).catch((e: unknown) => {
            throw new ChatError('move-failed', `A git repository could not be started in ${folder}: ${errorText(e)}`);
        });
    }
    return made;
}

/*
 * Moves a chat from Chats into a project it finds or makes, as a whole or not at all. Every step that
 * changes something has its undo, run in reverse when a later step throws, and the working folder of
 * the chat only changes once its CLI is gone (`ChatCore.relocate`). Order inside: the target is
 * written first, a fork's lineage follows before the Chats write (which would otherwise drop an
 * unspoken fork's record), and a project places the chat at every moment between the two writes.
 * A project made for the move stays when the move fails; asking again moves into it.
 */
export async function moveChat(payload: ChatMovePayload, deps: MoveChatDeps): Promise<ChatMoveResult> {
    const { chatId } = payload;
    refuse(deps, chatId);
    const ownFolder = deps.ownFolder(chatId);
    const known = await deps.projects.known();
    const { to } = payload;
    const chosen = 'projectId' in to ? known.find((project) => project.projectId === to.projectId) : undefined;
    if ('projectId' in to && chosen === undefined) {
        throw new ChatError('move-failed', `No project ${to.projectId} on this machine`);
    }
    const folder = chosen?.folder ?? resolve('folder' in to ? to.folder : '');
    // Another chat's folder is no project: it would put the chat inside what Chats still owns.
    // By the resolved path as well, as `MachineHome.refuse` does: a link into Chats is Chats.
    const [realFolder, realScratch] = await Promise.all([resolvedPath(folder), resolvedPath(deps.scratchFolder)]);
    if (isWithin(deps.scratchFolder, folder) || isWithin(realScratch, realFolder)) {
        throw new ChatError('move-failed', 'A chat cannot move into the folder of Chats');
    }
    await deps.refuseFolder(folder);

    const names = payload.ownFiles === 'move' ? await ownFileNames(ownFolder) : [];
    const [taken] = await ownFileConflicts(names, folder, 1);
    if (taken !== undefined) {
        throw new ChatError('files-conflict', `${taken} is already in ${folder}`);
    }

    const chats = known.find((project) => project.folder === deps.scratchFolder);
    if (chats === undefined) {
        throw new ChatError('move-refused', REFUSAL_SENTENCES['not-in-chats']);
    }
    const info = await deps.chats.load(chatId);
    refuse(deps, chatId);
    // The last refusal: from here on the move makes things on disk.
    const putBack = deps.chats.claim(chatId);
    if (putBack === null) {
        throw new ChatError('move-refused', REFUSAL_SENTENCES.working);
    }
    const target = chosen ?? known.find((project) => project.folder === folder) ?? (await makeProject(payload, folder, deps).catch(failWith(putBack)));

    const undo: Array<() => Promise<void>> = [];
    let leftAt: string | null = null;
    let whole = false;
    /* The journal is only a trace for the next start, so a failure to drop it never undoes a move. */
    const endJournal = (): Promise<void> =>
        Promise.resolve(deps.journal?.end(chatId)).catch((e: unknown) => console.error(`Dropping the journal of a chat move failed: ${errorText(e)}`));
    /* Puts back every step, last first; false when one could not be, which leaves the journal for the next start. */
    const rollback = async (): Promise<boolean> => {
        let complete = true;
        for (const step of undo.toReversed()) {
            await step().catch((failure: unknown) => {
                complete = false;
                console.error(`Putting back a step of a failed chat move failed: ${errorText(failure)}`);
            });
        }
        undo.length = 0;
        return complete;
    };
    const during = async (): Promise<void> => {
        try {
            await deps.journal?.begin({ chatId, to: target.projectId, folder });
            const transcript = await fileTranscript(deps.chats, info, folder, deps.moveTranscript);
            if (transcript !== null) {
                undo.push(() => transcript.undo());
            }
            // A task or a message that came while the CLI ended still refuses.
            refuse(deps, chatId);

            const leaving = await deps.projects.read(chats.projectId);
            const view = chatViewOf(leaving, chatId);
            const flag = leaving.flags?.[chatId];
            const adopted = (await deps.projects.overlayFieldsOf(chats.projectId)).filter((field) => Object.hasOwn(view.node, field));
            // The views with this one among them, its flag and the overlay fields it carries: in the target, or back in Chats.
            const placing = (content: ProjectContent, overlayFields: readonly string[], views: ProjectContent['views']) => ({
                content: { ...content, views, ...(flag === undefined ? {} : { flags: { ...content.flags, [chatId]: flag } }) },
                result: undefined,
                overlayFields: [...new Set([...overlayFields, ...adopted])]
            });
            await deps.projects.mutate(target.projectId, (content, context) => placing(content, context.overlayFields, [movedView(view), ...content.views]));
            undo.push(() =>
                deps.projects.mutate(target.projectId, (content) => ({
                    content: { ...content, views: content.views.filter((entry) => entry.id !== chatId), flags: withoutFlag(content.flags, chatId) },
                    result: undefined
                }))
            );

            const fromProject = deps.lineage.projectOf(chatId);
            if (fromProject !== null) {
                await deps.lineage.rehome(chatId, target.projectId);
                undo.push(async () => {
                    await deps.lineage.rehome(chatId, fromProject);
                });
            }

            const snooze = deps.snoozes?.list().find((entry) => entry.nodeId === chatId);
            if (snooze !== undefined) {
                deps.snoozes?.set(target.projectId, chatId, snooze.until);
                undo.push(async () => deps.snoozes?.set(snooze.projectId, chatId, snooze.until));
            }

            let position = 0;
            await deps.projects.mutate(chats.projectId, (content, context) => {
                chatViewOf(content, chatId);
                // Under the lock of the write: a message that came since the last look would be dropped with the view.
                refuse(deps, chatId, true);
                position = content.views.findIndex((entry) => entry.id === chatId);
                const rest = content.views.filter((entry) => entry.id !== chatId);
                // Fields a node of Chats still carries stay declared there.
                const inUse = new Set(rest.flatMap((entry) => (entry.kind === 'chat' ? Object.keys(entry.node) : [])));
                return {
                    content: { ...content, views: rest, flags: withoutFlag(content.flags, chatId) },
                    result: undefined,
                    overlayFields: context.overlayFields.filter((field) => !adopted.includes(field) || inUse.has(field))
                };
            });
            undo.push(() =>
                deps.projects.mutate(chats.projectId, (content, context) => {
                    const views = content.views.filter((entry) => entry.id !== chatId);
                    views.splice(Math.min(position, views.length), 0, view);
                    return placing(content, context.overlayFields, views);
                })
            );

            if (payload.ownFiles === 'move') {
                const moved = await (deps.moveOwnFiles ?? moveOwnFiles)(ownFolder, folder);
                undo.push(() => moved.undo());
            } else if ((await ownFileNames(ownFolder)).length > 0) {
                leftAt = ownFolder;
            }
            whole = true;
        } catch (e) {
            if (await rollback()) {
                await endJournal();
            }
            throw e;
        }
    };

    try {
        await deps.chats.relocate(chatId, folder, during);
    } catch (e) {
        // Past this point the queue of the chat went on, so nothing is taken back: the journal stays and the next start finishes the move.
        if (whole) {
            deps.moved?.(chatId);
            throw new ChatError(
                'move-failed',
                `The chat is in the project, but the machine could not save its new folder (${errorText(e)}). It finishes the move the next time it starts`
            );
        }
        putBack();
        // The relocation throws the library's error, not Ruimte's subclass, and its sentence names the chat id.
        if (e instanceof AgentChatError && e.code === 'chat-busy') {
            throw new ChatError('move-refused', REFUSAL_SENTENCES.working);
        }
        throw e;
    }
    await endJournal();
    deps.moved?.(chatId);

    const words = movedNote({ name: target.name, folder, leftAt });
    await deps.chats
        .deliverNote(chatId, { noteId: `moved-${target.projectId}`, ...words })
        .catch((e: unknown) => console.error(`Leaving the note of a moved chat failed: ${errorText(e)}`));
    // The move is done; a summary that cannot be read must not turn it into an error the window does not follow.
    const summary = await deps.projects.summary(target.projectId).catch(() => summaryOf(target, folder));
    return { summary, viewId: chatId, ownFilesLeftAt: leftAt };
}

function withoutFlag(flags: ProjectContent['flags'], chatId: string): ProjectContent['flags'] {
    if (flags === undefined) {
        return undefined;
    }
    const { [chatId]: _flag, ...rest } = flags;
    return rest;
}

/* What is known of the project when its summary cannot be read: enough for the window to follow the chat. */
function summaryOf(target: { projectId: string; name: string }, folder: string): ProjectSummary {
    return {
        projectId: target.projectId,
        name: target.name,
        color: DEFAULT_PROJECT_COLOR,
        folder,
        lastOpenedAt: Date.now(),
        closedAt: null,
        available: true,
        icon: initialIconOf(target.name),
        nameSource: 'chosen'
    };
}

/* The path with every link in its existing part followed, for a folder that is not made yet. */
async function resolvedPath(path: string): Promise<string> {
    const real = await realOrNull(path);
    if (real !== null) {
        return real;
    }
    const parent = dirname(path);
    return parent === path ? path : join(await resolvedPath(parent), basename(path));
}
