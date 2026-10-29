import type { AgentInfo, AgentKind, AgentLaunch, ChatCreatePayload, ChatInfo, RuntimeMode } from '@ruimte/contracts';
import type { AgentLineageStore } from '@adecore/agents/coordination';
import type { PendingPromptStore } from '../agents/pending-prompts.ts';
import type { AgentStart, AgentStartHost, NodeAccount } from '../canvas/verb.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import type { SessionManager } from '../sessions/manager.ts';
import { errorText } from '../error-text.ts';
import type { ComposerPreference } from '@adecore/agents/chat';
import { narrowerMode } from '@adecore/agents/providers';
import { DEFAULT_RUNTIME_MODE, launchedMode } from '../providers/launch.ts';
import type { OutboxStore, OutboxWork, StartAgentEntry } from './outbox.ts';

interface NodeModeDeps {
    chatMode(nodeId: string): RuntimeMode | undefined;
    /* The launch a terminal session was started with. Null for a plain shell, undefined for no session at all. */
    launch(nodeId: string): AgentLaunch | null | undefined;
    /* The mode a terminal agent's hooks last reported; null or undefined while none did. */
    reportedMode(nodeId: string): RuntimeMode | null | undefined;
    /* The widest mode an agent that opened this node let it have; null for a node a person made. */
    ceiling(nodeId: string): RuntimeMode | null;
}

/*
 * The mode a node runs in as far as the daemon knows it, which is what an agent it opens may get at
 * most. Never above the ceiling its opener gave it, whatever a hook or the node's own file says.
 */
export function nodeMode(deps: NodeModeDeps) {
    return (nodeId: string): RuntimeMode => {
        const mode = deps.chatMode(nodeId) ?? deps.reportedMode(nodeId) ?? launchedMode(deps.launch(nodeId) ?? null);
        const ceiling = deps.ceiling(nodeId);
        return ceiling === null ? mode : narrowerMode(mode, ceiling);
    };
}

interface NodeAccountDeps {
    chat(nodeId: string): Pick<ChatInfo, 'provider' | 'account'> | undefined;
    session(nodeId: string): { launch: AgentLaunch | null; agent: AgentInfo | null } | undefined;
}

/* The CLI and account the agent of a node runs under; a CLI a person started by hand runs under its default account. */
function nodeAccount(deps: NodeAccountDeps) {
    return (nodeId: string): NodeAccount | null => {
        const chat = deps.chat(nodeId);
        if (chat !== undefined) {
            return { kind: chat.provider, ...(chat.account === undefined ? {} : { account: chat.account }) };
        }
        const session = deps.session(nodeId);
        const kind = session?.agent?.kind ?? session?.launch?.kind;
        if (session === undefined || kind === undefined) {
            return null;
        }
        const account = session.launch?.kind === kind ? session.launch.account : undefined;
        return { kind, ...(account === undefined ? {} : { account }) };
    };
}

/*
 * The entry a verb owes for a node it made. A chat opened by a chat takes that chat's mode unless
 * `--mode` said otherwise, and every start carries the opener's mode as the ceiling, read now, since
 * the opener may be gone by the time the entry runs.
 */
export function startAgentWork(start: AgentStart, deps: NodeModeDeps): OutboxWork {
    const runtimeMode = start.runtimeMode ?? (start.node === 'chat' ? deps.chatMode(start.openedBy) : undefined);
    return {
        kind: 'start-agent',
        payload: {
            node: start.node,
            provider: start.provider,
            ...(start.selection ? { selection: start.selection } : {}),
            cwd: start.cwd,
            ...(runtimeMode ? { runtimeMode } : {}),
            ceiling: nodeMode(deps)(start.openedBy),
            ...(start.account === undefined ? {} : { account: start.account })
        }
    };
}

interface AgentStartHostDeps {
    /* The agent CLIs installed on this machine. */
    installed(): Promise<AgentKind[]>;
    prompts: Pick<PendingPromptStore, 'put'>;
    enqueue(projectId: string, nodeId: string, work: OutboxWork): Promise<void>;
    chats: Pick<ChatManager, 'get' | 'composerPreferences'>;
    sessions: Pick<SessionManager, 'get'>;
    lineage: Pick<AgentLineageStore, 'ceilingOf'>;
    /* The agent nodes a caller holds open, which caps one caller in a loop. */
    openedCount(callerId: string): number;
    /* The accounts of a CLI a project turned off. */
    accountsOff?(projectId: string, kind: AgentKind): readonly string[];
}

/* What the verbs start an agent node through, the same for the daemon and the test daemon. */
export function agentStartHost(deps: AgentStartHostDeps): AgentStartHost {
    const modes: NodeModeDeps = {
        chatMode: (id) => deps.chats.get(id)?.info.runtimeMode,
        launch: (id) => deps.sessions.get(id)?.launch,
        reportedMode: (id) => deps.sessions.get(id)?.reportedMode,
        ceiling: (id) => deps.lineage.ceilingOf(id)
    };
    return {
        installedAgents: () => deps.installed(),
        holdPrompt: (projectId, nodeId, prompt, brief) => deps.prompts.put(projectId, nodeId, prompt, brief),
        startAgent: (start) => deps.enqueue(start.projectId, start.nodeId, startAgentWork(start, modes)),
        modeOf: nodeMode(modes),
        accountOf: nodeAccount({ chat: (id) => deps.chats.get(id)?.info, session: (id) => deps.sessions.get(id) }),
        terminalModePreference: () => deps.chats.composerPreferences.terminalMode(),
        preferredSelection: (kind) => deps.chats.composerPreferences.for(kind).selection,
        openedCount: (callerId) => deps.openedCount(callerId),
        accountsOff: (projectId, kind) => deps.accountsOff?.(projectId, kind) ?? []
    };
}

