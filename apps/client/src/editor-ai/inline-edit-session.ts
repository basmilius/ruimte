import i18next from 'i18next';
import { createStore, type StoreApi } from 'zustand';
import type { AgentKind, ProjectNewInlineChatPayload, ProjectNewInlineChatResult } from '@ruimte/contracts';
import type { Editor, EditorRange, EditorTrackedRange } from '@adecore/editor';
import { waitingRequestsOf, type ChatState } from '@adecore/agents-react/state/chats';
import type { DiskText } from '@/state/text-drafts';
import { inlineMessage } from './inline-message';
import { endOfInsertion, fitReplacement, locateSelection, parseAnswer, replaceRange, type InlineProblem, type LineSpan } from '@adecore/editor-react/models';
import type { InlineEditRecord } from './inline-edit-record';

export type InlinePhase = 'running' | 'proposal' | 'answer' | 'failed' | 'stopped';

export interface InlineEditState {
    phase: InlinePhase;
    instruction: string;
    provider: AgentKind;
    model: string | null;
    /* The lines as they stand now, which a tracked range keeps up while an editor is attached. */
    range: EditorRange;
    selectedText: string;
    /* The new text of the selection, fitted to its line breaks; null while there is none. */
    proposal: string | null;
    /* What the agent said: about the proposal, or the whole answer when it had none. */
    answer: string;
    startedAt: number;
    endedAt: number | null;
    /* The selected text is no longer where it was, so nothing can be applied to it. */
    stale: boolean;
    /* The chat waits on a person, which only the chat itself can answer. */
    needsYou: boolean;
    error: string | null;
    /* Whether the card is drawn; a closed card keeps its session, which the Code menu shows again. */
    shown: boolean;
    /* Counts the times the card was asked to take the keyboard: shown again, or a new turn. */
    focusRequest: number;
    /* Whether an editor draws this session, as opposed to one whose tab was closed. */
    attached: boolean;
    /* Set once the session is over, which is when whatever draws it lets go. */
    closed: boolean;
}

export type ApplyOutcome = 'applied' | 'stale' | 'readonly' | 'nothing';

export interface InlineEditDeps {
    now(): number;
    newChat(payload: ProjectNewInlineChatPayload): Promise<ProjectNewInlineChatResult>;
    /* Attaches this client to the chat, which is what fills the thread it reads. */
    openChat(chatId: string, provider: AgentKind): Promise<void>;
    readChat(chatId: string): ChatState | undefined;
    watchChat(chatId: string, listener: (chat: ChatState | undefined) => void): () => void;
    /* Answers the id of the turn the message opened, or null when the host did not say. */
    send(chatId: string, text: string, mentions: string[]): Promise<string | null>;
    /* Stops the turn that runs; the chat stays. */
    stopChat(chatId: string): Promise<void>;
    /* Lets go of the chat without a word to the machine, since it is about to be removed. */
    releaseChat(chatId: string): void;
    removeChat(projectId: string, viewId: string): Promise<void>;
    showChat(projectId: string, viewId: string): Promise<void>;
    focusChat(chatId: string): void;
    viewExists(projectId: string, viewId: string): boolean;
    /* The file as a draft holds it, or as the machine has it; null when it is not a text file. */
    readFile(path: string): Promise<DiskText | null>;
    stageFile(path: string, disk: DiskText, text: string): void;
    saveRecord(record: InlineEditRecord): InlineEditRecord | null;
    forgetRecord(path: string, chatId: string): void;
    notify(toast: { kind: 'success' | 'error'; title: string; description?: string; action?: { label: string; run: () => void } }): void;
}

export interface InlineEditInit {
    readonly projectId: string;
    /* The absolute path the editor knows its file by. */
    readonly path: string;
    /* The path as the project stores it: what the agent is told and a mention names. */
    readonly storedPath: string;
    /* The highlighter id of the file's language, null for plain text. */
    readonly language: string | null;
    readonly range: EditorRange;
    readonly selectedText: string;
    readonly span: LineSpan;
    readonly problems: readonly InlineProblem[];
    readonly provider: AgentKind;
    readonly model: string | null;
    readonly account?: string;
}

