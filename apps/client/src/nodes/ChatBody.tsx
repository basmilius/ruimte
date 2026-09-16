import { Suspense, lazy, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AgentKind, ModelSelection } from '@ruimte/contracts';
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
import { readNodeHost, renameHost, updateHost, useNodeHost, useSuggestedTitle } from '@/nodes/node-host';
import { ErrorBoundary } from '@/ui/ErrorBoundary';

// The worker pool and its highlighter load with the first chat node, not with the app.
const DiffPool = lazy(() => import('@/chat/ui/DiffPool'));

/* The body of a chat, the same on a canvas inside a frame and filling a view of its own. */
export function ChatBody({ id, focused }: { id: string; focused: boolean }) {
    const info = useChatRow(id, (row) => row?.info);
    const providerFixed = useNodeHost(id)?.providerFixed === true;
    useSuggestedTitle(id, info?.suggestedTitle);
    const status = useTransportStatus();
    const [failure, setFailure] = useState<string | null>(null);
    const [generation, setGeneration] = useState(0);
    const { trail } = useSubagentTrail(id);
    const subagent = trail.at(-1);

    useEffect(() => {
        let cancelled = false;
        const host = readNodeHost(id);
        const preferences = readChatPreferences();
        // A node without a provider of its own opens on the CLI whose model was picked last.
        const provider = host?.provider ?? defaultProvider(preferences) ?? undefined;
        chatClient
            .open(id, {
                provider,
                cwd: host?.cwd ?? useProject.getState().current?.folder ?? undefined,
                resume: host?.resume,
                selection: selectionFor(preferences, provider) ?? undefined,
                runtimeMode: preferences.runtimeMode
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    setFailure(e instanceof Error ? e.message : 'The chat could not be opened');
                }
            });
        return () => {
            cancelled = true;
            void chatClient.detach(id);
        };
    }, [id, generation]);

    /* The chat remembers the new CLI, so a reload opens it on the same one. */
    const retarget = (provider: AgentKind, selection: ModelSelection): void => {
        updateHost(id, { provider });
        chatClient.retarget(id, provider, selection).catch((e: unknown) => setFailure(e instanceof Error ? e.message : 'The provider could not be changed'));
    };

    const send = (text: string, extras: ChatSendExtras): void => {
        const host = readNodeHost(id);
        const title = deriveNodeTitle(text);
        // The prompt that opens a chat names it, once, until the CLI's own name for the session
        // arrives. A rename by a person ends both for good.
        if (host && !host.titleSource && title) {
            renameHost(id, title, 'auto');
        }
        chatClient.send(id, text, extras).catch((e: unknown) => setFailure(e instanceof Error ? e.message : 'The message could not be sent'));
    };

    return (
        <div className="relative flex h-full flex-col bg-surface">
            {status !== 'open' && <NodeNotice>{status === 'closed' ? 'Reconnecting to the machine' : 'Connecting to the machine'}</NodeNotice>}
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
                    <div className={clsx('flex min-h-0 grow flex-col', subagent && 'invisible')} aria-hidden={subagent ? true : undefined}>
                        <Timeline chatId={id} />
                    </div>
                    {subagent && (
                        <div className="absolute inset-0 flex flex-col bg-surface">
                            <ErrorBoundary label="This conversation failed to render" resetKeys={[subagent.toolUseId]}>
                                <SubagentTimeline key={subagent.toolUseId} chatId={id} toolUseId={subagent.toolUseId} />
                            </ErrorBoundary>
                        </div>
                    )}
                </DiffPool>
            </Suspense>
            {info && showsComposer(trail) && (
                <Composer
                    chatId={id}
                    info={info}
                    focused={focused}
                    disabled={status !== 'open'}
                    providerFixed={providerFixed}
                    onSend={send}
                    onRetarget={retarget}
                />
            )}
        </div>
    );
}
