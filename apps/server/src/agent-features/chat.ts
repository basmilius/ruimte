import type { ChatAttachment } from '@ruimte/contracts';
import { chatAttachActions } from '../actions/chat-attach-actions.ts';
import { chatToolkit } from '../tools/chat-tools.ts';
import { defineAgentFeature } from './feature.ts';

/* Puts an image or a model the caller's agent has of its own in the thread of its chat; the bytes arrive checked. */
interface AgentImageHost {
    attach(chatId: string, upload: { name: string; mime: string; bytes: Uint8Array }): Promise<ChatAttachment>;
}

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The images and models the caller's own chat holds from its agent; absent on a host that keeps none. */
        agentImages?: AgentImageHost;
    }
}

export const chatFeature = defineAgentFeature({
    name: 'chat',
    toolkit: chatToolkit,
    actions: chatAttachActions,
    host: ({ agents }) => ({ agentImages: { attach: (chatId, upload) => agents.chatManager.attachAgentImage(chatId, upload) } })
});