/* A turn as the chat shows it now. */
export interface TurnOutcome {
    readonly state: 'running' | 'done' | 'aborted' | 'error';
    readonly text: string;
    readonly error: string | null;
    readonly startedAt: number | null;
    readonly endedAt: number | null;
    readonly needsYou: boolean;
}

/* A turn that is not in the thread yet counts as running, since the host writes it the moment it takes the message. */
export function turnOutcome(chat: ChatState, turnId: string): TurnOutcome {
    const turn = chat.items[turnId];
    const items = chat.order.map((id) => chat.items[id]).filter((item) => item?.turnId === turnId);
    const text = items
        .filter((item) => item?.kind === 'assistant' && !item.parentToolUseId)
        .map((item) => (item?.kind === 'assistant' ? item.text.trim() : ''))
        .filter((part) => part !== '')
        .join('\n\n');
    const note = items.find((item) => item?.kind === 'note' && item.level === 'error');
    return {
        state: turn?.kind === 'turn' ? turn.state : 'running',
        text,
        error: note?.kind === 'note' ? note.text : null,
        startedAt: turn?.kind === 'turn' ? turn.createdAt : null,
        endedAt: turn?.kind === 'turn' ? turn.endedAt : null,
        needsYou: waitingRequestsOf(chat).length > 0
    };
}

/* The newest turn of a thread, which is the one a restored card reads its answer from. */
export function lastTurnId(chat: ChatState): string | null {
    for (const id of [...chat.order].reverse()) {
        if (chat.items[id]?.kind === 'turn') {
            return id;
        }
    }
    return null;
}

const sessions = new Map<string, InlineEditSession>();

function sessionKey(endpointId: string, path: string): string {
    return `${endpointId}\0${path}`;
}

/* Lets go of every session without a word to the machine, which is how a test starts from nothing. */
export function forgetInlineSessions(): void {
    for (const session of sessions.values()) {
        session.dispose();
    }
    sessions.clear();
}

/* The inline edit a file has on this machine, whether or not an editor draws it right now. */
export function inlineSessionOf(endpointId: string, path: string): InlineEditSession | null {
    return sessions.get(sessionKey(endpointId, path)) ?? null;
}

/*
 * One inline edit: a hidden chat that answers for some selected lines, and what this client does with
 * the answer. It outlives the editor that started it, so closing the tab while the agent works loses
 * nothing: the answer waits for the next editor of that file, or is applied to the draft from a toast.
 */
export class InlineEditSession {
    readonly store: StoreApi<InlineEditState>;
    readonly endpointId: string;
    private readonly deps: InlineEditDeps;
    private readonly init: InlineEditInit;
    private chatId: string | null = null;
    private viewId: string | null = null;
    private turnId: string | null = null;
    private settledTurn: string | null = null;
    private stopWatching: (() => void) | null = null;
    private editor: Editor | null = null;
    private tracked: EditorTrackedRange | null = null;
    private createdAt: number;
    private starting: Promise<void> | null = null;

    constructor(endpointId: string, deps: InlineEditDeps, init: InlineEditInit) {
        this.endpointId = endpointId;
        this.deps = deps;
        this.init = init;
        this.createdAt = deps.now();
        this.store = createStore<InlineEditState>(() => ({
            phase: 'running',
            instruction: '',
            provider: init.provider,
            model: init.model,
            range: init.range,
            selectedText: init.selectedText,
            proposal: null,
            answer: '',
            startedAt: this.createdAt,
            endedAt: null,
            stale: false,
            needsYou: false,
            error: null,
            shown: true,
            focusRequest: 1,
            attached: false,
            closed: false
        }));
    }

    /* A session for the record of an edit this client started before a reload; `restore` reads its chat. */
    static fromRecord(endpointId: string, deps: InlineEditDeps, record: InlineEditRecord, storedPath: string, language: string | null): InlineEditSession {
        const session = new InlineEditSession(endpointId, deps, {
            projectId: record.projectId,
            path: record.path,
            storedPath,
            language,
            range: record.range,
            selectedText: record.selectedText,
            span: { startLine: record.range.start.line + 1, endLine: record.range.end.line + 1 },
            problems: [],
            provider: record.provider,
            model: record.model
        });
        session.chatId = record.chatId;
        session.viewId = record.viewId;
        session.createdAt = record.createdAt;
        session.store.setState({ instruction: record.instruction, startedAt: record.createdAt });
        sessions.set(sessionKey(endpointId, record.path), session);
        return session;
    }

