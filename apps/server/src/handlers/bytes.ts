import { encodeBytesReply } from '@ruimte/contracts';
import { readBytes, type ByteSources } from '../bytes/read-bytes.ts';
import type { MachineHome } from '../disk/machine-home.ts';
import { BinaryReply, type Dispatcher } from '../dispatcher.ts';

export function registerBytesHandlers(dispatcher: Dispatcher, sources: ByteSources, machineHome: MachineHome): void {
    dispatcher.register('bytes.read', async (payload, client) => {
        if (payload.resource.kind === 'file') {
            await machineHome.refuse(payload.resource.path);
        }
        const { bytes, ...header } = await readBytes(sources, payload);
        if (payload.binary === true && client.sendBinary) {
            return new BinaryReply((id) => encodeBytesReply(id, header, bytes));
        }
        return { ...header, data: Buffer.from(bytes).toString('base64') };
    });
}
