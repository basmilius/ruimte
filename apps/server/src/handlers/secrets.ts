import { CodedError } from '@adecore/agents';
import type { Area } from '../area.ts';
import type { SecretService } from '../secrets/secret-service.ts';

interface SecretsDeps {
    secrets: SecretService;
}

/* Every client of the machine is its owner or one the owner let in, so any of them answers a card, as a question of a chat is answered. */
export function secretsArea({ secrets }: SecretsDeps): Area {
    return {
        name: 'secrets',
        sources: [secrets],
        handlers: (dispatcher) => {
            dispatcher.register('secret.requests', () => ({ requests: secrets.list() }));

            dispatcher.register('secret.save', async ({ requestId, value, values }) => {
                if ((value === undefined) === (values === undefined)) {
                    throw new CodedError('secret-values', 'A save carries value or values, not both');
                }

                return { accepted: await secrets.save(requestId, value === undefined ? { values: values ?? {} } : { value }) };
            });

            dispatcher.register('secret.decline', (payload) => ({ accepted: secrets.decline(payload.requestId) }));
        }
    };
}
