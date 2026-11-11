import { forkRefusal } from '@adecore/agents-react/chat';
import type { ChatThreadInfo, ChatThreadItem } from '@adecore/agents-react/state';
import type { ProviderInfo } from '@ruimte/contracts';

interface HostProviders {
    readonly providers: readonly ProviderInfo[];
    readonly loaded: boolean;
}

/* Whether the machine lists no provider of this chat any more, such as one a release removed. */
export function chatProviderGone(info: ChatThreadInfo | null, providers: readonly ProviderInfo[]): boolean {
    return info !== null && providers.length > 0 && !providers.some((entry) => entry.kind === info.provider);
}

/* As `forkRefusal`, except that a chat on a provider that is gone goes on with another one, the only way it can. */
export function chatForkRefusal(info: ChatThreadInfo | null, turn: ChatThreadItem | undefined, host: HostProviders): string | null {
    return turn?.kind === 'turn' && chatProviderGone(info, host.providers) ? null : forkRefusal(info, turn, host);
}
