import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Editor } from '@ruimte/smart-editor';
import { offerDraft } from '@ruimte/agents-react/chat/drafts';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { chooserChats } from '@/chat/chat-chooser';
import { focusChat } from '@/plan/plan-actions';
import { createHolder } from '@/shell/panels/use-editor-language';
import { useSidebarSource } from '@/shell/sidebar-source';
import { useGitRoot } from '@/shell/panels/use-git-root';
import { useEndpointId } from '@/state/keys';
import { useGitSignal } from '@/state/git-watch';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useTransport } from '@/transport/context';
import type { AgentChanges, AgentChangesState } from './agent-changes';
import { mountAgentChanges } from './agent-changes-wiring';
import type { AgentReview } from './agent-review';

const NOT_DRAWN: AgentChangesState = { live: null, hover: null };
const noSubscription = (): (() => void) => () => undefined;

export interface AgentChangesView extends AgentChangesState {
    /* For the card, which stays open while the pointer is in it. */
    holdCard(inside: boolean): void;
    /* The rows and the steps of Review mode; they hold nothing in the other modes. */
    review: AgentReview | null;
}

/*
 * Draws what agents wrote in the file of this editor, as far as Settings, Editor, AI asks: nothing when
 * agent changes are off, and no bars (but the chip and the cursor of a live turn) without attribution.
 */
export function useAgentChanges(editor: Editor | null, path: string, language: string | undefined): AgentChangesView {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const mode = useSettings((s) => s.aiAgentChanges);
    const attribution = useSettings((s) => s.aiAttribution);
    const root = useGitRoot(path);
    // A commit hands lines to git blame, which the daemon notices when it is asked again.
    const commits = useGitSignal(root ?? null);
    const holder = useMemo(() => createHolder<AgentChanges>(), []);
    const reviews = useMemo(() => createHolder<AgentReview>(), []);
    const source = useSidebarSource();
    // What the review reads when it is asked, not when it is mounted: chats come and go and the folder may change.
    const folder = useProject((s) => s.current?.folder ?? null);
    const app = useRef({ chats: new Set<string>(), folder, language: language ?? null });
    useEffect(() => {
        app.current = { chats: new Set(chooserChats(source).map((chat) => chat.id)), folder, language: language ?? null };
    }, [source, folder, language]);
    const providers = useProviders((s) => s.providers);
    const providersNow = useRef(providers);
    useEffect(() => {
        providersNow.current = providers;
    }, [providers]);

    useEffect(() => {
        if (editor === null || projectId === null) {
            return;
        }
        const mounted = mountAgentChanges(editor, transport, { endpointId, projectId, path }, () => providersNow.current, {
            offer: offerDraft,
            focusChat,
            chatExists: (chatId) => app.current.chats.has(chatId),
            language: () => app.current.language,
            folder: () => app.current.folder
        });
        holder.set(mounted.changes);
        reviews.set(mounted.review);
        return () => {
            mounted.unmount();
            reviews.set(null);
            holder.set(null);
        };
    }, [editor, transport, endpointId, projectId, path, holder, reviews]);

    const changes = useSyncExternalStore(holder.subscribe, holder.get);

    useEffect(() => {
        changes?.configure({ mode, attribution });
    }, [changes, mode, attribution]);

    useEffect(() => {
        changes?.refresh();
    }, [changes, commits]);

    const review = useSyncExternalStore(reviews.subscribe, reviews.get);
    const state = useSyncExternalStore(changes?.subscribe ?? noSubscription, changes?.getState ?? (() => NOT_DRAWN));
    return useMemo(() => ({ ...state, review, holdCard: (inside: boolean) => changes?.holdCard(inside) }), [state, changes, review]);
}
