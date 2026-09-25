import { useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronDown } from 'lucide-react';
import type { ChatItem, ChatSubagentItem, Task } from '@ruimte/contracts';
import type { SubagentBranch } from '@/chat/logic/timeline';
import { formatElapsedShort } from '@/format/duration';
import { useOpenForFind } from '@/chat/ui/find-reveal';
import { Markdown } from '@/chat/ui/Markdown';
import { RunningFor, ToggleLine, WorkLiveRow, WorkRow } from '@/chat/ui/rows/WorkRows';
import { entryTimeOf, statusWordOf, taskIdOf } from '@/chat/subagent-list';
import { useSubagentSupport } from '@/chat/subagent-support';
import { canOpenSubagent, crumbOf, type SubagentStep } from '@/chat/subagent-view';
import { useEndpointId } from '@/state/keys';
import { useTasks } from '@/state/tasks';
import { Icon } from '@/ui/Icon';
import { useNow } from '@/ui/useNow';

// The work of a long-running agent scrolls inside its row instead of pushing the thread away.
const CHILDREN_MAX_PX = 320;

/*
 * One step a sub-agent took, inside its parent's row. The thread's own `Row` draws the same kinds,
 * but off a timeline it has already grouped and folded, and it writes an answer at the size of a
 * message; here every step is a line and the text is the aside under it.
 */
function ChildRow({ item }: { item: ChatItem }) {
    if (item.kind === 'tool') {
        return item.state === 'running' ? <WorkLiveRow tool={item} /> : <WorkRow tool={item} />;
    }
    if (item.kind === 'assistant') {
        return (
            <div className="-mx-1 px-1 pb-2 text-xs text-text-muted select-text">
                <Markdown text={item.text} />
            </div>
        );
    }
    return null;
}

function StatusPill({ item, task }: { item: ChatSubagentItem; task: Task | null }) {
    const { t } = useTranslation(['chat', 'common']);
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
            {duration === null ? t(`common:status.${outcome}`) : t(`rows.subagent.${outcome}In`, { duration })}
        </span>
    );
}

/* What the sub-agent did, live: its own tool calls and the text it wrote, as ordinary rows. */
function SubagentWork({ item, work }: { item: ChatSubagentItem; work: ChatItem[] }) {
    const { t } = useTranslation('chat');
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
                <ChildRow key={child.id} item={child} />
            ))}
        </div>
    );
}

/* The report the sub-agent handed back, behind a fold: the row is about the work, this is the answer. */
function SubagentResult({ itemId, result }: { itemId: string; result: string }) {
    const { t } = useTranslation('chat');
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
    item,
    work,
    expanded,
    onToggle,
    onOpenConversation
}: {
    item: ChatSubagentItem;
    work: ChatItem[];
    expanded: boolean;
    onToggle(): void;
    /* Opens everything it did in the thread's place, for a surface that has somewhere to open it. */
    onOpenConversation?(): void;
}) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const taskId = taskIdOf(item);
    const task = useTasks((s) => (taskId === null ? null : (s.byEndpoint[endpointId]?.[taskId] ?? null)));
    // A task paused on its child's limit is still a running row on the wire, but nothing is at work.
    const running = item.status === 'running' && statusWordOf(item, task) !== 'paused';
    const detail = item.description || item.summary || item.subagentType || '';
    // A row that carries no pointer on a machine that already said no has nothing to open.
    const refused = useSubagentSupport((s) => s.unsupported[endpointId] === true);
    const press = onOpenConversation !== undefined && canOpenSubagent(item, refused) ? onOpenConversation : onToggle;
    return (
        <div data-find-item={item.id}>
            <ToggleLine
                icon={<Icon icon={Bot} size={12} />}
                // A node another agent opened with `--task` reads as the task it is, not as a helper of the CLI's own.
                label={item.origin === 'ruimte' ? t('rows.subagent.task') : t('rows.subagent.label')}
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
            {expanded && (
                <div className="mb-1">
                    <SubagentWork item={item} work={work} />
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
    branch,
    onToggle,
    onOpenConversation
}: {
    branch: SubagentBranch;
    onToggle(id: string): void;
    onOpenConversation?(step: SubagentStep): void;
}) {
    return (
        <>
            <SubagentRow
                item={branch.item}
                work={branch.children}
                expanded={branch.expanded}
                onToggle={() => onToggle(branch.id)}
                onOpenConversation={onOpenConversation ? () => onOpenConversation(crumbOf(branch.item)) : undefined}
            />
            {branch.nested.length > 0 && (
                <div className="ml-6">
                    {branch.nested.map((child) => (
                        <SubagentBranchRow key={child.id} branch={child} onToggle={onToggle} onOpenConversation={onOpenConversation} />
                    ))}
                </div>
            )}
        </>
    );
}
