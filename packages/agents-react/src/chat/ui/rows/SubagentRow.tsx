import { useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronDown } from 'lucide-react';
import type { ChatAssistantItem, ChatItem, ChatSubagentItem } from '@ruimte/agent-contracts';
import type { SubagentBranch } from '../../logic/timeline';
import { formatElapsedShort } from '@adecore/ui/format';
import { Icon, useNow } from '@adecore/ui';
import { useOpenForFind } from '../find-reveal';
import { Markdown } from '../Markdown';
import { TaskRow } from './TaskRow';
import { RunningFor, ToggleLine, WorkLiveRow, WorkRow } from './WorkRows';
import { entryTimeOf, statusWordOf, taskIdOf } from '../../subagent-list';
import { useSubagentSupport } from '../../subagent-support';
import { canOpenSubagent, crumbOf, type SubagentStep } from '../../subagent-view';
import { chatHost, type SubagentTask } from '../../../host';
import { useChatScope } from '../../../scope';
import { useCurrentItem } from '../../../state/chats';

// The work of a long-running agent scrolls inside its row instead of pushing the thread away.
const CHILDREN_MAX_PX = 320;

/*
 * One step a sub-agent took, inside its parent's row. The thread's own `Row` draws the same kinds,
 * but off a timeline it has already grouped and folded, and it writes an answer at the size of a
 * message; here every step is a line and the text is the aside under it.
 */
function ChildRow({ chatId, item }: { chatId: string; item: ChatItem }) {
    if (item.kind === 'tool') {
        return item.state === 'running' ? <WorkLiveRow chatId={chatId} tool={item} /> : <WorkRow tool={item} />;
    }
    if (item.kind === 'assistant') {
        return <ChildText chatId={chatId} item={item} />;
    }
    return null;
}

function ChildText({ chatId, item: derived }: { chatId: string; item: ChatAssistantItem }) {
    const item = useCurrentItem(chatId, derived);
    return (
        <div className="-mx-1 px-1 pb-2 text-xs text-text-muted select-text">
            <Markdown text={item.text} />
        </div>
    );
}

function StatusPill({ item, task }: { item: ChatSubagentItem; task: SubagentTask | null }) {
    const { t } = useTranslation('agent-chat');
    const paused = statusWordOf(item, task) === 'paused';
    const now = useNow(60_000, paused);
    if (paused) {
        return <span className="shrink-0 text-xs text-text-faint tabular-nums">{entryTimeOf(item, task, now)}</span>;
    }
    if (item.status === 'running') {
        return <RunningFor startedAt={item.startedAt} />;
    }
    const failed = item.status === 'failed';
    const duration = item.finishedAt === null ? null : formatElapsedShort(item.finishedAt - item.startedAt);
    const outcome = failed ? 'failed' : 'done';
    return (
        <span className={clsx('shrink-0 text-xs tabular-nums', failed ? 'text-status-error' : 'text-text-faint')}>
            {duration === null ? t(`common.status.${outcome}`) : t(`rows.subagent.${outcome}In`, { duration })}
        </span>
    );
}

/* What the sub-agent did, live: its own tool calls and the text it wrote, as ordinary rows. */
function SubagentWork({ chatId, item, work }: { chatId: string; item: ChatSubagentItem; work: ChatItem[] }) {
    const { t } = useTranslation('agent-chat');
    const scroller = useRef<HTMLDivElement>(null);
    const running = item.status === 'running';
    useLayoutEffect(() => {
        // While it works, the newest line is the one worth seeing.
        if (running && scroller.current) {
            scroller.current.scrollTop = scroller.current.scrollHeight;
        }
    }, [work.length, running]);
    if (work.length === 0) {
        // A line inside a chat row, where the centered block of an EmptyState would outweigh the row itself.
        return <div className="ml-6 pb-1 text-xs text-text-faint">{t('rows.subagent.nothingYet')}</div>;
    }
    return (
        <div ref={scroller} className="ml-6 overflow-y-auto" style={{ maxHeight: CHILDREN_MAX_PX }}>
            {item.itemsTruncated && <div className="pb-1 text-xs text-text-faint">{t('rows.subagent.truncated')}</div>}
            {work.map((child) => (
                <ChildRow key={child.id} chatId={chatId} item={child} />
            ))}
        </div>
    );
}

