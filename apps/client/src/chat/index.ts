import { useChats } from '@/state/chats';
import { useProviders } from '@/state/providers';
import { transport } from '@/transport';
import { ChatClient } from '@/chat/chat-client';

export type { ChatSendExtras } from '@/chat/chat-client';

export const chatClient = new ChatClient(transport, useChats.getState(), useProviders.getState());
