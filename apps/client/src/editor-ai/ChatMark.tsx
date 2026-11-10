import { hasProviderLogo, ProviderLogo } from '@adecore/agents-react/providers';
import type { AgentKind } from '@ruimte/contracts';

/* An agent's mark in the color of its chat; an agent without a mark of its own is a dot. */
export function ChatMark({ provider, color, size }: { provider: AgentKind | null | undefined; color: string; size: number }) {
    return (
        <span className="flex shrink-0 items-center" style={{ color: `var(${color})` }}>
            {hasProviderLogo(provider) ? <ProviderLogo provider={provider} size={size} /> : <span className="size-2 rounded-full bg-current" />}
        </span>
    );
}
