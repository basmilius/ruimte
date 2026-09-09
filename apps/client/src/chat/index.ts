import { useChats } from '@/state/chats';
import { transport } from '@/transport';
import { ChatClient } from '@/chat/chat-client';

export const chatClient = new ChatClient(transport, useChats.getState());
