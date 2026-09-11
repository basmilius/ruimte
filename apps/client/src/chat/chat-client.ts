import type {
    AgentKind,
    ChatAttachmentUpload,
    ChatCheckpointDiff,
    ChatConfigurePayload,
    ChatInfo,
    ChatItem,
    ChatSkill,
    FsSearchResult,
    ModelSelection,
    RuntimeMode
} from '@ruimte/contracts';
import type { ChatSink } from '../state/chats';
import { LOCAL_ENDPOINT_ID } from '../state/endpoints';
import type { ProviderInfo } from '@ruimte/contracts';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';

interface ChatOpenOptions {
    /* Which agent CLI answers; a chat that exists on the daemon keeps its own. */
    provider?: AgentKind;
    cwd?: string;
    /* A CLI session to continue, for a chat opened from a terminal that ran the agent. */
    resume?: string;
    /* What a fresh chat starts with; an existing chat keeps what it has. */
    selection?: ModelSelection;
    runtimeMode?: RuntimeMode;
}

export interface ChatSendExtras {
    /* Paths picked with `@`; they also sit in the text, this is what the timeline highlights. */
    mentions?: string[];
    /* Skills picked with `$`; they also sit in the text, this is what the timeline chips. */
    skills?: string[];
    attachments?: ChatAttachmentUpload[];
}

interface Mounted extends ChatOpenOptions {
    attached: boolean;
    /* The daemon this chat runs on; a socket that comes back pointed at another one is not its socket. */
    endpointId: string;
}

interface ProviderSink {
    setProviders(providers: ProviderInfo[]): void;
}

const isConnectionError = (e: unknown): boolean => e instanceof TransportError && (e.code === 'not-connected' || e.code === 'disconnected');

/*
 * One daemon chat per node id. Like the terminal's session client: a node opens on mount and
 * detaches on unmount, and every mounted chat is attached again when the transport comes back.
 * The provider list is fetched once per connection and handed to its own store.
 */
