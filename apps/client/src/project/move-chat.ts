import type { ChatMovePayload, ChatMoveResult } from '@ruimte/contracts';
import { ensureMachine } from '@/endpoint/reach';
import { listProjects } from '@/project/list';
import { showChatIn } from '@/project/new-chat';
import { transportFor } from '@/transport';
import { TransportError } from '@/transport-api/transport';

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
    void listProjects(id).catch(() => undefined);
    await showChatIn(id, result.summary.projectId, result.viewId);
    return result;
}
