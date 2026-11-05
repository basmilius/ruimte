import i18next from 'i18next';
import { TransportError, type Transport } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';

/*
 * The whole output of a tool call whose item carries only its beginning. Only a machine that answers
 * `chat.toolOutput` marks an item that way, so one that does not is never asked: the thread keeps the
 * beginning and says the rest could not be read.
 */
export async function readToolOutput(transport: Pick<Transport, 'request' | 'connection'> | null, chatId: string, itemId: string): Promise<string | null> {
    if (transport === null) {
        throw new TransportError('offline', i18next.t('chat:offline'));
    }

    if (!machineAnswers(transport.connection, 'chat.toolOutput')) {
        throw new TransportError('machine-older', i18next.t('chat:fullOutputOlder'), { request: 'chat.toolOutput' });
    }

    const { output } = await transport.request('chat.toolOutput', { chatId, itemId });

    return output;
}
