import { forkRefusal } from '@adecore/agents-react/chat';
import type { ChatInfo, ChatItem, ProviderInfo } from '@ruimte/contracts';

/* Whether the machine lists no provider of this chat any more, such as one a release removed. */
export function chatProviderGone(info: ChatInfo | null, providers: readonly ProviderInfo[]): boolean {
    return info !== null && providers.length > 0 && !providers.some((entry) => entry.kind === info.provider);
}

/* As `forkRefusal`, except that a chat on a provider that is gone goes on with another one, the only way it can. */
export function chatForkRefusal(info: ChatInfo | null, turn: ChatItem | undefined, providers: readonly ProviderInfo[]): string | null {
    return turn?.kind === 'turn' && chatProviderGone(info, providers) ? null : forkRefusal(info, turn);
}
