import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { agentDefaultCatalog, agentModel, createAcpProvider, ModelCatalog, type ChatProvider } from '@adecore/agents/providers';
import { extensionAgentKind } from '@ruimte/contracts/extension-providers';
import { RUIMTE_ACP_CLIENT } from '../providers/acp-providers.ts';
import { withRuimteMcp } from '../ruimte-mcp.ts';
import type { AgentProviderDescription } from './descriptions.ts';

/* An agent provider an enabled extension lists: with what its process described, or null while that process did not say. */
export interface ListedAgentProvider {
    extension: string;
    id: string;
    /* The version of the extension, which is what a picker shows as the agent's. */
    version: string;
    described: AgentProviderDescription | null;
}

/* The registry of the machine's providers, as far as an extension's agent joins and leaves it. */
interface OfferedProviders {
    add(provider: ChatProvider): void;
    remove(kind: string): void;
    invalidate(kind: string): void;
}

interface AgentProvidersOptions {
    /* With `start`, the process of every extension that lists an agent starts for the answer. */
    list(start: boolean): Promise<ListedAgentProvider[]>;
    providers: OfferedProviders;
    /* Where a program named without a folder is on the person's path, or null; a test answers from memory. */
    which?: (command: string) => string | null;
}

function catalogOf(models: AgentProviderDescription['models']): ModelCatalog {
    const [first] = models;

    return first === undefined
        ? agentDefaultCatalog()
        : new ModelCatalog({
              defaultModel: first.id,
              profiles: { agent: { options: [], contextWindowTokens: {} } },
              models: models.map((model) => ({ slug: model.id, name: model.name, profile: 'agent' }))
          });
}

/*
 * The agents extensions describe, as providers of the machine. An extension only says what the agent is called, which
 * program speaks ACP and which models it names; the chat, its session and its stop are the ACP backend's, as for an
 * agent of the registry. A provider stays offered while its extension is on and lists it, also once the process that
 * described it ended, and leaves with the extension.
 */
export class ExtensionAgentProviders {
    // What is offered now, by kind, with what it was made from, so the same description is not offered twice.
    private readonly offered = new Map<string, string>();
    // The newest ask, so an older one that answers later does not undo what the newer one found.
    private asked = 0;
    private readonly options: AgentProvidersOptions;

    constructor(options: AgentProvidersOptions) {
        this.options = options;
    }

    /* The kinds on offer now. */
    kinds(): string[] {
        return [...this.offered.keys()];
    }

    /* Asks the extensions again. Never rejects: a list that fails leaves what is offered. */
    async refresh(start: boolean): Promise<void> {
        const ask = ++this.asked;
        let listed: ListedAgentProvider[];

        try {
            listed = await this.options.list(start);
        } catch {
            // What was offered stands; the extension host wrote why a process did not answer to its log.
            return;
        }

        if (ask !== this.asked) {
            return;
        }

        const kinds = new Set<string>();

        for (const { extension, id, version, described } of listed) {
            const kind = extensionAgentKind(extension, id);

            if (kind === null) {
                continue;
            }

            kinds.add(kind);

            const made = described === null ? null : JSON.stringify([version, described]);

            if (described !== null && made !== null && this.offered.get(kind) !== made) {
                this.offered.set(kind, made);
                this.options.providers.add(this.providerOf(kind, version, described));
                this.options.providers.invalidate(kind);
            }
        }

        for (const kind of this.kinds()) {
            if (!kinds.has(kind)) {
                this.offered.delete(kind);
                this.options.providers.remove(kind);
            }
        }
    }

    private providerOf(kind: string, version: string, described: AgentProviderDescription): ChatProvider {
        const which = this.options.which ?? ((command: string) => Bun.which(command));

        return createAcpProvider({
            kind,
            name: described.name,
            command: described.spawn.command,
            args: described.spawn.args ?? [],
            // Only what the extension described goes on top of the person's own variables: Ruimte hands an agent no key.
            env: described.spawn.env ?? {},
            catalog: catalogOf(described.models),
            model: agentModel,
            loginHint: `Sign in to ${described.name} the way its own documentation says, then start the chat again.`,
            client: RUIMTE_ACP_CLIENT,
            launch: withRuimteMcp,
            // Asking an account or the models over ACP would start the program with nobody asking for a chat.
            accountProbe: false,
            // The same reason: whether the program is there is read from the disk, never by running it.
            detect: (command) => Promise.resolve({ installed: isAbsolute(command) ? existsSync(command) : which(command) !== null, version })
        });
    }
}
