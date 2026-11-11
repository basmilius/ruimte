import { encodeBytesReply } from '@ruimte/contracts';
import type { Area } from '../area.ts';
import { readBytes, type ByteSources } from '../bytes/read-bytes.ts';
import type { MachineHome } from '../disk/machine-home.ts';
import { BinaryReply, type Dispatcher } from '../dispatcher.ts';

export interface BytesDeps {
    sources: ByteSources;
    machineHome: Pick<MachineHome, 'refuse'>;
}

export function bytesArea(deps: BytesDeps): Area {
    return { name: 'bytes', handlers: (dispatcher) => registerRequests(dispatcher, deps) };
}

function registerRequests(dispatcher: Dispatcher, { sources, machineHome }: BytesDeps): void {
    dispatcher.register('bytes.read', async (payload, client) => {
        if (payload.resource.kind === 'file') {
            await machineHome.refuse(payload.resource.path);
        }
        const { bytes, ...header } = await readBytes(sources, payload, client.id);
        if (payload.binary === true && client.sendBinary) {
            return new BinaryReply((id) => encodeBytesReply(id, header, bytes));
        }
        return { ...header, data: Buffer.from(bytes).toString('base64') };
    });
}
