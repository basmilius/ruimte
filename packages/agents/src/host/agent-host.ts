import {
    AGENT_REQUEST_SCHEMAS,
    parseRequest,
    type AgentKind,
    type AgentRequestType,
    type FramePort,
    type ReplyError,
    type UsageProvider
} from '@ruimte/agent-contracts';
import { AttachmentStore } from '../chat/attachment-store.ts';
import { BookmarkStore } from '../chat/bookmark-store.ts';
import { ChatCore } from '../chat/chat-core.ts';
import type { SpawnChatProcess } from '../chat/chat-process.ts';
import { ChatStore } from '../chat/chat-store.ts';
import { suggestChatTitle } from '../chat/chat-title.ts';
import { ClaudeTitleReader } from '../chat/claude-title.ts';
import { DEFAULT_CODEX_CLIENT, type CodexClientInfo } from '../chat/codex-transport.ts';
import { CodedError } from '../coded-error.ts';
import { errorText } from '../error-text.ts';
import type { AgentEvent } from '../events.ts';
import { definedEnv } from '../providers/accounts/launch.ts';
import { ProviderAccountsService } from '../providers/accounts/service.ts';
import type { AccountsHost } from '../providers/accounts/variables.ts';
import { createClaudeProvider } from '../providers/claude-provider.ts';
import { createCodexProvider } from '../providers/codex-provider.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { chatSessionAccounts, limitAccountsOf, usageAccountsOf, usageRootsOf } from '../usage/accounts.ts';
import { UsageMonitor } from '../usage/limits/monitor.ts';
import { UsageService } from '../usage/usage-service.ts';
import { cliEnvironment } from './environment.ts';
import { accountHandlers, chatHandlers, usageHandlers, type AgentHandler, type AgentHandlers } from './handlers.ts';

export interface AgentHostOptions {
    // Where the chats, their attachments and bookmarks, the accounts and the usage index are kept.
    dataDir: string;
    // The environment the CLIs start in; absent, this process's own through `cliEnvironment`.
    env?: Record<string, string | undefined>;
    // What every agent is told once, at the start of its process.
    systemNote?: string;
    // How the host names itself: to Codex, in a refusal about an account, and in the keychain.
    client?: CodexClientInfo;
    accountsHost?: AccountsHost;
    // Whether the host checks who is signed in and reads what is left of each plan on its own clock.
    background?: boolean;
    // A test runs fake CLIs: the commands to start and how.
    command?: string[];
    codexCommand?: string[];
    spawn?: SpawnChatProcess;
}

const errorReply = (id: string | null, code: string, message: string): ReplyError => ({ id, ok: false, error: { code, message } });

const isAgentRequest = (type: string): type is AgentRequestType => Object.hasOwn(AGENT_REQUEST_SCHEMAS, type);

/*
 * The chats of an app that has no daemon: it answers the agent requests over any `FramePort` and
 * sends the agent events back on it, frames checked on arrival the way Ruimte's daemon checks a
 * socket's. One port is one client. Closing the host writes every thread and ends every CLI; a chat
 * goes on at the next start through its CLI's own session.
 */
export class AgentHost {
    readonly chats: ChatCore;
    readonly providers: ProviderRegistry;
    readonly accounts: ProviderAccountsService;
    readonly usage: UsageService;
    readonly limits: UsageMonitor;
    private readonly handlers: AgentHandlers;
    private readonly background: boolean;
    private readonly connections = new Set<() => void>();
    private nextClient = 1;
    private closing: Promise<void> | null = null;

