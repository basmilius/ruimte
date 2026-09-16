import { useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Bot, ChevronDown, PanelRightOpen } from 'lucide-react';
import type { ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import { formatDuration } from '@/chat/logic/timeline';
import { Markdown } from '@/chat/ui/Markdown';
import { RunningFor, ToggleLine, WorkLiveRow, WorkRow } from '@/chat/ui/rows/WorkRows';
import { useSubagentSupport } from '@/chat/subagent-support';
import { useEndpointId } from '@/state/keys';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// The work of a long-running agent scrolls inside its row instead of pushing the thread away.
const CHILDREN_MAX_PX = 320;

function StatusPill({ item }: { item: ChatSubagentItem }) {
    if (item.status === 'running') {
        return <RunningFor startedAt={item.startedAt} />;
    }
    const duration = item.finishedAt === null ? null : formatDuration(item.finishedAt - item.startedAt);
    return (
        <span className={clsx('shrink-0 text-xs tabular-nums', item.status === 'failed' ? 'text-status-error' : 'text-text-faint')}>
            {item.status === 'failed' ? 'failed' : 'done'}
            {duration ? ` in ${duration}` : ''}
        </span>
    );
}

/* What the sub-agent did, live: its own tool calls and the text it wrote, as ordinary rows. */
function SubagentWork({ item, work }: { item: ChatSubagentItem; work: ChatItem[] }) {
    const scroller = useRef<HTMLDivElement>(null);
    const running = item.status === 'running';
    useLayoutEffect(() => {
        // While it works, the newest line is the one worth seeing.
        if (running && scroller.current) {
            scroller.current.scrollTop = scroller.current.scrollHeight;
        }
    }, [work.length, running]);
    if (work.length === 0) {
        return <div className="ml-6 pb-1 text-xs text-text-faint">Nothing to show yet.</div>;
    }
    return (
        <div ref={scroller} className="ml-6 overflow-y-auto" style={{ maxHeight: CHILDREN_MAX_PX }}>
            {item.itemsTruncated && <div className="pb-1 text-xs text-text-faint">Only the beginning of this agent's work is kept.</div>}
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
    const [open, setOpen] = useState(false);
    return (
        <div className="ml-6 pb-1">
            <button className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
                <Icon icon={ChevronDown} size={12} className={clsx('transition-transform', open && 'rotate-180')} />
                {open ? 'Hide result' : 'Show result'}
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
 * One agent the agent delegated to. Collapsed it says what it is doing and for how long; opened it
 * shows its own work and, once it settled, the report it wrote.
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
    /* Opens everything it did beside the thread, for a surface that has somewhere to open it. */
    onOpenConversation?(): void;
}) {
    const running = item.status === 'running';
    const detail = item.description || item.summary || item.subagentType || '';
    const endpointId = useEndpointId();
    // A row that carries no pointer on a machine that already said no has nothing to open.
    const refused = useSubagentSupport((s) => s.unsupported[endpointId] === true);
    const canOpen = onOpenConversation !== undefined && (item.native !== undefined || !refused);
    const line = (
        <ToggleLine
            icon={<Icon icon={Bot} size={12} />}
            // A node another agent opened with `--task` reads as the task it is, not as a helper of the CLI's own.
            label={item.origin === 'ruimte' ? 'Task' : 'Sub-agent'}
            detail={detail}
            open={expanded}
            onToggle={onToggle}
            failed={item.status === 'failed'}
            live={running}
            inline={canOpen}
            trailing={
                <>
                    {item.background && <span className="shrink-0 text-xs text-text-faint">background</span>}
                    {running && item.lastTool && <span className="shrink-0 text-xs text-text-faint">{item.lastTool}</span>}
                    <StatusPill item={item} />
                </>
            }
        />
    );
    return (
        <div>
            {canOpen ? (
                <div className="-mx-1 flex w-[calc(100%+8px)] items-center gap-1">
                    {line}
                    <Tooltip label="Open conversation" name>
                        <button className="icon-btn mb-0.5 shrink-0" onClick={onOpenConversation}>
                            <Icon icon={PanelRightOpen} size={12} />
                        </button>
                    </Tooltip>
                </div>
            ) : (
                line
            )}
            {expanded && (
                <div className="mb-1">
                    <SubagentWork item={item} work={work} />
                    {item.result !== null && <SubagentResult result={item.result} />}
                </div>
            )}
        </div>
    );
}
