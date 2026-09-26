import type {
    AgentKind,
    ChatAttachmentUpload,
    ChatAttachResult,
    ChatBookmark,
    ChatPreferencesPayload,
    ChatSkill,
    ModelSelection,
    ProviderInfo,
    RuntimeMode
} from '@ruimte/agent-contracts';
import { MountedRegistry, type MountedEntry } from '../mounted-registry';
import type { ChatSink } from '../state/chats';
import { isConnectionError, type ChatTransport, type ChatTransportStatus } from '../transport';

interface ChatOpenOptions {
    /* Which agent CLI answers; a chat that exists on the host keeps its own. */
    provider?: AgentKind;
    /* The account of that CLI; a chat that exists on the host keeps its own. */
    account?: string;
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
    /* Chats of the project picked with `@`; only their ids travel, the agent reads them itself. */
    chats?: string[];
    attachments?: ChatAttachmentUpload[];
}

interface Mounted extends ChatOpenOptions, MountedEntry {
    // The last place in the chat's stream the store holds, so a reattach asks only for what came after.
    seq?: number;
}

interface ProviderSink {
    setProviders(providers: ProviderInfo[]): void;
}

/*
 * One chat per chat id on one host. A chat opens on mount and detaches on unmount, and every mounted
 * chat is attached again when the transport comes back. The provider list is fetched once per
 * connection and handed to its own store. The transport it is given never changes hosts, so a
 * reattach stays on the host these chats run on.
 */
export class ChatClient {
    private readonly transport: ChatTransport;
    private readonly sink: ChatSink;
    private readonly providers: ProviderSink | null;
    private readonly mounted = new MountedRegistry<Mounted>();
    private readonly unsubscribe: Array<() => void> = [];
    private preferences: ChatPreferencesPayload | null = null;

    constructor(transport: ChatTransport, sink: ChatSink, providers: ProviderSink | null = null) {
        this.transport = transport;
        this.sink = sink;
        this.providers = providers;
        this.unsubscribe.push(
            transport.on('chat.event', ({ chatId, event, seq }) => {
                this.sink.apply(chatId, event);
                const entry = this.mounted.get(chatId);
                if (entry && seq !== undefined) {
                    entry.seq = seq;
                }
            }),
            // Every chat on the machine, attached or not, so a node waiting on a person says so on a view nobody has open.
            transport.on('chat.status', ({ chatId, info }) => this.sink.status(chatId, info)),
            transport.on('chat.bookmarks', ({ chatId, bookmarks }) => this.sink.bookmarks(chatId, bookmarks)),
            transport.subscribeStatus((status) => this.onStatus(status))
        );
        if (transport.status === 'open') {
            void this.loadProviders();
            void this.loadStatuses();
        }
    }

    private readonly inspections = new Map<string, Promise<ChatAttachResult>>();

    inspect(chatId: string): Promise<ChatAttachResult> {
        const pending = this.inspections.get(chatId);
        if (pending) {
            return pending;
        }
        const read = this.transport.request('chat.attach', { chatId, historyLimit: 100 }).finally(async () => {
            this.inspections.delete(chatId);
            // A visible chat owns its attachment; an inspection must never release it.
            if (!this.mounted.get(chatId)) {
                await this.transport.request('chat.detach', { chatId }).catch(() => undefined);
            }
        });
        this.inspections.set(chatId, read);
        return read;
    }

