import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, FileDiff, X } from 'lucide-react';
import type { ChatToolItem, ChatTurnItem } from '@ruimte/contracts';
import { fileChanges, toolSummary } from '@/chat/logic/tools';
import { toolIcon } from '@/chat/ui/icons';

// The diff renderer carries shiki; it only loads once a thread shows a file change.
const EditDiff = lazy(() => import('@/chat/ui/EditDiff'));

const OUTPUT_LIMIT = 4000;

const clip = (text: string): string => (text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n[${text.length - OUTPUT_LIMIT} more characters]` : text);

function ToggleLine({
    icon,
    label,
    detail,
    open,
    onToggle,
    failed,
    live,
    className
}: {
    icon: React.ReactNode;
    label: string;
    detail?: string;
    open: boolean;
    onToggle(): void;
    failed?: boolean;
    live?: boolean;
    className?: string;
}) {
    return (
        <button
            className={clsx(
                'flex h-7 w-full items-center gap-2 rounded-md px-1 text-left text-[12.5px] text-text-muted hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                failed && 'text-status-error',
                className
            )}
            onClick={onToggle}
        >
            <span className={clsx('grid h-6 w-6 shrink-0 place-items-center', live && 'chat-live')}>{icon}</span>
            <span className={clsx('shrink-0', live && 'chat-live-text')}>{label}</span>
            {detail && <span className="min-w-0 truncate font-mono text-text-faint">{detail}</span>}
            <span className="grow" />
            {failed && <X size={12} className="shrink-0" />}
            <ChevronRight size={12} className={clsx('shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
        </button>
    );
}

function ToolBody({ tool }: { tool: ChatToolItem }) {
    const changes = fileChanges(tool.name, tool.input);
    return (
        <div className="mb-1 ml-8 overflow-hidden rounded-md border border-border bg-surface-raised">
            {changes.length > 0 ? (
                <Suspense fallback={<div className="px-3 py-2 text-[12px] text-text-faint">Loading diff</div>}>
                    {changes.map((change, index) => (
                        <EditDiff key={index} change={change} />
                    ))}
                </Suspense>
            ) : (
                <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-[1.6] text-text-muted select-text">
                    {clip(JSON.stringify(tool.input, null, 2) ?? '')}
                </pre>
            )}
            {tool.output !== null && tool.output !== '' && (
                <pre
                    className={clsx(
                        'max-h-64 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 font-mono text-[11.5px] leading-[1.6] select-text',
                        tool.state === 'error' ? 'text-term-red' : 'text-term-fg'
                    )}
                >
                    {clip(tool.output)}
                </pre>
            )}
        </div>
    );
}

/* One settled tool call: a line, and its input and output behind it. */
export function WorkRow({ tool, nested }: { tool: ChatToolItem; nested?: boolean }) {
    const [open, setOpen] = useState(false);
    return (
        <div className={clsx(nested ? 'ml-6' : '', 'pb-0.5')}>
            <ToggleLine
                icon={toolIcon(tool.name)}
                label={tool.name}
                detail={toolSummary(tool.name, tool.input)}
                open={open}
                onToggle={() => setOpen((o) => !o)}
                failed={tool.state === 'error'}
            />
            {open && <ToolBody tool={tool} />}
        </div>
    );
}

export function WorkLiveRow({ tool }: { tool: ChatToolItem }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="pb-0.5">
            <ToggleLine
                icon={toolIcon(tool.name)}
                label={tool.name}
                detail={toolSummary(tool.name, tool.input)}
                open={open}
                onToggle={() => setOpen((o) => !o)}
                live
            />
            {open && <ToolBody tool={tool} />}
        </div>
    );
}

/* A run of tool calls as one line ("Read 4 files"); opening it lists every call. */
export function WorkGroupRow({ tools, summary, expanded, onToggle }: { tools: ChatToolItem[]; summary: string; expanded: boolean; onToggle(): void }) {
    const failed = tools.some((tool) => tool.state === 'error');
    return (
        <div className="pb-0.5">
            <ToggleLine icon={toolIcon(tools[0]!.name)} label={summary} open={expanded} onToggle={onToggle} failed={failed} />
        </div>
    );
}

export function TurnFoldRow({ turn, label, expanded, onToggle }: { turn: ChatTurnItem; label: string; expanded: boolean; onToggle(): void }) {
    return (
        <div className="pb-1.5">
            <button
                className={clsx(
                    'flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[12px] text-text-muted hover:bg-surface-sunken',
                    turn.state === 'error' && 'text-status-error'
                )}
                onClick={onToggle}
            >
                <ChevronRight size={12} className={clsx('transition-transform', expanded && 'rotate-90')} />
                {label}
            </button>
        </div>
    );
}

/* The files a settled turn changed, as a card; each file opens its diff in place. */
export function ChangedFilesRow({ tools }: { tools: ChatToolItem[] }) {
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const byPath = new Map<string, ChatToolItem[]>();
    for (const tool of tools) {
        const path = (tool.input as { file_path?: string })?.file_path ?? tool.id;
        byPath.set(path, [...(byPath.get(path) ?? []), tool]);
    }
    return (
        <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface-raised">
            <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-text-muted">
                <FileDiff size={13} />
                <span className="font-medium text-text">
                    {byPath.size} changed file{byPath.size === 1 ? '' : 's'}
                </span>
            </div>
            {[...byPath].map(([path, edits]) => (
                <div key={path} className="border-t border-border">
                    <button
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-muted hover:bg-surface-sunken"
                        onClick={() => setOpen((o) => ({ ...o, [path]: !o[path] }))}
                    >
                        <ChevronRight size={12} className={clsx('shrink-0 text-text-faint transition-transform', open[path] && 'rotate-90')} />
                        <span className="min-w-0 truncate font-mono text-text">{path}</span>
                        <span className="grow" />
                        <span className="text-text-faint">
                            {edits.length} edit{edits.length === 1 ? '' : 's'}
                        </span>
                    </button>
                    {open[path] && (
                        <div className="border-t border-border">
                            <Suspense fallback={<div className="px-3 py-2 text-[12px] text-text-faint">Loading diff</div>}>
                                {edits.flatMap((edit) =>
                                    fileChanges(edit.name, edit.input).map((change, index) => <EditDiff key={`${edit.id}-${index}`} change={change} />)
                                )}
                            </Suspense>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

const pad = (n: number): string => String(n).padStart(2, '0');

/* "Working for 00:14": the timer writes the text itself, so a tick never re-renders the thread. */
export function WorkingRow({ startedAt }: { startedAt: number }) {
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const tick = (): void => {
            const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
            if (ref.current) {
                ref.current.textContent = `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
            }
        };
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [startedAt]);
    return (
        <div className="flex h-7 items-center gap-2 px-1 pb-2 text-[12.5px] text-text-muted">
            <span className="chat-live grid h-6 w-6 place-items-center">
                <span className="h-2 w-2 rounded-full bg-status-running" />
            </span>
            <span className="chat-live-text">Working for</span>
            <span ref={ref} className="tabular-nums" />
        </div>
    );
}
