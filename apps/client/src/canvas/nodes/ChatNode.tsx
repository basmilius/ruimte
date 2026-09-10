import { Suspense, lazy, useEffect, useState } from 'react';
import { RotateCwIcon } from '@hugeicons/core-free-icons';
import type { AgentKind, ModelSelection } from '@ruimte/contracts';
import { chatClient, type ChatSendExtras } from '@/chat';
import { defaultProvider, readChatPreferences, selectionFor } from '@/chat/preferences';
import { Composer } from '@/chat/ui/Composer';
import { Timeline } from '@/chat/ui/Timeline';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useProject } from '@/state/project';
import { useTransportStatus } from '@/transport/status';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

const TITLE_LIMIT = 48;
const DEFAULT_TITLE = 'New chat';

// The worker pool and its highlighter load with the first chat node, not with the app.
const DiffPool = lazy(() => import('@/chat/ui/DiffPool'));

export function ChatNode({ id, focused }: { id: string; focused: boolean }) {
    const info = useChats((s) => s.byNodeId[id]?.info);
    const providerFixed = useCanvas((s) => s.nodes[id]?.providerFixed === true);
    const status = useTransportStatus();
    const [failure, setFailure] = useState<string | null>(null);
    const [generation, setGeneration] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const node = useCanvas.getState().nodes[id];
        const preferences = readChatPreferences();
        // A node without a provider of its own opens on the CLI whose model was picked last.
        const provider = node?.provider ?? defaultProvider(preferences) ?? undefined;
        chatClient
            .open(id, {
                provider,
                cwd: node?.cwd ?? useProject.getState().current?.folder ?? undefined,
                resume: node?.resume,
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

    /* The node remembers the new CLI, so a reload opens the chat on the same one. */
    const retarget = (provider: AgentKind, selection: ModelSelection): void => {
        useCanvas.getState().updateNode(id, { provider });
        chatClient.retarget(id, provider, selection).catch((e: unknown) => setFailure(e instanceof Error ? e.message : 'The provider could not be changed'));
    };

    const send = (text: string, extras: ChatSendExtras): void => {
        const node = useCanvas.getState().nodes[id];
        const title = text.replace(/\s+/g, ' ').trim();
        if (node && node.title === DEFAULT_TITLE && title) {
            useCanvas.getState().renameNode(id, title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}…` : title);
        }
        chatClient.send(id, text, extras).catch((e: unknown) => setFailure(e instanceof Error ? e.message : 'The message could not be sent'));
    };

    return (
        <div className="relative flex h-full flex-col bg-surface">
            {status !== 'open' && (
                <div className="pointer-events-none absolute inset-x-3 top-3 z-10 rounded-lg border border-border bg-surface-raised/90 px-3 py-2 text-[12px] text-text-muted">
                    {status === 'closed' ? 'Not connected to the Ruimte server.' : 'Connecting to the Ruimte server'}
                </div>
            )}
            {failure && (
                <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-3 rounded-lg border border-border bg-surface-raised/90 px-3 py-2 text-[12px] text-status-error">
                    <span className="grow">{failure}</span>
                    <Tooltip label="Try again">
                        <button
                            className="icon-btn h-7 w-7 shrink-0"
                            onClick={() => {
                                setFailure(null);
                                setGeneration((g) => g + 1);
                            }}
                        >
                            <Icon icon={RotateCwIcon} size={13} />
                        </button>
                    </Tooltip>
                </div>
            )}
            <Suspense fallback={<div className="grow" />}>
                <DiffPool>
                    <Timeline chatId={id} />
                </DiffPool>
            </Suspense>
            {info && (
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
