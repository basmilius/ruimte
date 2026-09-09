import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { RotateCw } from 'lucide-react';
import { chatClient } from '@/chat';
import { Composer } from '@/chat/ui/Composer';
import { ThreadItem } from '@/chat/ui/ThreadItem';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useTransportStatus } from '@/transport/status';
import { Tooltip } from '@/ui/Tooltip';

/* Below this distance from the bottom the thread follows new content; above it the reader is scrolled back on purpose. */
const FOLLOW_THRESHOLD_PX = 48;
const ESTIMATED_ROW_PX = 72;
const TITLE_LIMIT = 48;

const DEFAULT_TITLE = 'New chat';

// The worker pool and its highlighter load with the first chat node, not with the app.
const DiffPool = lazy(() => import('@/chat/ui/DiffPool'));

const formatTokens = (count: number): string => (count >= 1000 ? `${Math.round(count / 1000)}k` : String(count));

function Thread({ chatId }: { chatId: string }) {
    const order = useChats((s) => s.byNodeId[chatId]?.order);
    const items = useChats((s) => s.byNodeId[chatId]?.items);
    const scrollRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);
    const count = order?.length ?? 0;
    const lastText =
        order && items ? items[order[count - 1] ?? '']?.kind === 'assistant' && (items[order[count - 1] ?? ''] as { text: string }).text.length : 0;

    const virtualizer = useVirtualizer({
        count,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ESTIMATED_ROW_PX,
        overscan: 6
    });

    useLayoutEffect(() => {
        if (followRef.current && count > 0) {
            virtualizer.scrollToIndex(count - 1, { align: 'end' });
        }
    }, [count, lastText, virtualizer]);

    if (!order || !items) {
        return <div className="grow" />;
    }

    return (
        <div
            ref={scrollRef}
            className="min-h-0 grow overflow-auto px-4 py-4"
            onScroll={(e) => {
                const el = e.currentTarget;
                followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
            }}
        >
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((row) => {
                    const item = items[order[row.index]!];
                    if (!item) {
                        return null;
                    }
                    return (
                        <div
                            key={item.id}
                            data-index={row.index}
                            ref={virtualizer.measureElement}
                            className="absolute left-0 top-0 w-full pb-4"
                            style={{ transform: `translateY(${row.start}px)` }}
                        >
                            <ThreadItem chatId={chatId} item={item} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function ChatNode({ id, focused }: { id: string; focused: boolean }) {
    const info = useChats((s) => s.byNodeId[id]?.info);
    const status = useTransportStatus();
    const [failure, setFailure] = useState<string | null>(null);
    const [generation, setGeneration] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const node = useCanvas.getState().nodes[id];
        chatClient.open(id, { cwd: node?.cwd, resume: node?.resume }).catch((e: unknown) => {
            if (!cancelled) {
                setFailure(e instanceof Error ? e.message : 'The chat could not be opened');
            }
        });
        return () => {
            cancelled = true;
            void chatClient.detach(id);
        };
    }, [id, generation]);

    const send = (text: string): void => {
        const node = useCanvas.getState().nodes[id];
        if (node && node.title === DEFAULT_TITLE) {
            const title = text.replace(/\s+/g, ' ').trim();
            useCanvas.getState().renameNode(id, title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT - 1)}…` : title);
        }
        chatClient.send(id, text).catch((e: unknown) => setFailure(e instanceof Error ? e.message : 'The message could not be sent'));
    };

    const busy = info?.status === 'running' || info?.status === 'needs-you';
    const context = info?.usage.contextWindow ? Math.round((info.usage.contextTokens / info.usage.contextWindow) * 100) : null;

    return (
        <div className="flex h-full flex-col bg-surface">
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
                            <RotateCw size={13} />
                        </button>
                    </Tooltip>
                </div>
            )}
            <Suspense fallback={<div className="grow" />}>
                <DiffPool>
                    <Thread chatId={id} />
                </DiffPool>
            </Suspense>
            <div className="shrink-0 border-t border-border p-3">
                <Composer
                    focused={focused}
                    busy={busy}
                    disabled={status !== 'open'}
                    onSend={send}
                    onCancel={() => void chatClient.cancel(id).catch(() => undefined)}
                />
                <div className="mt-2 flex items-center gap-2 px-1 text-[11px] text-text-faint">
                    <span>Claude Code</span>
                    {info?.model && (
                        <>
                            <span>·</span>
                            <span>{info.model}</span>
                        </>
                    )}
                    <span className="grow" />
                    {info && info.usage.contextTokens > 0 && (
                        <Tooltip
                            label={`${formatTokens(info.usage.contextTokens)} tokens in context${info.usage.contextWindow ? ` of ${formatTokens(info.usage.contextWindow)}` : ''}`}
                        >
                            <span>{context !== null ? `${context}% context` : `${formatTokens(info.usage.contextTokens)} tokens`}</span>
                        </Tooltip>
                    )}
                </div>
            </div>
        </div>
    );
}
