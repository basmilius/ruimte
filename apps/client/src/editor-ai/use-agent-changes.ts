import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Editor } from '@ruimte/smart-editor';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { createHolder } from '@/shell/panels/use-editor-language';
import { useGitRoot } from '@/shell/panels/use-git-root';
import { useEndpointId } from '@/state/keys';
import { useGitSignal } from '@/state/git-watch';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useTransport } from '@/transport/context';
import type { AgentChanges, AgentChangesState } from './agent-changes';
import { mountAgentChanges } from './agent-changes-wiring';

const NOT_DRAWN: AgentChangesState = { live: null, hover: null };
const noSubscription = (): (() => void) => () => undefined;

export interface AgentChangesView extends AgentChangesState {
    /* For the card, which stays open while the pointer is in it. */
    holdCard(inside: boolean): void;
}

/*
 * Draws what agents wrote in the file of this editor, as far as Settings, Editor, AI asks: nothing when
 * agent changes are off, and no bars (but the chip and the cursor of a live turn) without attribution.
 */
export function useAgentChanges(editor: Editor | null, path: string): AgentChangesView {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const mode = useSettings((s) => s.aiAgentChanges);
    const attribution = useSettings((s) => s.aiAttribution);
    const root = useGitRoot(path);
    // A commit hands lines to git blame, which the daemon notices when it is asked again.
    const commits = useGitSignal(root ?? null);
    const holder = useMemo(() => createHolder<AgentChanges>(), []);
    const providers = useProviders((s) => s.providers);
    const providersNow = useRef(providers);
    useEffect(() => {
        providersNow.current = providers;
    }, [providers]);

    useEffect(() => {
        if (editor === null || projectId === null) {
            return;
        }
        const mounted = mountAgentChanges(editor, transport, { endpointId, projectId, path }, () => providersNow.current);
        holder.set(mounted.changes);
        return () => {
            mounted.unmount();
            holder.set(null);
        };
    }, [editor, transport, endpointId, projectId, path, holder]);

    const changes = useSyncExternalStore(holder.subscribe, holder.get);

    useEffect(() => {
        changes?.configure({ mode, attribution });
    }, [changes, mode, attribution]);

    useEffect(() => {
        changes?.refresh();
    }, [changes, commits]);

    const state = useSyncExternalStore(changes?.subscribe ?? noSubscription, changes?.getState ?? (() => NOT_DRAWN));
    return useMemo(() => ({ ...state, holdCard: (inside: boolean) => changes?.holdCard(inside) }), [state, changes]);
}
