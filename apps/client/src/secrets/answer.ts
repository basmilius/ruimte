import { machineTransport } from '@/transport';

/* One value, or one per field of a card that asks for several. */
export type SecretValues = { value: string } | { values: Readonly<Record<string, string>> };

/*
 * A person's answer to a secret card, straight to the machine that asked. The value goes in this one
 * request and nowhere else: not through the action registry, not into a store, not into a log.
 * False when the card was gone already.
 */
export interface SecretAnswers {
    save(endpointId: string, requestId: string, answer: SecretValues): Promise<boolean>;
    decline(endpointId: string, requestId: string): Promise<boolean>;
}

export const secretAnswers: SecretAnswers = {
    save: async (endpointId, requestId, answer) =>
        (
            await machineTransport(endpointId).request(
                'secret.save',
                'value' in answer ? { requestId, value: answer.value } : { requestId, values: { ...answer.values } }
            )
        ).accepted,
    decline: async (endpointId, requestId) => (await machineTransport(endpointId).request('secret.decline', { requestId })).accepted
};
