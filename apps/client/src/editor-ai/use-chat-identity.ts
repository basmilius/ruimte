import { useMemo } from 'react';
import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { chooserChats } from '@/chat/chat-chooser';
import { useSidebarSource } from '@/shell/sidebar-source';

/* The chat that wrote something, as the project shows it now. */
export interface ChatIdentity {
    /* False once the chat is gone from the project, which leaves the card without a way to open it. */
    exists: boolean;
    title: string | null;
}

export function useChatIdentity(chatId: string): ChatIdentity {
    const source = useSidebarSource();
    return useMemo(() => {
        const chat = chooserChats(source).find((candidate) => candidate.id === chatId);
        return { exists: chat !== undefined, title: chat?.title ?? null };
    }, [source, chatId]);
}

/* A CLI's name as the app calls it, such as Claude Code; the kind itself where the machine does not list it. */
export function providerNameOf(providers: readonly ProviderInfo[], kind: AgentKind | undefined): string {
    return providers.find((provider) => provider.kind === kind)?.name ?? kind ?? '';
}

export function useProviderName(kind: AgentKind | undefined): string {
    return providerNameOf(
        useProviders((s) => s.providers),
        kind
    );
}