export class ChatClient {
    private readonly transport: Transport;
    private readonly sink: ChatSink;
    private readonly providers: ProviderSink | null;
    private readonly endpointId: () => string;
    private readonly mounted = new Map<string, Mounted>();
    private readonly unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, sink: ChatSink, providers: ProviderSink | null = null, endpointId: () => string = () => LOCAL_ENDPOINT_ID) {
        this.transport = transport;
        this.sink = sink;
        this.providers = providers;
        this.endpointId = endpointId;
        this.unsubscribe.push(
            transport.on('chat.event', ({ chatId, event }) => this.sink.apply(chatId, event)),
            transport.subscribeStatus((status) => this.onStatus(status))
        );
        if (transport.status === 'open') {
            void this.loadProviders();
        }
    }

    /* Answers false when the transport is not connected; the chat opens once it is. */
    async open(chatId: string, options: ChatOpenOptions): Promise<boolean> {
        this.mounted.set(chatId, { ...options, attached: false, endpointId: this.endpointId() });
        try {
            await this.attach(chatId);
            return true;
        } catch (e) {
            if (isConnectionError(e)) {
                return false;
            }
            throw e;
        }
    }

    /*
     * Points a chat that has not spoken yet at another CLI. The daemon fixes a chat's provider when
     * it registers the chat, so the only way over is to drop the empty one and register it again.
     */
    async retarget(chatId: string, provider: AgentKind, selection: ModelSelection): Promise<void> {
        const entry = this.mounted.get(chatId);
        if (!entry) {
            return;
        }
        const { attached: _attached, ...options } = entry;
        this.mounted.delete(chatId);
        await this.transport.request('chat.kill', { chatId });
        this.sink.forget(chatId);
        await this.open(chatId, { ...options, provider, selection });
    }

    async detach(chatId: string): Promise<void> {
        const entry = this.mounted.get(chatId);
        this.mounted.delete(chatId);
        if (!entry?.attached) {
            return;
        }
        try {
            await this.transport.request('chat.detach', { chatId });
        } catch {
            // The socket closing detaches every chat server-side anyway.
        }
    }

    /* Answers whether a turn was still running, so the message went into the chat's queue instead. */
    async send(chatId: string, text: string, extras: ChatSendExtras = {}): Promise<boolean> {
        const { queued } = await this.transport.request('chat.send', {
            chatId,
            text,
            mentions: extras.mentions,
            skills: extras.skills,
            attachments: extras.attachments
        });
        return queued;
    }

    async unqueue(chatId: string, messageId: string): Promise<void> {
        await this.transport.request('chat.unqueue', { chatId, messageId });
    }

    /* Stops the turn in the way and puts this queued message first. */
    async sendNow(chatId: string, messageId: string): Promise<void> {
        await this.transport.request('chat.sendNow', { chatId, messageId });
    }

    /* Files under `cwd` that fuzzy-match `query`, for the composer's mention picker. */
    async searchFiles(cwd: string, query: string, limit = 8): Promise<FsSearchResult> {
        return this.transport.request('fs.search', { cwd, query, limit });
    }

    /* What this chat's CLI would run as a skill, for the composer's `$` picker. */
    async listSkills(chatId: string): Promise<ChatSkill[]> {
        const { skills } = await this.transport.request('skills.list', { chatId });
        return skills;
    }

    async compact(chatId: string): Promise<void> {
        await this.transport.request('chat.compact', { chatId });
    }

    async cancel(chatId: string): Promise<void> {
        await this.transport.request('chat.cancel', { chatId });
    }

    /* What a turn changed against its checkpoint, for a card whose turn carries no diff yet. */
    async turnDiff(chatId: string, turnId: string): Promise<ChatCheckpointDiff | null> {
        const { diff } = await this.transport.request('chat.turnDiff', { chatId, turnId });
        return diff;
    }

    async configure(payload: ChatConfigurePayload): Promise<ChatInfo> {
        const info = await this.transport.request('chat.configure', payload);
        this.sink.apply(payload.chatId, { type: 'info', info });
        return info;
    }

    async approve(chatId: string, requestId: string, decision: 'allow' | 'allow-always' | 'deny', message?: string): Promise<void> {
        await this.transport.request('chat.approve', { chatId, requestId, decision, message });
    }

    async answer(chatId: string, requestId: string, answers: Record<string, string>): Promise<void> {
        await this.transport.request('chat.answer', { chatId, requestId, answers });
    }

    /* Leaves an asynchronous question alone; the agent is not told and the item settles as dismissed. */
    async dismiss(chatId: string, itemId: string): Promise<void> {
        await this.transport.request('chat.dismiss', { chatId, itemId });
    }

    async kill(chatId: string): Promise<void> {
        this.mounted.delete(chatId);
        this.sink.forget(chatId);
        await this.transport.request('chat.kill', { chatId });
    }

    async loadProviders(): Promise<void> {
        if (!this.providers) {
            return;
        }
        try {
            const { providers } = await this.transport.request('provider.list', {});
            this.providers.setProviders(providers);
        } catch {
            // The list comes with the next connection; pickers show what they had.
        }
    }

    isMounted(chatId: string): boolean {
        return this.mounted.has(chatId);
    }

    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
    }

    private async attach(chatId: string): Promise<{ info: ChatInfo; items: ChatItem[] }> {
        const entry = this.mounted.get(chatId);
        await this.transport.request('chat.create', {
            chatId,
            provider: entry?.provider,
            cwd: entry?.cwd,
            resume: entry?.resume,
            selection: entry?.selection,
            runtimeMode: entry?.runtimeMode
        });
        const result = await this.transport.request('chat.attach', { chatId });
        const current = this.mounted.get(chatId);
        if (current) {
            current.attached = true;
            this.sink.reset(chatId, result.info, result.items);
        }
        return result;
    }

    private onStatus(status: TransportStatus): void {
        if (status === 'open') {
            void this.loadProviders();
            void this.reattachAll();
            return;
        }
        for (const entry of this.mounted.values()) {
            entry.attached = false;
        }
    }

    private async reattachAll(): Promise<void> {
        for (const [chatId, entry] of [...this.mounted]) {
            if (entry.attached) {
                continue;
            }
            // The socket that just opened belongs to another daemon; this chat is not there, and creating it would be a second one.
            if (entry.endpointId !== this.endpointId()) {
                this.mounted.delete(chatId);
                continue;
            }
            try {
                await this.attach(chatId);
            } catch {
                // A socket that dropped again will trigger the next round.
            }
        }
    }
}
