import { join, relative } from 'node:path';
import { runningInBackground } from '@adecore/agents/chat';
import type { AgentEvent } from '@adecore/agents/host';
import { isWithin } from '@adecore/utils/path';
import type { ChatItem, ChatTurnItem, LaunchStatus } from '@ruimte/contracts';
import { z } from 'zod';
import type { ChatManager } from '../chat/chat-manager.ts';
import { errorText } from '../error-text.ts';
import { JsonFileStore } from '../json-file-store.ts';
import type { OutboxEntry, OutboxWork, RunAfterSettleEntry } from '../outbox/outbox.ts';
import type { LaunchRunner, WorktreeRun } from './runner.ts';
import type { AfterSettleChoices, LaunchStore, ResolvedLaunch } from './store.ts';

const FileSchema = z.object({
    // The task each project runs after a worktree chat settles, and when a person chose it.
    choices: z.record(z.string(), z.object({ launchId: z.string().min(1), chosenAt: z.number() })),
    // The last settled turn each chat ran its project's task for, so neither an event nor a restart runs it twice.
    handled: z.record(z.string(), z.object({ projectId: z.string().min(1), turnId: z.string().min(1) }))
});
type AfterSettleFile = z.infer<typeof FileSchema>;

/*
 * What a person chose to run after a worktree chat settles, and what already ran. Under `$RUIMTE_HOME`
 * and never in a project file: an agent with a shell can rewrite `project.json`, and only a person's
 * choice here makes the daemon start anything.
 */
export class AfterSettleStore implements AfterSettleChoices {
    private readonly store: JsonFileStore<AfterSettleFile>;
    private readonly now: () => number;
    private readonly file: AfterSettleFile;

    constructor(options: { path?: string; now?: () => number } = {}) {
        this.store = new JsonFileStore(options.path, FileSchema, 'no launch runs after a chat settles until a person chooses one again');
        this.now = options.now ?? Date.now;
        this.file = this.store.read() ?? { choices: {}, handled: {} };
    }

    choiceOf(projectId: string): { launchId: string; chosenAt: number } | null {
        return this.file.choices[projectId] ?? null;
    }

    async choose(projectId: string, launchId: string | null): Promise<void> {
        if (launchId === null) {
            delete this.file.choices[projectId];
        } else {
            this.file.choices[projectId] = { launchId, chosenAt: this.now() };
        }
        this.save();
    }

    handledTurn(chatId: string): string | null {
        return this.file.handled[chatId]?.turnId ?? null;
    }

    markHandled(projectId: string, chatId: string, turnId: string): void {
        this.file.handled[chatId] = { projectId, turnId };
        this.save();
    }

    /* For `ProjectIndex.onPlaces`: a chat that left its project takes what it ran along. */
    places(projectId: string, ids: ReadonlySet<string>): void {
        const leaving = Object.entries(this.file.handled).filter(([chatId, entry]) => entry.projectId === projectId && !ids.has(chatId));
        for (const [chatId] of leaving) {
            delete this.file.handled[chatId];
        }
        if (leaving.length > 0) {
            this.save();
        }
    }

    private save(): void {
        this.store.write(this.file);
    }
}

export interface AfterSettleDeps {
    store: AfterSettleStore;
    chats: Pick<ChatManager, 'get' | 'isLoading' | 'deliverNote'>;
    launches: Pick<LaunchStore, 'inWorktree'>;
    runner: Pick<LaunchRunner, 'startIn'>;
    /* The project that places a chat node; null for none. */
    projectOf(chatId: string): string | null;
    /* Whether another machine gave this chat its task, which never starts a command of this machine's project on its own. */
    isPeerChat(chatId: string): boolean;
    folderOf(projectId: string): string | null;
    /* The worktrees of the repository the folder is in, without the main checkout and without one that is gone. */
    worktreesOf(folder: string): Promise<string[]>;
    /* The top of the repository the folder is in. */
    repoRootOf(folder: string): Promise<string>;
    entries(): readonly OutboxEntry[];
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
}

function lastTurn(items: readonly ChatItem[]): ChatTurnItem | null {
    return items.findLast((item): item is ChatTurnItem => item.kind === 'turn') ?? null;
}

/* What a turn of the chat leaves the agent to read about the run, said in the words its launches tool takes. */
function endedPreamble(name: string, launchId: string, status: LaunchStatus): string {
    return `${endedText(name, status)} It ran in your worktree after your last turn; launch_read ${launchId} shows its output.`;
}

function endedText(name: string, status: LaunchStatus): string {
    if (status.stopped) {
        return `${name} was stopped.`;
    }
    return status.exitCode === null ? `${name} ended with its project.` : `${name} ended with exit code ${status.exitCode}.`;
}

/*
 * Runs a project's chosen task in a chat's worktree once that chat settles: its last turn ended done,
 * with nothing in the background, no goal holding it, nothing queued and nothing waiting on a person.
 * Hearing that only owes a `run-after-settle` entry; the outbox starts the task, once per settled turn,
 * and the chat gets notes, never a wake.
 */
export class AfterSettleLaunches {
    private readonly deps: AfterSettleDeps;
    // Turns being owed right now, so two events of one settle owe it once.
    private readonly owing = new Set<string>();
    // Settled turns of chats outside any worktree, so the events after one ask git nothing again.
    private readonly outside = new Set<string>();

