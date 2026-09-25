import { Suspense, useEffect, useState } from 'react';
import i18next from 'i18next';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { AgentKind, ModelSelection } from '@ruimte/contracts';
import { performAsPerson } from '@/actions/client-actions';
import { chatClient, type ChatSendExtras } from '@/chat';
import { defaultProvider, readChatPreferences, selectionFor } from '@/chat/preferences';
import { showsComposer, useSubagentTrail } from '@/chat/subagent-view';
import { deriveNodeTitle } from '@/chat/title';
import { Composer } from '@/chat/ui/Composer';
import { SubagentTimeline } from '@/chat/ui/SubagentTimeline';
import { Timeline } from '@/chat/ui/Timeline';
import { useChatRow } from '@/state/chats';
import { useProject } from '@/state/project';
import { useTransportStatus } from '@/transport/status';
import { NodeNotice } from '@/nodes/NodeNotice';
import { readNodeHost, renameHost, useNodeHost, useSuggestedTitle } from '@/nodes/node-host';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { lazyNamed } from '@/ui/lazy';

// The worker pool and its highlighter load with the first chat node, not with the app.
const DiffPool = lazyNamed(() => import('@/chat/ui/DiffPool'), 'default');

/* The body of a chat, the same on a canvas inside a frame and filling a view of its own. */
export function ChatBody({ id, focused, onCanvas = false }: { id: string; focused: boolean; onCanvas?: boolean }) {
    const { t } = useTranslation('canvas');
    const info = useChatRow(id, (row) => row?.info);
    const providerFixed = useNodeHost(id)?.providerFixed === true;
    useSuggestedTitle(id, info?.suggestedTitle);
    const status = useTransportStatus();
    const [failure, setFailure] = useState<string | null>(null);
    const [generation, setGeneration] = useState(0);
    const { trail } = useSubagentTrail(id);
    const shown = trail.at(-1);

    useEffect(() => {
        let cancelled = false;
        const host = readNodeHost(id);
        const preferences = readChatPreferences();
        // A node without a provider of its own opens on the CLI whose model was picked last.
        const provider = host?.provider ?? defaultProvider(preferences) ?? undefined;
        chatClient
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
            void chatClient.detach(id);
        };
    }, [id, generation]);

    const retarget = (provider: AgentKind, selection: ModelSelection): void => {
        performAsPerson('chat.setProvider', { chatId: id, provider, model: null, selection }).catch((e: unknown) =>
            setFailure(e instanceof Error ? e.message : t('chat.retargetFailed'))
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
        performAsPerson('chat.send', { chatId: id, prompt: text, ...extras }).catch((e: unknown) =>
            setFailure(e instanceof Error ? e.message : t('chat.sendFailed'))
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
                    {/* Hidden rather than unmounted, so coming back finds the thread where it was left. */}
                    <div className={clsx('relative flex min-h-0 grow flex-col', shown && 'invisible')} aria-hidden={shown ? true : undefined}>
                        <Timeline
                            chatId={id}
                            composer={
                                info &&
                                showsComposer(trail) && (
                                    <Composer
                                        chatId={id}
                                        info={info}
                                        focused={focused}
                                        onCanvas={onCanvas}
                                        disabled={status !== 'open'}
                                        providerFixed={providerFixed}
                                        onSend={send}
                                        onRetarget={retarget}
                                    />
                                )
                            }
                        />
                    </div>
                    {shown && (
                        <div className="absolute inset-0 flex flex-col bg-surface">
                            <ErrorBoundary key={shown.toolUseId} label={t('chat.conversationFailed')} resetKeys={[shown.toolUseId]}>
                                <SubagentTimeline chatId={id} toolUseId={shown.toolUseId} />
                            </ErrorBoundary>
                        </div>
                    )}
                </DiffPool>
            </Suspense>
        </div>
    );
}
