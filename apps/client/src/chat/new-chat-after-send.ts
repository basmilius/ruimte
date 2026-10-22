import { rememberChatSelection } from '@adecore/agents-react/chat';
import { useChats } from '@adecore/agents-react/state';
import { createNodeAction, createViewAction } from '@/actions/client-actions';
import { openChatInMode } from '@/chat/opening-mode';
import { readNodeHost } from '@/nodes/node-host';
import { newChatOn } from '@/project/new-chat';
import { canvasOfNode, liveCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { isScratchProject, useProject } from '@/state/project';

/*
 * The new chat Mod+Alt+Enter opens once its message went: beside the chat it was sent from, on the
 * same CLI, account, model and modes, with the keyboard in its composer. A view gets a view and a node
 * a node on the same canvas; in the Chats project it is a chat of its own there, the way New Chat
 * makes one.
 */
export async function openNewChatAfterSend(endpointId: string, chatId: string): Promise<void> {
    if (endpointId !== currentEndpointId()) {
        return;
    }
    const info = useChats.getState().byKey[endpointKey(endpointId, chatId)]?.info;
    const host = readNodeHost(chatId);
    if (info === undefined || host === null) {
        return;
    }
    // A new chat starts on the remembered model, so the one this chat runs on becomes it. The mode goes to the new chat alone.
    rememberChatSelection(info.provider, info.selection);
    // A chat that was not opened for one CLI stays free to move to another, so only a fixed one names its CLI.
    const agent = host.provider === undefined ? {} : { provider: info.provider, ...(info.account === undefined ? {} : { account: info.account }) };
    if (isScratchProject(useProject.getState().current)) {
        if (await newChatOn(endpointId, agent, info.runtimeMode)) {
            useDocument.getState().setBodyFocused(true);
        }
        return;
    }
    const session = { ...agent, ...(host.cwd === undefined ? {} : { cwd: host.cwd }) };
    if (!host.onCanvas) {
        const viewId = await createViewAction('chat', session);
        if (viewId !== null) {
            openChatInMode(endpointId, viewId, info.runtimeMode);
            useDocument.getState().setBodyFocused(true);
        }
        return;
    }
    const canvasViewId = liveCanvases().find(([, canvas]) => canvas.nodes[chatId] !== undefined)?.[0];
    const nodeId = await createNodeAction('chat', { ...session, viewId: canvasViewId ?? null });
    if (nodeId !== null) {
        openChatInMode(endpointId, nodeId, info.runtimeMode);
        canvasOfNode(nodeId)?.getState().setBodyFocus(nodeId);
    }
}
