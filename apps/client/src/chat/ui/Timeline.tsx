import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { deriveTimelineRows, type TimelineRow } from '@/chat/logic/timeline';
import { registerTimeline } from '@/chat/timeline-scroll';
import { EMPTY_TARGET, readTimelineTarget, type TimelineTarget } from '@/chat/logic/timeline-target';
import { TimelineMenuPopup } from '@/chat/ui/TimelineMenu';
import { AgentTurnRow, ApprovalHistoryRow, AssistantRow, CompactionRow, NoteRow, QuestionHistoryRow, ThinkingRow, UserRow } from '@/chat/ui/rows/MessageRows';
import { SubagentRow } from '@/chat/ui/rows/SubagentRow';
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
    toggleSubagent(id: string): void;
    openSubagent(toolUseId: string): void;
}

function Row({ row, chatId, lastAssistantId, toggleGroup, toggleTurn, toggleSubagent, openSubagent }: RowProps) {
    switch (row.kind) {
        case 'user':
            return <UserRow chatId={chatId} item={row.item} />;
        case 'turn-start': {
            const toolUseId = row.turn.taskToolUseId;
            return <AgentTurnRow label={row.label} onOpen={toolUseId ? () => openSubagent(toolUseId) : undefined} />;
        }
        case 'assistant':
            return <AssistantRow item={row.item} last={row.id === lastAssistantId} />;
        case 'thinking':
            return <ThinkingRow item={row.item} />;
        case 'work':
            return <WorkRow tool={row.tool} />;
        case 'work-live':
            return <WorkLiveRow tool={row.tool} />;
        case 'work-group':
            return <WorkGroupRow tools={row.tools} summary={row.summary} expanded={row.expanded} onToggle={() => toggleGroup(row.id)} />;
        case 'subagent':
            return <SubagentRow item={row.item} work={row.children} expanded={row.expanded} onToggle={() => toggleSubagent(row.id)} />;
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
    const [expandedSubagents, setExpandedSubagents] = useState<Set<string>>(() => new Set());
    const scrollRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);
    const [target, setTarget] = useState<TimelineTarget>(EMPTY_TARGET);

    const rows = useMemo(() => {
        if (!order || !items) {
            return [];
        }
        return deriveTimelineRows(
            order.map((id) => items[id]!),
            { expandedGroups, expandedTurns, expandedSubagents, activeTurnId }
        );
    }, [order, items, expandedGroups, expandedTurns, expandedSubagents, activeTurnId]);

    const empty = rows.length === 0;

    // The composer pages through the thread with PageUp and PageDown; this is the element it moves.
    // An empty thread draws no scroller at all, so the first row is what puts one there to register.
    useEffect(() => registerTimeline(chatId, scrollRef.current), [chatId, empty]);

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

    /* The header of a turn a sub-agent woke: it points at the row that agent worked in. */
    const openSubagent = (toolUseId: string): void => {
        const index = rows.findIndex((row) => row.kind === 'subagent' && row.item.toolUseId === toolUseId);
        const row = rows[index];
        if (!row) {
            return;
        }
        setExpandedSubagents((current) => new Set(current).add(row.id));
        followRef.current = false;
        virtualizer.scrollToIndex(index, { align: 'start' });
    };

    if (empty) {
        return (
            <div className="flex min-h-0 grow items-center justify-center">
                <EmptyState icon={info ? <AgentIcon kind={info.provider} /> : undefined}>
                    {info ? `${info.selection.model} is ready. Ask it anything.` : 'Ask anything.'}
                </EmptyState>
            </div>
        );
    }

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                ref={scrollRef}
                className="chat-thread min-h-0 grow overflow-auto px-4 pt-4"
                onScroll={(e) => {
                    const el = e.currentTarget;
                    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX + COMPOSER_CLEARANCE_PX;
                }}
                onContextMenu={(e) => setTarget(readTimelineTarget(e.target as HTMLElement, scrollRef.current, rows))}
            >
                <div className="chat-column-content relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                        const row = rows[virtualRow.index]!;
                        // A question and its answer are one step apart, one turn and the next question a
                        // wider one; the rows inside a turn keep their own tight rhythm. The gap is
                        // padding on the measured element, so the virtualizer counts it in the height.
                        const question = row.kind === 'user';
                        return (
                            <div
                                key={row.id}
                                data-index={virtualRow.index}
                                data-item-id={row.id}
                                ref={virtualizer.measureElement}
                                className={clsx(
                                    'absolute left-0 top-0 w-full',
                                    question && 'pb-[var(--chat-answer-gap)]',
                                    question && virtualRow.index > 0 && 'pt-[var(--chat-turn-gap)]'
                                )}
                                style={{ transform: `translateY(${virtualRow.start}px)` }}
                            >
                                <Row
                                    row={row}
                                    chatId={chatId}
                                    lastAssistantId={lastAssistantId}
                                    toggleGroup={(id) => toggle(setExpandedGroups, id)}
                                    toggleTurn={(id) => toggle(setExpandedTurns, id)}
                                    toggleSubagent={(id) => toggle(setExpandedSubagents, id)}
                                    openSubagent={openSubagent}
                                />
                            </div>
                        );
                    })}
                </div>
            </ContextMenu.Trigger>
            <TimelineMenuPopup target={target} scroller={scrollRef} />
        </ContextMenu.Root>
    );
}