/*
 * The size a terminal agent starts at with nobody looking. Wide enough that a CLI does not wrap its
 * own layout into a column; the first client that attaches sizes it to itself, as every attach does.
 */
export const HEADLESS_TERMINAL = { cols: 120, rows: 40 } as const;

export interface StartAgentDeps {
    /* Whether a project still places the node; a node deleted before its start is not started. */
    placed(nodeId: string): boolean;
    hasChat(chatId: string): boolean;
    createChat(payload: ChatCreatePayload): Promise<unknown>;
    /* The composer preference of the connected clients for this provider, read when the chat is made. */
    composerPreference(provider: StartAgentEntry['payload']['provider']): ComposerPreference;
    killChat(chatId: string): Promise<void>;
    hasSession(sessionId: string): boolean;
    createSession(options: {
        sessionId: string;
        cols: number;
        rows: number;
        cwd?: string;
        agent: { kind: StartAgentEntry['payload']['provider']; runtimeMode?: RuntimeMode; account?: string };
    }): Promise<unknown>;
    killSession(sessionId: string): Promise<void>;
    /* Refuses a directory the node may not start in; asked right before the start, not when the verb ran. */
    checkCwd?: (nodeId: string, cwd: string) => Promise<void>;
    log?: (line: string) => void;
    /* A start that failed and will not be tried again. What was waiting on the agent hears it here. */
    onGaveUp?: (entry: StartAgentEntry, error: unknown) => void;
}

function agentChatPayload(entry: StartAgentEntry, preference: ComposerPreference): ChatCreatePayload {
    const { provider, cwd, runtimeMode, ceiling, selection, account } = entry.payload;
    const modelSelection = selection ?? preference.selection;
    const picked = runtimeMode ?? preference.runtimeMode;
    const mode = ceiling === undefined ? picked : narrowerMode(picked ?? DEFAULT_RUNTIME_MODE, ceiling);
    return {
        chatId: entry.target,
        provider,
        ...(account === undefined ? {} : { account }),
        ...(cwd === null ? {} : { cwd }),
        ...(modelSelection ? { selection: modelSelection } : {}),
        ...(mode === undefined ? {} : { runtimeMode: mode })
    };
}

export function agentChatOpening(outbox: Pick<OutboxStore, 'list'>, composerPreference: StartAgentDeps['composerPreference']) {
    return (chatId: string): ChatCreatePayload | undefined => {
        const entry = outbox.list().find((entry) => entry.kind === 'start-agent' && entry.target === chatId);
        return entry?.kind === 'start-agent' && entry.payload.node === 'chat' ? agentChatPayload(entry, composerPreference(entry.payload.provider)) : undefined;
    };
}

/*
 * Starts the chat or the terminal of an agent node a verb wrote, so a client that mounts it later
 * attaches to what already runs. Never retried: the create takes the node's first prompt before it
 * spawns, so a second attempt would start the agent without its task.
 */
export function startAgentHandler(deps: StartAgentDeps) {
    return async (entry: StartAgentEntry): Promise<void> => {
        const { node, provider, cwd, runtimeMode, ceiling, account } = entry.payload;
        const nodeId = entry.target;
        const log = deps.log ?? ((line: string) => console.error(line));
        if (!deps.placed(nodeId)) {
            return;
        }
        try {
            if (cwd !== null) {
                await deps.checkCwd?.(nodeId, cwd);
            }
            if (node === 'chat') {
                if (deps.hasChat(nodeId)) {
                    return;
                }
                await deps.createChat(agentChatPayload(entry, deps.composerPreference(provider)));
            } else {
                if (deps.hasSession(nodeId)) {
                    return;
                }
                await deps.createSession({
                    sessionId: nodeId,
                    ...HEADLESS_TERMINAL,
                    ...(cwd === null ? {} : { cwd }),
                    // The node carries the same mode, so a reload starts the CLI the way this did.
                    agent: {
                        kind: provider,
                        ...(account === undefined ? {} : { account }),
                        ...(runtimeMode === undefined ? {} : { runtimeMode: ceiling === undefined ? runtimeMode : narrowerMode(runtimeMode, ceiling) })
                    }
                });
            }
        } catch (e) {
            // A client that mounted the node first made the session; that is the node started, not a failure.
            if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'session-exists') {
                return;
            }
            log(`Starting the agent of ${nodeId} failed: ${errorText(e)}`);
            deps.onGaveUp?.(entry, e);
            return;
        }
        // Deleted while it was being started. Whoever deleted it found nothing to end yet.
        if (!deps.placed(nodeId)) {
            await (node === 'chat' ? deps.killChat(nodeId) : deps.killSession(nodeId)).catch(() => undefined);
        }
    };
}
