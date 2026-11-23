import { secretActions } from '../actions/secret-actions.ts';
import type { SecretAnswer, SecretAsk } from '../secrets/secret-requests.ts';
import { secretToolkit } from '../tools/secret-tools.ts';
import { defineAgentFeature } from './feature.ts';

/* Only what became of a card ever comes back, with the paths of a file card; the value goes from the person's card to the store or a file. */
interface SecretHost {
    ask(ask: SecretAsk, waitMs?: number): Promise<SecretAnswer>;
}

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The cards in which an agent asks a person for a secret; absent on a host that keeps none. */
        secrets?: SecretHost;
    }
}

export const secretFeature = defineAgentFeature({
    name: 'secret',
    toolkit: secretToolkit,
    actions: secretActions,
    host: ({ secrets }) => ({ secrets: secrets.service })
});
