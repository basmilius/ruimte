import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import type { Editor } from '@ruimte/smart-editor';
import { endpointKey } from '@/state/keys';
import { type TextDraft, useTextDrafts } from '@/state/text-drafts';
import type { Transport } from '@/transport/transport';
import { AgentChanges } from './agent-changes';
import { AgentReview, type ReviewSource } from './agent-review';
import { joinReviewGroup } from './review-group';
import { providerNameOf } from './use-chat-identity';

export interface AgentChangesFile {
    endpointId: string;
    projectId: string;
    /* Absolute on the machine. */
    path: string;
}

/* What a review needs of the app around it; the machine and the label of the file are the wiring's. */
export type AgentReviewApp = Pick<ReviewSource, 'offer' | 'focusChat' | 'chatExists' | 'language'> & {
    /* The open project's folder, which a chat reads the file relative to. */
    folder(): string | null;
};

/* The path the way a chat reads it: inside the project folder it is relative to it. */
export function projectRelative(path: string, folder: string | null): string {
    return folder !== null && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
}

/*
 * An `AgentChanges` for the file of an editor, fed by the daemon: it asks `provenance.read`, hears
 * `provenance.changed` for this file and asks again whenever the draft's text on disk moves on. The
 * returned function ends it all and clears what it drew. With `app` it also puts the rows of Review mode
 * on the runs it draws.
 */
export function mountAgentChanges(
    editor: Editor,
    transport: Pick<Transport, 'request' | 'on'>,
    file: AgentChangesFile,
    providers: () => readonly ProviderInfo[],
    app?: AgentReviewApp
): { changes: AgentChanges; review: AgentReview | null; unmount(): void } {
    const key = endpointKey(file.endpointId, file.path);
    const changes = new AgentChanges(editor, {
        read: () => transport.request('provenance.read', { projectId: file.projectId, path: file.path }),
        disk: () => {
            const draft = useTextDrafts.getState().rows[key];
            return draft === undefined ? null : (draft.incoming ?? { text: draft.disk, mtime: draft.mtime });
        },
        nameOf: (provider: AgentKind | undefined) => providerNameOf(providers(), provider)
    });
    // One review per file and window: every editor on the file answers through the same group.
    const membership = app === undefined ? null : joinReviewGroup(key);
    const review =
        app === undefined || membership === null
            ? null
            : new AgentReview(
                  editor,
                  changes,
                  {
                      mark: async (runIds, state) => {
                          await transport.request('provenance.review', { projectId: file.projectId, path: file.path, runIds: [...runIds], state });
                      },
                      offer: app.offer,
                      focusChat: app.focusChat,
                      chatExists: app.chatExists,
                      label: () => projectRelative(file.path, app.folder()),
                      language: app.language
                  },
                  membership.group
              );
    const stopEvents = transport.on('provenance.changed', (event) => {
        if (event.projectId === file.projectId && event.path === file.path) {
            changes.changed(event);
        }
    });
    const diskOf = (row: TextDraft | undefined): number | undefined => (row?.incoming ?? row)?.mtime;
    let mtime = diskOf(useTextDrafts.getState().rows[key]);
    const stopDrafts = useTextDrafts.subscribe((state) => {
        const next = diskOf(state.rows[key]);
        if (next !== mtime) {
            mtime = next;
            changes.refresh();
        }
    });
    return {
        changes,
        review,
        unmount: () => {
            stopEvents();
            stopDrafts();
            review?.dispose();
            membership?.leave();
            changes.dispose();
        }
    };
}
