import type { AgentLineageStore, TaskCoordinator } from '@adecore/agents/coordination';
import type { ChatContinueOnPayload, ChatContinueOnResult, ChatForkPayload, ChatForkResult, ChatTurnLimit, RuntimeMode } from '@ruimte/contracts';
import type { ChatManager } from './chat-manager.ts';
import { ChatError } from './errors.ts';
import type { ForkOpener } from './fork.ts';

interface ContinueOnDeps {
    chats: ChatManager;
    tasks: Pick<TaskCoordinator, 'handOver'>;
    lineage: Pick<AgentLineageStore, 'startedBy' | 'peerOf' | 'depthOf' | 'ceilingOf'>;
    fork(payload: ChatForkPayload, opener: ForkOpener | undefined): Promise<ChatForkResult>;
}

/*
 * Goes on after a turn that stopped on a limit under another account, only because a person asked.
 * An account that reads the chat's transcripts takes the chat over in place; any other gets a fork
 * cut after the limited turn, which takes over the chat's place, its opener and its open task. The
 * original's resume at the reset lapses either way.
 */
export async function continueOn(deps: ContinueOnDeps, payload: ChatContinueOnPayload): Promise<ChatContinueOnResult> {
    if (deps.chats.core.isRelocating(payload.chatId)) {
        throw new ChatError('chat-busy', 'The chat is being moved to a project; go on under another account once that is done');
    }
    const { turnId, limit, inPlace } = await deps.chats.limitedTurnFor(payload.chatId, payload.account);
    if (inPlace) {
        deps.chats.continueInPlace(payload.chatId, payload.account);
        return { chatId: payload.chatId };
    }
    const opener = openerOf(deps.lineage, payload.chatId, deps.chats.core.require(payload.chatId).info.runtimeMode);
    const fork = await deps.fork({ chatId: payload.chatId, turnId, account: payload.account }, opener);
    deps.chats.continuedInFork(payload.chatId, fork.info.account);
    const task = await deps.tasks.handOver(payload.chatId, fork.info.chatId);
    await deps.chats.continueInFork(fork.info.chatId, limit, task === null ? [] : [task.id]);
    return { chatId: fork.info.chatId, fork };
}

/*
 * The agent that opened the chat here, so the fork is its child with the chat's depth and ceiling; none for a chat
 * a person opened, or one an agent on another machine opened. Taking over is no new start, so it counts nothing.
 */
function openerOf(lineage: ContinueOnDeps['lineage'], chatId: string, mode: RuntimeMode): ForkOpener | undefined {
    const id = lineage.startedBy(chatId);
    if (id === null || lineage.peerOf(chatId) !== null) {
        return undefined;
    }
    return { id, depth: lineage.depthOf(chatId), ceiling: lineage.ceilingOf(chatId) ?? mode, recount: () => {} };
}

/*
 * The turn that takes a limited one up under another account a person picked: in the chat itself, or
 * in the fork that got its conversation handed over, whose own note already says where it came from.
 */
export function continueOnWake(kind: ChatTurnLimit['kind'], account: string, forked: boolean): { text: string; label: string; note?: string } {
    const reason = kind === 'usage' ? 'stopped on a usage limit' : 'stopped because the model was overloaded';
    const label = `Continued on ${account}`;
    if (forked) {
        return { text: `The last turn of the conversation you took over ${reason}. Continue where it left off.`, label };
    }
    return {
        text: `Your previous turn ${reason}. You now run under another account; continue where you left off.`,
        label,
        note: `Continued under the account '${account}' after the previous turn ${reason}`
    };
}

export function continuedInForkNote(account: string): string {
    return `Continued under the account '${account}' in a fork`;
}
