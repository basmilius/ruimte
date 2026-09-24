import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import type { ChatSubagentItem } from '@ruimte/contracts';
import { deriveTimelineRows } from '@/chat/logic/timeline';
import { INITIAL_CONVERSATION, SubagentConversation, type SubagentConversationState } from '@/chat/subagent-conversation';
import { useSubagentSupport } from '@/chat/subagent-support';
import { EMPTY_TARGET, readTimelineTarget, type TimelineTarget } from '@/chat/logic/timeline-target';
import { crumbOf, openBelow, useSubagentTrail } from '@/chat/subagent-view';
import { Row } from '@/chat/ui/rows/Rows';
import { TimelineMenuPopup } from '@/chat/ui/TimelineMenu';
import { FOLLOW_THRESHOLD_PX, rowRhythm } from '@/chat/ui/rows/row-rhythm';
import { useToggleSet } from '@/chat/ui/useToggleSet';
import { FileLinkContext } from '@/shell/panels/file-links';
import { useChatRow } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { machineTransport } from '@/transport';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';

const NO_TURNS = new Set<string>();

/*
 * A sub-agent's whole conversation, read back from the machine and grown while it is on screen. It
 * stands in the chat's own place, read-only, and a sub-agent it opened goes one level further down.
 */
export function SubagentTimeline({ chatId, toolUseId }: { chatId: string; toolUseId: string }) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
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
    // The height before older rows went in above, so the rows being read stay where they were.
    const heightBefore = useRef<number | null>(null);
    const cwd = useChatRow(chatId, (row) => row?.info.cwd ?? null);

    useEffect(() => {
        const conversation = new SubagentConversation(machineTransport(endpointId), chatId, toolUseId, setState);
        controller.current = conversation;
        void conversation.start();
        return () => {
            conversation.dispose();
            controller.current = null;
        };
    }, [endpointId, chatId, toolUseId]);

    useEffect(() => {
        if (state.unsupported) {
            useSubagentSupport.getState().markUnsupported(endpointId);
        }
    }, [state.unsupported, endpointId]);

    const rows = useMemo(
        () => deriveTimelineRows(state.items, { expandedGroups: groups.ids, expandedTurns: NO_TURNS, expandedSubagents: subagents.ids, activeTurnId: null }),
        [state.items, groups.ids, subagents.ids]
    );

    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (element === null) {
            return;
        }
        if (heightBefore.current !== null) {
            element.scrollTop += element.scrollHeight - heightBefore.current;
            heightBefore.current = null;
            return;
        }
        if (followRef.current) {
            element.scrollTop = element.scrollHeight;
        }
    }, [rows, state.live]);

    if (state.status === 'loading') {
        return <div className="chat-column-content px-4 pt-4 text-xs text-text-faint">{t('subagents.loading')}</div>;
    }
    if (state.status === 'failed') {
        return <EmptyState icon={Bot}>{state.unsupported ? t('subagents.unsupported') : (state.error ?? t('subagents.unreadable'))}</EmptyState>;
    }

    const openChild = (item: ChatSubagentItem): void => {
        show(openBelow(trail, crumbOf(item)));
    };

    const loadEarlier = (): void => {
        heightBefore.current = scrollRef.current?.scrollHeight ?? null;
        void controller.current?.loadEarlier();
    };

    return (
        <FileLinkContext.Provider value={cwd}>
            <div
                ref={scrollRef}
                className="chat-thread h-full min-h-0 overflow-auto px-4 pt-4 pb-3"
                onScroll={(event) => {
                    const element = event.currentTarget;
                    followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD_PX;
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
                        {state.cursor !== null && (
                            <div className="flex justify-center pb-2">
                                <Button size="sm" disabled={state.loadingEarlier} onClick={loadEarlier}>
                                    {state.loadingEarlier ? t('subagents.loadingEarlier') : t('subagents.loadEarlier')}
                                </Button>
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
        </FileLinkContext.Provider>
    );
}
