import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import type { ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import { SubagentConversation } from '@/chat/subagent-conversation';
import {
    entryTimeOf,
    needsTail,
    previewFor,
    sectionSubagents,
    statusWordOf,
    subagentTitle,
    taskIdOf,
    threadWorkBy,
    type SubagentPreview
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
import { statusLookOf } from '@/ui/status-look';
import { Tooltip } from '@/ui/Tooltip';

// The newest end is all an entry shows, so a few items are enough to find the last call or reply in.
const TAIL_PAGE = 10;

const NO_ITEMS: readonly string[] = [];

const NO_STRUCTURE: Record<string, ChatItem> = {};

const NO_WORK: readonly ChatItem[] = [];

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

/* One clock for the whole list, ticking each second only while an entry is running. */
const useListClock = (ticking: boolean): number => {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!ticking) {
            return;
        }
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [ticking]);
    return now;
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

function Entry({ chatId, item, work, now }: { chatId: string; item: ChatSubagentItem; work: readonly ChatItem[]; now: number }) {
    const { t } = useTranslation(['chat', 'common']);
    const endpointId = useEndpointId();
    const refused = useSubagentSupport((s) => s.unsupported[endpointId] === true);
    const taskId = taskIdOf(item);
    const task = useTasks((s) => (taskId === null ? null : (s.byEndpoint[endpointId]?.[taskId] ?? null)));
    const { show } = useSubagentTrail(chatId);
    const tail = useTail(chatId, item.toolUseId, needsTail(item, work, refused));
    const preview = previewFor(item, work, tail);
    const word = statusWordOf(item, task);
    const look = statusLookOf(word);
    const time = entryTimeOf(item, task, now);
    // The stop is a button of its own beside the entry, since a button cannot hold another.
    return (
        <div className="-mx-2 flex w-[calc(100%+16px)] items-start gap-1 rounded-md hover:bg-surface-hover">
            <button
                type="button"
                className="flex min-w-0 flex-1 flex-col gap-1 rounded-md px-2 py-2 text-left text-xs focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                onClick={() => show(openFromList(crumbOf(item)))}
            >
                <span className="flex min-w-0 items-center gap-2">
                    <Tooltip label={t(`common:status.${word}`)}>
                        <span className={clsx(ROW_GUTTER, look.tone)}>
                            <Icon icon={look.icon} size={14} className={clsx(look.spins && 'animate-spin')} />
                        </span>
                    </Tooltip>
                    {/* The title reads at the size of the chat's own messages; the line under it stays small. */}
                    <span className="min-w-0 truncate text-sm font-medium text-text">{subagentTitle(item)}</span>
                    {/* The icon says the state to the eye; a screen reader hears it with the title. */}
                    <span className="sr-only">, {t(`common:status.${word}`)}</span>
                    {time !== null && <span className="ml-auto shrink-0 pl-3 text-text-muted tabular-nums">{time}</span>}
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

function Section({
    label,
    chatId,
    items,
    work,
    now
}: {
    label: string;
    chatId: string;
    items: ChatSubagentItem[];
    work: Map<string, ChatItem[]>;
    now: number;
}) {
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
                <Entry key={item.id} chatId={chatId} item={item} work={work.get(item.toolUseId) ?? NO_WORK} now={now} />
            ))}
        </section>
    );
}

/*
 * The sub-agents of a chat in the chat's own place: the ones still at work on top and the ones that
 * settled under Done, each with the latest thing it did. Picking one opens its conversation.
 */
export function SubagentList({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const subagents = useOpenableSubagents(chatId);
    const order = useChatRow(chatId, (row) => row?.order) ?? NO_ITEMS;
    const structure = useChatRow(chatId, (row) => row?.structure) ?? NO_STRUCTURE;
    const work = useMemo(() => threadWorkBy(order, structure), [order, structure]);
    const sections = useMemo(() => sectionSubagents(subagents, work), [subagents, work]);
    const now = useListClock(sections.active.length > 0);
    if (subagents.length === 0) {
        return <EmptyState icon={<Icon icon={Bot} size={16} />}>{t('subagents.empty')}</EmptyState>;
    }
    return (
        <div className="chat-thread h-full min-h-0 overflow-auto px-4 pt-1 pb-3">
            <div className="chat-column-content flex flex-col gap-4">
                <Section label={t('subagents.active')} chatId={chatId} items={sections.active} work={work} now={now} />
                <Section label={t('subagents.done')} chatId={chatId} items={sections.done} work={work} now={now} />
            </div>
        </div>
    );
}
