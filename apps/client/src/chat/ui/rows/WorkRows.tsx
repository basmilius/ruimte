import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { ChevronRight, FileDiff, GitFork, X } from 'lucide-react';
import type { ChatCheckpointDiff, ChatCheckpointFile, ChatFileChange, ChatInfo, ChatToolItem, ChatTurnItem } from '@ruimte/contracts';
import { chatClient } from '@/chat';
import { forksAfter } from '@/chat/logic/fork';
import { useChats, type ChatsById } from '@/state/chats';
import { splitKey, useEndpointId } from '@/state/keys';
import { Tooltip } from '@/ui/Tooltip';
import { fileChanges, formatElapsed, liveOutput, readImagePath, toolStartedAt, toolSummary, unifiedChanges, type FileChange } from '@/chat/logic/tools';
import { ReadImage } from '@/chat/ui/ImageView';
import { ROW_GUTTER, toolIcon } from '@/chat/ui/icons';
import { Icon } from '@/ui/Icon';

// The diff renderers carry shiki; they only load once a thread shows a file change.
const EditDiff = lazy(() => import('@/chat/ui/EditDiff'));
const UnifiedDiff = lazy(() => import('@/chat/ui/UnifiedDiff'));

const OUTPUT_LIMIT = 4000;

const clip = (text: string): string =>
    text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n${i18next.t('chat:work.moreCharacters', { count: text.length - OUTPUT_LIMIT })}` : text;

export function ToggleLine({
    icon,
    label,
    detail,
    open,
    onToggle,
    failed,
    live,
    trailing,
    className
}: {
    icon: React.ReactNode;
    label: string;
    detail?: string;
    open: boolean;
    onToggle(): void;
    failed?: boolean;
    live?: boolean;
    trailing?: React.ReactNode;
    className?: string;
}) {
    return (
        <button
            className={clsx(
                // Fix the width so long commands reach the truncation inside the negative margins.
                '-mx-1 mb-0.5 flex h-7 w-[calc(100%+8px)] items-center gap-2 rounded-md px-1 text-left text-xs text-text-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                failed && 'text-status-error',
                className
            )}
            onClick={onToggle}
        >
            <span className={clsx(ROW_GUTTER, live && 'text-accent')}>{icon}</span>
            <span className={clsx('shrink-0', live && 'chat-live-text')}>{label}</span>
            {detail && <span className="min-w-0 truncate font-mono text-text-faint">{detail}</span>}
            <span className="grow" />
            {trailing}
            {failed && <Icon icon={X} size={12} className="shrink-0" />}
            <Icon icon={ChevronRight} size={12} className={clsx('shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
        </button>
    );
}

function ToolBody({ tool }: { tool: ChatToolItem }) {
    const { t } = useTranslation('chat');
    const patches = unifiedChanges(tool);
    const changes = patches.length > 0 ? [] : fileChanges(tool.name, tool.input);
    return (
        <div className="mt-1.5 mb-2 ml-6 overflow-hidden rounded-md border border-border bg-surface-raised">
            {patches.length > 0 ? (
                <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                    {patches.map((change, index) => (
                        <UnifiedDiff key={index} change={change} />
                    ))}
                </Suspense>
            ) : changes.length > 0 ? (
                <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                    {changes.map((change, index) => (
                        <EditDiff key={index} change={change} />
                    ))}
                </Suspense>
            ) : (
                <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-code text-text-muted select-text">
                    {clip(JSON.stringify(tool.input, null, 2) ?? '')}
                </pre>
            )}
            {tool.output !== null && tool.output !== '' && patches.length === 0 && (
                <pre
                    className={clsx(
                        'max-h-64 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 font-mono text-code select-text',
                        tool.state === 'error' ? 'text-term-red' : 'text-term-fg'
                    )}
                >
                    {clip(tool.output)}
                </pre>
            )}
        </div>
    );
}

/* One settled tool call: a line, and its input and output behind it. An image the call looked at
   is drawn under the line, because a picture says more about that read than its path does. */
export function WorkRow({ tool, nested }: { tool: ChatToolItem; nested?: boolean }) {
    const [open, setOpen] = useState(false);
    const image = tool.state === 'done' ? readImagePath(tool.name, tool.input) : null;
    return (
        <div className={nested ? 'ml-6' : undefined}>
            <ToggleLine
                icon={toolIcon(tool.name)}
                label={tool.name}
                detail={toolSummary(tool.name, tool.input)}
                open={open}
                onToggle={() => setOpen((o) => !o)}
                failed={tool.state === 'error'}
            />
            {image !== null && <ReadImage path={image} />}
            {open && <ToolBody tool={tool} />}
        </div>
    );
}

/* "running for 12s" next to a live call; like WorkingRow, the timer writes the text itself. */
export function RunningFor({ startedAt }: { startedAt: number }) {
    const { t } = useTranslation('chat');
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const tick = (): void => {
            if (ref.current) {
                ref.current.textContent = t('work.runningFor', { elapsed: formatElapsed(Date.now() - startedAt) });
            }
        };
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [startedAt, t]);
    return <span ref={ref} className="shrink-0 text-xs text-text-faint tabular-nums" />;
}

/* A call still running: its timer on the line, and for a provider that streams output, the last lines under it. */
export function WorkLiveRow({ tool }: { tool: ChatToolItem }) {
    const [open, setOpen] = useState(false);
    const tail = liveOutput(tool);
    return (
        <div>
            <ToggleLine
                icon={toolIcon(tool.name)}
                label={tool.name}
                detail={toolSummary(tool.name, tool.input) || tool.progress?.description || ''}
                open={open}
                onToggle={() => setOpen((o) => !o)}
                trailing={<RunningFor startedAt={toolStartedAt(tool)} />}
                live
            />
            {open && <ToolBody tool={tool} />}
            {tail !== null && !open && (
                <pre className="mt-1.5 mb-2 ml-6 max-h-48 overflow-auto rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-code whitespace-pre-wrap text-term-fg select-text">
                    {tail}
                </pre>
            )}
        </div>
    );
}

/* A run of tool calls as one line ("Read 4 files"); opening it lists every call. */
export function WorkGroupRow({ tools, summary, expanded, onToggle }: { tools: ChatToolItem[]; summary: string; expanded: boolean; onToggle(): void }) {
    const failed = tools.some((tool) => tool.state === 'error');
    return (
        <div>
            <ToggleLine icon={toolIcon(tools[0]!.name)} label={summary} open={expanded} onToggle={onToggle} failed={failed} />
        </div>
    );
}

/* The chats this client holds of one machine, which is where the forks it knows of are. */
function* forkInfosOn(byKey: ChatsById, endpointId: string): Generator<ChatInfo> {
    for (const [key, state] of Object.entries(byKey)) {
        if (state.info.forkOf !== undefined && splitKey(key).endpointId === endpointId) {
            yield state.info;
        }
    }
}

export function TurnFoldRow({
    chatId,
    turn,
    label,
    expanded,
    onToggle
}: {
    chatId: string;
    turn: ChatTurnItem;
    label: string;
    expanded: boolean;
    onToggle(): void;
}) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    // A count, so the selector answers a number and never a new object.
    const forks = useChats((s) => forksAfter(forkInfosOn(s.byKey, endpointId), chatId, turn.id));
    return (
        <div className="flex items-center gap-2 pb-1.5">
            <button
                className={clsx(
                    'mb-0.5 flex h-7 items-center gap-2 rounded-md border border-border px-2 text-xs text-text-muted hover:bg-surface-hover',
                    turn.state === 'error' && 'text-status-error'
                )}
                onClick={onToggle}
            >
                <span className={ROW_GUTTER}>
                    <Icon icon={ChevronRight} size={12} className={clsx('transition-transform', expanded && 'rotate-90')} />
                </span>
                {label}
            </button>
            {forks > 0 && (
                <Tooltip label={t('work.forksAfter', { count: forks })}>
                    <span className="mb-0.5 flex items-center gap-1 text-xs text-text-faint">
                        <Icon icon={GitFork} size={12} /> {t('work.forked', { count: forks })}
                    </span>
                </Tooltip>
            )}
        </div>
    );
}

const omittedLabel = (reason: 'binary' | 'too-large'): string =>
    reason === 'binary' ? i18next.t('chat:work.omitted.binary') : i18next.t('chat:work.omitted.tooLarge');

/* One file of a turn's checkpoint diff: its patch, or the reason there is none. */
function CheckpointFileBody({ file }: { file: ChatCheckpointFile }) {
    const { t } = useTranslation('chat');
    if (file.omitted) {
        return <div className="px-3 py-2 text-xs text-text-faint">{omittedLabel(file.omitted)}</div>;
    }
    return (
        <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
            <UnifiedDiff change={file} />
        </Suspense>
    );
}

/*
 * The files a settled turn changed, as a card; each file opens its diff in place. The daemon's
 * checkpoint diff comes first (the working tree against the tree the turn started from), then the
 * unified diffs the CLI reported, then the before and after of its own edits. A turn that has a
 * checkpoint but no stored diff asks the daemon for one, which is also how a running turn gets it.
 */
export function ChangedFilesRow({
    tools,
    diff,
    checkpoint,
    chatId,
    turnId
}: {
    tools: ChatToolItem[];
    diff: ChatCheckpointDiff | null;
    checkpoint: boolean;
    chatId: string;
    turnId: string;
}) {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [fetched, setFetched] = useState<ChatCheckpointDiff | null>(null);
    useEffect(() => {
        if (diff !== null || !checkpoint) {
            return;
        }
        let alive = true;
        void chatClient
            .turnDiff(chatId, turnId)
            .then((answer) => {
                if (alive) {
                    setFetched(answer);
                }
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [chatId, turnId, diff, checkpoint]);
    const checkpointDiff = diff ?? fetched;
    if (checkpointDiff !== null && checkpointDiff.files.length > 0) {
        return (
            <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface-raised">
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted">
                    <Icon icon={FileDiff} size={12} />
                    <span className="font-medium text-text">{t('work.changedFiles', { count: checkpointDiff.files.length })}</span>
                    {checkpointDiff.truncated && <span className="text-text-faint">{t('work.andMore')}</span>}
                </div>
                {checkpointDiff.files.map((file) => (
                    <div key={file.path} className="border-t border-border">
                        <button
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted hover:bg-surface-hover"
                            data-file-path={file.path}
                            onClick={() => setOpen((o) => ({ ...o, [file.path]: !o[file.path] }))}
                        >
                            <Icon
                                icon={ChevronRight}
                                size={12}
                                className={clsx('shrink-0 text-text-faint transition-transform', open[file.path] && 'rotate-90')}
                            />
                            <span className="min-w-0 truncate font-mono text-text">{file.path}</span>
                            <span className="grow" />
                            <span className="text-term-green tabular-nums">+{file.added}</span>
                            <span className="text-term-red tabular-nums">-{file.deleted}</span>
                        </button>
                        {open[file.path] && (
                            <div className="border-t border-border">
                                <CheckpointFileBody file={file} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    }
    return <ProviderChangedFiles tools={tools} open={open} setOpen={setOpen} />;
}

/* The fallback card, built from what the CLI itself reported about its edits. */
function ProviderChangedFiles({
    tools,
    open,
    setOpen
}: {
    tools: ChatToolItem[];
    open: Record<string, boolean>;
    setOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
    const { t } = useTranslation('chat');
    const byPath = new Map<string, { edits: FileChange[]; patches: ChatFileChange[] }>();
    const entryFor = (path: string) => {
        const existing = byPath.get(path);
        if (existing) {
            return existing;
        }
        const created = { edits: [] as FileChange[], patches: [] as ChatFileChange[] };
        byPath.set(path, created);
        return created;
    };
    for (const tool of tools) {
        const patches = unifiedChanges(tool);
        if (patches.length > 0) {
            for (const patch of patches) {
                entryFor(patch.path).patches.push(patch);
            }
            continue;
        }
        for (const change of fileChanges(tool.name, tool.input)) {
            entryFor(change.path || tool.id).edits.push(change);
        }
    }
    return (
        <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface-raised">
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted">
                <Icon icon={FileDiff} size={12} />
                <span className="font-medium text-text">{t('work.changedFiles', { count: byPath.size })}</span>
            </div>
            {[...byPath].map(([path, entry]) => {
                const count = entry.edits.length + entry.patches.length;
                return (
                    <div key={path} className="border-t border-border">
                        <button
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted hover:bg-surface-hover"
                            data-file-path={path}
                            onClick={() => setOpen((o) => ({ ...o, [path]: !o[path] }))}
                        >
                            <Icon icon={ChevronRight} size={12} className={clsx('shrink-0 text-text-faint transition-transform', open[path] && 'rotate-90')} />
                            <span className="min-w-0 truncate font-mono text-text">{path}</span>
                            <span className="grow" />
                            <span className="text-text-faint">{t('work.edits', { count })}</span>
                        </button>
                        {open[path] && (
                            <div className="border-t border-border">
                                <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">{t('work.loadingDiff')}</div>}>
                                    {entry.patches.map((change, index) => (
                                        <UnifiedDiff key={`patch-${index}`} change={change} />
                                    ))}
                                    {entry.edits.map((change, index) => (
                                        <EditDiff key={`edit-${index}`} change={change} />
                                    ))}
                                </Suspense>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

const pad = (n: number): string => String(n).padStart(2, '0');

/* "Working for 00:14": the timer writes the text itself, so a tick never re-renders the thread. */
export function WorkingRow({ startedAt }: { startedAt: number }) {
    const { t } = useTranslation('chat');
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const tick = (): void => {
            const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            if (ref.current) {
                ref.current.textContent = hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${pad(minutes)}:${pad(seconds % 60)}`;
            }
        };
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [startedAt]);
    return (
        <div className="-mx-1 mb-0.5 flex h-7 items-center gap-2 px-1 text-xs text-text-muted">
            <span className={`${ROW_GUTTER} text-accent`}>
                <span className="h-2 w-2 rounded-full bg-status-running" />
            </span>
            <span className="chat-live-text">{t('work.workingFor')}</span>
            <span ref={ref} className="tabular-nums" />
        </div>
    );
}