    constructor(deps: AfterSettleDeps) {
        this.deps = deps;
    }

    chatEvent(event: AgentEvent): void {
        if (event.event !== 'chat.event') {
            return;
        }
        const { chatId } = event.payload;
        if (this.deps.chats.isLoading(chatId)) {
            return;
        }
        void this.consider(chatId).catch((e: unknown) => console.error(`Owing the launch after ${chatId} settled failed:`, errorText(e)));
    }

    async handle(entry: RunAfterSettleEntry): Promise<void> {
        const { store, chats } = this.deps;
        const { turnId, launchId, worktree } = entry.payload;
        const chatId = entry.target;
        if (this.deps.isPeerChat(chatId)) {
            return;
        }
        // A person who chose another task or none since takes this one along, as does a worktree that went.
        if (store.handledTurn(chatId) === turnId || store.choiceOf(entry.projectId)?.launchId !== launchId) {
            return;
        }
        const folder = this.deps.folderOf(entry.projectId);
        const worktrees = folder === null ? [] : await this.deps.worktreesOf(folder);
        if (folder === null || !worktrees.includes(worktree)) {
            return;
        }
        // Written before the start, so a restart in between misses a run rather than run it twice.
        store.markHandled(entry.projectId, chatId, turnId);
        const note = (suffix: string, text: string, preamble = text): Promise<boolean> =>
            chats.deliverNote(chatId, { noteId: `after-settle-${turnId}-${suffix}`, note: text, preamble });
        let resolved: ResolvedLaunch;
        let run: WorktreeRun;
        try {
            const projectFolder = join(worktree, relative(await this.deps.repoRootOf(folder), folder));
            resolved = await this.deps.launches.inWorktree(entry.projectId, launchId, projectFolder);
            if (!resolved.approved) {
                await note(
                    'held',
                    `${resolved.launch.name} did not run in this worktree: it waits until a person approves its command and environment again in the launch menu.`
                );
                return;
            }
            run = await this.deps.runner.startIn(resolved, worktree);
        } catch (e) {
            // Marked already, so the outbox trying again would run nothing; the chat hears why instead.
            await note('failed', `The launch chosen to run after this turn did not start in this worktree: ${errorText(e)}`);
            return;
        }
        const name = resolved.launch.name;
        if (run.outcome === 'running') {
            await note('busy', `${name} did not run in this worktree after this turn: it was already running.`);
            return;
        }
        await note('started', `${name} started in this worktree after this turn.`);
        void run.ended
            .then((status) => note('ended', endedText(name, status), endedPreamble(name, launchId, status)))
            .catch((e: unknown) => console.error(`Noting how ${name} ended in ${chatId} failed:`, errorText(e)));
    }

    private async consider(chatId: string): Promise<void> {
        if (this.deps.isPeerChat(chatId)) {
            return;
        }
        const projectId = this.deps.projectOf(chatId);
        const choice = projectId === null ? null : this.deps.store.choiceOf(projectId);
        const turn = choice === null ? null : this.settledTurn(chatId);
        if (projectId === null || choice === null || turn === null || (turn.endedAt ?? 0) < choice.chosenAt) {
            return;
        }
        const key = `${chatId}\t${turn.id}`;
        if (this.deps.store.handledTurn(chatId) === turn.id || this.owing.has(key) || this.outside.has(key) || this.owes(chatId, turn.id)) {
            return;
        }
        this.owing.add(key);
        try {
            const worktree = await this.worktreeOf(projectId, chatId);
            if (worktree === null) {
                this.outside.add(key);
                return;
            }
            await this.deps.enqueue(projectId, chatId, { kind: 'run-after-settle', payload: { turnId: turn.id, launchId: choice.launchId, worktree } });
        } finally {
            this.owing.delete(key);
        }
    }

    /* The chat's last turn when the chat has settled on it; null while anything still holds the chat. */
    private settledTurn(chatId: string): ChatTurnItem | null {
        const chat = this.deps.chats.get(chatId);
        if (!chat) {
            return null;
        }
        const { info } = chat;
        const held =
            info.activeTurnId !== null ||
            info.status === 'needs-you' ||
            (info.requests ?? []).length > 0 ||
            info.goal?.status === 'active' ||
            (info.background ?? []).length > 0 ||
            (info.queue ?? []).length > 0 ||
            info.delegating === true;
        if (held) {
            return null;
        }
        const items = chat.thread.list();
        const turn = lastTurn(items);
        return turn?.state === 'done' && runningInBackground(items).length === 0 ? turn : null;
    }

    private owes(chatId: string, turnId: string): boolean {
        return this.deps.entries().some((entry) => entry.kind === 'run-after-settle' && entry.target === chatId && entry.payload.turnId === turnId);
    }

    private async worktreeOf(projectId: string, chatId: string): Promise<string | null> {
        const folder = this.deps.folderOf(projectId);
        const cwd = this.deps.chats.get(chatId)?.info.cwd;
        if (folder === null || cwd === undefined) {
            return null;
        }
        const worktrees = await this.deps.worktreesOf(folder);
        return worktrees.find((path) => isWithin(path, cwd)) ?? null;
    }
}
