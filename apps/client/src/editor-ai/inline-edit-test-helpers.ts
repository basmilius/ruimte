import type { ChatInfo, ChatItem, ProjectNewInlineChatPayload } from '@ruimte/contracts';
import type { ChatState } from '@ruimte/agents-react/state/chats';
import type { DiskText } from '@/state/text-drafts';
import type { InlineEditRecord } from './inline-edit-record';
import type { InlineEditDeps } from './inline-edit-session';

export const at = (line: number, character: number) => ({ line, character });
export const TEXT = ['function skillOverlap(have, need) {', '  if (need.length === 0) return 1;', '  return hits / need.length;', '}', ''].join('\n');
export const SELECTED = '  if (need.length === 0) return 1;\n  return hits / need.length;';
export const RANGE = { start: at(1, 0), end: at(2, 28) };

/* The app as an inline edit sees it, with a chat the test answers by hand. */
export class Harness {
    readonly chats = new Map<string, ChatState>();
    readonly listeners = new Set<(chat: ChatState | undefined) => void>();
    readonly calls: string[] = [];
    readonly created: ProjectNewInlineChatPayload[] = [];
    readonly sent: Array<{ chatId: string; text: string; mentions: string[] }> = [];
    readonly records = new Map<string, InlineEditRecord>();
    readonly staged: Array<{ path: string; text: string }> = [];
    readonly toasts: Array<{ title: string; action?: string }> = [];
    clock = 1_000;
    views = new Set<string>(['chat-1']);
    file: DiskText | null = { text: TEXT, mtime: 7 };
    turns = 0;

    readonly deps: InlineEditDeps = {
        now: () => this.clock,
        newChat: async (payload) => {
            this.created.push(payload);
            this.calls.push('newChat');
            return { chatId: 'chat-1', viewId: 'chat-1' };
        },
        openChat: async (chatId) => {
            this.calls.push(`open ${chatId}`);
            this.chats.set(chatId, { info: {} as ChatInfo, items: {}, structure: {}, order: [] });
        },
        readChat: (chatId) => this.chats.get(chatId),
        watchChat: (_chatId, listener) => {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        },
        send: async (chatId, text, mentions) => {
            this.sent.push({ chatId, text, mentions });
            const turnId = `turn-${++this.turns}`;
            this.add(chatId, { id: turnId, kind: 'turn', createdAt: this.clock, turnId, state: 'running', endedAt: null, costUsd: 0 } as ChatItem);
            return turnId;
        },
        releaseChat: (chatId) => void this.calls.push(`release ${chatId}`),
        removeChat: async (_projectId, viewId) => {
            this.calls.push(`remove ${viewId}`);
            this.views.delete(viewId);
        },
        showChat: async (_projectId, viewId) => void this.calls.push(`show ${viewId}`),
        focusChat: (chatId) => void this.calls.push(`focus ${chatId}`),
        viewExists: (_projectId, viewId) => this.views.has(viewId),
        readFile: async () => this.file,
        stageFile: (path, _disk, text) => void this.staged.push({ path, text }),
        saveRecord: (record) => {
            const previous = this.records.get(record.path) ?? null;
            this.records.set(record.path, record);
            return previous !== null && previous.chatId !== record.chatId ? previous : null;
        },
        forgetRecord: (path, chatId) => {
            if (this.records.get(path)?.chatId === chatId) {
                this.records.delete(path);
            }
        },
        notify: (toast) => void this.toasts.push({ title: toast.title, ...(toast.action === undefined ? {} : { action: toast.action.label }) })
    };

    add(chatId: string, item: ChatItem): void {
        const chat = this.chats.get(chatId)!;
        const items = { ...chat.items, [item.id]: item };
        this.chats.set(chatId, { ...chat, items, structure: items, order: chat.order.includes(item.id) ? chat.order : [...chat.order, item.id] });
        this.emit(chatId);
    }

    /* The host settles the turn with what the agent said, as one assistant item of that turn. */
    answer(chatId: string, turnId: string, text: string, state: 'done' | 'aborted' | 'error' = 'done'): void {
        this.add(chatId, { id: `${turnId}-text`, kind: 'assistant', createdAt: this.clock, turnId, text, streaming: false } as ChatItem);
        this.add(chatId, { id: turnId, kind: 'turn', createdAt: 1_000, turnId, state, endedAt: this.clock, costUsd: 0 } as ChatItem);
    }

    private emit(chatId: string): void {
        for (const listener of this.listeners) {
            listener(this.chats.get(chatId));
        }
    }
}
