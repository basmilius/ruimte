import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatStore, claudeProjectSlug } from '@adecore/agents/chat';
import { FakeWatch, ManualClock } from '@adecore/agents/testing';
import { SnoozeStore } from '../push/snoozes.ts';
import { moveOwnFiles } from './own-files.ts';
import type { ChatMovePayload } from '@ruimte/contracts';
import { MachineHome } from '../fs/machine-home.ts';
import { claudeApiConfigDir, createAnthropicClaudeApiProvider } from '../providers/anthropic-claude-api-provider.ts';
import { AnthropicClaudeApiService } from '../providers/anthropic-claude-api-service.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { chatMoveDeps, type ChatMoveWiring } from '../wiring/chat-move.ts';
import { moveChat, type MoveChatDeps } from './move-chat.ts';
import { MoveJournal } from './move-journal.ts';
import { privateFileOnDisk, projectLinks } from './project-file-test-helpers.ts';
import { ProjectStore } from './project-store.ts';
import { newScratchChat } from './scratch-project.ts';

const FAILED = new Error('injected');

describe('moving a chat from Chats into a project', () => {
    let root: string;
    let store: ProjectStore;
    let daemon: TestDaemon;
    let chatId: string;
    let chatsId: string;
    let ownFolder: string;
    let sessionId: string;
    let journal: MoveJournal;
    let claudeApi: AnthropicClaudeApiService;

    const wiring = (): ChatMoveWiring => ({
        ...daemon,
        store,
        lineage: daemon.lineage,
        prWatches: daemon.prWatches,
        outbox: daemon.outbox,
        machineHome: new MachineHome(store.home),
        journal
    });

    /* The deps as the daemon wires them, with one piece replaced by a test. */
    const deps = (override: (base: MoveChatDeps) => Partial<MoveChatDeps> = () => ({})): MoveChatDeps => {
        const base = chatMoveDeps(wiring()).move;
        return { ...base, ...override(base) };
    };

    const make = (name: string, extra: Partial<Extract<ChatMovePayload['to'], { folder: string }>> = {}): ChatMovePayload['to'] => ({
        folder: join(root, name),
        name,
        createFolder: true,
        initGit: false,
        ...extra
    });

    const say = async (id: string, text: string): Promise<void> => {
        const before = daemon.chats
            .get(id)!
            .thread.list()
            .filter((item) => item.kind === 'turn').length;
        await daemon.chats.send(id, text);
        await daemon.until(() => {
            const chat = daemon.chats.get(id)!;
            return chat.info.activeTurnId === null && chat.thread.list().filter((item) => item.kind === 'turn').length === before + 1;
        });
    };

    /* Where Claude Code would keep the conversation of the chat while it works in Chats. */
    const transcriptDir = (): string => join(daemon.chats.claudeProjectsDir, claudeProjectSlug(ownFolder));

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'ruimte-move-chat-'));
        const home = join(root, 'home');
        store = new ProjectStore(home, projectLinks(), new FakeWatch());
        journal = new MoveJournal(home);
        claudeApi = new AnthropicClaudeApiService(async () => Response.json({ data: [{ id: 'claude-sonnet-example', line: 'sonnet' }] }));
        await claudeApi.load(home);
        await claudeApi.configure('sk-ant-test-only');
        daemon = await bootTestDaemon({ home, store, clock: new ManualClock(), providers: [createAnthropicClaudeApiProvider(claudeApi)] });
        const made = await newScratchChat(store, {});
        chatId = made.viewId;
        chatsId = made.summary.projectId;
        ownFolder = join(store.scratchFolder, chatId);
        await daemon.chats.create({ chatId, provider: 'claude', cwd: ownFolder });
        await say(chatId, 'hello');
        sessionId = daemon.chats.get(chatId)!.info.agentSessionId!;
        await mkdir(join(transcriptDir(), sessionId), { recursive: true });
        await writeFile(join(transcriptDir(), `${sessionId}.jsonl`), '{"type":"user"}\n');
        await writeFile(join(ownFolder, 'notes.md'), 'notes');
        // Written in, so the view is listed: the mark of an empty chat goes with the first message.
        await store.mutate(chatsId, (content) => ({
            content: { ...content, views: content.views.map((view) => (view.kind === 'chat' ? { ...view, empty: undefined } : view)) },
            result: undefined
        }));
    });

    afterEach(async () => {
        await daemon.stop();
        store.closeAll();
        await rm(root, { recursive: true, force: true });
    });

    const viewIds = async (projectId: string): Promise<string[]> => (await store.read(projectId)).views.map((view) => view.id);

    /* The project the moves below make in `vinyl`, which stays when a move fails. */
    const vinylId = async (): Promise<string> => (await store.known()).find((project) => project.folder === join(root, 'vinyl'))!.projectId;

    /* A move into `vinyl` whose own files cannot move: the last step fails, after the Chats write. */
    const failingFiles = (extra: Partial<MoveChatDeps> = {}): Promise<unknown> =>
        moveChat(
            { chatId, to: make('vinyl'), ownFiles: 'move' },
            deps(() => ({ moveOwnFiles: () => Promise.reject(FAILED), ...extra }))
        );

    /* A move into `vinyl` whose second project write, the one to Chats, fails. */
    const failingChatsWrite = (): Promise<unknown> => {
        let writes = 0;
        return moveChat(
            { chatId, to: make('vinyl'), ownFiles: 'move' },
            deps((base) => ({
                projects: {
                    ...base.projects,
                    mutate: (projectId, apply) => {
                        writes += 1;
                        return writes === 2 ? Promise.reject(FAILED) : base.projects.mutate(projectId, apply);
                    }
                }
            }))
        );
    };

    /* What a failed move has to leave exactly as it was. */
    const expectUntouched = async (): Promise<void> => {
        expect(daemon.chats.get(chatId)!.info.cwd).toBe(ownFolder);
        expect(await viewIds(chatsId)).toContain(chatId);
        expect(await readdir(transcriptDir())).toEqual(expect.arrayContaining([`${sessionId}.jsonl`, sessionId]));
        expect(await readFile(join(ownFolder, 'notes.md'), 'utf8')).toBe('notes');
        expect(daemon.lineage.projectOf(chatId)).toBeNull();
    };

    test('makes a project in a new folder and puts the chat, its conversation and its files in it', async () => {
        const folder = join(root, 'vinyl');
        const result = await moveChat({ chatId, to: make('vinyl', { initGit: true }), ownFiles: 'move' }, deps());

        expect(result).toMatchObject({ viewId: chatId, ownFilesLeftAt: null, summary: { name: 'vinyl', folder } });
        expect(existsSync(join(folder, '.git'))).toBe(true);
        expect(await readFile(join(folder, 'notes.md'), 'utf8')).toBe('notes');
        expect(existsSync(ownFolder)).toBe(false);

        const [view] = (await store.read(result.summary.projectId)).views;
        expect(view).toMatchObject({ kind: 'chat', id: chatId });
        expect(view!.kind === 'chat' && 'cwd' in view.node).toBe(false);
        expect(await viewIds(chatsId)).not.toContain(chatId);
        expect(store.index.locate(chatId)?.projectId).toBe(result.summary.projectId);
        expect(await readdir(join(daemon.chats.claudeProjectsDir, claudeProjectSlug(await realpath(folder))))).toEqual(
            expect.arrayContaining([`${sessionId}.jsonl`, sessionId])
        );

        const chat = daemon.chats.get(chatId)!;
        expect(chat.info.cwd).toBe(folder);
        expect(chat.thread.list().findLast((item) => item.kind === 'note')).toMatchObject({ text: 'Moved from Chats to vinyl.' });
        expect(store.holdersOf(result.summary.projectId)).toEqual([]);
    });

    test('writes the move down while it runs and drops it once the move is whole or put back', async () => {
        const seen: number[] = [];
        await moveChat(
            { chatId, to: make('vinyl'), ownFiles: 'move' },
            deps((base) => ({
                projects: {
                    ...base.projects,
                    mutate: (projectId, apply) => {
                        seen.push(journal.pending().length);
                        return base.projects.mutate(projectId, apply);
                    }
                }
            }))
        );
        expect(seen).toEqual([1, 1]);
        expect(journal.pending()).toEqual([]);
        const second = (await newScratchChat(store, {})).viewId;
        await daemon.chats.create({ chatId: second, provider: 'claude', cwd: join(store.scratchFolder, second) });
        await expect(
            moveChat(
                { chatId: second, to: make('other'), ownFiles: 'move' },
                deps(() => ({ moveOwnFiles: () => Promise.reject(FAILED) }))
            )
        ).rejects.toBe(FAILED);
        expect(journal.pending()).toEqual([]);
    });

    test('the next turn resumes the same session, and its agent is told the new folder', async () => {
        const folder = join(root, 'vinyl');
        await moveChat({ chatId, to: make('vinyl'), ownFiles: 'leave' }, deps());
        const before = daemon.claude.started.length;
        await say(chatId, 'where am I');
        const started = daemon.claude.started.slice(before);
        expect(started).toHaveLength(1);
        expect(started[0]!.argv).toContain(`--resume=${sessionId}`);
        const reply = daemon.chats
            .get(chatId)!
            .thread.list()
            .findLast((item) => item.kind === 'assistant');
        expect(reply).toMatchObject({ text: expect.stringContaining(`Your working directory is now ${folder}`) });
        expect(daemon.chats.get(chatId)!.info).toMatchObject({ cwd: folder, agentSessionId: sessionId });
    });

    test('leaves the own files where they are and says so', async () => {
        const result = await moveChat({ chatId, to: make('vinyl'), ownFiles: 'leave' }, deps());
        expect(result.ownFilesLeftAt).toBe(ownFolder);
        expect(await readFile(join(ownFolder, 'notes.md'), 'utf8')).toBe('notes');
        expect(existsSync(join(root, 'vinyl', 'notes.md'))).toBe(false);
        expect(
            daemon.chats
                .get(chatId)!
                .thread.list()
                .findLast((item) => item.kind === 'note')
        ).toMatchObject({
            text: `Moved from Chats to vinyl. Its own files stay in ${ownFolder}.`
        });
    });

    test('moves into the project the registry has for the folder instead of opening it again', async () => {
        const folder = join(root, 'repo');
        await mkdir(folder);
        const existing = await store.openProject({ folder });
        store.release(existing.summary.projectId);
        let made = 0;
        const result = await moveChat(
            { chatId, to: { folder, name: 'Other name', createFolder: false, initGit: false }, ownFiles: 'leave' },
            deps((base) => ({
                projects: {
                    ...base.projects,
                    make: (payload) => {
                        made += 1;
                        return base.projects.make(payload);
                    }
                }
            }))
        );
        expect(made).toBe(0);
        expect(result.summary.projectId).toBe(existing.summary.projectId);
        expect(await viewIds(existing.summary.projectId)).toEqual([chatId]);
    });

    test('moves into a project named by its id', async () => {
        const folder = join(root, 'repo');
        await mkdir(folder);
        const existing = await store.openProject({ folder });
        store.release(existing.summary.projectId);
        const result = await moveChat({ chatId, to: { projectId: existing.summary.projectId }, ownFiles: 'leave' }, deps());
        expect(result.summary.folder).toBe(folder);
        expect(daemon.chats.get(chatId)!.info.cwd).toBe(folder);
    });

    test('refuses a name the target holds before anything moved or was made', async () => {
        const folder = join(root, 'repo');
        await mkdir(folder);
        await writeFile(join(folder, 'notes.md'), 'theirs');
        const before = (await store.known()).length;
        await expect(moveChat({ chatId, to: { folder, name: 'repo', createFolder: false, initGit: false }, ownFiles: 'move' }, deps())).rejects.toMatchObject({
            code: 'files-conflict'
        });
        expect((await store.known()).length).toBe(before);
        expect(await readFile(join(folder, 'notes.md'), 'utf8')).toBe('theirs');
        await expectUntouched();
    });

    test("refuses the folder of Chats and another chat's own folder", async () => {
        const other = join(store.scratchFolder, 'chat-other');
        await mkdir(other);
        for (const folder of [other, join(other, 'sub'), store.scratchFolder]) {
            await expect(moveChat({ chatId, to: { folder, name: 'x', createFolder: true, initGit: false }, ownFiles: 'leave' }, deps())).rejects.toMatchObject({
                code: 'move-failed'
            });
        }
        expect(existsSync(join(other, 'sub'))).toBe(false);
        await expectUntouched();
    });

    test("refuses a folder that holds the machine's own state", async () => {
        const state = join(store.home, 'chats');
        await mkdir(state, { recursive: true });
        await expect(
            moveChat({ chatId, to: { folder: state, name: 'x', createFolder: false, initGit: false }, ownFiles: 'leave' }, deps())
        ).rejects.toMatchObject({
            code: 'machine-state'
        });
        await expectUntouched();
    });

    test('refuses with the sentence of the reason and moves nothing', async () => {
        await daemon.lineage.put({ projectId: chatsId, nodeId: 'child', openedBy: chatId, depth: 1, agent: true });
        await expect(moveChat({ chatId, to: make('vinyl'), ownFiles: 'move' }, deps())).rejects.toMatchObject({
            code: 'move-refused',
            message: expect.stringContaining('started agents of its own')
        });
        expect(existsSync(join(root, 'vinyl'))).toBe(false);
    });

    test('a chat that is working is refused', async () => {
        await daemon.chats.send(chatId, 'ask: which color');
        await daemon.until(() => daemon.chats.get(chatId)?.info.status === 'needs-you');
        await expect(moveChat({ chatId, to: make('vinyl'), ownFiles: 'move' }, deps())).rejects.toMatchObject({ code: 'move-refused' });
        expect(existsSync(join(root, 'vinyl'))).toBe(false);
    });

    test('a chat that cannot be relocated is refused before a folder, a repository or a project is made', async () => {
        daemon.chats.holdForPerson(chatId, 'some-card');
        const folder = join(root, 'vinyl');
        const before = (await store.known()).length;
        const refused = await moveChat(
            { chatId, to: make('vinyl', { initGit: true }), ownFiles: 'move' },
            deps(() => ({ refusal: () => null }))
        ).catch((e: unknown) => e);
        expect(refused).toMatchObject({
            code: 'move-refused',
            message: 'This chat is still working. Stop it or wait for it to finish, then try again'
        });
        expect((refused as Error).message).not.toContain(chatId);
        expect(existsSync(folder)).toBe(false);
        expect((await store.known()).length).toBe(before);
        await expectUntouched();
    });

    test('a project places the chat at every moment of the move', async () => {
        const seen: Array<string | null> = [];
        const result = await moveChat(
            { chatId, to: make('vinyl'), ownFiles: 'move' },
            deps((base) => ({
                projects: {
                    ...base.projects,
                    mutate: async (projectId, apply) => {
                        seen.push(store.index.locate(chatId)?.projectId ?? null);
                        const done = await base.projects.mutate(projectId, apply);
                        seen.push(store.index.locate(chatId)?.projectId ?? null);
                        return done;
                    }
                }
            }))
        );
        expect(seen).toHaveLength(4);
        expect(seen).not.toContain(null);
        expect(store.index.locate(chatId)?.projectId).toBe(result.summary.projectId);
    });

    test('the write that takes the view out of Chats cancels no task, ends no agents and owes nothing', async () => {
        const before = daemon.enqueued.length;
        await moveChat({ chatId, to: make('vinyl'), ownFiles: 'move' }, deps());
        await daemon.pruned();
        expect(daemon.enqueued).toHaveLength(before);
        expect(daemon.outbox.list()).toEqual([]);
        expect(daemon.tasks.involving(chatId)).toEqual([]);
    });

    test("a fork's lineage record survives with the project of the target", async () => {
        await daemon.lineage.put({ projectId: chatsId, nodeId: chatId, openedBy: 'chat-original', depth: 0, agent: true, relation: 'fork' });
        expect(daemon.lineage.projectOf(chatId)).toBe(chatsId);
        const result = await moveChat({ chatId, to: make('vinyl'), ownFiles: 'move' }, deps());
        await daemon.pruned();
        expect(daemon.lineage.projectOf(chatId)).toBe(result.summary.projectId);
        expect(daemon.lineage.forkedFrom(chatId)).toBe('chat-original');
    });

    test('a fork nobody wrote in keeps its record and its conversation', async () => {
        const forkId = (await newScratchChat(store, {})).viewId;
        const forkFolder = join(store.scratchFolder, forkId);
        const original = daemon.chats.get(chatId)!;
        const items = original.thread.list();
        const turn = items.findLast((item) => item.kind === 'turn')!;
        const forkSession = 'unspoken-fork-session';
        await daemon.chats.writeRecord(
            forkId,
            {
                ...original.info,
                chatId: forkId,
                cwd: forkFolder,
                agentSessionId: forkSession,
                forkOf: { chatId, turnId: turn.id, at: 1_800_000_000_000 }
            },
            items
        );
        const transcript = join(daemon.chats.claudeProjectsDir, claudeProjectSlug(forkFolder), `${forkSession}.jsonl`);
        await mkdir(join(daemon.chats.claudeProjectsDir, claudeProjectSlug(forkFolder)), { recursive: true });
        await writeFile(transcript, 'inherited conversation\n');
        await daemon.lineage.put({ projectId: chatsId, nodeId: forkId, openedBy: chatId, depth: 0, agent: true, relation: 'fork' });
        expect(daemon.chats.get(forkId)).toBeUndefined();
        expect((await new ChatStore(store.home).read(forkId))!.items.filter((item) => item.kind === 'turn').map((item) => item.id)).toEqual([turn.id]);
        const result = await moveChat({ chatId: forkId, to: make('vinyl'), ownFiles: 'move' }, deps());
        await daemon.pruned();
        expect(await daemon.chats.hasStored(forkId)).toBe(true);
        expect(daemon.lineage.forkedFrom(forkId)).toBe(chatId);
        expect(daemon.lineage.projectOf(forkId)).toBe(result.summary.projectId);
        expect((await new ChatStore(store.home).read(forkId))!.items.filter((item) => item.kind === 'turn').map((item) => item.id)).toEqual([turn.id]);
        expect(
            await readFile(join(daemon.chats.claudeProjectsDir, claudeProjectSlug(await realpath(join(root, 'vinyl'))), `${forkSession}.jsonl`), 'utf8')
        ).toBe('inherited conversation\n');
    });

    test("a Claude API chat takes its conversation along in the Claude API's own config folder", async () => {
        const apiId = (await newScratchChat(store, { provider: 'anthropic-claude-api' })).viewId;
        const apiFolder = join(store.scratchFolder, apiId);
        await daemon.chats.create({ chatId: apiId, provider: 'anthropic-claude-api', cwd: apiFolder });
        await say(apiId, 'hello');
        await store.mutate(chatsId, (content) => ({
            content: { ...content, views: content.views.map((view) => (view.id === apiId && view.kind === 'chat' ? { ...view, empty: undefined } : view)) },
            result: undefined
        }));
        const apiSession = daemon.chats.get(apiId)!.info.agentSessionId!;
        const projects = join(claudeApiConfigDir(claudeApi), 'projects');
        await mkdir(join(projects, claudeProjectSlug(apiFolder)), { recursive: true });
        await writeFile(join(projects, claudeProjectSlug(apiFolder), `${apiSession}.jsonl`), '{"type":"user"}\n');

        await moveChat({ chatId: apiId, to: make('vinyl'), ownFiles: 'leave' }, deps());

        // The move names the folder by its real path, as the project registry does.
        expect(existsSync(join(projects, claudeProjectSlug(await realpath(join(root, 'vinyl'))), `${apiSession}.jsonl`))).toBe(true);
        expect(existsSync(join(projects, claudeProjectSlug(apiFolder), `${apiSession}.jsonl`))).toBe(false);
        expect(existsSync(join(daemon.chats.claudeProjectsDir, claudeProjectSlug(join(root, 'vinyl'))))).toBe(false);
    });

    test('a Codex chat has no conversation file to move', async () => {
        const codexId = (await newScratchChat(store, { provider: 'codex' })).viewId;
        await daemon.chats.create({ chatId: codexId, provider: 'codex', cwd: join(store.scratchFolder, codexId) });
        await say(codexId, 'hello');
        await store.mutate(chatsId, (content) => ({
            content: { ...content, views: content.views.map((view) => (view.id === codexId && view.kind === 'chat' ? { ...view, empty: undefined } : view)) },
            result: undefined
        }));
        let moved = 0;
        await moveChat(
            { chatId: codexId, to: make('vinyl'), ownFiles: 'leave' },
            deps(() => ({
                moveTranscript: () => {
                    moved += 1;
                    return Promise.reject(FAILED);
                }
            }))
        );
        expect(moved).toBe(0);
        expect(daemon.chats.get(codexId)!.info.cwd).toBe(join(root, 'vinyl'));
    });

    describe('a step that fails undoes every step before it', () => {
        test('after the conversation moved, a refusal that came meanwhile', async () => {
            let calls = 0;
            await expect(
                moveChat(
                    { chatId, to: make('vinyl'), ownFiles: 'move' },
                    deps((base) => ({
                        refusal: (id) => {
                            calls += 1;
                            return calls >= 3 ? { reason: 'messages' } : base.refusal(id);
                        }
                    }))
                )
            ).rejects.toMatchObject({ code: 'move-refused' });
            await expectUntouched();
        });

        test('after the target was written, a Chats write that fails', async () => {
            await expect(failingChatsWrite()).rejects.toBe(FAILED);
            await expectUntouched();
            expect(await viewIds(await vinylId())).toEqual([]);
        });

        test("after a fork's lineage moved, a Chats write that fails", async () => {
            await daemon.lineage.put({ projectId: chatsId, nodeId: chatId, openedBy: 'chat-original', depth: 0, agent: true, relation: 'fork' });
            await expect(failingChatsWrite()).rejects.toBe(FAILED);
            expect(daemon.lineage.projectOf(chatId)).toBe(chatsId);
            expect(daemon.chats.get(chatId)!.info.cwd).toBe(ownFolder);
            expect(await viewIds(chatsId)).toContain(chatId);
        });

        test('after the Chats write, the files that cannot move', async () => {
            await daemon.lineage.put({ projectId: chatsId, nodeId: chatId, openedBy: 'chat-original', depth: 0, agent: true, relation: 'fork' });
            await expect(failingFiles()).rejects.toBe(FAILED);
            expect(daemon.lineage.projectOf(chatId)).toBe(chatsId);
            expect(daemon.chats.get(chatId)!.info.cwd).toBe(ownFolder);
            expect(await viewIds(chatsId)).toContain(chatId);
            expect(await readdir(transcriptDir())).toEqual(expect.arrayContaining([`${sessionId}.jsonl`, sessionId]));
            expect(await readFile(join(ownFolder, 'notes.md'), 'utf8')).toBe('notes');
            expect(await viewIds(await vinylId())).toEqual([]);
        });

        test('the chat keeps working in its old folder afterwards', async () => {
            await expect(failingFiles()).rejects.toBe(FAILED);
            await say(chatId, 'write: marker.txt here');
            expect(await readFile(join(ownFolder, 'marker.txt'), 'utf8')).toBe('here\n');
        });
    });

    for (const another of [false, true]) {
        test(`the node fields a newer Ruimte keeps one person go along ${another ? 'and stay in Chats while another node needs them' : 'and leave Chats when unused'}`, async () => {
            const second = another ? (await newScratchChat(store, {})).viewId : null;
            const privateFile = join(store.scratchFolder, '.ruimte', 'private', 'project.json');
            const file = JSON.parse(await readFile(privateFile, 'utf8')) as {
                views: Array<{ id: string; node: Record<string, unknown> }>;
                overlayFields?: string[];
            };
            file.overlayFields = ['pinnedAt'];
            file.views = file.views.map((view) =>
                view.id === chatId || view.id === second ? { ...view, node: { ...view.node, pinnedAt: view.id === chatId ? 7 : 9 } } : view
            );
            await writeFile(privateFile, JSON.stringify(file));
            const result = await moveChat({ chatId, to: make('vinyl'), ownFiles: 'leave' }, deps());

            const target = await privateFileOnDisk(join(root, 'vinyl'));
            expect(target.overlayFields).toEqual(['pinnedAt']);
            expect(target.views.find((view) => view.id === chatId)).toMatchObject({ node: { pinnedAt: 7 } });
            const remaining = await privateFileOnDisk(store.scratchFolder);
            expect(remaining.overlayFields ?? []).toEqual(another ? ['pinnedAt'] : []);
            if (another) {
                expect(remaining.views.find((view) => view.id === second)).toMatchObject({ node: { pinnedAt: 9 } });
            }
            expect(result.viewId).toBe(chatId);
        });
    }

    test("the person's flag on the chat moves with it", async () => {
        await store.mutate(chatsId, (content) => ({ content: { ...content, flags: { [chatId]: 'red' } }, result: undefined }));
        const result = await moveChat({ chatId, to: make('vinyl'), ownFiles: 'leave' }, deps());
        expect((await store.read(result.summary.projectId)).flags).toEqual({ [chatId]: 'red' });
        expect((await store.read(chatsId)).flags ?? {}).toEqual({});
    });

    test('a failed move leaves the flag in Chats and none in the target', async () => {
        await store.mutate(chatsId, (content) => ({ content: { ...content, flags: { [chatId]: 'red' } }, result: undefined }));
        await expect(failingFiles()).rejects.toBe(FAILED);
        expect((await store.read(chatsId)).flags).toEqual({ [chatId]: 'red' });
        expect((await store.read(await vinylId())).flags ?? {}).toEqual({});
    });

    test('keeps the place of the chat among the others when a Chats write has to be undone', async () => {
        const second = (await newScratchChat(store, {})).viewId;
        const order = await viewIds(chatsId);
        await expect(failingFiles()).rejects.toBe(FAILED);
        expect(await viewIds(chatsId)).toEqual(order);
        expect(order).toContain(second);
    });
    describe('after the work is done', () => {
        test('a journal that cannot be dropped does not undo the move', async () => {
            const result = await moveChat(
                { chatId, to: make('vinyl'), ownFiles: 'move' },
                deps(() => ({ journal: { begin: () => Promise.resolve(), end: () => Promise.reject(FAILED) } }))
            );
            expect(await viewIds(result.summary.projectId)).toEqual([chatId]);
            expect(await viewIds(chatsId)).not.toContain(chatId);
            expect(daemon.chats.get(chatId)!.info.cwd).toBe(join(root, 'vinyl'));
        });

        test('a successful move is told as done once the chat is in its project', async () => {
            const told: string[] = [];
            await moveChat(
                { chatId, to: make('vinyl'), ownFiles: 'move' },
                deps(() => ({ moved: (id) => void told.push(id) }))
            );
            expect(told).toEqual([chatId]);
        });

        test('a move that failed before the chat was in its project tells nothing', async () => {
            const told: string[] = [];
            await expect(failingFiles({ moved: (id) => void told.push(id) })).rejects.toBe(FAILED);
            expect(told).toEqual([]);
        });

        test('a record that cannot take the new folder takes nothing back and leaves the journal for the next start', async () => {
            const told: string[] = [];
            await expect(
                moveChat(
                    { chatId, to: make('vinyl'), ownFiles: 'move' },
                    deps((base) => ({
                        moved: (id) => void told.push(id),
                        chats: {
                            ...base.chats,
                            relocate: async (id, cwd, during) => {
                                await base.chats.relocate(id, cwd, during);
                                throw FAILED;
                            }
                        }
                    }))
                )
            ).rejects.toMatchObject({ code: 'move-failed', message: expect.stringContaining('finishes the move the next time it starts') });
            expect(told).toEqual([chatId]);
            const targetId = await vinylId();
            expect(await viewIds(targetId)).toEqual([chatId]);
            expect(await viewIds(chatsId)).not.toContain(chatId);
            expect(journal.pending()).toEqual([expect.objectContaining({ chatId, to: targetId })]);
        });

        test('a summary that cannot be read still answers with the project to follow the chat into', async () => {
            const result = await moveChat(
                { chatId, to: make('vinyl'), ownFiles: 'leave' },
                deps((base) => ({ projects: { ...base.projects, summary: () => Promise.reject(FAILED) } }))
            );
            expect(result).toMatchObject({ viewId: chatId, summary: { name: 'vinyl', folder: join(root, 'vinyl') } });
            expect(result.summary.projectId).toBe(await vinylId());
        });
    });

    test('a message that came after the last look but before the Chats write stops the move and puts everything back', async () => {
        await expect(
            moveChat(
                { chatId, to: make('vinyl'), ownFiles: 'move' },
                deps((base) => ({ refusal: (id, recheck) => (recheck === true ? { reason: 'messages' } : base.refusal(id)) }))
            )
        ).rejects.toMatchObject({ code: 'move-refused' });
        await expectUntouched();
    });

    test('a link into Chats is Chats', async () => {
        const other = join(store.scratchFolder, 'chat-other');
        await mkdir(other);
        const link = join(root, 'link');
        await symlink(other, link);
        for (const folder of [link, join(link, 'sub')]) {
            await expect(moveChat({ chatId, to: { folder, name: 'x', createFolder: true, initGit: false }, ownFiles: 'leave' }, deps())).rejects.toMatchObject({
                code: 'move-failed'
            });
        }
        await expectUntouched();
    });

    describe('a snooze on the chat', () => {
        const snoozes = (): SnoozeStore => new SnoozeStore({ clock: new ManualClock() });

        test('goes to the project with the chat', async () => {
            const store2 = snoozes();
            store2.set(chatsId, chatId, 10 ** 15);
            const result = await moveChat(
                { chatId, to: make('vinyl'), ownFiles: 'leave' },
                deps(() => ({ snoozes: store2 }))
            );
            expect(store2.list()).toEqual([{ projectId: result.summary.projectId, nodeId: chatId, until: 10 ** 15 }]);
        });

        test('stays in Chats when the move is taken back', async () => {
            const store2 = snoozes();
            store2.set(chatsId, chatId, 10 ** 15);
            await expect(failingFiles({ snoozes: store2 })).rejects.toBe(FAILED);
            expect(store2.list()).toEqual([{ projectId: chatsId, nodeId: chatId, until: 10 ** 15 }]);
        });
    });

    describe('while the chat is on its way', () => {
        test('it cannot be forked, summarized or continued on another account', async () => {
            let release: () => void = () => undefined;
            const gate = new Promise<void>((resolve) => (release = resolve));
            let reached: () => void = () => undefined;
            const inside = new Promise<void>((resolve) => (reached = resolve));
            const moving = moveChat(
                { chatId, to: make('vinyl'), ownFiles: 'move' },
                deps(() => ({
                    moveOwnFiles: async (from, to) => {
                        reached();
                        await gate;
                        return moveOwnFiles(from, to);
                    }
                }))
            );
            await inside;
            const turnId = daemon.chats
                .get(chatId)!
                .thread.list()
                .find((item) => item.kind === 'turn')!.id;
            for (const [type, payload] of [
                ['chat.fork', { chatId, turnId }],
                ['chat.summarize', { chatId }],
                ['chat.continueOn', { chatId, account: 'other' }]
            ] as const) {
                expect(await daemon.request(type, payload)).toMatchObject({ ok: false, error: { code: 'chat-busy' } });
            }
            release();
            await moving;
        });
    });
});
