import type { AgentKind, UsageProvider } from '@ruimte/agent-contracts';
import { AttachmentStore } from '../chat/attachment-store.ts';
import { BookmarkStore } from '../chat/bookmark-store.ts';
import { ChatCore, type ChatCoreOptions } from '../chat/chat-core.ts';
import type { SpawnChatProcess } from '../chat/chat-process.ts';
import { ChatStore } from '../chat/chat-store.ts';
import { suggestChatTitle } from '../chat/chat-title.ts';
import type { ClaudeBackendOptions } from '../chat/claude-backend.ts';
import { ClaudeTitleReader } from '../chat/claude-title.ts';
import { DEFAULT_CODEX_CLIENT, type CodexClientInfo } from '../chat/codex-transport.ts';
import type { AgentEvent } from '../events.ts';
import { definedEnv } from '../providers/accounts/launch.ts';
import { ProviderAccountsService } from '../providers/accounts/service.ts';
import type { AccountsHost } from '../providers/accounts/variables.ts';
import { createClaudeProvider } from '../providers/claude-provider.ts';
import { errorText } from '../error-text.ts';
import { createCodexProvider } from '../providers/codex-provider.ts';
import { codexRulesPathIn, defaultCodexHome, installCodexRules, type CodexRules } from '../providers/codex-rules.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { chatSessionAccounts, limitAccountsOf, usageAccountsOf, usageRootsOf } from '../usage/accounts.ts';
import { UsageMonitor } from '../usage/limits/monitor.ts';
import { UsageService } from '../usage/usage-service.ts';
import { cliEnvironment } from './environment.ts';
import { accountHandlers, chatHandlers, usageHandlers, type AgentHandlers } from './handlers.ts';

export interface AgentWiringOptions<Core extends ChatCore = ChatCore> {
    // Where the chats, their attachments and bookmarks, the accounts and the usage index are kept.
    dataDir: string;
    // The environment the CLIs start in; absent, this process's own through `cliEnvironment`.
    env?: Record<string, string | undefined>;
    // What every agent is told once, at the start of its process.
    systemNote?: string;
    // How the host names itself: to Codex, in a refusal about an account, and in the keychain.
    client?: CodexClientInfo;
    accountsHost?: AccountsHost;
    claude?: ClaudeBackendOptions;
    // The commands Codex runs outside its sandbox without asking, such as the host's context CLI; written in its home and every account's.
    codexRules?: CodexRules;
    // The core of an app that extends `ChatCore`, made from what a plain core would get; absent, a plain core.
    core?: (options: ChatCoreOptions) => Core;
    // A test runs fake CLIs: the commands to start and how.
    command?: string[];
    codexCommand?: string[];
    spawn?: SpawnChatProcess;
}

export interface AgentWiring<Core extends ChatCore = ChatCore> {
    providers: ProviderRegistry;
    accounts: ProviderAccountsService;
    limits: UsageMonitor;
    usage: UsageService;
    chats: Core;
    handlers: AgentHandlers;
    /* Sends one client its chat, account and usage events until the returned function lets go of it. */
    connect(clientId: string, send: (event: AgentEvent) => void): () => void;
    /* Checks who is signed in and reads what is left of each plan on their own clocks, until `stop`. */
    start(): void;
    /* Stops the clocks, writes every thread and ends every CLI; settles once they exited. */
    stop(): Promise<void>;
}

// A folder the rule cannot be written to only costs an approval per call, so it never stops the host.
async function installRulesIn(kind: AgentKind, folder: string, rules: CodexRules): Promise<void> {
    if (kind !== 'codex') {
        return;
    }
    const path = codexRulesPathIn(folder, rules);
    await installCodexRules(path, rules).catch((e: unknown) => console.error(`Could not write the codex rules in ${path}:`, errorText(e)));
}

/*
 * The chats of a host with the providers, accounts and usage around them, and the handlers of
 * every agent request. `AgentHost` serves them over a port; an app that answers requests on a wire
 * of its own takes the handlers and `connect` from here. The accounts are read with
 * `accounts.load()` before the first request.
 */
export function wireAgents<Core extends ChatCore = ChatCore>(options: AgentWiringOptions<Core>): AgentWiring<Core> {
    const env = options.env ?? cliEnvironment();
    const client = options.client ?? DEFAULT_CODEX_CLIENT;
    const codexRules = options.codexRules;
    const providers = new ProviderRegistry({ providers: [createClaudeProvider(options.claude), createCodexProvider({ client })], env });
    const accounts = new ProviderAccountsService({
        home: options.dataDir,
        providers,
        env,
        client,
        ...(options.accountsHost ? { host: options.accountsHost } : {}),
        ...(codexRules ? { install: (kind: AgentKind, folder: string) => installRulesIn(kind, folder, codexRules) } : {})
    });
    if (codexRules) {
        void installRulesIn('codex', defaultCodexHome(env), codexRules);
    }
    const nameOf = (kind: AgentKind | UsageProvider): string => providers.get(kind).name;
    const limits = new UsageMonitor({ providers, accounts: limitAccountsOf(accounts, nameOf, env), client });
    accounts.listen(() => limits.accountsChanged());
    const attachments = new AttachmentStore(options.dataDir);
    // Only without `core`, where `Core` is `ChatCore` itself.
    const core = options.core ?? ((coreOptions: ChatCoreOptions) => new ChatCore(coreOptions) as Core);
    const chats = core({
        providers,
        store: new ChatStore(options.dataDir, { attachments }),
        attachments,
        bookmarks: new BookmarkStore(options.dataDir),
        env,
        ...(options.systemNote === undefined ? {} : { instructions: options.systemNote }),
        ...(options.command ? { command: options.command } : {}),
        ...(options.codexCommand ? { codexCommand: options.codexCommand } : {}),
        ...(options.spawn ? { spawn: options.spawn } : {}),
        codexClient: client,
        accounts,
        onLimits: (update) => limits.applyLive(update),
        claudeTitles: new ClaudeTitleReader(),
        nameChat: (kind, input) => suggestChatTitle(providers, kind, input, definedEnv(env))
    });
    const usage = new UsageService({
        home: options.dataDir,
        knownProjects: () => Promise.resolve([]),
        roots: () => usageRootsOf(accounts),
        sessionAccounts: () => chatSessionAccounts(chats.list()),
        accounts: () => usageAccountsOf(accounts, nameOf)
    });
    return {
        providers,
        accounts,
        limits,
        usage,
        chats,
        handlers: {
            ...chatHandlers(chats, providers),
            ...accountHandlers(accounts),
            ...usageHandlers(usage, limits)
        },
        connect: (clientId, send) => {
            const releases = [
                chats.subscribe(clientId, send),
                accounts.subscribe(clientId, send),
                usage.subscribe(clientId, send),
                limits.subscribe(clientId, send)
            ];
            return () => {
                for (const release of releases) {
                    release();
                }
                chats.detachAll(clientId);
                usage.unfollow(clientId);
            };
        },
        start: () => {
            limits.start();
            accounts.start();
        },
        stop: async () => {
            try {
                usage.stop();
                limits.stop();
                accounts.stop();
            } finally {
                await chats.shutdown();
            }
        }
    };
}