    get path(): string {
        return this.init.path;
    }

    get chat(): string | null {
        return this.chatId;
    }

    /* Draws this session in an editor: its lines are followed through the edits from here on. */
    attach(editor: Editor): void {
        this.editor = editor;
        this.tracked?.dispose();
        const { range, selectedText } = this.store.getState();
        const found = locateSelection(editor.getText(), range, selectedText);
        this.tracked = found === null ? null : editor.trackRange(found);
        this.store.setState({ attached: true, ...(found === null ? { stale: true } : { range: found }) });
    }

    /* The editor is going: the lines are kept as they last stood, and a range that was touched is a selection that changed. */
    detach(): void {
        if (this.editor === null) {
            return;
        }
        const now = this.tracked?.get() ?? null;
        this.tracked?.dispose();
        this.tracked = null;
        this.editor = null;
        this.store.setState({ attached: false, ...(now === null ? { stale: true } : { range: now }) });
    }

    show(): void {
        this.store.setState({ shown: true, focusRequest: this.store.getState().focusRequest + 1 });
    }

    hide(): void {
        this.store.setState({ shown: false });
    }

    /* Where the selected lines are now, or null once an edit touched them. */
    currentRange(): EditorRange | null {
        if (this.editor === null) {
            return this.store.getState().stale ? null : this.store.getState().range;
        }
        const range = this.tracked?.get() ?? null;
        if (range !== null) {
            this.store.setState({ range });
        }
        return range;
    }

    /* Whether the text under the card is still the text the agent was asked about; says so once it is not. */
    checkSelection(): boolean {
        const range = this.currentRange();
        const holds = range !== null && this.editor !== null && this.editor.textInRange(range) === this.store.getState().selectedText;
        if (!holds && !this.store.getState().stale && this.editor !== null) {
            this.store.setState({ stale: true });
        }
        return holds;
    }

    /* The first run: makes the chat and sends the instruction with the selection. */
    start(text: string): Promise<void> {
        this.starting = this.begin(text);
        return this.starting;
    }

    /* Stops the turn that runs; what the agent said so far stays on the card, and the same instruction can run again. */
    async stop(): Promise<void> {
        // A stop pressed while the chat is still being made waits for it, since there is nothing to stop before.
        await this.starting;
        const chatId = this.chatId;
        if (chatId === null || this.store.getState().phase !== 'running') {
            return;
        }
        try {
            await this.deps.stopChat(chatId);
        } catch (e) {
            this.deps.notify({ kind: 'error', title: i18next.t('inline-edit:error.stop'), description: e instanceof Error ? e.message : String(e) });
        }
    }

    /* Sends the last instruction again, in the chat that already holds the selection. */
    rerun(): Promise<void> {
        return this.followUp(this.store.getState().instruction);
    }

    private async begin(text: string): Promise<void> {
        const instruction = text.trim();
        const { provider, model } = this.store.getState();
        this.beginTurn(instruction);
        sessions.set(sessionKey(this.endpointId, this.init.path), this);
        try {
            const made = await this.deps.newChat({
                projectId: this.init.projectId,
                path: this.init.storedPath,
                provider,
                ...(model === null ? {} : { model }),
                ...(this.init.account === undefined ? {} : { account: this.init.account })
            });
            this.chatId = made.chatId;
            this.viewId = made.viewId;
            const replaced = this.deps.saveRecord(this.record());
            if (replaced !== null) {
                void this.deps.removeChat(replaced.projectId, replaced.viewId).catch(() => undefined);
            }
            await this.deps.openChat(made.chatId, provider);
            this.watch();
            this.turnId = await this.deps.send(
                made.chatId,
                inlineMessage({
                    instruction,
                    path: this.init.storedPath,
                    language: this.init.language,
                    span: this.init.span,
                    text: this.store.getState().selectedText,
                    problems: this.init.problems
                }),
                [this.init.storedPath]
            );
            this.read();
        } catch (e) {
            this.fail(e);
        }
    }

