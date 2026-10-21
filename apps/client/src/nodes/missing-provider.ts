import type { AgentKind } from '@ruimte/contracts';
import type { ProvidersRow } from '@adecore/agents-react/state';

export interface MissingProvider {
    name: string;
    /* False for a kind the machine does not offer at all, which nothing installs. */
    installable: boolean;
}

/*
 * The CLI a node runs that its machine lacks, or null while the list is not in or the CLI is there.
 * A provider with no terminal (the local model) is turned on in its own settings, not installed.
 */
export function missingProvider(row: ProvidersRow | undefined, kind: AgentKind | undefined): MissingProvider | null {
    if (kind === undefined || row === undefined || !row.loaded) {
        return null;
    }
    const provider = row.providers.find((entry) => entry.kind === kind);
    if (provider === undefined) {
        return { name: kind, installable: false };
    }
    return provider.installed || !provider.capabilities.terminal ? null : { name: provider.name, installable: true };
}
