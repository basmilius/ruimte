import type { DraftLink } from '@/state/text-drafts';
import { transportFor } from '@/transport';
import { readLargeText } from '@/transport/large-text';
import { windowWorkspace } from '@/transport/window';
import { writeMachineText } from '@/transport/write-text';

export function liveDraftLink(endpointId: string): DraftLink | null {
    const transport = transportFor(endpointId);
    if (transport === null) {
        return null;
    }
    return {
        read: async (path) => {
            const read = await transport.request('fs.read', { path });

            return read.kind === 'too-large' ? readLargeText(endpointId, path, read, null) : read;
        },
        write: (path, text, expectedMtime) => writeMachineText(transport, path, text, expectedMtime),
        projectOpen: () => {
            const connection = windowWorkspace()?.connection;
            return connection?.endpointId === endpointId ? connection.projects.whenOpen() : Promise.resolve();
        }
    };
}
