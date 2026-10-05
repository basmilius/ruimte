import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import type { Editor } from '@ruimte/smart-editor';
import { endpointKey } from '@/state/keys';
import { useTextDrafts } from '@/state/text-drafts';
import type { Transport } from '@/transport/transport';
import { AgentChanges } from './agent-changes';
import { providerNameOf } from './use-chat-identity';

export interface AgentChangesFile {
    endpointId: string;
    projectId: string;
    /* Absolute on the machine. */
    path: string;
}

/*
 * An `AgentChanges` for the file of an editor, fed by the daemon: it asks `provenance.read`, hears
 * `provenance.changed` for this file and asks again whenever the draft's text on disk moves on. The
 * returned function ends it all and clears what it drew.
 */
export function mountAgentChanges(
    editor: Editor,
    transport: Pick<Transport, 'request' | 'on'>,
    file: AgentChangesFile,
    providers: () => readonly ProviderInfo[]
): { changes: AgentChanges; unmount(): void } {
    const key = endpointKey(file.endpointId, file.path);
    const changes = new AgentChanges(editor, {
        read: () => transport.request('provenance.read', { projectId: file.projectId, path: file.path }),
        disk: () => {
            const draft = useTextDrafts.getState().rows[key];
            return draft === undefined ? null : { text: draft.disk, mtime: draft.mtime };
        },
        nameOf: (provider: AgentKind | undefined) => providerNameOf(providers(), provider)
    });
    const stopEvents = transport.on('provenance.changed', (event) => {
        if (event.projectId === file.projectId && event.path === file.path) {
            changes.changed(event);
        }
    });
    let mtime = useTextDrafts.getState().rows[key]?.mtime;
    const stopDrafts = useTextDrafts.subscribe((state) => {
        const next = state.rows[key]?.mtime;
        if (next !== mtime) {
            mtime = next;
            changes.refresh();
        }
    });
    return {
        changes,
        unmount: () => {
            stopEvents();
            stopDrafts();
            changes.dispose();
        }
    };
}