    /* Another turn in the same chat; the answer to it takes the place of the proposal. */
    async followUp(text: string): Promise<void> {
        const chatId = this.chatId;
        const instruction = text.trim();
        if (chatId === null || instruction === '' || this.store.getState().phase === 'running') {
            return;
        }
        this.beginTurn(instruction);
        this.deps.saveRecord(this.record());
        try {
            this.turnId = await this.deps.send(chatId, instruction, []);
            this.read();
        } catch (e) {
            this.fail(e);
        }
    }

    /* Reads the chat of a record: the answer if its last turn settled, or the wait for it. */
    async restore(): Promise<void> {
        const chatId = this.chatId;
        if (chatId === null || this.viewId === null) {
            return;
        }
        if (!this.deps.viewExists(this.init.projectId, this.viewId)) {
            this.deps.forgetRecord(this.init.path, chatId);
            this.finish();
            return;
        }
        try {
            await this.deps.openChat(chatId, this.store.getState().provider);
            this.watch();
            const chat = this.deps.readChat(chatId);
            this.turnId = chat === undefined ? null : lastTurnId(chat);
            if (this.turnId === null) {
                this.store.setState({ phase: 'failed', error: i18next.t('inline-edit:error.noAnswer'), endedAt: this.deps.now() });
                return;
            }
            this.read();
        } catch (e) {
            this.fail(e);
        }
    }

    /* Applies the proposal to the selected lines as one step of the editor's history, or to the draft of a file no editor holds. */
    async apply(): Promise<ApplyOutcome> {
        const state = this.store.getState();
        if (state.proposal === null) {
            return 'nothing';
        }
        const outcome = this.editor === null ? await this.applyToDraft(state.proposal) : this.applyToEditor(this.editor, state.proposal);
        if (outcome === 'applied') {
            await this.remove();
        } else if (outcome === 'stale') {
            this.store.setState({ stale: true });
        }
        return outcome;
    }

    /* Takes the chat away with the card: its CLI, its record, its hidden view. */
    async discard(): Promise<void> {
        await this.remove();
    }

    /* Lists the chat as a chat of its own and goes to it; from here on it is the person's conversation. */
    async openAsChat(): Promise<void> {
        const { chatId, viewId } = this;
        if (chatId === null || viewId === null) {
            return;
        }
        try {
            await this.deps.showChat(this.init.projectId, viewId);
        } catch (e) {
            this.deps.notify({ kind: 'error', title: i18next.t('inline-edit:error.open'), description: e instanceof Error ? e.message : String(e) });
            return;
        }
        this.deps.forgetRecord(this.init.path, chatId);
        this.deps.focusChat(chatId);
        this.finish();
    }

    /* The editor lets go and nobody holds the session any more: only its chat watch ends. */
    dispose(): void {
        this.stopWatching?.();
        this.stopWatching = null;
    }

    private applyToEditor(editor: Editor, proposal: string): ApplyOutcome {
        const range = this.currentRange();
        if (range === null || editor.textInRange(range) !== this.store.getState().selectedText) {
            return 'stale';
        }
        if (!editor.applyEdits([{ range, text: proposal }])) {
            return 'readonly';
        }
        editor.setSelection({ start: range.start, end: endOfInsertion(range.start, proposal) });
        editor.focus();
        return 'applied';
    }

    private async applyToDraft(proposal: string): Promise<ApplyOutcome> {
        const file = await this.deps.readFile(this.init.path);
        if (file === null) {
            return 'stale';
        }
        const { range, selectedText } = this.store.getState();
        const found = locateSelection(file.text, range, selectedText);
        const next = found === null ? null : replaceRange(file.text, found, proposal);
        if (next === null) {
            return 'stale';
        }
        this.deps.stageFile(this.init.path, file, next);
        return 'applied';
    }

    private record(): InlineEditRecord {
        const state = this.store.getState();
        return {
            chatId: this.chatId!,
            viewId: this.viewId!,
            projectId: this.init.projectId,
            path: this.init.path,
            range: state.range,
            selectedText: state.selectedText,
            instruction: state.instruction,
            provider: state.provider,
            model: state.model,
            createdAt: this.createdAt
        };
    }

    private beginTurn(instruction: string): void {
        this.settledTurn = null;
        this.turnId = null;
        this.store.setState({
            phase: 'running',
            instruction,
            proposal: null,
            answer: '',
            startedAt: this.deps.now(),
            endedAt: null,
            needsYou: false,
            error: null,
            shown: true,
            focusRequest: this.store.getState().focusRequest + 1
        });
    }

