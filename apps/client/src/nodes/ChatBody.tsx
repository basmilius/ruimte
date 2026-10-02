import { Suspense, useEffect, useRef, useState } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import type { AgentKind, ModelSelection } from '@ruimte/contracts';
import { performAsPerson } from '@/actions/client-actions';
import type { ChatSendExtras } from '@ruimte/agents-react/chat/chat-client';
import { defaultProvider, readChatPreferences, selectionFor } from '@ruimte/agents-react/chat/preferences';
import { composerWrites, useSubagentTrail } from '@ruimte/agents-react/chat/subagent-view';
import { deriveNodeTitle } from '@/chat/title';
import { Composer } from '@ruimte/agents-react/chat/ui/Composer';
import { SubagentTimeline } from '@ruimte/agents-react/chat/ui/SubagentTimeline';
import { Timeline } from '@ruimte/agents-react/chat/ui/Timeline';
import { useChatRow } from '@ruimte/agents-react/state/chats';
import { useProject } from '@/state/project';
import { useEndpointId } from '@/state/keys';
import { chatClientFor } from '@/transport/connections';
import { useTransportStatus } from '@/transport/status';
import { NodeNotice } from '@/nodes/NodeNotice';
import { readNodeHost, renameHost, useNodeHost, useSuggestedTitle } from '@/nodes/node-host';
import { ErrorBoundary, lazyNamed } from '@basmilius/desktop-ui';
import { bringPromptToFront } from '@/canvas/prompt-stack';
import { PROMPTS_IN_NODES } from '@/prompts/placement';

// The worker pool and its highlighter load with the first chat node, not with the app.
const DiffPool = lazyNamed(() => import('@/chat/ChatDiffPool'), 'default');

/* The body of a chat, the same on a canvas inside a frame and filling a view of its own. */
export function ChatBody({ id, focused, onCanvas = false }: { id: string; focused: boolean; onCanvas?: boolean }) {
    const { t } = useTranslation('canvas');
    const info = useChatRow(id, (row) => row?.info);
    const providerFixed = useNodeHost(id)?.providerFixed === true;
    useSuggestedTitle(id, info?.suggestedTitle);
    const status = useTransportStatus();
    const endpointId = useEndpointId();
    const [failure, setFailure] = useState<string | null>(null);
    const [generation, setGeneration] = useState(0);
    const switched = useRef<Promise<void>>(Promise.resolve());
    const { trail } = useSubagentTrail(id);
    const shown = trail.at(-1);

    useEffect(() => {
        // Taken once, so a node that leaves after the window moved to another machine still detaches from its own.
        const chats = chatClientFor(endpointId);
        if (!chats) {
            return;
        }
        let cancelled = false;
        const host = readNodeHost(id);
        const preferences = readChatPreferences();
        // A node without a provider of its own opens on the CLI whose model was picked last.
        const provider = host?.provider ?? defaultProvider(preferences) ?? undefined;
        chats
            .open(id, {
                provider,
                account: host?.account,
                cwd: host?.cwd ?? useProject.getState().current?.folder ?? undefined,
                resume: host?.resume,
                selection: selectionFor(preferences, provider) ?? undefined,
                runtimeMode: preferences.runtimeMode
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    // Not the hook's `t`: the effect would then depend on it and reopen the chat on a language change.
                    setFailure(e instanceof Error ? e.message : i18next.t('canvas:chat.openFailed'));
                }
            });
        return () => {
            cancelled = true;
            void chats.detach(id);
        };
    }, [endpointId, id, generation]);

    // The chat is gone on the machine until it opened again on the other CLI, so a send or another switch meanwhile waits for that.
    const retarget = (provider: AgentKind, selection: ModelSelection): void => {
        switched.current = switched.current.then(() =>
            performAsPerson('chat.setProvider', { chatId: id, provider, model: null, selection })
                .then(() => undefined)
                .catch((e: unknown) => setFailure(e instanceof Error ? e.message : t('chat.retargetFailed')))
        );
    };

    const send = (text: string, extras: ChatSendExtras): void => {
        const host = readNodeHost(id);
        const title = deriveNodeTitle(text);
        // The prompt that opens a chat names it, once, until the CLI's own name for the session
        // arrives. A rename by a person ends both for good.
        if (host && !host.titleSource && title) {
            renameHost(id, title, 'auto');
        }
        void switched.current.then(() =>
            performAsPerson('chat.send', { chatId: id, prompt: text, ...extras }).catch((e: unknown) =>
                setFailure(e instanceof Error ? e.message : t('chat.sendFailed'))
            )
        );
    };

    return (
        <div className="relative flex h-full flex-col bg-surface">
            {status !== 'open' && <NodeNotice>{status === 'closed' ? t('notice.reconnecting') : t('notice.connecting')}</NodeNotice>}
            {failure && (
                <NodeNotice
                    tone="error"
                    onRetry={() => {
                        setFailure(null);
                        setGeneration((g) => g + 1);
                    }}
                >
                    {failure}
                </NodeNotice>
            )}
            <Suspense fallback={<div className="grow" />}>
                <DiffPool>
                    <Timeline
                        chatId={id}
                        composer={
                            info && (
                                <Composer
                                    chatId={id}
                                    info={info}
                                    focused={focused}
                                    answerPromptsElsewhere={onCanvas && !PROMPTS_IN_NODES ? () => bringPromptToFront(id) : undefined}
                                    disabled={status !== 'open'}
                                    readOnly={!composerWrites(trail)}
                                    providerFixed={providerFixed}
                                    onSend={send}
                                    onRetarget={retarget}
                                />
                            )
                        }
                        overlay={
                            shown && (
                                <ErrorBoundary key={shown.toolUseId} label={t('chat.conversationFailed')} resetKeys={[shown.toolUseId]}>
                                    <SubagentTimeline chatId={id} toolUseId={shown.toolUseId} />
                                </ErrorBoundary>
                            )
                        }
                    />
                </DiffPool>
            </Suspense>
        </div>
    );
}
