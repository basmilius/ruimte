import type { AgentKind } from '@ruimte/contracts';
import { ProviderLogo } from '@adecore/agents-react/agents/ProviderLogo';

/* An agent's mark in the color of its chat; an agent without a mark of its own is a dot. */
export function ChatMark({ provider, color, size }: { provider: AgentKind | null | undefined; color: string; size: number }) {
    const logo = provider === 'claude' || provider === 'codex' ? provider : null;
    return (
        <span className="flex shrink-0 items-center" style={{ color: `var(${color})` }}>
            {logo === null ? <span className="size-2 rounded-full bg-current" /> : <ProviderLogo provider={logo} size={size} />}
        </span>
    );
}
