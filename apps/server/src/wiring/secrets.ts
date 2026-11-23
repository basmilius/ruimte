import { errorText } from '../error-text.ts';
import { SecretFiles } from '../secrets/secret-files.ts';
import { SecretService } from '../secrets/secret-service.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { LaunchesBundle } from './launches.ts';

/* The cards in which an agent asks a person for a secret, and the files a value for its own commands goes to. */
export interface SecretsBundle {
    service: SecretService;
}

interface SecretsInput {
    home: string;
    stores: AgentStores;
    agents: AgentsBundle;
    launches: LaunchesBundle;
}

/* A card for a launch hands its value to the launch's own store; every other card writes files. */
export function wireSecrets({ home, stores, agents, launches }: SecretsInput): SecretsBundle {
    const { chats } = agents;
    const service = new SecretService({
        store: launches.secretStore,
        files: new SecretFiles(home),
        launches: launches.store,
        chats: {
            hold: (nodeId, key) => void chats.holdForPerson(nodeId, key),
            release: (nodeId, key) => chats.releaseHold(nodeId, key),
            answered: (nodeId, wake) =>
                void agents.outboxLink.oweAnswer(nodeId, wake).catch((e: unknown) => console.error(`Owing the answer of a card failed: ${errorText(e)}`)),
            record: (nodeId, record) =>
                void chats.addSecret(nodeId, record).catch((e: unknown) => console.error(`Keeping a secret card in its chat failed: ${errorText(e)}`))
        }
    });

    service.follow(stores.lifecycle);

    return { service };
}