    private constructor(options: AgentHostOptions) {
        const env = options.env ?? cliEnvironment();
        const client = options.client ?? DEFAULT_CODEX_CLIENT;
        this.background = options.background ?? true;
        this.providers = new ProviderRegistry({ providers: [createClaudeProvider(), createCodexProvider({ client })], env });
        this.accounts = new ProviderAccountsService({
            home: options.dataDir,
            providers: this.providers,
            env,
            client,
            ...(options.accountsHost ? { host: options.accountsHost } : {})
        });
        const nameOf = (kind: AgentKind | UsageProvider): string => this.providers.get(kind).name;
        this.limits = new UsageMonitor({ providers: this.providers, accounts: limitAccountsOf(this.accounts, nameOf, env), client });
        this.accounts.listen(() => this.limits.accountsChanged());
        const attachments = new AttachmentStore(options.dataDir);
        this.chats = new ChatCore({
            providers: this.providers,
            store: new ChatStore(options.dataDir, { attachments }),
            attachments,
            bookmarks: new BookmarkStore(options.dataDir),
            env,
            ...(options.systemNote === undefined ? {} : { instructions: options.systemNote }),
            ...(options.command ? { command: options.command } : {}),
            ...(options.codexCommand ? { codexCommand: options.codexCommand } : {}),
            ...(options.spawn ? { spawn: options.spawn } : {}),
            codexClient: client,
            accounts: this.accounts,
            onLimits: (update) => this.limits.applyLive(update),
            claudeTitles: new ClaudeTitleReader(),
            nameChat: (kind, input) => suggestChatTitle(this.providers, kind, input, definedEnv(env))
        });
        this.usage = new UsageService({
            home: options.dataDir,
            knownProjects: () => Promise.resolve([]),
            roots: () => usageRootsOf(this.accounts),
            sessionAccounts: () => chatSessionAccounts(this.chats.list()),
            accounts: () => usageAccountsOf(this.accounts, nameOf)
        });
        this.handlers = {
            ...chatHandlers(this.chats, this.providers),
            ...accountHandlers(this.accounts),
            ...usageHandlers(this.usage, this.limits)
        };
    }

    /* A host with its accounts read; its clocks run from here unless `background` is off. */
    static async open(options: AgentHostOptions): Promise<AgentHost> {
        const host = new AgentHost(options);
        await host.accounts.load();
        if (host.background) {
            host.limits.start();
            host.accounts.start();
        }
        return host;
    }

    /* Serves one client over `port` until the returned function or `close` lets go of it. */
    connect(port: FramePort): () => void {
        const clientId = `port-${this.nextClient++}`;
        const send = (event: AgentEvent): void => {
            port.send({ type: 'event', event: event.event, payload: event.payload });
        };
        const releases = [
            this.chats.subscribe(clientId, send),
            this.accounts.subscribe(clientId, send),
            this.usage.subscribe(clientId, send),
            this.limits.subscribe(clientId, send),
            port.onFrame((frame) => void this.receive(port, clientId, frame))
        ];
        const disconnect = (): void => {
            if (!this.connections.delete(disconnect)) {
                return;
            }
            for (const release of releases) {
                release();
            }
            this.chats.detachAll(clientId);
            this.usage.unfollow(clientId);
        };
        this.connections.add(disconnect);
        return disconnect;
    }

    /* Lets go of every client, writes every thread and ends every CLI; settles once they exited. */
    close(): Promise<void> {
        this.closing ??= this.shutDown();
        return this.closing;
    }

    private async shutDown(): Promise<void> {
        for (const disconnect of [...this.connections]) {
            disconnect();
        }
        this.usage.stop();
        this.limits.stop();
        this.accounts.stop();
        await this.chats.shutdown();
    }

    private async receive(port: FramePort, clientId: string, frame: unknown): Promise<void> {
        const parsed = parseRequest(frame);
        if (!parsed.ok) {
            // The id when the frame carried a usable one, so the client can settle its promise.
            const id = typeof frame === 'object' && frame !== null && 'id' in frame && typeof frame.id === 'string' && frame.id !== '' ? frame.id : null;
            port.send(errorReply(id, 'bad-request', parsed.message));
            return;
        }
        const { id, type, payload } = parsed.value;
        if (!isAgentRequest(type)) {
            port.send(errorReply(id, 'unknown-request', `Unknown request type: ${type}`));
            return;
        }
        const checked = AGENT_REQUEST_SCHEMAS[type].payload.safeParse(payload);
        if (!checked.success) {
            port.send(errorReply(id, 'bad-request', `Invalid payload for ${type}`));
            return;
        }
        try {
            const handler = this.handlers[type] as AgentHandler<AgentRequestType>;
            port.send({ id, ok: true, result: await handler(checked.data as never, clientId) });
        } catch (e) {
            if (e instanceof CodedError) {
                port.send(errorReply(id, e.code, e.message));
                return;
            }
            console.error(`Handler for ${type} failed:`, errorText(e));
            port.send(errorReply(id, 'internal', 'Request failed'));
        }
    }
}
