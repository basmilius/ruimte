import { encodeBytesReply } from '@ruimte/contracts';
import { readBytes, type ByteSources } from '../bytes/read-bytes.ts';
import { BinaryReply, translate, type Dispatcher } from '../dispatcher.ts';
import type { MachineHome } from '../fs/machine-home.ts';

export const registerBytesHandlers = (dispatcher: Dispatcher, sources: ByteSources, machineHome: MachineHome): void => {
    dispatcher.register('bytes.read', (payload, client) =>
        translate(async () => {
            if (payload.resource.kind === 'file') {
                await machineHome.refuse(payload.resource.path);
            }
            const { bytes, ...header } = await readBytes(sources, payload);
            if (payload.binary === true && client.sendBinary) {
                return new BinaryReply((id) => encodeBytesReply(id, header, bytes));
            }
            return { ...header, data: Buffer.from(bytes).toString('base64') };
        })
    );
};
