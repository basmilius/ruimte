import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import type { ChatBookmark } from '@ruimte/contracts';
import { useForkedTurns } from '@/chat/forks';
import { bookmarkRows } from '@/chat/logic/bookmarks';
import { deriveTimelineRows, findSubagentBranch, type TimelineRow } from '@/chat/logic/timeline';
import { openFromMain, useSubagentTrail, type SubagentStep } from '@/chat/subagent-view';
import { registerItemJumper, registerMessageStepper, registerTimeline, setTimelineAtEnd } from '@/chat/timeline-scroll';
import {
    SCRUBBER_MIN_TICKS,
    STRIP_INSET_PX,
    STRIP_WIDTH_PX,
    messagesInView,
    stepMessage,
    threadPaddingLeft,
    tickOfRow,
    ticksOf,
    ticksWithHits
} from '@/chat/logic/scrubber';
import { EMPTY_TARGET, readTimelineTarget, withCurrentText, type TimelineTarget } from '@/chat/logic/timeline-target';
import { forkRefusal } from '@/chat/logic/fork';
import { FindRevealContext } from '@/chat/ui/find-reveal';
import { BookmarkMarker } from '@/chat/ui/BookmarkMarker';
import { MessageActions } from '@/chat/ui/MessageActions';
import { Scrubber, type CardChat } from '@/chat/ui/Scrubber';
import { TimelineMenuPopup } from '@/chat/ui/TimelineMenu';
import { FOLLOW_THRESHOLD_PX, rowRhythm } from '@/chat/ui/rows/row-rhythm';
import { QuoteButton } from '@/chat/ui/QuoteButton';
import { QuoteTakerContext, type QuoteTaker } from '@/chat/ui/quote-selection';
import { useChatFind } from '@/chat/ui/use-chat-find';
import { useToggleSet } from '@/chat/ui/useToggleSet';
import { Row } from '@/chat/ui/rows/Rows';
import { useChatRow, useChats } from '@/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useUi } from '@/state/ui';
import { FileLinkContext } from '@/shell/panels/file-links';
import { AgentIcon } from '@/agents/AgentIcon';
import { useModelName } from '@/agents/model-name';
import { useContextSources } from '@/context/sources';
import { FindBar } from '@/find/FindBar';
import { SECTION_LABEL } from '@ruimte/ui/classes';
import { EmptyState } from '@ruimte/ui/EmptyState';
import { ErrorBoundary } from '@ruimte/ui/ErrorBoundary';

const ESTIMATED_ROW_PX = 56;

/*
 * A thread before its first message: which model answers, what the lines into this node let it read,
 * and the folder it works in, so a first question can lean on all three.
 */
