import type { ReactElement, ReactNode } from 'react';
import { ChatScopeContext } from '@ruimte/agents-react/scope';
import { useEndpointId } from '@/state/keys';
import { chatScopeOf } from '@/transport/chat-scope';

/* The machine a chat under it runs on: the workspace's inside one, the active machine around it, the way `useEndpointId` reads it. */
export function ChatScopeProvider({ children }: { children: ReactNode }): ReactElement {
    const endpointId = useEndpointId();
    return <ChatScopeContext.Provider value={chatScopeOf(endpointId)}>{children}</ChatScopeContext.Provider>;
}
