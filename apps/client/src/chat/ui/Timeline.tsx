import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import type { ChatSubagentItem } from '@ruimte/contracts';
import { deriveTimelineRows, type TimelineRow } from '@/chat/logic/timeline';
import { crumbOf, openFromMain, useSubagentTrail } from '@/chat/subagent-view';
import { registerMessageStepper, registerTimeline, setTimelineAtEnd } from '@/chat/timeline-scroll';
import { SCRUBBER_MIN_TICKS, STRIP_INSET_PX, STRIP_WIDTH_PX, messagesInView, stepMessage, threadPaddingLeft, ticksOf } from '@/chat/logic/scrubber';
import { EMPTY_TARGET, readTimelineTarget, withCurrentText, type TimelineTarget } from '@/chat/logic/timeline-target';
import { forkRefusal } from '@/chat/logic/fork';
import { Scrubber, type CardChat } from '@/chat/ui/Scrubber';
import { TimelineMenuPopup } from '@/chat/ui/TimelineMenu';
import { Row } from '@/chat/ui/rows/Rows';
import { useChatRow, useChats } from '@/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useUi } from '@/state/ui';
import { FileLinkContext } from '@/shell/panels/file-links';
import { AgentIcon } from '@/agents/AgentIcon';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorBoundary } from '@/ui/ErrorBoundary';

/* Below this distance from the bottom the thread follows new content; above it the reader scrolled back on purpose. */
const FOLLOW_THRESHOLD_PX = 40;
const ESTIMATED_ROW_PX = 56;

/* Extra room under the last row so the floating composer never covers it. */
const COMPOSER_CLEARANCE_PX = 168;

/*
 * A turn runs in two rhythms. The tool lines are a list and read as one when they sit tight
 * against each other; prose and cards are blocks and need room around them. Where the two meet,
 * the block gap marks the seam, so an answer never looks glued to the call above it.
 */
const BLOCK_KINDS = new Set<TimelineRow['kind']>(['assistant', 'report', 'thinking', 'changed-files', 'compaction']);

const isBlock = (row: TimelineRow): boolean => BLOCK_KINDS.has(row.kind);

