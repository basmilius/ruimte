import { useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronDown } from 'lucide-react';
import type { ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import { formatElapsedShort } from '@/format/duration';
import { Markdown } from '@/chat/ui/Markdown';
import { RunningFor, ToggleLine, WorkLiveRow, WorkRow } from '@/chat/ui/rows/WorkRows';
import { useSubagentSupport } from '@/chat/subagent-support';
import { canOpenSubagent } from '@/chat/subagent-view';
import { useEndpointId } from '@/state/keys';
import { Icon } from '@/ui/Icon';

// The work of a long-running agent scrolls inside its row instead of pushing the thread away.
const CHILDREN_MAX_PX = 320;

function StatusPill({ item }: { item: ChatSubagentItem }) {
    const { t } = useTranslation('chat');
    if (item.status === 'running') {
        return <RunningFor startedAt={item.startedAt} />;
    }
    const failed = item.status === 'failed';
    const duration = item.finishedAt === null ? null : formatElapsedShort(item.finishedAt - item.startedAt);
    const outcome = failed ? 'failed' : 'done';
    return (
        <span className={clsx('shrink-0 text-xs tabular-nums', failed ? 'text-status-error' : 'text-text-faint')}>
            {duration === null ? t(`rows.subagent.${outcome}`) : t(`rows.subagent.${outcome}In`, { duration })}
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
        return <div className="ml-6 pb-1 text-xs text-text-faint">{t('rows.subagent.nothingYet')}</div>;
    }
    return (
        <div ref={scroller} className="ml-6 overflow-y-auto" style={{ maxHeight: CHILDREN_MAX_PX }}>
            {item.itemsTruncated && <div className="pb-1 text-xs text-text-faint">{t('rows.subagent.truncated')}</div>}
            {work.map((child) =>
                child.kind === 'tool' ? (
                    child.state === 'running' ? (
                        <WorkLiveRow key={child.id} tool={child} />
                    ) : (
                        <WorkRow key={child.id} tool={child} />
                    )
                ) : child.kind === 'assistant' ? (
                    <div key={child.id} className="-mx-1 px-1 pb-2 text-xs text-text-muted select-text">
                        <Markdown text={child.text} />
                    </div>
                ) : null
            )}
        </div>
    );
}

/* The report the sub-agent handed back, behind a fold: the row is about the work, this is the answer. */
function SubagentResult({ result }: { result: string }) {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);
    return (
        <div className="ml-6 pb-1">
            <button className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
                <Icon icon={ChevronDown} size={12} className={clsx('transition-transform', open && 'rotate-180')} />
                {open ? t('rows.subagent.hideResult') : t('rows.subagent.showResult')}
            </button>
            {open && (
                <div className="mt-1 rounded-md border border-border bg-surface-raised px-3 py-2 select-text">
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
    const running = item.status === 'running';
    const detail = item.description || item.summary || item.subagentType || '';
    const endpointId = useEndpointId();
    // A row that carries no pointer on a machine that already said no has nothing to open.
    const refused = useSubagentSupport((s) => s.unsupported[endpointId] === true);
    const press = onOpenConversation !== undefined && canOpenSubagent(item, refused) ? onOpenConversation : onToggle;
    return (
        <div>
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
                        <StatusPill item={item} />
                    </>
                }
            />
            {expanded && (
                <div className="mb-1">
                    <SubagentWork item={item} work={work} />
                    {item.result !== null && <SubagentResult result={item.result} />}
                </div>
            )}
        </div>
    );
}
