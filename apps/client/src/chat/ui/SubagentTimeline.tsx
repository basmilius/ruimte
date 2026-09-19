import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import type { ChatSubagentItem } from '@ruimte/contracts';
import { deriveTimelineRows, type TimelineRow } from '@/chat/logic/timeline';
import { INITIAL_CONVERSATION, SubagentConversation, type SubagentConversationState } from '@/chat/subagent-conversation';
import { useSubagentSupport } from '@/chat/subagent-support';
import { crumbOf, openBelow, useSubagentTrail } from '@/chat/subagent-view';
import { Row } from '@/chat/ui/rows/Rows';
import { FileLinkContext } from '@/shell/panels/file-links';
import { useChatRow } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { machineTransport } from '@/transport';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

// Below this distance from the bottom the thread follows what the agent writes; above it the reader scrolled back.
const FOLLOW_THRESHOLD_PX = 40;

// The same rhythm the thread has: a block of prose next to a run of tool lines gets air between them.
const BLOCK_KINDS = new Set<TimelineRow['kind']>(['assistant', 'report', 'thinking', 'compaction']);

const NO_TURNS = new Set<string>();

const toggled = (current: Set<string>, id: string): Set<string> => {
    const next = new Set(current);
    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }
    return next;
};

/*
 * A sub-agent's whole conversation, read back from the machine and grown while it is on screen. It
 * stands in the chat's own place, read-only, and a sub-agent it opened goes one level further down.
 */
export function SubagentTimeline({ chatId, toolUseId }: { chatId: string; toolUseId: string }) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const { trail, show } = useSubagentTrail(chatId);
    const [state, setState] = useState<SubagentConversationState>(INITIAL_CONVERSATION);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
    const [expandedSubagents, setExpandedSubagents] = useState<Set<string>>(() => new Set());
    const controller = useRef<SubagentConversation | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);
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
        () => deriveTimelineRows(state.items, { expandedGroups, expandedTurns: NO_TURNS, expandedSubagents, activeTurnId: null }),
        [state.items, expandedGroups, expandedSubagents]
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
        return (
            <EmptyState icon={<Icon icon={Bot} size={16} />}>
                {state.unsupported ? t('subagents.unsupported') : (state.error ?? t('subagents.unreadable'))}
            </EmptyState>
        );
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
                <div className="chat-column-content">
                    {state.cursor !== null && (
                        <div className="flex justify-center pb-2">
                            <Button size="sm" disabled={state.loadingEarlier} onClick={loadEarlier}>
                                {state.loadingEarlier ? t('subagents.loadingEarlier') : t('subagents.loadEarlier')}
                            </Button>
                        </div>
                    )}
                    {rows.length === 0 && !state.live && <div className="text-xs text-text-faint">{t('rows.subagent.nothingYet')}</div>}
                    {rows.map((row, index) => {
                        const previous = index > 0 ? rows[index - 1]! : null;
                        const question = row.kind === 'user';
                        const seam = !question && previous !== null && previous.kind !== 'user' && BLOCK_KINDS.has(row.kind) !== BLOCK_KINDS.has(previous.kind);
                        return (
                            <div key={row.id} className={clsx(question && 'pb-(--chat-answer-gap)', seam && 'pt-(--chat-block-gap)')}>
                                <Row
                                    row={row}
                                    chatId={chatId}
                                    toggleGroup={(id) => setExpandedGroups((current) => toggled(current, id))}
                                    toggleTurn={() => undefined}
                                    toggleSubagent={(id) => setExpandedSubagents((current) => toggled(current, id))}
                                    openSubagent={() => undefined}
                                    openConversation={openChild}
                                />
                            </div>
                        );
                    })}
                    {state.live && <div className="chat-live-text pt-1 text-xs">{t('subagents.working')}</div>}
                </div>
            </div>
        </FileLinkContext.Provider>
    );
}
