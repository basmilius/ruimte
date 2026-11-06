import { secretActions } from '../actions/secret-actions.ts';
import type { SecretAsk, SecretOutcome } from '../secrets/secret-requests.ts';
import { secretToolkit } from '../tools/secret-tools.ts';
import { defineAgentFeature } from './feature.ts';

/* Only what became of a card ever comes back; the value goes from the person's card to the store. */
interface SecretHost {
    ask(ask: SecretAsk, waitMs?: number): Promise<{ requestId: string; outcome: SecretOutcome }>;
}

declare module '../canvas/host.ts' {
    interface CanvasHost {
        /* The cards in which an agent asks a person for a launch's secret; absent on a host that keeps none. */
        secrets?: SecretHost;
    }
}

export const secretFeature = defineAgentFeature({
    name: 'secret',
    toolkit: secretToolkit,
    actions: secretActions,
    host: ({ launches }) => ({ secrets: launches.secrets })
});
