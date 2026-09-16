import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Bot, ChevronRight } from 'lucide-react';
import type { ChatSubagentItem } from '@ruimte/contracts';
import { deriveTimelineRows, type TimelineRow } from '@/chat/logic/timeline';
import { INITIAL_CONVERSATION, SubagentConversation, type SubagentConversationState } from '@/chat/subagent-conversation';
import { useSubagentSupport } from '@/chat/subagent-support';
import { Row } from '@/chat/ui/rows/Rows';
import { FileLinkContext } from '@/shell/panels/file-links';
import { useChatRow } from '@/state/chats';
import { useUi, type SubagentCrumb } from '@/state/ui';
import { machineTransport } from '@/transport';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';

// Below this distance from the bottom the panel follows what the agent writes; above it the reader scrolled back.
const FOLLOW_THRESHOLD_PX = 40;

// The same rhythm the thread has: a block of prose next to a run of tool lines gets air between them.
const BLOCK_KINDS = new Set<TimelineRow['kind']>(['assistant', 'thinking', 'compaction']);

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

/* The way down from the chat's own subagent, each step a way back up. */
function Breadcrumb({ trail }: { trail: SubagentCrumb[] }) {
    return (
        <nav aria-label="Sub-agents" className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border px-3 py-2 text-xs">
            <Icon icon={Bot} size={12} className="shrink-0 text-text-faint" />
            {trail.map((crumb, index) => {
                const last = index === trail.length - 1;
                const label = crumb.description || 'Sub-agent';
                return (
                    <Fragment key={`${index}:${crumb.toolUseId}`}>
                        {index > 0 && <Icon icon={ChevronRight} size={12} className="shrink-0 text-text-faint" />}
                        {last ? (
                            <span className="min-w-0 truncate text-text">{label}</span>
                        ) : (
                            <button
                                className="min-w-0 shrink truncate text-text-muted hover:text-text"
                                onClick={() => useUi.getState().openSubagentCrumb(index)}
                            >
                                {label}
                            </button>
                        )}
                    </Fragment>
                );
            })}
        </nav>
    );
}

/* One conversation, read back from the machine and grown while it is open. */
function Conversation({ endpointId, chatId, toolUseId }: { endpointId: string; chatId: string; toolUseId: string }) {
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
        return <div className="px-3 py-3 text-xs text-text-faint">Loading the conversation...</div>;
    }
    if (state.status === 'failed') {
        return (
            <EmptyState icon={<Icon icon={Bot} size={16} />}>
                {state.unsupported
                    ? "This machine cannot open a sub-agent's conversation. Update Ruimte there to read it."
                    : (state.error ?? 'The conversation could not be read.')}
            </EmptyState>
        );
    }

    const openChild = (item: ChatSubagentItem): void => {
        useUi.getState().openSubagentChild({ toolUseId: item.toolUseId, description: item.description });
    };

    const loadEarlier = (): void => {
        heightBefore.current = scrollRef.current?.scrollHeight ?? null;
        void controller.current?.loadEarlier();
    };

    return (
        <FileLinkContext.Provider value={cwd}>
            <div
                ref={scrollRef}
                className="chat-thread h-full min-h-0 overflow-auto px-4 py-3"
                onScroll={(event) => {
                    const element = event.currentTarget;
                    followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD_PX;
                }}
            >
                {state.cursor !== null && (
                    <div className="flex justify-center pb-2">
                        <Button size="sm" disabled={state.loadingEarlier} onClick={loadEarlier}>
                            {state.loadingEarlier ? 'Loading...' : 'Load earlier'}
                        </Button>
                    </div>
                )}
                {rows.length === 0 && !state.live && <div className="text-xs text-text-faint">Nothing to show yet.</div>}
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
                {state.live && <div className="chat-live-text pt-1 text-xs">Working...</div>}
            </div>
        </FileLinkContext.Provider>
    );
}

/*
 * The whole conversation of a sub-agent, beside the chat that opened it. Read-only, one at a time: a
 * click on another row replaces it, and a sub-agent it opened goes one step down the breadcrumb.
 */
export function SubagentPanel() {
    const target = useUi((s) => s.subagentPanel);
    const crumb = target?.trail.at(-1);
    if (!target || !crumb) {
        return <EmptyState icon={<Icon icon={Bot} size={16} />}>Open a sub-agent's conversation from its row in a chat.</EmptyState>;
    }
    return (
        <div className="flex h-full min-h-0 flex-col">
            <Breadcrumb trail={target.trail} />
            <ErrorBoundary label="This conversation failed to render" resetKeys={[target.chatId, crumb.toolUseId]} className="min-h-0 grow">
                <Conversation
                    key={`${target.endpointId}:${target.chatId}:${crumb.toolUseId}`}
                    endpointId={target.endpointId}
                    chatId={target.chatId}
                    toolUseId={crumb.toolUseId}
                />
            </ErrorBoundary>
        </div>
    );
}
