import { chatAttachActions } from '../actions/chat-attach-actions.ts';
import { chatToolkit } from '../tools/chat-tools.ts';
import { defineAgentFeature } from './feature.ts';

export const chatFeature = defineAgentFeature({
    name: 'chat',
    toolkit: chatToolkit,
    actions: chatAttachActions,
    host: ({ agents }) => ({ agentImages: { attach: (chatId, upload) => agents.chats.attachAgentImage(chatId, upload) } })
});
