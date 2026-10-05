import type { ProviderInfo } from '@ruimte/contracts';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { availableAgents } from '@/agents/creation';

/* The two CLIs the editor offers a question to; the chooser lists every agent the app has. */
const ASKED: readonly string[] = ['claude', 'codex'];

/* Which of them are installed and can chat, in the order they are asked in. */
export function useAskAgents(): ProviderInfo[] {
    const providers = useProviders((s) => s.providers);
    return availableAgents(providers, 'chat')
        .filter((provider) => ASKED.includes(provider.kind))
        .sort((left, right) => ASKED.indexOf(left.kind) - ASKED.indexOf(right.kind));
}
