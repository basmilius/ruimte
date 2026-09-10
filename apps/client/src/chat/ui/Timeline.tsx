import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { deriveTimelineRows, type TimelineRow } from '@/chat/logic/timeline';
import { AgentTurnRow, ApprovalHistoryRow, AssistantRow, CompactionRow, NoteRow, QuestionHistoryRow, UserRow } from '@/chat/ui/rows/MessageRows';
import { ChangedFilesRow, TurnFoldRow, WorkGroupRow, WorkLiveRow, WorkRow, WorkingRow } from '@/chat/ui/rows/WorkRows';
import { useChats } from '@/state/chats';
import { AgentIcon } from '@/agents/AgentIcon';
import { EmptyState } from '@/ui/EmptyState';

/* Below this distance from the bottom the thread follows new content; above it the reader scrolled back on purpose. */
const FOLLOW_THRESHOLD_PX = 40;
const ESTIMATED_ROW_PX = 56;

interface RowProps {
    row: TimelineRow;
    chatId: string;
    lastAssistantId: string | null;
    toggleGroup(id: string): void;
    toggleTurn(id: string): void;
}

function Row({ row, chatId, lastAssistantId, toggleGroup, toggleTurn }: RowProps) {
    switch (row.kind) {
        case 'user':
            return <UserRow chatId={chatId} item={row.item} />;
        case 'turn-start':
            return <AgentTurnRow label={row.label} />;
        case 'assistant':
            return <AssistantRow item={row.item} last={row.id === lastAssistantId} />;
        case 'work':
            return <WorkRow tool={row.tool} />;
        case 'work-live':
            return <WorkLiveRow tool={row.tool} />;
        case 'work-group':
            return <WorkGroupRow tools={row.tools} summary={row.summary} expanded={row.expanded} onToggle={() => toggleGroup(row.id)} />;
        case 'turn-fold':
            return <TurnFoldRow turn={row.turn} label={row.label} expanded={row.expanded} onToggle={() => toggleTurn(row.turn.id)} />;
        case 'changed-files':
            return <ChangedFilesRow chatId={chatId} turnId={row.turnId} tools={row.tools} diff={row.diff} checkpoint={row.checkpoint} />;
        case 'approval':
            return <ApprovalHistoryRow item={row.item} />;
        case 'question':
            return <QuestionHistoryRow item={row.item} />;
        case 'note':
            return <NoteRow level={row.level} text={row.text} />;
        case 'compaction':
            return <CompactionRow preTokens={row.preTokens} />;
        case 'working':
            return <WorkingRow startedAt={row.startedAt} />;
    }
}

/* Extra room under the last row so the floating composer never covers it. */
const COMPOSER_CLEARANCE_PX = 168;

export function Timeline({ chatId }: { chatId: string }) {
    const order = useChats((s) => s.byNodeId[chatId]?.order);
    const items = useChats((s) => s.byNodeId[chatId]?.items);
    const activeTurnId = useChats((s) => s.byNodeId[chatId]?.info.activeTurnId ?? null);
    const info = useChats((s) => s.byNodeId[chatId]?.info ?? null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
    const [expandedTurns, setExpandedTurns] = useState<Set<string>>(() => new Set());
    const scrollRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);

    const rows = useMemo(() => {
        if (!order || !items) {
            return [];
        }
        return deriveTimelineRows(
            order.map((id) => items[id]!),
            { expandedGroups, expandedTurns, activeTurnId }
        );
    }, [order, items, expandedGroups, expandedTurns, activeTurnId]);

    const lastAssistantId = useMemo(() => {
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i]!;
            if (row.kind === 'assistant') {
                return row.id;
            }
        }
        return null;
    }, [rows]);

    // The client does not run the React Compiler, so its memoization rule has nothing to break here.
    // oxlint-disable-next-line react/incompatible-library
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ESTIMATED_ROW_PX,
        getItemKey: (index) => rows[index]!.id,
        overscan: 8,
        paddingEnd: COMPOSER_CLEARANCE_PX
    });

    // A change in what the last row says (a streaming delta) must also pull the view down.
    const lastRow = rows[rows.length - 1];
    const tail = lastRow?.kind === 'assistant' ? lastRow.item.text.length : rows.length;
    useLayoutEffect(() => {
        if (followRef.current && rows.length > 0) {
            virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
        }
    }, [rows.length, tail, virtualizer]);

    const toggle = (set: (update: (current: Set<string>) => Set<string>) => void, id: string): void => {
        set((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
        // Opening or closing a fold is a deliberate look back, not a reason to jump to the end.
        followRef.current = false;
    };

    if (rows.length === 0) {
        return (
            <div className="flex min-h-0 grow items-center justify-center">
                <EmptyState icon={info ? <AgentIcon kind={info.provider} /> : undefined}>
                    {info ? `${info.selection.model} is ready. Ask it anything.` : 'Ask anything.'}
                </EmptyState>
            </div>
        );
    }

    return (
        <div
            ref={scrollRef}
            className="min-h-0 grow overflow-auto px-4 pt-4"
            onScroll={(e) => {
                const el = e.currentTarget;
                followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX + COMPOSER_CLEARANCE_PX;
            }}
        >
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index]!;
                    return (
                        <div
                            key={row.id}
                            data-index={virtualRow.index}
                            ref={virtualizer.measureElement}
                            className="absolute left-0 top-0 w-full"
                            style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                            <Row
                                row={row}
                                chatId={chatId}
                                lastAssistantId={lastAssistantId}
                                toggleGroup={(id) => toggle(setExpandedGroups, id)}
                                toggleTurn={(id) => toggle(setExpandedTurns, id)}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
