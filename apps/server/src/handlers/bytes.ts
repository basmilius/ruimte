import { encodeBytesReply } from '@ruimte/contracts';
import { readBytes, type ByteSources } from '../bytes/read-bytes.ts';
import { BinaryReply, translate, type Dispatcher } from '../dispatcher.ts';

export const registerBytesHandlers = (dispatcher: Dispatcher, sources: ByteSources): void => {
    dispatcher.register('bytes.read', (payload, client) =>
        translate(async () => {
            const { bytes, ...header } = await readBytes(sources, payload);
            if (payload.binary === true && client.sendBinary) {
                return new BinaryReply((id) => encodeBytesReply(id, header, bytes));
            }
            return { ...header, data: Buffer.from(bytes).toString('base64') };
        })
    );
};