    private watch(): void {
        this.stopWatching?.();
        const chatId = this.chatId!;
        this.stopWatching = this.deps.watchChat(chatId, (chat) => {
            if (chat !== undefined) {
                this.settle(chat);
            }
        });
    }

    private read(): void {
        const chat = this.chatId === null ? undefined : this.deps.readChat(this.chatId);
        if (chat !== undefined) {
            this.settle(chat);
        }
    }

    private settle(chat: ChatState): void {
        const turnId = this.turnId;
        if (turnId === null || this.settledTurn === turnId || this.store.getState().closed) {
            return;
        }
        const outcome = turnOutcome(chat, turnId);
        if (outcome.state === 'running') {
            if (outcome.needsYou !== this.store.getState().needsYou) {
                this.store.setState({ needsYou: outcome.needsYou });
            }
            return;
        }
        this.settledTurn = turnId;
        const endedAt = outcome.endedAt ?? this.deps.now();
        const began = outcome.startedAt ?? this.store.getState().startedAt;
        if (outcome.state === 'aborted') {
            this.store.setState({ phase: 'stopped', needsYou: false, error: null, answer: outcome.text, startedAt: began, endedAt });
            return;
        }
        if (outcome.state !== 'done') {
            this.store.setState({
                phase: 'failed',
                needsYou: false,
                error: outcome.error ?? i18next.t('inline-edit:error.failed'),
                startedAt: began,
                endedAt
            });
            this.announce();
            return;
        }
        const answer = parseAnswer(outcome.text);
        const { selectedText } = this.store.getState();
        this.store.setState({
            phase: answer.replacement === null ? 'answer' : 'proposal',
            proposal: answer.replacement === null ? null : fitReplacement(selectedText, answer.replacement),
            answer: answer.rest,
            needsYou: false,
            startedAt: began,
            endedAt
        });
        if (this.editor !== null) {
            this.checkSelection();
        }
        this.announce();
    }

    /* A card nobody sees gets the news in a toast: Show while an editor has the file, Apply once it has none. */
    private announce(): void {
        const state = this.store.getState();
        if (state.shown && state.attached) {
            return;
        }
        const name = this.init.path.slice(this.init.path.lastIndexOf('/') + 1);
        if (state.phase === 'proposal' && !state.attached) {
            this.deps.notify({
                kind: 'success',
                title: i18next.t('inline-edit:toast.ready', { name }),
                description: state.instruction,
                action: { label: i18next.t('inline-edit:toast.apply'), run: () => void this.applyFromToast() }
            });
            return;
        }
        this.deps.notify({
            kind: state.phase === 'failed' ? 'error' : 'success',
            title: i18next.t(state.phase === 'failed' ? 'inline-edit:toast.failed' : 'inline-edit:toast.answered', { name }),
            description: state.instruction,
            ...(state.attached ? { action: { label: i18next.t('inline-edit:toast.show'), run: () => this.show() } } : {})
        });
    }

    private async applyFromToast(): Promise<void> {
        const outcome = await this.apply();
        if (outcome === 'stale') {
            this.deps.notify({ kind: 'error', title: i18next.t('inline-edit:toast.stale'), description: i18next.t('inline-edit:toast.staleHint') });
        }
    }

    private fail(error: unknown): void {
        this.store.setState({ phase: 'failed', error: error instanceof Error ? error.message : String(error), endedAt: this.deps.now() });
    }

    private async remove(): Promise<void> {
        const { chatId, viewId } = this;
        this.finish();
        if (chatId === null || viewId === null) {
            return;
        }
        this.deps.releaseChat(chatId);
        try {
            await this.deps.removeChat(this.init.projectId, viewId);
            this.deps.forgetRecord(this.init.path, chatId);
        } catch {
            // The record stays, so the next sweep of old edits tries again.
        }
    }

    private finish(): void {
        this.dispose();
        this.tracked?.dispose();
        this.tracked = null;
        const key = sessionKey(this.endpointId, this.init.path);
        if (sessions.get(key) === this) {
            sessions.delete(key);
        }
        this.store.setState({ closed: true, shown: false });
    }
}
