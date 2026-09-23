import i18next from 'i18next';
import { ActionRefusal, type ActionCall, type ActionHandlers, type ActionOutput } from '@ruimte/actions';
import {
    CHAT_FORK_TITLE_MAX,
    isCanvasView,
    type AgentKind,
    type ChatForkResult,
    type ChatInfo,
    type ChatItem,
    type ChatQuestionItem,
    type ModelSelection,
    type Plan,
    type PlanPersonOp,
    type ProviderInfo,
    type RequestMap,
    type RequestType
} from '@ruimte/contracts';
import { effectiveChecks, findItem } from '@ruimte/plan';
import type { StoreApi } from 'zustand';
import { asksFirst, asRefusal } from '@/actions/developer-actions';
import { agentsEndedWith } from '@/agents/end-children';
import { forkRefusal, lastSettledTurn, summaryRefusal } from '@/chat/logic/fork';
import { recentSubagentMessages } from '@/chat/recent-messages';
import { stopOf, subagentTitle } from '@/chat/subagent-list';
import { readNodeHost, updateHost, type NodeHost } from '@/nodes/node-host';
import { PlanClient } from '@/plan/plan-client';
import { showViewWhenItLands } from '@/project/views';
import { revealWhenItLands } from '@/state/canvas';
import { chatSinkFor, useChats, type ChatState } from '@/state/chats';
import type { DocumentState } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { usePlans } from '@/state/plans';
import { providersOf } from '@/state/providers';
import { useSessions, type SessionState } from '@/state/sessions';
import { screenOf } from '@/terminal/registry';
import { chatClient, machineFor, sessionClient } from '@/transport/connections';
import type { Transport } from '@/transport/transport';

type Requester = Pick<Transport, 'request'>;
type Call = ActionCall<void> & { confirmed: boolean };

/* What the chat and terminal actions reach outside the document; a test hands in a fake of each. */
export interface SessionMachine {
    transport(): Requester | null;
    /* What this window knows of a chat: its status always, its thread only while someone has it open. */
    chat(chatId: string): ChatState | null;
    isOpen(chatId: string): boolean;
    applyInfo(chatId: string, info: ChatInfo): void;
    terminal(terminalId: string): SessionState | null;
    /* The lines of a terminal this window has drawn, oldest first; null for one it never drew. */
    screen(terminalId: string): string[] | null;
    providers(): readonly ProviderInfo[];
    providerFixed(chatId: string): boolean;
    /* False when nobody here has the chat open, since only an open chat can be registered again. */
    retarget(chatId: string, provider: AgentKind, selection: ModelSelection): Promise<boolean>;
    /* Newest first, the way the store keeps them. */
    plans(chatId: string): readonly Plan[];
    applyPlan(chatId: string, planId: string, ops: PlanPersonOp[]): Promise<Plan>;
    revealFork(result: ChatForkResult): void;
    /* What a terminal was made to run: its command, or the CLI and the mode of a terminal agent. */
    terminalHost(terminalId: string): Pick<NodeHost, 'command' | 'provider' | 'runtimeMode'> | null;
    /*
     * Ends what is left of a terminal's session and has its body start a fresh one, with the agent
     * session `resume` names going on in it. The body rebuilds its terminal; this only asks for it.
     */
    restartTerminal(terminalId: string, resume: string | null): Promise<void>;
}

const endpointTransport = (): Requester | null => machineFor(currentEndpointId())?.transport ?? null;

const livePlans = new PlanClient((endpointId) => machineFor(endpointId)?.transport ?? null);

