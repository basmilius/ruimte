import type { DraftLink } from '@/state/text-drafts';
import { transportFor } from '@/transport/index';
import { readLargeText } from '@/transport/large-text';
import { writeMachineText } from '@/transport/write-text';
import { windowWorkspace } from '@/workspace/window';

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