function EmptyThread({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const info = useChatRow(chatId, (row) => row?.info ?? null);
    const model = useModelName(info?.provider, info?.selection.model ?? '');
    const sources = useContextSources(chatId);
    return (
        <div className="flex grow items-center justify-center">
            <div className="flex max-w-sm flex-col items-center gap-3 px-6 py-8 text-center">
                <EmptyState icon={info ? <AgentIcon kind={info.provider} /> : undefined} className="p-0">
                    {info ? t('timeline.empty.ready', { model }) : t('timeline.empty.ask')}
                </EmptyState>
                {sources.length > 0 && (
                    <div className="flex max-w-full flex-col items-center gap-1">
                        <span className={SECTION_LABEL}>{t('timeline.empty.canRead')}</span>
                        <span className="max-w-full text-xs text-text-muted">{sources.map((source) => source.title).join(', ')}</span>
                    </div>
                )}
                {info?.cwd && (
                    <div className="flex max-w-full flex-col items-center gap-1">
                        <span className={SECTION_LABEL}>{t('timeline.empty.worksIn')}</span>
                        <span className="max-w-full font-mono text-xs break-all text-text-muted">{info.cwd}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

/*
 * A row of the thread behind the chapter line of its bookmark. A message, the only row that takes a
 * bookmark, gets its actions under it; every other row carries a bookmark only for a reply it folds.
 */
function MarkableRow({ row, chatId, bookmark, children }: { row: TimelineRow; chatId: string; bookmark: ChatBookmark | null; children: ReactNode }) {
    if (row.kind !== 'user' && row.kind !== 'assistant') {
        return (
            <>
                {bookmark !== null && <BookmarkMarker chatId={chatId} itemId={bookmark.itemId} bookmark={bookmark} />}
                {children}
            </>
        );
    }
    return (
        <>
            <BookmarkMarker chatId={chatId} itemId={row.id} bookmark={bookmark} />
            <div className="group/message">
                {children}
                <MessageActions chatId={chatId} row={row} />
            </div>
        </>
    );
}

export function Timeline({ chatId, composer }: { chatId: string; composer?: ReactNode }) {
    const { t } = useTranslation('chat');
    const order = useChatRow(chatId, (row) => row?.order);
    // The structure, not the items. A delta growing a reply must not derive every row again.
    const items = useChatRow(chatId, (row) => row?.structure);
    const activeTurnId = useChatRow(chatId, (row) => row?.info.activeTurnId ?? null);
    const bookmarks = useChatRow(chatId, (row) => row?.bookmarks);
    const forkedTurns = useForkedTurns(chatId);
    const info = useChatRow(chatId, (row) => row?.info ?? null);
    const endpointId = useEndpointId();
    // Read when the menu opens rather than subscribed to, for the same reason the rows use the structure.
    const fullItems = () => useChats.getState().byKey[endpointKey(endpointId, chatId)]?.items;
    const scrollRef = useRef<HTMLDivElement>(null);
    const threadRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const quoteTakerRef = useRef<QuoteTaker | null>(null);
    const registerQuoteTaker = useCallback((take: QuoteTaker) => {
        quoteTakerRef.current = take;
        return () => {
            if (quoteTakerRef.current === take) {
                quoteTakerRef.current = null;
            }
        };
    }, []);
    const followRef = useRef(true);
    const stopFollowing = useCallback(() => {
        followRef.current = false;
    }, []);
    const groups = useToggleSet(stopFollowing);
    const turns = useToggleSet(stopFollowing);
    const subagents = useToggleSet(stopFollowing);
    const scrollGeometry = useRef({ top: 0, height: 0, viewport: 0 });
    const [target, setTarget] = useState<TimelineTarget>(EMPTY_TARGET);
    const { trail, show } = useSubagentTrail(chatId);
    const frameRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLDivElement>(null);
    const [composerHeight, setComposerHeight] = useState(0);
    const [frame, setFrame] = useState({ width: 0, height: 0, column: false });

    const rows = useMemo(() => {
        if (!order || !items) {
            return [];
        }
        return deriveTimelineRows(
            order.map((id) => items[id]!),
            { expandedGroups: groups.ids, expandedTurns: turns.ids, expandedSubagents: subagents.ids, activeTurnId, forkedTurns }
        );
    }, [order, items, groups.ids, turns.ids, subagents.ids, activeTurnId, forkedTurns]);

    const empty = rows.length === 0;
    const marks = useMemo(() => bookmarkRows(rows, bookmarks ?? [], items ?? {}), [rows, bookmarks, items]);
    const ticks = useMemo(() => ticksOf(rows, marks), [rows, marks]);
    // A message a jump is on its way to; it may first have to open the turn its reply folded into.
    const [seeking, setSeeking] = useState<string | null>(null);

    // Whether the thread's text clears the strip depends on the width of the view, which only the thread's own frame tells.
    useEffect(() => {
        const element = frameRef.current;
        if (element === null || typeof ResizeObserver === 'undefined') {
            return;
        }
        const column = element.closest('.chat-column') !== null;
        const measure = (): void =>
            setFrame((current) =>
                current.width === element.offsetWidth && current.height === element.offsetHeight && current.column === column
                    ? current
                    : { width: element.offsetWidth, height: element.offsetHeight, column }
            );
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        measure();
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        const element = composerRef.current;
        if (element === null) {
            return;
        }
        const measure = () => setComposerHeight(element.offsetHeight);
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        measure();
        return () => observer.disconnect();
    }, []);

    // Oversized prompts scroll in full instead of sticking with their top outside the viewport.
    const stickyComposer = composerHeight < frame.height - FOLLOW_THRESHOLD_PX;
    const coveredHeight = stickyComposer ? composerHeight : 0;
    const coveredHeightRef = useRef(coveredHeight);
    coveredHeightRef.current = coveredHeight;

    // The composer pages through the thread with PageUp and PageDown; this is the element it moves.
    useEffect(
        () =>
            registerTimeline(
                chatId,
                scrollRef.current,
                (enabled) => {
                    followRef.current = enabled;
                },
                () => coveredHeightRef.current
            ),
        [chatId]
    );

    // The client does not run the React Compiler, so its memoization rule has nothing to break here.
    // oxlint-disable-next-line react/incompatible-library
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ESTIMATED_ROW_PX,
        getItemKey: (index) => rows[index]!.id,
        overscan: 8,
        scrollPaddingEnd: coveredHeight
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
        // The composer is in the scroll flow, so its measured height is part of this end position.
        element.scrollTop = element.scrollHeight;
        scrollGeometry.current = { top: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight };
    }, [rows.length, tail, totalSize, composerHeight, frame.height]);

    // A sub-agent in the thread's place hides the thread, and the strip and the keyboard go with it.
    const onMainAgent = trail.length === 0;
    // A node on a canvas has no strip. It is too narrow to give up a column of its width.
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
    const visibleHeight = Math.max(0, viewport - coveredHeight);
    const inView = showsScrubber ? messagesInView({ starts, scrollTop, visibleHeight }) : null;

    const chatFind = useChatFind({
        chatId,
        frame: frameRef,
        thread: threadRef,
        scroller: scrollRef,
        enabled: onMainAgent,
        rows,
        structure: items,
        order,
        firstRowInView: () => {
            const top = scrollRef.current?.scrollTop ?? 0;
            return virtualizer.getVirtualItems().find((virtualRow) => virtualRow.end > top)?.index ?? 0;
        },
        openTurn: turns.add,
        openGroup: groups.add,
        openSubagent: subagents.add,
        // A row already on screen stays put; the find scrolls to the match itself once it is drawn.
        scrollToRow: (index) => {
            const top = scrollRef.current?.scrollTop ?? 0;
            const bottom = top + visibleHeight;
            if (!virtualizer.getVirtualItems().some((virtualRow) => virtualRow.index === index && virtualRow.end > top && virtualRow.start < bottom)) {
                virtualizer.scrollToIndex(index, { align: 'center' });
            }
        },
        coveredHeight: () => coveredHeightRef.current,
        stopFollowing
    });
    const searching = chatFind.find.open;
    const found = useMemo(() => (searching ? ticksWithHits(ticks, chatFind.hitRows) : []), [searching, ticks, chatFind.hitRows]);
    const foundCurrent = chatFind.currentRow === null ? null : tickOfRow(ticks, chatFind.currentRow);

    const jumpTo = (index: number): void => {
        const tick = ticks[index];
        if (!tick) {
            return;
        }
        if (tick.bookmark !== null) {
            setSeeking(tick.bookmark.itemId);
            return;
        }
        followRef.current = false;
        virtualizer.scrollToIndex(tick.rowIndex, { align: 'start' });
    };

    useLayoutEffect(() => {
        if (seeking === null) {
            return;
        }
        const index = rows.findIndex((row) => row.id === seeking);
        if (index !== -1) {
            setSeeking(null);
            followRef.current = false;
            virtualizer.scrollToIndex(index, { align: 'start' });
            return;
        }
        const turnId = items?.[seeking]?.turnId ?? null;
        if (turnId !== null && !turns.ids.has(turnId)) {
            turns.add(turnId);
            return;
        }
        setSeeking(null);
    }, [seeking, rows, items, turns, virtualizer]);
    useEffect(() => registerItemJumper(endpointKey(endpointId, chatId), setSeeking), [endpointId, chatId]);
    // The strip is memoized and draws on every scroll, so it gets one callback for its life.
    const jumpRef = useRef(jumpTo);
    jumpRef.current = jumpTo;
    const pick = useCallback((index: number) => jumpRef.current(index), []);
    // Read when the card asks rather than on every render, so the strip's memo holds while the thread streams.
    const cardChat = useMemo<CardChat>(
        () => ({
            chatId,
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

    /* The whole of what a sub-agent did, in the thread's place. Its row only keeps the beginning. */
    const openConversation = (step: SubagentStep): void => {
        show(openFromMain(step));
    };

    /* The header of a turn a sub-agent woke. It points at the row that agent worked in, or the one it hangs under. */
    const openSubagent = (toolUseId: string): void => {
        const found = findSubagentBranch(rows, toolUseId);
        if (!found) {
            return;
        }
        subagents.add(found.branch.id);
        followRef.current = false;
        virtualizer.scrollToIndex(found.index, { align: 'start' });
    };

    return (
        // A file an answer names is relative to the folder this chat runs in, which is a worktree as
        // often as it is the project itself.
        <FileLinkContext.Provider value={info?.cwd ?? null}>
            <div ref={frameRef} className="relative flex min-h-0 grow flex-col">
                {searching && (
                    <FindBar find={chatFind.find} total={chatFind.total} current={chatFind.current} invalid={chatFind.invalid} onStep={chatFind.step} />
                )}
                <ContextMenu.Root>
                    <div
                        ref={scrollRef}
                        // No CSS scroll-padding here: Chromium counts the sticky composer's caret as hidden behind
                        // it and scrolls the thread toward the end on every keystroke.
                        className="chat-scroll min-h-0 grow overflow-auto"
                        onScrollCapture={(e) => {
                            const el = e.currentTarget;
                            // Capture the reader's movement before virtualization remeasures rows and shifts the scroll offset.
                            const previous = scrollGeometry.current;
                            const layoutChanged = previous.height !== el.scrollHeight || previous.viewport !== el.clientHeight;
                            const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
                            if (!layoutChanged && el.scrollTop < previous.top) {
                                followRef.current = false;
                            } else if (atEnd) {
                                followRef.current = true;
                            }
                            scrollGeometry.current = { top: el.scrollTop, height: el.scrollHeight, viewport: el.clientHeight };
                            setTimelineAtEnd(chatId, followRef.current);
                        }}
                    >
                        <div ref={contentRef} className="relative flex min-h-full flex-col">
                            <ContextMenu.Trigger
                                ref={threadRef}
                                className="chat-thread flex grow flex-col px-4 pt-4"
                                style={{ paddingLeft }}
                                onContextMenu={(e) =>
                                    setTarget(readTimelineTarget(e.target as HTMLElement, threadRef.current, withCurrentText(rows, fullItems())))
                                }
                            >
                                {empty ? (
                                    <EmptyThread chatId={chatId} />
                                ) : (
                                    <div className="chat-column-content relative w-full shrink-0" style={{ height: virtualizer.getTotalSize() }}>
                                        {virtualizer.getVirtualItems().map((virtualRow) => {
                                            const row = rows[virtualRow.index]!;
                                            // Put turn gaps inside the measured row so the virtualizer includes them.
                                            const question = row.kind === 'user';
                                            const previous = virtualRow.index > 0 ? rows[virtualRow.index - 1]! : null;
                                            return (
                                                <div
                                                    key={row.id}
                                                    data-index={virtualRow.index}
                                                    data-item-id={row.id}
                                                    ref={virtualizer.measureElement}
                                                    className={clsx(
                                                        'absolute left-0 top-0 w-full',
                                                        rowRhythm(row, previous),
                                                        question && virtualRow.index > 0 && 'pt-(--chat-turn-gap)'
                                                    )}
                                                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                                                >
                                                    <FindRevealContext.Provider value={chatFind.reveal}>
                                                        <MarkableRow row={row} chatId={chatId} bookmark={marks.get(row.id) ?? null}>
                                                            <Row
                                                                row={row}
                                                                chatId={chatId}
                                                                toggleGroup={groups.toggle}
                                                                toggleTurn={turns.toggle}
                                                                toggleSubagent={subagents.toggle}
                                                                openSubagent={openSubagent}
                                                                openConversation={openConversation}
                                                            />
                                                        </MarkableRow>
                                                    </FindRevealContext.Provider>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </ContextMenu.Trigger>
                            <QuoteButton thread={threadRef} frame={contentRef} taker={quoteTakerRef} />
                            <div
                                ref={composerRef}
                                className={clsx('relative z-10 shrink-0', composer && 'px-3 pb-3 pt-3')}
                                style={{ position: stickyComposer ? 'sticky' : 'relative', bottom: 0 }}
                            >
                                <QuoteTakerContext.Provider value={registerQuoteTaker}>{composer}</QuoteTakerContext.Provider>
                            </div>
                        </div>
                    </div>
                    <TimelineMenuPopup target={target} thread={threadRef} chatId={onMainAgent ? chatId : null} />
                </ContextMenu.Root>
                {showsScrubber && (
                    <div className="absolute top-4" style={{ left: STRIP_INSET_PX, width: STRIP_WIDTH_PX, bottom: coveredHeight }}>
                        <ErrorBoundary label={t('timeline.stripFailed')} resetKeys={[ticks.length]}>
                            <Scrubber
                                ticks={ticks}
                                firstInView={inView?.first ?? null}
                                lastInView={inView?.last ?? null}
                                onPick={pick}
                                chat={cardChat}
                                found={found}
                                foundCurrent={foundCurrent}
                            />
                        </ErrorBoundary>
                    </div>
                )}
            </div>
        </FileLinkContext.Provider>
    );
}
