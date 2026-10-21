import type { AgentKind, UsageProvider } from '@ruimte/contracts';

/* Whether the shared `ProviderLogo` draws this kind; every other kind takes `AgentIcon`. */
export function hasProviderLogo(kind: AgentKind | null | undefined): kind is UsageProvider {
    return kind === 'claude' || kind === 'codex';
}