const LIVE_MACHINE: SessionMachine = {
    transport: endpointTransport,
    chat: (chatId) => useChats.getState().byKey[endpointKey(currentEndpointId(), chatId)] ?? null,
    isOpen: (chatId) => chatClient.isMounted(chatId),
    applyInfo: (chatId, info) => chatSinkFor(currentEndpointId()).apply(chatId, { type: 'info', info }),
    terminal: (terminalId) => useSessions.getState().byKey[endpointKey(currentEndpointId(), terminalId)] ?? null,
    screen: (terminalId) => screenOf(currentEndpointId(), terminalId),
    providers: () => providersOf(currentEndpointId()).providers,
    providerFixed: (chatId) => readNodeHost(chatId)?.providerFixed === true,
    retarget: async (chatId, provider, selection) => {
        if (!chatClient.isMounted(chatId)) {
            return false;
        }
        // The chat remembers the new CLI, so a reload opens it on the same one.
        updateHost(chatId, { provider });
        await chatClient.retarget(chatId, provider, selection);
        return true;
    },
    plans: (chatId) => usePlans.getState().byChat[endpointKey(currentEndpointId(), chatId)] ?? [],
    applyPlan: (chatId, planId, ops) => livePlans.apply(currentEndpointId(), chatId, planId, ops),
    revealFork: (result) => {
        if (result.viewId === result.nodeId) {
            showViewWhenItLands(result.viewId);
        } else {
            revealWhenItLands(result.viewId, result.nodeId);
        }
    },
    terminalHost: (terminalId) => readNodeHost(terminalId),
    restartTerminal: async (terminalId, resume) => {
        // On the node, so it survives a reload; the daemon turns it into the CLI's own resume line.
        if (resume !== null) {
            updateHost(terminalId, { resume });
        }
        try {
            await sessionClient.kill(terminalId);
        } catch {
            // Already gone on the machine; a fresh session is all that matters.
        }
        useSessions.getState().restart(endpointKey(currentEndpointId(), terminalId));
    }
};

/* Read from the exported views, so a node on any canvas on screen counts with what its editor holds. */
export const sessionTitle = (document: StoreApi<DocumentState>, id: string, kind: 'chat' | 'terminal'): string | null => {
    for (const view of document.getState().exportViews()) {
        if (view.kind === kind && view.id === id) {
            return view.name;
        }
        if (isCanvasView(view)) {
            const node = view.nodes.find((candidate) => candidate.id === id && candidate.kind === kind);
            if (node) {
                return node.title;
            }
        }
    }
    return null;
};

const plural = (count: number, noun: string): string => `${count} ${count === 1 ? noun : `${noun}s`}`;

const DEFAULT_TERMINAL_LINES = 40;
const MAX_TERMINAL_CHARACTERS = 12_000;
const DEFAULT_SUBAGENT_MESSAGES = 20;
const SUBAGENT_PAGE = 100;

/* The newest lines that fit, so a screen of long lines still reads as its end rather than its start. */
const lastLines = (lines: readonly string[], limit: number): { lines: string[]; truncated: boolean } => {
    const kept: string[] = [];
    let characters = 0;
    for (const line of lines.slice(-limit).toReversed()) {
        if (characters + line.length > MAX_TERMINAL_CHARACTERS) {
            break;
        }
        kept.unshift(line);
        characters += line.length;
    }
    return { lines: kept, truncated: kept.length < lines.length };
};

const threadOf = (row: ChatState): ChatItem[] => row.order.flatMap((id) => (row.structure[id] === undefined ? [] : [row.structure[id]]));

const pendingQuestion = (row: ChatState | null, match: (item: ChatQuestionItem) => boolean): ChatQuestionItem | null =>
    row === null ? null : (threadOf(row).find((item): item is ChatQuestionItem => item.kind === 'question' && item.state === 'pending' && match(item)) ?? null);

/* What the fresh shell of a restarted terminal runs, which is what Voice asks about first: an agent CLI on a new session is a start. */
const startsAgain = (host: Pick<NodeHost, 'command' | 'provider' | 'runtimeMode'> | null, providerName: string | null): string => {
    if (host?.provider) {
        return `${providerName ?? host.provider} starts again on a new session${host.runtimeMode ? `, in ${host.runtimeMode} mode` : ''}.`;
    }
    if (host?.command) {
        return `It runs “${host.command}” again.`;
    }
    return 'A fresh shell starts.';
};

const quotedList = (items: readonly string[]): string => (items.length === 0 ? 'none' : items.map((item) => `“${item}”`).join(', '));

/*
 * What a person does to a chat or a terminal, as actions: the composer, the prompt cards, the thread's
 * rows, the fork dialog, the plan panel and the processes panel. Each sends the request that surface
 * always sent. A person's own dialogs are the confirmation, so a person runs straight through; Voice
 * is asked first for what stops work or answers for the person.
 */