/* The report the sub-agent handed back, behind a fold: the row is about the work, this is the answer. */
function SubagentResult({ itemId, result }: { itemId: string; result: string }) {
    const { t } = useTranslation('agent-chat');
    const [open, setOpen] = useState(false);
    useOpenForFind(itemId, 'output', setOpen);
    return (
        <div className="ml-6 pb-1">
            <button className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
                <Icon icon={ChevronDown} size={12} className={clsx('transition-transform', open && 'rotate-180')} />
                {open ? t('rows.subagent.hideResult') : t('rows.subagent.showResult')}
            </button>
            {open && (
                <div data-find-field="output" className="mt-1 rounded-md border border-border bg-surface-raised px-3 py-2 select-text">
                    <Markdown text={result} />
                </div>
            )}
        </div>
    );
}

/*
 * One agent the agent delegated to. The line says what it is doing and for how long; pressing it
 * opens the whole conversation in the thread's place, and where there is none to open it folds out
 * the work the thread kept and, once it settled, the report it wrote.
 */
export function SubagentRow({
    chatId,
    item,
    work,
    expanded,
    onToggle,
    onOpenConversation
}: {
    chatId: string;
    item: ChatSubagentItem;
    work: ChatItem[];
    expanded: boolean;
    onToggle(): void;
    /* Opens everything it did in the thread's place, for a surface that has somewhere to open it. */
    onOpenConversation?(): void;
}) {
    const { t } = useTranslation('agent-chat');
    const { id } = useChatScope();
    const taskId = taskIdOf(item);
    const task = chatHost().tasks.useTask(id, taskId);
    // A task paused on its child's limit is still a running row on the wire, but nothing is at work.
    const running = item.status === 'running' && statusWordOf(item, task) !== 'paused';
    const detail = item.description || item.summary || item.subagentType || '';
    // A row that carries no pointer on a host that already said no has nothing to open.
    const refused = useSubagentSupport((s) => s.unsupported[id] === true);
    const press = onOpenConversation !== undefined && canOpenSubagent(item, refused) ? onOpenConversation : onToggle;
    return (
        <div data-find-item={item.id}>
            {item.origin === 'ruimte' ? (
                <TaskRow item={item} task={task} open={expanded} onPress={press} />
            ) : (
                <ToggleLine
                    icon={<Icon icon={Bot} size={12} />}
                    label={t('rows.subagent.label')}
                    detail={detail}
                    open={expanded}
                    onToggle={press}
                    failed={item.status === 'failed'}
                    live={running}
                    trailing={
                        <>
                            {item.background && <span className="shrink-0 text-xs text-text-faint">{t('rows.subagent.background')}</span>}
                            {running && item.lastTool && <span className="shrink-0 text-xs text-text-faint">{item.lastTool}</span>}
                            <StatusPill item={item} task={task} />
                        </>
                    }
                />
            )}
            {expanded && (
                <div className="mb-1">
                    <SubagentWork chatId={chatId} item={item} work={work} />
                    {item.result !== null && <SubagentResult itemId={item.id} result={item.result} />}
                </div>
            )}
        </div>
    );
}

/*
 * A sub-agent's row with the agents it opened in turn under it. Those stay in sight whether its own
 * work is folded or not, since opening the parent shows its conversation and not theirs.
 */
export function SubagentBranchRow({
    chatId,
    branch,
    onToggle,
    onOpenConversation
}: {
    chatId: string;
    branch: SubagentBranch;
    onToggle(id: string): void;
    onOpenConversation?(step: SubagentStep): void;
}) {
    return (
        <>
            <SubagentRow
                chatId={chatId}
                item={branch.item}
                work={branch.children}
                expanded={branch.expanded}
                onToggle={() => onToggle(branch.id)}
                onOpenConversation={onOpenConversation ? () => onOpenConversation(crumbOf(branch.item)) : undefined}
            />
            {branch.nested.length > 0 && (
                <div className="ml-6">
                    {branch.nested.map((child) => (
                        <SubagentBranchRow key={child.id} chatId={chatId} branch={child} onToggle={onToggle} onOpenConversation={onOpenConversation} />
                    ))}
                </div>
            )}
        </>
    );
}
