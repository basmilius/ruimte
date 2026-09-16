import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Bot } from 'lucide-react';
import type { ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import { SubagentConversation } from '@/chat/subagent-conversation';
import {
    needsTail,
    previewFor,
    sectionSubagents,
    statusLookOf,
    statusWordOf,
    subagentTitle,
    taskIdOf,
    threadWorkBy,
    type SubagentPreview,
    type SubagentStatusWord
} from '@/chat/subagent-list';
import { useSubagentSupport } from '@/chat/subagent-support';
import { crumbOf, openFromList, useOpenableSubagents, useSubagentTrail } from '@/chat/subagent-view';
import { ROW_GUTTER } from '@/chat/ui/icons';
import { SubagentStopButton } from '@/chat/ui/SubagentStopButton';
import { useChatRow } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useTasks } from '@/state/tasks';
import { machineTransport } from '@/transport';
import { SECTION_LABEL } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

// The newest end is all an entry shows, so a few items are enough to find the last call or reply in.
const TAIL_PAGE = 10;

const NO_ITEMS: readonly string[] = [];

const NO_STRUCTURE: Record<string, ChatItem> = {};

const NO_WORK: readonly ChatItem[] = [];

const STATUS_CLASS: Record<SubagentStatusWord, string> = {
    running: 'text-status-running',
    done: 'text-text-faint',
    failed: 'text-status-error',
    cancelled: 'text-text-faint'
};

/*
 * The newest end of a sub-agent's conversation, held on the machine for as long as the entry needs
 * it, so it grows with the `chat.subagentChanged` the conversation view already listens to.
 */
const useTail = (chatId: string, toolUseId: string, enabled: boolean): readonly ChatItem[] | null => {
    const endpointId = useEndpointId();
    const [tail, setTail] = useState<readonly ChatItem[] | null>(null);
    useEffect(() => {
        if (!enabled) {
            return;
        }
        const conversation = new SubagentConversation(
            machineTransport(endpointId),
            chatId,
            toolUseId,
            (state) => {
                if (state.unsupported) {
                    useSubagentSupport.getState().markUnsupported(endpointId);
                }
                setTail(state.status === 'ready' ? state.items : null);
            },
            TAIL_PAGE
        );
        void conversation.start();
        return () => conversation.dispose();
    }, [endpointId, chatId, toolUseId, enabled]);
    // What an earlier hold read says nothing once the entry stopped needing one.
    return enabled ? tail : null;
};

function Preview({ preview }: { preview: SubagentPreview }) {
    if (preview.kind === 'text') {
        return <span className="line-clamp-2 break-words text-text-muted">{preview.text}</span>;
    }
    return (
        <span className="line-clamp-2 break-words text-text-muted">
            <span className="text-text">{preview.name}</span>
            {preview.detail !== '' && ` ${preview.detail}`}
        </span>
    );
}

function Entry({ chatId, item, work }: { chatId: string; item: ChatSubagentItem; work: readonly ChatItem[] }) {
    const endpointId = useEndpointId();
    const refused = useSubagentSupport((s) => s.unsupported[endpointId] === true);
    const taskId = taskIdOf(item);
    const task = useTasks((s) => (taskId === null ? null : (s.byEndpoint[endpointId]?.[taskId] ?? null)));
    const { show } = useSubagentTrail(chatId);
    const tail = useTail(chatId, item.toolUseId, needsTail(item, work, refused));
    const preview = previewFor(item, work, tail);
    const word = statusWordOf(item, task);
    const look = statusLookOf(word);
    // The stop is a button of its own beside the entry, since a button cannot hold another.
    return (
        <div className="-mx-2 flex w-[calc(100%+16px)] items-start gap-1 rounded-md hover:bg-surface-hover">
            <button
                type="button"
                className="flex min-w-0 flex-1 flex-col gap-1 rounded-md px-2 py-2 text-left text-xs focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                onClick={() => show(openFromList(crumbOf(item)))}
            >
                <span className="flex min-w-0 items-center gap-2">
                    <span className={clsx(ROW_GUTTER, look.tone)}>
                        <Icon icon={look.icon} size={14} className={clsx(look.spins && 'animate-spin')} />
                    </span>
                    {/* The title reads at the size of the chat's own messages; the line under it stays small. */}
                    <span className="min-w-0 truncate text-sm font-medium text-text">{subagentTitle(item)}</span>
                    <span className={clsx('ml-auto shrink-0 pl-3', STATUS_CLASS[word])}>{word}</span>
                </span>
                {preview !== null && (
                    <span className="ml-6 min-w-0">
                        <Preview preview={preview} />
                    </span>
                )}
            </button>
            <SubagentStopButton chatId={chatId} item={item} className="mt-1.5 mr-1.5" />
        </div>
    );
}

function Section({ label, chatId, items, work }: { label: string; chatId: string; items: ChatSubagentItem[]; work: Map<string, ChatItem[]> }) {
    if (items.length === 0) {
        return null;
    }
    return (
        <section aria-label={label} className="flex flex-col gap-1">
            <div className={`${SECTION_LABEL} flex items-center gap-1.5 pt-2 pb-1`}>
                {label}
                <span className="ml-auto tabular-nums">{items.length}</span>
            </div>
            {items.map((item) => (
                <Entry key={item.id} chatId={chatId} item={item} work={work.get(item.toolUseId) ?? NO_WORK} />
            ))}
        </section>
    );
}

/*
 * The sub-agents of a chat in the chat's own place: the ones still at work on top and the ones that
 * settled under Done, each with the latest thing it did. Picking one opens its conversation.
 */
export function SubagentList({ chatId }: { chatId: string }) {
    const subagents = useOpenableSubagents(chatId);
    const order = useChatRow(chatId, (row) => row?.order) ?? NO_ITEMS;
    const structure = useChatRow(chatId, (row) => row?.structure) ?? NO_STRUCTURE;
    const sections = useMemo(() => sectionSubagents(subagents), [subagents]);
    const work = useMemo(() => threadWorkBy(order, structure), [order, structure]);
    if (subagents.length === 0) {
        return <EmptyState icon={<Icon icon={Bot} size={16} />}>This chat has no sub-agents to open.</EmptyState>;
    }
    return (
        <div className="chat-thread h-full min-h-0 overflow-auto px-4 pt-1 pb-3">
            <div className="chat-column-content flex flex-col gap-4">
                <Section label="Active" chatId={chatId} items={sections.active} work={work} />
                <Section label="Done" chatId={chatId} items={sections.done} work={work} />
            </div>
        </div>
    );
}
