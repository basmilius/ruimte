import { CodedError } from '@adecore/agents';
import type { ChatCore } from '@adecore/agents/chat';
import { chatHandlers, type AgentHandler } from '@adecore/agents/host';
import type {
    ChatContinueOnPayload,
    ChatContinueOnResult,
    ChatForkInfoPayload,
    ChatForkInfoResult,
    ChatForkPayload,
    ChatForkResult,
    ChatHandoffPayload,
    ChatHandoffResult,
    ChatMoveInfoPayload,
    ChatMoveInfoResult,
    ChatMovePayload,
    ChatMoveResult,
    ChatSummarizeResult
} from '@ruimte/contracts';
import type { Area } from '../area.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { refuseBoundNode, type MachineOfNode } from '../peer/giver/bound-nodes.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { registerAgentHandlers } from './agent.ts';
import type { BeforeKill } from './session.ts';

interface ChatForkHandlers {
    fork(payload: ChatForkPayload): Promise<ChatForkResult>;
    info(payload: ChatForkInfoPayload): Promise<ChatForkInfoResult>;
    handoff(payload: ChatHandoffPayload): Promise<ChatHandoffResult>;
    summarize(chatId: string): Promise<ChatSummarizeResult>;
    continueOn(payload: ChatContinueOnPayload): Promise<ChatContinueOnResult>;
}

export interface ChatMoveHandlers {
    info(payload: ChatMoveInfoPayload): Promise<ChatMoveInfoResult>;
    move(payload: ChatMovePayload): Promise<ChatMoveResult>;
}

export interface ChatDeps {
    manager: ChatCore;
    providers: ProviderRegistry;
    beforeKill: BeforeKill;
    stopNode(nodeId: string, reason: string): Promise<void>;
    forks: ChatForkHandlers;
    moves: ChatMoveHandlers;
    machineOf: MachineOfNode;
    /* Whether another machine's task still has this chat to start, which only the daemon may do: a window would start it in the wrong folder. */
    starting(chatId: string): boolean;
    skills: RuimteSkillPrompts;
}

/* What a person's prompt that names a Ruimte skill takes along. */
export interface RuimteSkillPrompts {
    /* The note the chat hears in front of the prompt, or undefined for a prompt that names no Ruimte skill. */
    brief(chatId: string, text: string): string | undefined;
    names(): readonly string[];
}

export function chatArea(deps: ChatDeps): Area {
    const { manager } = deps;

    return {
        name: 'chat',
        sources: [manager],
        holders: [manager],
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        stop: [
            // Before anything is awaited: a `bun --watch` reload restarts the module during the first await, so a turn in flight would otherwise never reach its file.
            { phase: 'halt', label: 'Writing chats at once', run: () => manager.persistAllSync() },
            { phase: 'drain', label: 'Writing chats', run: () => manager.shutdown() }
        ]
    };
}

function registerRequests(dispatcher: Dispatcher, { manager, providers, beforeKill, stopNode, forks, moves, machineOf, starting, skills }: ChatDeps): void {
    // What the daemon answers differently from a host of chats alone: a task's row stops its node, a stop or a
    // removal first owes the end of the agents a chat opened, and a fork lands on the canvas.
    const {
        'chat.stopSubagent': _stopSubagent,
        'chat.cancel': _cancel,
        'chat.kill': _kill,
        'chat.fork': _fork,
        'chat.forkInfo': _forkInfo,
        'chat.summarize': _summarize,
        'chat.continueOn': _continueOn,
        ...shared
    } = chatHandlers(manager, providers);
    const unlessBound =
        <T extends 'chat.create' | 'chat.attach' | 'chat.toolOutput'>(handler: AgentHandler<T>): AgentHandler<T> =>
        (payload, clientId) => {
            refuseBoundNode(machineOf, payload.chatId);
            return handler(payload, clientId);
        };
    // An attach that carries `create` makes the chat as `chat.create` would, so it passes the same guard; one without it only reads.
    const unlessStarting =
        <T extends 'chat.create' | 'chat.attach'>(handler: AgentHandler<T>, creates: (payload: Parameters<AgentHandler<T>>[0]) => boolean): AgentHandler<T> =>
        (payload, clientId) => {
            if (creates(payload) && starting(payload.chatId)) {
                throw new CodedError('peer-task-starting', 'A task from another machine is still starting this chat. Try again in a moment');
            }
            return handler(payload, clientId);
        };
    // A Ruimte skill is no skill of the CLI, which would run a picked one as a command it does not have; the brief carries it instead.
    const send: AgentHandler<'chat.send'> = (payload) => {
        const ruimte = new Set(skills.names());
        const brief = skills.brief(payload.chatId, payload.text);
        const picked = payload.skills?.filter((name) => !ruimte.has(name));

        return manager.send(
            payload.chatId,
            payload.text,
            {
                delivery: payload.delivery,
                mentions: payload.mentions,
                skills: picked,
                chats: payload.chats,
                quoteSource: payload.quoteSource,
                references: payload.references,
                ...(brief === undefined ? {} : { brief })
            },
            payload.attachments
        );
    };
    registerAgentHandlers(dispatcher, {
        ...shared,
        'chat.send': send,
        'chat.create': unlessBound(unlessStarting(shared['chat.create'], () => true)),
        'chat.attach': unlessBound(unlessStarting(shared['chat.attach'], (payload) => payload.create !== undefined)),
        'chat.toolOutput': unlessBound(shared['chat.toolOutput'])
    });

    dispatcher.register('chat.stopSubagent', async (payload) => {
        await manager.stopSubagent(payload.chatId, payload.toolUseId, stopNode);
        return {};
    });

    dispatcher.register('chat.fork', (payload) => forks.fork(payload));

    dispatcher.register('chat.forkInfo', (payload) => forks.info(payload));

    dispatcher.register('chat.handoff', (payload) => forks.handoff(payload));

    dispatcher.register('chat.summarize', (payload) => forks.summarize(payload.chatId));

    dispatcher.register('chat.continueOn', (payload) => forks.continueOn(payload));

    dispatcher.register('chat.moveInfo', (payload) => moves.info(payload));
    dispatcher.register('chat.move', (payload) => moves.move(payload));

    dispatcher.register('chat.cancel', async (payload) => {
        // Owed on disk before the turn stops, so a restart in between still ends the agents it opened.
        if (payload.subagents === true && manager.get(payload.chatId)) {
            await beforeKill(payload.chatId);
        }
        manager.cancel(payload.chatId, payload.subagents === true);
        return {};
    });

    dispatcher.register('chat.kill', async (payload) => {
        await beforeKill(payload.chatId);
        await manager.kill(payload.chatId);
        return {};
    });
}