    /* Answers false when the transport is not connected; the chat opens once it is. */
    async open(chatId: string, options: ChatOpenOptions): Promise<boolean> {
        this.mounted.set(chatId, { ...options, attached: false });
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
     * Points a chat that has not spoken yet at another CLI. The host fixes a chat's provider when
     * it registers the chat, so the only way over is to drop the empty one and register it again.
     */
    async retarget(chatId: string, provider: AgentKind, selection: ModelSelection): Promise<void> {
        const entry = this.mounted.get(chatId);
        if (!entry) {
            return;
        }
        // The account belonged to the CLI the chat leaves.
        const { attached: _attached, account: _account, ...options } = entry;
        this.mounted.delete(chatId);
        await this.transport.request('chat.kill', { chatId });
        this.sink.forget(chatId);
        await this.open(chatId, { ...options, provider, selection });
    }

    /*
     * Tells the host what a chat it starts on its own is made with while this socket is connected,
     * since no client mounting that chat sends a composer preference. Said again on every fresh socket.
     */
    setPreferences(preferences: ChatPreferencesPayload): void {
        this.preferences = preferences;
        this.sendPreferences();
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

    /* Current hosts return the stable turn id; older compatible ones only report whether the message queued. */
    async send(chatId: string, text: string, extras: ChatSendExtras = {}): Promise<{ queued: boolean; turnId?: string }> {
        return this.transport.request('chat.send', {
            chatId,
            text,
            mentions: extras.mentions,
            skills: extras.skills,
            chats: extras.chats,
            attachments: extras.attachments
        });
    }

    /* Marks a message; the list every client of the chat holds comes back as `chat.bookmarks`. */
    async addBookmark(chatId: string, itemId: string, name?: string): Promise<ChatBookmark[]> {
        const { bookmarks } = await this.transport.request('chat.addBookmark', { chatId, itemId, ...(name === undefined ? {} : { name }) });
        return bookmarks;
    }

    /* An empty name takes the name away. */
    async renameBookmark(chatId: string, itemId: string, name: string): Promise<ChatBookmark[]> {
        const { bookmarks } = await this.transport.request('chat.renameBookmark', { chatId, itemId, name });
        return bookmarks;
    }

    async removeBookmark(chatId: string, itemId: string): Promise<ChatBookmark[]> {
        const { bookmarks } = await this.transport.request('chat.removeBookmark', { chatId, itemId });
        return bookmarks;
    }

    /* What this chat's CLI would run as a skill, for the composer's `$` picker. */
    async listSkills(chatId: string): Promise<ChatSkill[]> {
        const { skills } = await this.transport.request('skills.list', { chatId });
        return skills;
    }

    /* Starts the chat over; refused with `chat-busy` while a turn runs, unless `force` stops that turn. */
    async clear(chatId: string, force = false): Promise<void> {
        await this.transport.request('chat.clear', { chatId, ...(force ? { force: true } : {}) });
    }

    async kill(chatId: string): Promise<void> {
        this.mounted.delete(chatId);
        this.sink.forget(chatId);
        await this.transport.request('chat.kill', { chatId });
    }

    /*
     * What every chat on this machine is doing right now. `chat.status` only carries a change, so a
     * window that just opened or came back from a lost socket asks for the standing answer.
     */
    async loadStatuses(): Promise<void> {
        try {
            const { chats } = await this.transport.request('chat.list', {});
            for (const info of chats) {
                this.sink.status(info.chatId, info);
            }
        } catch {
            // The next status event says it instead; an older host never answers this at all.
        }
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

    /* Lets go of the machine; the chats keep running there, the host only stops streaming them here. */
    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
        for (const chatId of [...this.mounted.keys()]) {
            void this.detach(chatId);
        }
    }

    /*
     * A reattach offers the last seq the store holds. The host answers only what came after it when
     * it still has all of that, and the whole thread otherwise, so a short drop costs a few events.
     */
    private async attach(chatId: string): Promise<void> {
        const entry = this.mounted.get(chatId);
        await this.transport.request('chat.create', {
            chatId,
            provider: entry?.provider,
            account: entry?.account,
            cwd: entry?.cwd,
            resume: entry?.resume,
            selection: entry?.selection,
            runtimeMode: entry?.runtimeMode
        });
        const since = entry?.seq;
        const result = await this.transport.request('chat.attach', { chatId, ...(since === undefined ? {} : { since }) });
        const current = this.mounted.get(chatId);
        if (!current) {
            return;
        }
        current.attached = true;
        if (result.seq !== undefined) {
            current.seq = result.seq;
        }
        if (result.events && since !== undefined && current === entry) {
            for (const event of result.events) {
                this.sink.apply(chatId, event);
            }
        } else {
            this.sink.reset(chatId, result.info, result.items);
        }
        // A host without bookmarks sends none, and then this chat has none.
        this.sink.bookmarks(chatId, result.bookmarks ?? []);
    }

    private sendPreferences(): void {
        if (this.preferences === null) {
            return;
        }
        void this.transport.request('chat.setPreferences', this.preferences).catch(() => undefined);
    }

    private onStatus(status: ChatTransportStatus): void {
        if (status === 'open') {
            this.sendPreferences();
            void this.loadProviders();
            void this.loadStatuses();
            void this.mounted.reattachAll((chatId) => this.attach(chatId).then(() => undefined));
            return;
        }
        this.mounted.detachAll();
    }
}
