import type { ChatMovePayload, ChatMoveResult } from '@ruimte/contracts';
import { listProjects } from '@/clients/project/list';
import { showChatIn } from '@/project/new-chat';
import { transportFor } from '@/transport';
import { TransportError, fireAndForget } from '@/transport-api/transport';
import { ensureMachine } from '@/workspace/reach';

/*
 * Asks a machine to move a chat of Chats into a project and follows it only after the answer, along
 * the path a new chat takes: a refusal leaves the window where it was.
 */
export async function moveChatOn(endpointId: string, payload: ChatMovePayload): Promise<ChatMoveResult> {
    const id = await ensureMachine(endpointId);
    const transport = transportFor(id);
    if (!transport) {
        throw new TransportError('not-connected', 'This machine cannot be reached');
    }
    const result = await transport.request('chat.move', payload);
    void fireAndForget('listProjects', listProjects(id));
    await showChatIn(id, result.summary.projectId, result.viewId);
    return result;
}
