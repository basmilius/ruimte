import { useProviders } from '@adecore/agents-react/state';
import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import { chooserChats } from '@/language/chat-chooser';
import { useProjectSource } from '@/project/project-source';

/* The chat that wrote something, as the project shows it now. */
interface ChatIdentity {
    /* False once the chat is gone from the project, which leaves the card without a way to open it. */
    exists: boolean;
    title: string | null;
}

export function useChatIdentity(chatId: string): ChatIdentity {
    const source = useProjectSource();
    const chat = chooserChats(source.views, source.nodesOf).find((candidate) => candidate.id === chatId);
    return { exists: chat !== undefined, title: chat?.title ?? null };
}

/* A CLI's name as the app calls it, such as Claude Code; the kind itself where the machine does not list it. */
export function providerNameOf(providers: readonly ProviderInfo[], kind: AgentKind | undefined): string {
    return providers.find((provider) => provider.kind === kind)?.name ?? kind ?? '';
}

export function useProviderName(kind: AgentKind | undefined): string {
    const providers = useProviders((s) => s.providers);
    return providerNameOf(providers, kind);
}