export function Timeline({ chatId }: { chatId: string }) {
    const order = useChatRow(chatId, (row) => row?.order);
    // The structure, not the items: a delta growing a reply must not derive every row again.
    const items = useChatRow(chatId, (row) => row?.structure);
    const activeTurnId = useChatRow(chatId, (row) => row?.info.activeTurnId ?? null);
    const info = useChatRow(chatId, (row) => row?.info ?? null);
    const endpointId = useEndpointId();
    // Read when the menu opens rather than subscribed to, for the same reason the rows use the structure.
    const fullItems = () => useChats.getState().byKey[endpointKey(endpointId, chatId)]?.items;
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
    const [expandedTurns, setExpandedTurns] = useState<Set<string>>(() => new Set());
    const [expandedSubagents, setExpandedSubagents] = useState<Set<string>>(() => new Set());
    const scrollRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);
    const [target, setTarget] = useState<TimelineTarget>(EMPTY_TARGET);
    const { trail, show } = useSubagentTrail(chatId);
    const frameRef = useRef<HTMLDivElement>(null);
    const [frame, setFrame] = useState({ width: 0, column: false });

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
    const ticks = useMemo(() => ticksOf(rows), [rows]);

    // Whether the thread's text clears the strip depends on the width of the view, which only the thread's own frame tells.
    useEffect(() => {
        const element = frameRef.current;
        if (element === null || typeof ResizeObserver === 'undefined') {
            return;
        }
        const column = element.closest('.chat-column') !== null;
        const measure = (): void =>
            setFrame((current) => (current.width === element.offsetWidth && current.column === column ? current : { width: element.offsetWidth, column }));
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        measure();
        return () => observer.disconnect();
    }, [empty]);

    // The composer pages through the thread with PageUp and PageDown; this is the element it moves.
    // An empty thread draws no scroller at all, so the first row is what puts one there to register.
    useEffect(() => registerTimeline(chatId, scrollRef.current), [chatId, empty]);

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
    const lastReplyLength = useChatRow(chatId, (row) => {
        const item = lastRow?.kind === 'assistant' ? row?.items[lastRow.id] : undefined;
        return item?.kind === 'assistant' ? item.text.length : null;
    });
    const tail = lastReplyLength ?? rows.length;
    /*
     * The rows are measured as they render, so the end of the list moves while it is drawn: a diff
     * that highlights, an image that loads, a tool row that grows a line of output. `scrollToIndex`
     * aims at where the row was when it was asked, which is what left the thread short of the end.
     * The scroller's own bottom is a fact rather than an estimate, and the total size changing is
     * what says a row was measured again, so this runs for every one of those.
     */
    const totalSize = virtualizer.getTotalSize();
    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (!followRef.current || rows.length === 0 || element === null) {
            return;
        }
        // `paddingEnd` holds the composer's room, so the last row lands above it and not under it.
        element.scrollTop = element.scrollHeight;
    }, [rows.length, tail, totalSize]);

    // A sub-agent in the thread's place hides the thread, and the strip and the keyboard go with it.
    const onMainAgent = trail.length === 0;
    // A node on a canvas has no strip: it is too narrow to give up a column of its width.
    const showsScrubber = frame.column && onMainAgent && ticks.length >= SCRUBBER_MIN_TICKS;
    const paddingLeft = threadPaddingLeft(frame.width, showsScrubber);

    /*
     * Where each message starts, from the virtualizer's measurements (an estimate for a row it never
     * drew), so reading the scroll position costs no layout. The virtualizer renders this component on
     * every scroll already.
     */
    const measurements = virtualizer.measurementsCache;
    const starts = ticks.map((tick) => measurements[tick.rowIndex]?.start ?? tick.rowIndex * ESTIMATED_ROW_PX);
    const scrollTop = virtualizer.scrollOffset ?? 0;
    const viewport = virtualizer.scrollRect?.height ?? 0;
    const visibleHeight = Math.max(0, viewport - COMPOSER_CLEARANCE_PX);
    const inView = showsScrubber ? messagesInView({ starts, scrollTop, visibleHeight }) : null;

    const jumpTo = (index: number): void => {
        const tick = ticks[index];
        if (!tick) {
            return;
        }
        followRef.current = false;
        virtualizer.scrollToIndex(tick.rowIndex, { align: 'start' });
    };
    // The strip is memoized and draws on every scroll, so it gets one callback for its life.
    const jumpRef = useRef(jumpTo);
    jumpRef.current = jumpTo;
    const pick = useCallback((index: number) => jumpRef.current(index), []);
    // Read when the card asks rather than on every render, so the strip's memo holds while the thread streams.
    const cardChat = useMemo<CardChat>(
        () => ({
            canFork: (turnId) => {
                const row = useChats.getState().byKey[endpointKey(endpointId, chatId)];
                return forkRefusal(row?.info ?? null, row?.structure[turnId]) === null;
            },
            fork: (turnId) => useUi.getState().setForkDialog({ chatId, turnId })
        }),
        [endpointId, chatId]
    );

    const stepRef = useRef<(direction: -1 | 1) => boolean>(() => false);
    stepRef.current = (direction) => {
        if (!onMainAgent) {
            return false;
        }
        const index = stepMessage(starts, (i) => ticks[i]!.kind === 'person', scrollTop, direction);
        if (index === null) {
            return false;
        }
        jumpTo(index);
        return true;
    };
    useEffect(() => registerMessageStepper(endpointKey(endpointId, chatId), (direction) => stepRef.current(direction)), [endpointId, chatId]);

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

    /* The whole of what a sub-agent did, in the thread's place: its row only keeps the beginning. */
    const openConversation = (item: ChatSubagentItem): void => {
        show(openFromMain(crumbOf(item)));
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
        // A file an answer names is relative to the folder this chat runs in, which is a worktree as
        // often as it is the project itself.
        <FileLinkContext.Provider value={info?.cwd ?? null}>
            <div ref={frameRef} className="relative flex min-h-0 grow flex-col">
                <ContextMenu.Root>
                    <ContextMenu.Trigger
                        ref={scrollRef}
                        className="chat-thread min-h-0 grow overflow-auto px-4 pt-4"
                        style={{ paddingLeft }}
                        onScroll={(e) => {
                            const el = e.currentTarget;
                            followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX + COMPOSER_CLEARANCE_PX;
                            setTimelineAtEnd(chatId, followRef.current);
                        }}
                        onContextMenu={(e) => setTarget(readTimelineTarget(e.target as HTMLElement, scrollRef.current, withCurrentText(rows, fullItems())))}
                    >
                        <div className="chat-column-content relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                            {virtualizer.getVirtualItems().map((virtualRow) => {
                                const row = rows[virtualRow.index]!;
                                // A question and its answer are one step apart, one turn and the next question a
                                // wider one; the rows inside a turn keep their own tight rhythm. The gap is
                                // padding on the measured element, so the virtualizer counts it in the height.
                                const question = row.kind === 'user';
                                const previous = virtualRow.index > 0 ? rows[virtualRow.index - 1]! : null;
                                // A question already carries the turn gap, and the row after one the answer gap.
                                const seam = !question && previous !== null && previous.kind !== 'user' && isBlock(row) !== isBlock(previous);
                                return (
                                    <div
                                        key={row.id}
                                        data-index={virtualRow.index}
                                        data-item-id={row.id}
                                        ref={virtualizer.measureElement}
                                        className={clsx(
                                            'absolute left-0 top-0 w-full',
                                            question && 'pb-(--chat-answer-gap)',
                                            question && virtualRow.index > 0 && 'pt-(--chat-turn-gap)',
                                            seam && 'pt-(--chat-block-gap)'
                                        )}
                                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                                    >
                                        <Row
                                            row={row}
                                            chatId={chatId}
                                            toggleGroup={(id) => toggle(setExpandedGroups, id)}
                                            toggleTurn={(id) => toggle(setExpandedTurns, id)}
                                            toggleSubagent={(id) => toggle(setExpandedSubagents, id)}
                                            openSubagent={openSubagent}
                                            openConversation={openConversation}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </ContextMenu.Trigger>
                    <TimelineMenuPopup target={target} scroller={scrollRef} chatId={onMainAgent ? chatId : null} />
                </ContextMenu.Root>
                {showsScrubber && (
                    <div className="absolute top-4" style={{ left: STRIP_INSET_PX, width: STRIP_WIDTH_PX, bottom: COMPOSER_CLEARANCE_PX }}>
                        <ErrorBoundary label="The message strip failed to render" resetKeys={[ticks.length]}>
                            <Scrubber ticks={ticks} firstInView={inView?.first ?? null} lastInView={inView?.last ?? null} onPick={pick} chat={cardChat} />
                        </ErrorBoundary>
                    </div>
                )}
            </div>
        </FileLinkContext.Provider>
    );
}
