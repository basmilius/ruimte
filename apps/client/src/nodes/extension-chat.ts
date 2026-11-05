import { lazyNamed } from '@adecore/ui';
import { provideExtensionChatBody } from '@/extensions/host/extension-chat-body';

/* The workspace draws chats, and an extension may draw on the start screen too, so the body comes only once one is asked for. */
export function provideExtensionChat(): void {
    provideExtensionChatBody(lazyNamed(() => import('@/nodes/ChatBody'), 'ChatBody'));
}
