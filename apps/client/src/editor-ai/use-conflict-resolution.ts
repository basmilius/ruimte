import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Editor } from '@adecore/editor';
import { createHolder } from '@adecore/editor-react';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useTransport } from '@/transport/context';
import type { ConflictResolution } from './conflict-resolution';
import { mountConflictResolution } from './conflict-wiring';

/*
 * The review of a file that moved on disk under unsaved text, in the editor that shows it: the rows of
 * the stretches both sides changed, and what only the other side changed merged in. Null while nothing
 * is incoming, though the editor is always ready for it.
 */
export function useConflictResolution(editor: Editor | null, path: string): ConflictResolution | null {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const holder = useMemo(() => createHolder<ConflictResolution>(), []);

    useEffect(() => {
        if (editor === null || projectId === null) {
            return;
        }
        const mounted = mountConflictResolution(editor, transport, { endpointId, projectId, path });
        holder.set(mounted.conflict);
        return () => {
            mounted.unmount();
            holder.set(null);
        };
    }, [editor, transport, endpointId, projectId, path, holder]);

    return useSyncExternalStore(holder.subscribe, holder.get);
}
