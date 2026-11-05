import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeProjectSlug } from '@adecore/agents/chat';
import { ManualClock } from '@adecore/agents/testing';
import { moveClaudeTranscript } from '../chat/claude-move.ts';
import { MachineHome } from '../disk/machine-home.ts';
import { SnoozeStore } from '../push/snoozes.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { repairChatMoves } from '../wiring/chat-move.ts';
import { MoveJournal } from './move-journal.ts';
import { OUTSIDE_CHECKOUT, projectLinks } from './project-file-test-helpers.ts';
import { ProjectStore } from './project-store.ts';
import { newScratchChat } from './scratch-project.ts';

describe('finishing a chat move the machine stopped in the middle of', () => {
    let root: string;
    let store: ProjectStore;
    let daemon: TestDaemon;
    let journal: MoveJournal;
    let snoozes: SnoozeStore;
    let chatId: string;
    let chatsId: string;
    let targetId: string;
    let targetFolder: string;
    let ownFolder: string;
    let sessionId: string;

    const repair = (): Promise<string[]> =>
        repairChatMoves({
            ...daemon,
            store,
            lineage: daemon.lineage,
            prWatches: daemon.prWatches,
            outbox: daemon.outbox,
            machineHome: new MachineHome(store.home),
            journal,
            snoozes
        });

    const viewIds = async (projectId: string): Promise<string[]> => (await store.read(projectId)).views.map((view) => view.id);

    /* The first write of a move: the view stands in the target while Chats still places it. */
    const writeTarget = async (): Promise<void> => {
        const view = (await store.read(chatsId)).views.find((entry) => entry.id === chatId)!;
        await store.mutate(targetId, (content) => ({ content: { ...content, views: [view, ...content.views] }, result: undefined }));
    };

    const dropFromChats = async (): Promise<void> => {
        await store.mutate(chatsId, (content) => ({ content: { ...content, views: content.views.filter((view) => view.id !== chatId) }, result: undefined }));
    };

    const expectFinished = async (): Promise<void> => {
        expect(store.index.projectsPlacing(chatId)).toEqual([targetId]);
        expect(await viewIds(chatsId)).not.toContain(chatId);
        expect(daemon.chats.get(chatId)!.info.cwd).toBe(targetFolder);
        expect(await readdir(join(daemon.chats.claudeProjectsDir, claudeProjectSlug(await realpath(targetFolder))))).toContain(`${sessionId}.jsonl`);
        expect(journal.pending()).toEqual([]);
        await expect(store.openProject({ folder: targetFolder })).resolves.toBeDefined();
    };

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'ruimte-move-repair-'));
        const home = join(root, 'home');
        store = new ProjectStore(home, projectLinks());
        journal = new MoveJournal(home);
        snoozes = new SnoozeStore({ clock: new ManualClock() });
        daemon = await bootTestDaemon({ home, store, clock: new ManualClock() });
        const made = await newScratchChat(store, {}, OUTSIDE_CHECKOUT);
        chatId = made.viewId;
        chatsId = made.summary.projectId;
        ownFolder = join(store.scratchFolder, chatId);
        await daemon.chats.create({ chatId, provider: 'claude', cwd: ownFolder });
        await daemon.chats.send(chatId, 'hello');
        await daemon.until(
            () =>
                daemon.chats.get(chatId)!.info.activeTurnId === null &&
                daemon.chats
                    .get(chatId)!
                    .thread.list()
                    .some((item) => item.kind === 'assistant')
        );
        sessionId = daemon.chats.get(chatId)!.info.agentSessionId!;
        const dir = join(daemon.chats.claudeProjectsDir, claudeProjectSlug(await realpath(ownFolder)));
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${sessionId}.jsonl`), '{"type":"user"}\n');

        targetFolder = join(root, 'vinyl');
        const opened = await store.openProject({ folder: targetFolder, name: 'vinyl', createFolder: true });
        targetId = opened.summary.projectId;
        store.release(targetId);
    });

    afterEach(async () => {
        await daemon.stop();
        store.closeAll();
        await rm(root, { recursive: true, force: true });
    });

    test('leaves a chat that only Chats places alone', async () => {
        expect(await repair()).toEqual([]);
        expect(daemon.chats.get(chatId)!.info.cwd).toBe(ownFolder);
        expect(await viewIds(chatsId)).toContain(chatId);
    });

    test('after the target was written: takes the chat out of Chats and into the folder', async () => {
        await writeTarget();
        expect(await repair()).toEqual([chatId]);
        await expectFinished();
    });

    test('tells the chat where it works now, once, and takes its snooze along', async () => {
        snoozes.set(chatsId, chatId, 10 ** 15);
        await writeTarget();
        await repair();
        const notes = () =>
            daemon.chats
                .get(chatId)!
                .thread.list()
                .filter((item) => item.kind === 'note');
        expect(notes().at(-1)).toMatchObject({ text: 'Moved from Chats to vinyl.' });
        expect(snoozes.list()).toEqual([{ projectId: targetId, nodeId: chatId, until: 10 ** 15 }]);
        await journal.begin({ chatId, to: targetId, folder: targetFolder });
        await repair();
        expect(notes().filter((item) => item.text === 'Moved from Chats to vinyl.')).toHaveLength(1);
    });

    test('after the target and the lineage were written: also for a fork', async () => {
        await daemon.lineage.put({ projectId: chatsId, nodeId: chatId, openedBy: 'chat-original', depth: 0, agent: true, relation: 'fork' });
        await writeTarget();
        await daemon.lineage.rehome(chatId, targetId);
        expect(await repair()).toEqual([chatId]);
        await expectFinished();
        expect(daemon.lineage.projectOf(chatId)).toBe(targetId);
        expect(daemon.lineage.forkedFrom(chatId)).toBe('chat-original');
    });

    test("a fork's record that still says Chats goes to the target", async () => {
        await daemon.lineage.put({ projectId: chatsId, nodeId: chatId, openedBy: 'chat-original', depth: 0, agent: true, relation: 'fork' });
        await writeTarget();
        await repair();
        expect(daemon.lineage.projectOf(chatId)).toBe(targetId);
    });

    test('after both writes, with the record still in the old folder: the journal finds it', async () => {
        await journal.begin({ chatId, to: targetId, folder: targetFolder });
        await writeTarget();
        await dropFromChats();
        const moved = await moveClaudeTranscript({
            projectsDir: daemon.chats.claudeProjectsDir,
            sessionId,
            fromCwd: ownFolder,
            toCwd: targetFolder
        });
        expect(moved).toBeDefined();
        expect(await repair()).toEqual([chatId]);
        await expectFinished();
    });

    test('a journal entry whose target never took the chat puts the conversation back where the record works', async () => {
        await journal.begin({ chatId, to: targetId, folder: targetFolder });
        await moveClaudeTranscript({ projectsDir: daemon.chats.claudeProjectsDir, sessionId, fromCwd: ownFolder, toCwd: targetFolder });
        expect(await repair()).toEqual([chatId]);
        expect(await viewIds(chatsId)).toContain(chatId);
        expect(daemon.chats.get(chatId)!.info.cwd).toBe(ownFolder);
        expect(await readdir(join(daemon.chats.claudeProjectsDir, claudeProjectSlug(await realpath(ownFolder))))).toContain(`${sessionId}.jsonl`);
        expect(journal.pending()).toEqual([]);
    });

    test('a chat whose record is gone still leaves Chats', async () => {
        await journal.begin({ chatId, to: targetId, folder: targetFolder });
        await writeTarget();
        await daemon.chats.kill(chatId);
        expect(await repair()).toEqual([chatId]);
        expect(await viewIds(chatsId)).not.toContain(chatId);
    });
});
