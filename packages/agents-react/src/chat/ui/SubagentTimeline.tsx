import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, LoaderCircle } from 'lucide-react';
import { deriveTimelineRows } from '../logic/timeline';
import { INITIAL_CONVERSATION, SubagentConversation, type SubagentConversationState } from '../subagent-conversation';
import { useSubagentSupport } from '../subagent-support';
import { firstRowInView, restoreAnchor, wantsEarlier, type ReadingAnchor } from '../timeline-scroll';
import { EMPTY_TARGET, readTimelineTarget, type TimelineTarget } from '../logic/timeline-target';
import { openBelow, useSubagentTrail, type SubagentStep } from '../subagent-view';
import { Row } from './rows/Rows';
import { ReplyContext } from './reply-context';
import { SubagentInfo } from './SubagentInfo';
import { TimelineMenuPopup } from './TimelineMenu';
import { FOLLOW_THRESHOLD_PX, rowRhythm } from './rows/row-rhythm';
import { useToggleSet } from './useToggleSet';
import { FileLinkContext } from './file-links';
import { useChatRow } from '../../state/chats';
import { useChatScope } from '../../scope';
import { EmptyState, ContextMenu, Icon } from '@basmilius/desktop-ui';

const NO_TURNS = new Set<string>();

/*
 * A sub-agent's whole conversation, read back from the host and grown while it is on screen. It
 * stands in the chat's own place, read-only, and a sub-agent it opened goes one level further down.
 */
export function SubagentTimeline({ chatId, toolUseId }: { chatId: string; toolUseId: string }) {
    const { t } = useTranslation('agent-chat');
    const scope = useChatScope();
    const { trail, show } = useSubagentTrail(chatId);
    const [state, setState] = useState<SubagentConversationState>(INITIAL_CONVERSATION);
    const controller = useRef<SubagentConversation | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const threadRef = useRef<HTMLDivElement>(null);
    const [target, setTarget] = useState<TimelineTarget>(EMPTY_TARGET);
    const followRef = useRef(true);
    const stopFollowing = useCallback(() => {
        followRef.current = false;
    }, []);
    const groups = useToggleSet(stopFollowing);
    const subagents = useToggleSet(stopFollowing);
    // The row being read when an earlier page was asked for, so it stays where it was once that page is in.
    const anchorRef = useRef<ReadingAnchor | null>(null);
    const headRef = useRef<string | undefined>(undefined);
    const cwd = useChatRow(chatId, (row) => row?.info.cwd ?? null);

    useEffect(() => {
        const conversation = new SubagentConversation(scope.transport, chatId, toolUseId, setState);
        controller.current = conversation;
        void conversation.start();
        return () => {
            conversation.dispose();
            controller.current = null;
        };
    }, [scope, chatId, toolUseId]);

    useEffect(() => {
        if (state.unsupported) {
            useSubagentSupport.getState().markUnsupported(scope.id);
        }
    }, [state.unsupported, scope]);

    const rows = useMemo(
        () => deriveTimelineRows(state.items, { expandedGroups: groups.ids, expandedTurns: NO_TURNS, expandedSubagents: subagents.ids, activeTurnId: null }),
        [state.items, groups.ids, subagents.ids]
    );

    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (element === null) {
            return;
        }
        const head = state.items[0]?.id;
        const moved = head !== headRef.current;
        headRef.current = head;
        if (moved && anchorRef.current !== null && !followRef.current) {
            restoreAnchor(element, anchorRef.current);
        } else if (followRef.current) {
            element.scrollTop = element.scrollHeight;
        }
        if (moved) {
            anchorRef.current = null;
        }
    }, [rows, state.live, state.items]);

    const loadEarlier = useCallback(() => {
        const element = scrollRef.current;
        if (element === null || state.cursor === null || !wantsEarlier(element)) {
            return;
        }
        // Taken on every call, since the reader may scroll on while a page is on its way.
        anchorRef.current = firstRowInView(element);
        void controller.current?.loadEarlier();
    }, [state.cursor]);

    // Close to the top, the page before goes in; again after each page that left too little above the reader.
    // A page that failed changes no row, so it is asked for again only on the next scroll.
    useEffect(() => {
        if (state.status === 'ready') {
            loadEarlier();
        }
    }, [rows, state.status, loadEarlier]);

    const openChild = (step: SubagentStep): void => {
        show(openBelow(trail, step));
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <SubagentInfo chatId={chatId} toolUseId={toolUseId} />
            {state.status === 'loading' && <div className="chat-column-content px-4 pt-4 text-xs text-text-faint">{t('subagents.loading')}</div>}
            {state.status === 'failed' && (
                <EmptyState icon={Bot}>{state.unsupported ? t('subagents.unsupported') : (state.error ?? t('subagents.unreadable'))}</EmptyState>
            )}
            {state.status === 'ready' && (
                <FileLinkContext.Provider value={state.context?.cwd ?? cwd}>
                    <ReplyContext.Provider value={state.context ?? { provider: state.source === 'codex-thread' ? 'codex' : 'claude' }}>
                        <div
                            ref={scrollRef}
                            className="chat-thread relative min-h-0 grow overflow-auto px-4 pt-4 pb-3"
                            // The thread keeps its reader in place itself when a page goes in above.
                            style={{ overflowAnchor: 'none' }}
                            onScroll={(event) => {
                                const element = event.currentTarget;
                                followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD_PX;
                                loadEarlier();
                            }}
                        >
                            {/* The same menu the chat's own thread has; this transcript is read-only, so the chat
                    it belongs to is not passed on and the fork item stays out. */}
                            <ContextMenu.Root>
                                <ContextMenu.Trigger
                                    ref={threadRef}
                                    className="chat-column-content"
                                    onContextMenu={(event) => setTarget(readTimelineTarget(event.target as HTMLElement, threadRef.current, rows))}
                                >
                                    {state.loadingEarlier && (
                                        <div className="pointer-events-none sticky top-0 z-10 flex h-0 justify-center" role="status">
                                            <Icon icon={LoaderCircle} size={16} className="animate-spin text-text-faint" />
                                            <span className="sr-only">{t('timeline.loadingEarlier')}</span>
                                        </div>
                                    )}
                                    {rows.length === 0 && !state.live && <EmptyState icon={Bot}>{t('rows.subagent.nothingYet')}</EmptyState>}
                                    {rows.map((row, index) => {
                                        const previous = index > 0 ? rows[index - 1]! : null;
                                        return (
                                            <div key={row.id} data-item-id={row.id} className={rowRhythm(row, previous)}>
                                                <Row
                                                    row={row}
                                                    chatId={chatId}
                                                    toggleGroup={groups.toggle}
                                                    toggleTurn={() => undefined}
                                                    toggleSubagent={subagents.toggle}
                                                    openSubagent={() => undefined}
                                                    openConversation={openChild}
                                                />
                                            </div>
                                        );
                                    })}
                                    {state.live && <div className="chat-live-text pt-1 text-xs">{t('subagents.working')}</div>}
                                </ContextMenu.Trigger>
                                <TimelineMenuPopup target={target} thread={threadRef} />
                            </ContextMenu.Root>
                        </div>
                    </ReplyContext.Provider>
                </FileLinkContext.Provider>
            )}
        </div>
    );
}
