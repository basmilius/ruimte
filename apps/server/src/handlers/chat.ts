import { CodedError } from '@adecore/agents';
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
import type { ChatManager } from '../chat/chat-manager.ts';
import { ChatError } from '../chat/errors.ts';
import type { Dispatcher } from '../dispatcher.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { refuseBoundNode, type MachineOfNode } from '../remote/bound-nodes.ts';
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

export function registerChatHandlers(
    dispatcher: Dispatcher,
    manager: ChatManager,
    providers: ProviderRegistry,
    beforeKill?: BeforeKill,
    stopNode?: (nodeId: string, reason: string) => Promise<void>,
    forks?: ChatForkHandlers,
    killed?: (chatId: string) => Promise<void>,
    moves?: ChatMoveHandlers,
    machineOf?: MachineOfNode,
    /* Whether another machine's task still has this chat to start, which only the daemon may do: a window would start it in the wrong folder. */
    starting?: (chatId: string) => boolean
): void {
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
    const unlessStarting =
        (handler: AgentHandler<'chat.create'>): AgentHandler<'chat.create'> =>
        (payload, clientId) => {
            if (starting?.(payload.chatId) === true) {
                throw new CodedError('peer-task-starting', 'A task from another machine is still starting this chat. Try again in a moment');
            }
            return handler(payload, clientId);
        };
    registerAgentHandlers(dispatcher, {
        ...shared,
        'chat.create': unlessBound(unlessStarting(shared['chat.create'])),
        'chat.attach': unlessBound(shared['chat.attach']),
        'chat.toolOutput': unlessBound(shared['chat.toolOutput'])
    });

    dispatcher.register('chat.stopSubagent', async (payload) => {
        await manager.stopSubagent(payload.chatId, payload.toolUseId, stopNode);
        return {};
    });

    const forking = (): ChatForkHandlers => {
        if (!forks) {
            throw new ChatError('chat-unsupported', 'This machine does not fork chats');
        }
        return forks;
    };

    dispatcher.register('chat.fork', (payload) => forking().fork(payload));

    dispatcher.register('chat.forkInfo', (payload) => forking().info(payload));

    dispatcher.register('chat.handoff', (payload) => forking().handoff(payload));

    dispatcher.register('chat.summarize', (payload) => forking().summarize(payload.chatId));

    dispatcher.register('chat.continueOn', (payload) => forking().continueOn(payload));

    // Left unregistered without them, so `features` only names what this machine answers.
    if (moves) {
        dispatcher.register('chat.moveInfo', (payload) => moves.info(payload));
        dispatcher.register('chat.move', (payload) => moves.move(payload));
    }

    dispatcher.register('chat.cancel', async (payload) => {
        // Owed on disk before the turn stops, so a restart in between still ends the agents it opened.
        if (payload.subagents === true && manager.get(payload.chatId)) {
            await beforeKill?.(payload.chatId);
        }
        manager.cancel(payload.chatId, payload.subagents === true);
        return {};
    });

    dispatcher.register('chat.kill', async (payload) => {
        await beforeKill?.(payload.chatId);
        await manager.kill(payload.chatId);
        await killed?.(payload.chatId);
        return {};
    });
}