export function sessionActions(document: StoreApi<DocumentState>, overrides: Partial<SessionMachine> = {}): ActionHandlers<void> {
    const machine: SessionMachine = { ...LIVE_MACHINE, ...overrides };

    const connected = (): Requester => {
        const transport = machine.transport();
        if (transport === null) {
            throw new ActionRefusal('offline', 'The machine of this project is not connected.');
        }
        return transport;
    };

    const ask = async <Type extends RequestType>(type: Type, payload: RequestMap[Type]['payload']): Promise<RequestMap[Type]['result']> => {
        try {
            return await connected().request(type, payload);
        } catch (error: unknown) {
            throw asRefusal(error);
        }
    };

    /*
     * The processes panel shows every session of the machine, so a person may act on one of another
     * project from there. Anyone else names a chat or terminal of this project.
     */
    const named = (id: string, kind: 'chat' | 'terminal', call: Call): string => {
        const title = sessionTitle(document, id, kind);
        if (title !== null) {
            return title;
        }
        if (call.actor.kind === 'person') {
            return id;
        }
        throw kind === 'chat'
            ? new ActionRefusal('unknown-chat', `No AI Chat with id “${id}” exists in this project.`)
            : new ActionRefusal('unknown-terminal', `No terminal with id “${id}” exists in this project.`);
    };

    const chatNamed = (chatId: string, call: Call): string => named(chatId, 'chat', call);

    const terminalNamed = (terminalId: string, call: Call): string => named(terminalId, 'terminal', call);

    /* A chat's status reaches this window for every chat the machine runs; without one the machine never said a word about it. */
    const rowOf = (chatId: string, chat: string): ChatState => {
        const row = machine.chat(chatId);
        if (row === null) {
            throw new ActionRefusal('chat-not-loaded', `Ruimte has no status of “${chat}” yet. Open it and try again.`);
        }
        return row;
    };

    /* A thread is only in this window while someone has it open; Voice cannot act on a row it has never seen. */
    const openRowOf = (chatId: string, chat: string): ChatState => {
        const row = rowOf(chatId, chat);
        if (!machine.isOpen(chatId)) {
            throw new ActionRefusal('chat-not-open', `Open “${chat}” first; its thread is only known while it is open.`);
        }
        return row;
    };

    const planOf = (chatId: string, planId: string | null): Plan => {
        const plans = machine.plans(chatId);
        const plan = planId === null ? plans[0] : plans.find((candidate) => candidate.id === planId);
        if (!plan) {
            throw new ActionRefusal(
                'plan-not-found',
                plans.length === 0 ? 'This chat has no plan.' : `This chat has no plan ${planId}. Its plans are ${quotedList(plans.map((entry) => entry.id))}.`
            );
        }
        return plan;
    };

    const chatOfPlan = (chatId: string | null | undefined, call: Call): string => {
        if (chatId == null) {
            throw new ActionRefusal('missing-chat', 'Name the AI Chat whose plan this is.');
        }
        chatNamed(chatId, call);
        return chatId;
    };

    const planChanged = async (chatId: string, planId: string | null, ops: PlanPersonOp[]): Promise<{ output: ActionOutput<'plan.addNote'> }> => {
        const plan = await machine.applyPlan(chatId, planOf(chatId, planId).id, ops);
        // A person's operations never add a sub-step, so no step loses its state to one.
        return { output: { plan, dropped: [] } };
    };

    return {
        'terminal.read': ({ terminalId, lines }, call) => {
            const terminal = terminalNamed(terminalId, call);
            const screen = machine.screen(terminalId);
            if (screen === null) {
                throw new ActionRefusal('terminal-not-open', `Open “${terminal}” before reading it; this window has not drawn it yet.`);
            }
            return {
                output: {
                    terminalId,
                    terminal,
                    ...lastLines(screen, lines ?? DEFAULT_TERMINAL_LINES),
                    exited: machine.terminal(terminalId)?.exited !== undefined
                }
            };
        },
        'chat.inspect': ({ chatId }, call) => {
            const chat = chatNamed(chatId, call);
            const row = rowOf(chatId, chat);
            const { info } = row;
            const open = machine.isOpen(chatId);
            const thread = open ? threadOf(row) : [];
            const working = info.activeTurnId !== null;
            return {
                output: {
                    chatId,
                    chat,
                    provider: info.provider,
                    model: info.selection.model,
                    options: info.selection.options,
                    runtimeMode: info.runtimeMode,
                    status: info.status,
                    working,
                    open,
                    queue: (info.queue ?? []).map((message) => ({ messageId: message.id, text: message.text })),
                    questions: thread.flatMap((item) =>
                        item.kind === 'question' && item.state === 'pending'
                            ? [
                                  {
                                      requestId: item.requestId,
                                      itemId: item.id,
                                      optional: item.async === true,
                                      questions: item.questions.map((question) => ({
                                          questionId: question.id,
                                          header: question.header,
                                          question: question.question,
                                          choices: question.choices.map((choice) => choice.label),
                                          multiSelect: question.multiSelect
                                      }))
                                  }
                              ]
                            : []
                    ),
                    approvals: thread.flatMap((item) =>
                        item.kind === 'approval' && item.decision === 'pending'
                            ? [{ requestId: item.requestId, tool: item.toolName, description: item.description }]
                            : []
                    ),
                    subagents: thread.flatMap((item) =>
                        item.kind === 'subagent'
                            ? [{ toolUseId: item.toolUseId, title: subagentTitle(item), status: item.status, stoppable: stopOf(item, working) !== null }]
                            : []
                    ),
                    tasks: (info.background ?? []).map((task) => ({ taskId: task.id, kind: task.kind, description: task.description, command: task.command })),
                    lastTurnId: open ? lastSettledTurn(row.structure, row.order) : null,
                    forkOf: info.forkOf ? { chatId: info.forkOf.chatId, turnId: info.forkOf.turnId } : null
                }
            };
        },
        'chat.stopTurn': async ({ chatId, subagents }, call) => {
            const chat = chatNamed(chatId, call);
            if (call.actor.kind !== 'person' && !subagents && machine.chat(chatId)?.info.activeTurnId === null) {
                throw new ActionRefusal('not-working', `“${chat}” is not in a turn.`);
            }
            if (asksFirst(call)) {
                const agents = subagents ? await agentsEndedWith(machine.transport(), [chatId]) : 0;
                return {
                    confirmation: {
                        title: `Stop the turn of “${chat}”?`,
                        consequences: [
                            'The turn ends unfinished. What it wrote and changed so far stays, and the agent does not go on with it on its own.',
                            ...(subagents
                                ? [
                                      'The sub-agents of its CLI are marked stopped.',
                                      agents === 0
                                          ? 'It has no agents of its own running.'
                                          : `The ${plural(agents, 'agent')} it opened end as well; their nodes stay with what they did so far.`
                                  ]
                                : [])
                        ]
                    }
                };
            }
            await ask('chat.cancel', { chatId, ...(subagents ? { subagents: true } : {}) });
            return { output: { chatId, chat, subagents } };
        },
        'chat.unqueue': async ({ chatId, messageId }, call) => {
            const chat = chatNamed(chatId, call);
            const message = machine.chat(chatId)?.info.queue?.find((entry) => entry.id === messageId);
            if (!message && call.actor.kind !== 'person') {
                throw new ActionRefusal('not-queued', `No message ${messageId} waits in the queue of “${chat}”.`);
            }
            await ask('chat.unqueue', { chatId, messageId });
            return { output: { chatId, chat, messageId, text: message?.text ?? '' } };
        },
        'chat.sendNow': async ({ chatId, messageId }, call) => {
            const chat = chatNamed(chatId, call);
            const message = machine.chat(chatId)?.info.queue?.find((entry) => entry.id === messageId);
            if (!message && call.actor.kind !== 'person') {
                throw new ActionRefusal('not-queued', `No message ${messageId} waits in the queue of “${chat}”.`);
            }
            await ask('chat.sendNow', { chatId, messageId });
            return { output: { chatId, chat, messageId, text: message?.text ?? '' } };
        },
        'chat.compact': async ({ chatId }, call) => {
            const chat = chatNamed(chatId, call);
            if (call.actor.kind !== 'person' && machine.chat(chatId)?.info.activeTurnId != null) {
                throw new ActionRefusal('chat-busy', `“${chat}” is in a turn; compacting waits until it is over.`);
            }
            await ask('chat.compact', { chatId });
            return { output: { chatId, chat } };
        },
        'chat.configure': async ({ chatId, model, option, runtimeMode, selection }, call) => {
            const chat = chatNamed(chatId, call);
            const { info } = rowOf(chatId, chat);
            let chosen: ModelSelection | undefined = selection ?? undefined;
            if (chosen === undefined && (model !== null || option !== null)) {
                const provider = machine.providers().find((entry) => entry.kind === info.provider);
                const slug = model ?? info.selection.model;
                const found = provider?.models.find((entry) => entry.slug === slug);
                if (!found) {
                    throw new ActionRefusal(
                        'unknown-model',
                        `${info.provider} has no model “${slug}”. Its models are ${quotedList(provider?.models.map((entry) => entry.slug) ?? [])}.`
                    );
                }
                // Another model has options of its own; the machine fills in their defaults.
                const options: ModelSelection['options'] = slug === info.selection.model ? { ...info.selection.options } : {};
                if (option !== null) {
                    const descriptor = found.options.find((entry) => entry.id === option.id);
                    if (!descriptor) {
                        throw new ActionRefusal(
                            'unknown-option',
                            `${found.name} has no option “${option.id}”. Its options are ${quotedList(found.options.map((entry) => entry.id))}.`
                        );
                    }
                    if (descriptor.type === 'select') {
                        if (!descriptor.choices.some((choice) => choice.id === option.value)) {
                            throw new ActionRefusal(
                                'unknown-choice',
                                `“${option.value}” is no choice of ${descriptor.label}. The choices are ${quotedList(descriptor.choices.map((choice) => choice.id))}.`
                            );
                        }
                        options[descriptor.id] = option.value;
                    } else {
                        if (option.value !== 'true' && option.value !== 'false') {
                            throw new ActionRefusal('unknown-choice', `${descriptor.label} is on or off: pass true or false.`);
                        }
                        options[descriptor.id] = option.value === 'true';
                    }
                }
                chosen = { model: slug, options };
            }
            if (chosen === undefined && runtimeMode == null) {
                throw new ActionRefusal('nothing-to-change', 'Name a model or an option to change.');
            }
            const updated = await ask('chat.configure', { chatId, ...(chosen ? { selection: chosen } : {}), ...(runtimeMode == null ? {} : { runtimeMode }) });
            machine.applyInfo(chatId, updated);
            return {
                output: {
                    chatId,
                    chat,
                    provider: updated.provider,
                    model: updated.selection.model,
                    options: updated.selection.options,
                    runtimeMode: updated.runtimeMode
                }
            };
        },
        'chat.setProvider': async ({ chatId, provider, model, selection }, call) => {
            const chat = chatNamed(chatId, call);
            const { info } = rowOf(chatId, chat);
            if (info.provider === provider) {
                throw new ActionRefusal('same-provider', `“${chat}” already runs ${provider}.`);
            }
            // The CLI holds the thread once it spoke, and a chat opened for a named CLI was never going to change.
            if (info.agentSessionId !== null || info.usage.turns > 0 || machine.providerFixed(chatId)) {
                throw new ActionRefusal('provider-fixed', `“${chat}” keeps its CLI; fork it to go on with another.`);
            }
            const target = machine.providers().find((entry) => entry.kind === provider && entry.installed && entry.capabilities.chat);
            if (!target) {
                throw new ActionRefusal('unavailable-provider', `${provider} is not installed for chats on this machine.`);
            }
            let chosen = selection ?? null;
            if (chosen === null) {
                const slug = model ?? target.models.find((entry) => entry.isDefault)?.slug ?? target.models[0]?.slug;
                if (slug === undefined || !target.models.some((entry) => entry.slug === slug)) {
                    throw new ActionRefusal(
                        'unknown-model',
                        `${target.name} has no model “${slug ?? ''}”. Its models are ${quotedList(target.models.map((entry) => entry.slug))}.`
                    );
                }
                chosen = { model: slug, options: {} };
            }
            try {
                if (!(await machine.retarget(chatId, provider, chosen))) {
                    throw new ActionRefusal('chat-not-open', `Open “${chat}” before switching its CLI.`);
                }
            } catch (error: unknown) {
                throw asRefusal(error);
            }
            return { output: { chatId, chat, provider } };
        },
        'chat.fork': async ({ chatId, turnId, title, branch, asView, filesAfterTurn, provider, selection }, call) => {
            const chat = chatNamed(chatId, call);
            const row = machine.chat(chatId);
            const turn = turnId ?? (row === null ? null : lastSettledTurn(row.structure, row.order));
            if (turn === null) {
                throw new ActionRefusal('no-turn', `“${chat}” has no finished turn to fork after that this window knows of. Open it and try again.`);
            }
            if (call.actor.kind !== 'person') {
                const refusal = forkRefusal(row?.info ?? null, row?.structure[turn]);
                if (refusal !== null) {
                    throw new ActionRefusal('cannot-fork', refusal);
                }
            }
            const named = title ?? i18next.t('shell:fork.copyTitle', { title: chat }).slice(0, CHAT_FORK_TITLE_MAX);
            if (branch != null && asksFirst(call)) {
                return {
                    confirmation: {
                        title: `Fork “${chat}” into a worktree on ${branch}?`,
                        consequences: [
                            `A git worktree on the new branch ${branch} is made for “${named}”. Nothing removes it on its own.`,
                            'The fork goes on with the conversation up to that turn; the original stays as it is.'
                        ]
                    }
                };
            }
            const result = await ask('chat.fork', {
                chatId,
                turnId: turn,
                title: named,
                ...(asView === true ? { asView: true } : {}),
                ...(branch == null ? {} : { worktree: { branch }, ...(filesAfterTurn === true ? { filesAfterTurn: true } : {}) }),
                ...(provider == null ? {} : { provider }),
                ...(selection == null ? {} : { selection })
            });
            machine.revealFork(result);
            return { output: { chatId: result.nodeId, nodeId: result.nodeId, viewId: result.viewId, chat: named, branch: result.worktree?.branch ?? null } };
        },
        'chat.summarize': async ({ chatId }, call) => {
            const chat = chatNamed(chatId, call);
            const { info } = rowOf(chatId, chat);
            if (!info.forkOf) {
                throw new ActionRefusal('not-a-fork', `“${chat}” is not a fork, so it has no original to write to.`);
            }
            const original = sessionTitle(document, info.forkOf.chatId, 'chat');
            if (call.actor.kind !== 'person') {
                const refusal = summaryRefusal({ busy: info.activeTurnId !== null, originalPresent: original !== null });
                if (refusal !== null) {
                    throw new ActionRefusal('cannot-summarize', refusal);
                }
            }
            const { turnId } = await ask('chat.summarize', { chatId });
            return { output: { chatId, chat, turnId, original: original ?? info.forkOf.chatId } };
        },
        'chat.turnDiff': async ({ chatId, turnId }, call) => {
            chatNamed(chatId, call);
            const { diff } = await ask('chat.turnDiff', { chatId, turnId });
            return { output: { chatId, turnId, diff } };
        },
        'chat.readSubagent': async ({ chatId, toolUseId, limit }, call) => {
            chatNamed(chatId, call);
            // No watch flag: a person reading the same sub-agent keeps being told as before.
            const page = await ask('chat.subagent', { chatId, toolUseId, limit: SUBAGENT_PAGE });
            return { output: { chatId, toolUseId, live: page.live, ...recentSubagentMessages(page.items, limit ?? DEFAULT_SUBAGENT_MESSAGES) } };
        },
        'chat.stopSubagent': async ({ chatId, toolUseId }, call) => {
            const chat = chatNamed(chatId, call);
            const row = call.actor.kind === 'person' ? machine.chat(chatId) : openRowOf(chatId, chat);
            const item = row === null ? undefined : threadOf(row).find((candidate) => candidate.kind === 'subagent' && candidate.toolUseId === toolUseId);
            const subagent = item?.kind === 'subagent' ? subagentTitle(item) : toolUseId;
            if (call.actor.kind !== 'person') {
                const stop = item?.kind === 'subagent' ? stopOf(item, row?.info.activeTurnId != null) : null;
                if (stop === null) {
                    throw new ActionRefusal(
                        'not-stoppable',
                        item
                            ? `“${subagent}” cannot be stopped now: it is not running, or it belongs to the turn that runs.`
                            : `“${chat}” has no sub-agent ${toolUseId}.`
                    );
                }
                if (asksFirst(call)) {
                    const agents =
                        stop === 'task' && item?.kind === 'subagent' && item.childId !== undefined
                            ? await agentsEndedWith(machine.transport(), [item.childId])
                            : 0;
                    return {
                        confirmation: {
                            title: `Stop “${subagent}”?`,
                            consequences:
                                stop === 'task'
                                    ? [
                                          'The agent working on this task ends unfinished and the task is cancelled, without waking the chat that gave it. Its node stays with what it did so far.',
                                          ...(agents === 0 ? [] : [`The ${plural(agents, 'agent')} it opened end as well.`])
                                      ]
                                    : ['It is marked stopped. The turn that ran it is already over, so nothing more is lost.']
                        }
                    };
                }
            }
            await ask('chat.stopSubagent', { chatId, toolUseId });
            return { output: { chatId, chat, toolUseId, subagent } };
        },
        'chat.stopTask': async ({ chatId, taskId }, call) => {
            const chat = chatNamed(chatId, call);
            const task = machine.chat(chatId)?.info.background?.find((entry) => entry.id === taskId);
            const named = task?.description || task?.command || taskId;
            if (call.actor.kind !== 'person' && !task) {
                throw new ActionRefusal('unknown-task', `“${chat}” runs no background task ${taskId}.`);
            }
            if (asksFirst(call)) {
                return {
                    confirmation: {
                        title: `Stop the background ${task?.kind === 'monitor' ? 'monitor' : 'command'} “${named}” of “${chat}”?`,
                        consequences: ['It ends now, unfinished. Whatever it would still have done or reported is lost.']
                    }
                };
            }
            await ask('chat.stopTask', { chatId, taskId });
            return { output: { chatId, chat, taskId, task: named } };
        },
        'chat.answer': async ({ chatId, requestId, answers }, call) => {
            const chat = chatNamed(chatId, call);
            const given = new Map(answers.map((entry) => [entry.questionId, entry.answer]));
            if (call.actor.kind !== 'person') {
                const item = pendingQuestion(openRowOf(chatId, chat), (candidate) => candidate.requestId === requestId);
                if (item === null) {
                    throw new ActionRefusal('unknown-question', `No question ${requestId} of “${chat}” waits for an answer.`);
                }
                const known = new Set(item.questions.map((question) => question.id));
                const unknown = [...given.keys()].filter((id) => !known.has(id));
                if (unknown.length > 0) {
                    throw new ActionRefusal('unknown-question', `The question has no part ${quotedList(unknown)}. Its parts are ${quotedList([...known])}.`);
                }
                const missing = item.questions.filter((question) => !given.has(question.id));
                if (missing.length > 0) {
                    throw new ActionRefusal(
                        'unanswered',
                        `Every part is answered at once; ask the user about ${quotedList(missing.map((question) => question.question))}.`
                    );
                }
                if (asksFirst(call)) {
                    return {
                        confirmation: {
                            title: `Send this answer to “${chat}”?`,
                            consequences: [
                                ...item.questions.map((question) => `${question.question} Answer: “${given.get(question.id)}”.`),
                                'The agent goes on with it; an answer cannot be taken back.'
                            ]
                        }
                    };
                }
            }
            await ask('chat.answer', { chatId, requestId, answers: Object.fromEntries(given) });
            return { output: { chatId, chat, requestId } };
        },
        'chat.dismissQuestion': async ({ chatId, itemId }, call) => {
            const chat = chatNamed(chatId, call);
            if (call.actor.kind !== 'person') {
                const item = pendingQuestion(openRowOf(chatId, chat), (candidate) => candidate.id === itemId);
                if (item === null) {
                    throw new ActionRefusal('unknown-question', `No question ${itemId} of “${chat}” waits for an answer.`);
                }
                if (item.async !== true) {
                    throw new ActionRefusal('not-optional', 'This question holds the agent up until it is answered, so it cannot be dismissed.');
                }
                if (asksFirst(call)) {
                    return {
                        confirmation: {
                            title: `Leave the question of “${chat}” unanswered?`,
                            consequences: [
                                ...item.questions.map((question) => `“${question.question}” stays unanswered.`),
                                'The agent is not told and goes on as it was.'
                            ]
                        }
                    };
                }
            }
            await ask('chat.dismiss', { chatId, itemId });
            return { output: { chatId, chat, itemId } };
        },
        'chat.approve': async ({ chatId, requestId, decision, message }, call) => {
            const chat = chatNamed(chatId, call);
            await ask('chat.approve', { chatId, requestId, decision, ...(message == null ? {} : { message }) });
            return { output: { chatId, chat, requestId } };
        },
        'terminal.answerApproval': async ({ terminalId, requestId, choiceId }, call) => {
            const terminal = terminalNamed(terminalId, call);
            // Settled already is an answer, not a failure: another client was first, or the CLI's own prompt was.
            const accepted = await connected()
                .request('agent.answerApproval', { sessionId: terminalId, requestId, choiceId })
                .then((result) => result.accepted)
                .catch(() => false);
            return { output: { terminalId, terminal, accepted } };
        },
        'terminal.stop': async ({ terminalId }, call) => {
            const terminal = terminalNamed(terminalId, call);
            const state = machine.terminal(terminalId);
            if (call.actor.kind !== 'person' && state?.exited !== undefined) {
                throw new ActionRefusal('not-running', `The shell of “${terminal}” has already ended.`);
            }
            if (asksFirst(call)) {
                const agents = await agentsEndedWith(machine.transport(), [terminalId]);
                return {
                    confirmation: {
                        title: `Stop the session of “${terminal}”?`,
                        consequences: [
                            state?.agent?.live === true
                                ? 'The shell and the agent working in it end now, unfinished.'
                                : 'The shell and everything running in it end now, unfinished.',
                            'Its scrollback and the agent session it could resume from are removed. The node stays and offers a restart.',
                            ...(agents === 0 ? [] : [`The ${plural(agents, 'agent')} it opened end as well; their nodes stay with what they did so far.`])
                        ]
                    }
                };
            }
            // Straight to the machine: the session client's kill forgets the node, which then never hears that its shell ended.
            await ask('session.kill', { sessionId: terminalId });
            return { output: { terminalId, terminal } };
        },
        'terminal.resumeAgent': async ({ terminalId }, call) => {
            const terminal = terminalNamed(terminalId, call);
            const state = machine.terminal(terminalId);
            if (state?.exited === undefined) {
                await ask('agent.resume', { sessionId: terminalId });
                return { output: { terminalId, terminal } };
            }
            // The CLI went down with the shell without its hooks reporting an end, so its session is still there to go on with.
            if (state.agent?.status !== 'exited') {
                throw new ActionRefusal('nothing-to-resume', `No agent session of “${terminal}” is left to resume; terminal.restart starts a fresh shell.`);
            }
            await machine.restartTerminal(terminalId, state.agent.agentSessionId);
            return { output: { terminalId, terminal } };
        },
        'terminal.restart': async ({ terminalId }, call) => {
            const terminal = terminalNamed(terminalId, call);
            const state = machine.terminal(terminalId);
            if (state === null) {
                throw new ActionRefusal('terminal-not-open', `Open “${terminal}” before restarting it; this window has not drawn it yet.`);
            }
            if (state.exited === undefined) {
                throw new ActionRefusal('still-running', `The shell of “${terminal}” still runs; only an ended shell starts over.`);
            }
            if (asksFirst(call)) {
                const launch = machine.terminalHost(terminalId);
                const providerName = machine.providers().find((provider) => provider.kind === launch?.provider)?.name ?? null;
                return {
                    confirmation: {
                        title: `Restart “${terminal}”?`,
                        consequences: [startsAgain(launch, providerName), 'The scrollback of the ended shell is gone.']
                    }
                };
            }
            await machine.restartTerminal(terminalId, null);
            return { output: { terminalId, terminal } };
        },
        'plan.list': ({ chatId }, call) => ({ output: { plans: machine.plans(chatOfPlan(chatId, call)).toReversed() } }),
        'plan.read': ({ chatId, planId }, call) => {
            const chat = chatOfPlan(chatId, call);
            const plans = machine.plans(chat);
            if (plans.length === 0) {
                return { output: { plan: null, others: [] } };
            }
            const plan = planOf(chat, planId);
            return { output: { plan, others: plans.filter((other) => other.id !== plan.id).toReversed() } };
        },
        'plan.setStepState': async ({ chatId, planId, stepIds, state, note }, call) => {
            const chat = chatOfPlan(chatId, call);
            const plan = planOf(chat, planId);
            if (call.actor.kind !== 'person') {
                // Voice speaks for the user, but a step the plan leaves to the user alone waits for their own hand.
                for (const stepId of stepIds) {
                    const step = findItem(plan, stepId);
                    if (step?.type === 'step' && effectiveChecks(plan, step) === 'person') {
                        throw new ActionRefusal('person-only', `Only the user checks “${step.title}”; they tick it in the plan panel.`);
                    }
                }
            }
            return planChanged(chat, plan.id, [{ op: 'set', ids: stepIds, state, ...(note == null ? {} : { note }) }]);
        },
        'plan.addNote': ({ chatId, planId, stepId, text }, call) => {
            const chat = chatOfPlan(chatId, call);
            return planChanged(chat, planId, [{ op: 'note', id: stepId, text }]);
        },
        'plan.unlock': ({ chatId, planId, stepIds }, call) => planChanged(chatOfPlan(chatId, call), planId, [{ op: 'unlock', ids: stepIds ?? 'all' }])
    };
}
