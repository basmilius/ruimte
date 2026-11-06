import { useChats } from '@adecore/agents-react/state';
import { Button, Dialog, Icon, Menu, Spinner, Tooltip } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import type { Worktree } from '@ruimte/contracts';
import {
    ArrowDown,
    ArrowUp,
    CircleAlert,
    Eye,
    FolderX,
    GitFork,
    GitMerge,
    LocateFixed,
    Lock,
    MessageSquare,
    MoreHorizontal,
    ScanSearch,
    Trash
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorktreeNode } from '@/controllers/worktrees';
import { nodeWorking } from '@/state/agent-work';
import { useEndpointId } from '@/state/current-endpoint';
import { hasActiveCanvas, useDocument } from '@/state/document';
import { useSessions } from '@/state/sessions';
import { StatusDot } from '@/surface/StatusDot';
import { hasWork, nodeNames, nodesInWorktree, workBadgesLabel } from '@/worktree-rules/worktree-rows';
import type { Inspection } from '@/worktrees/use-worktree-inspection';

/* What a worktree row can be asked besides being entered. */
export interface WorktreeActions {
    /* Enters the worktree and opens everything it holds in a tab. */
    onView(worktree: Worktree): void;
    onMerge(worktree: Worktree): void;
    onRemove(worktree: Worktree): void;
    onReveal(nodeId: string): void;
    onInspect(worktree: Worktree, agentWorking: boolean): void;
}

/* Outside the menu that asks for it, since the menu closes the moment its row is picked. */
export function WorktreeInspectDialog({ inspected, onClose, onRemove }: { inspected: Inspection | null; onClose(): void; onRemove(worktree: Worktree): void }) {
    const { t } = useTranslation('panels');
    return (
        <Dialog.Root open={inspected !== null} onOpenChange={(open) => !open && onClose()}>
            <Dialog.Popup size="sm">
                <Dialog.Title className="font-mono break-all">{inspected?.worktree.branch}</Dialog.Title>
                {inspected?.verdict == null ? (
                    <Dialog.Text className="mt-1 flex items-center gap-2" role="status">
                        <Spinner size={14} /> {t('worktree.verdict.inspecting')}
                    </Dialog.Text>
                ) : (
                    <Dialog.Text className="mt-1">{inspected.verdict.reason}</Dialog.Text>
                )}
                <Dialog.Footer>
                    <Button onClick={onClose}>{t('common:action.close')}</Button>
                    {inspected?.verdict?.removable === true && (
                        <Button
                            variant="danger-outline"
                            onClick={() => {
                                const target = inspected.worktree;
                                onClose();
                                onRemove(target);
                            }}
                        >
                            {t('worktree.menu.remove')}
                        </Button>
                    )}
                </Dialog.Footer>
            </Dialog.Popup>
        </Dialog.Root>
    );
}

interface WorktreeRowsProps {
    worktrees: readonly Worktree[];
    /* Every node of the project, on every canvas, so a row can name the node working in it. */
    nodes: readonly WorktreeNode[];
    /* The worktree the panel is in, which its row marks. */
    current: string | null;
    /* The repository the worktrees were made from, named on each row while the project holds several. */
    repo: string | null;
    busy: boolean;
    /* Without these a row only enters its worktree. */
    actions?: WorktreeActions;
    onEnter(worktree: Worktree): void;
}

/*
 * The worktrees of the project's repository as rows of the chip's menu. A row enters its worktree, and
 * the button at its end holds everything else a worktree can be asked. A worktree whose folder is gone
 * still has a row, since this is the one place it shows up once its canvas is cleaned up.
 */
export function WorktreeRows({ worktrees, nodes, current, repo, busy, actions, onEnter }: WorktreeRowsProps) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const onCanvas = useDocument(hasActiveCanvas);

    return worktrees.map((worktree) => {
        const working = nodesInWorktree(nodes, worktree);
        const names = nodeNames(working);
        const agentWorking = working.some((node) => nodeWorking(node, sessions, chats, endpointId));
        const reveal = working[0]?.id ?? null;
        return (
            <Menu.Row key={worktree.path}>
                <Menu.Item className="min-w-0 grow" disabled={worktree.missing === true} onClick={() => onEnter(worktree)}>
                    <Icon icon={worktree.missing ? FolderX : GitFork} size={14} className="shrink-0 text-text-muted" />
                    <span className="flex min-w-0 grow flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-mono text-xs text-text">{worktree.branch}</span>
                            {worktree.locked === true && <Icon icon={Lock} size={12} className="shrink-0 text-text-muted" />}
                            {agentWorking && <StatusDot status="running" />}
                        </span>
                        {(repo !== null || worktree.missing === true || names !== '') && (
                            <span className="flex min-w-0 items-center gap-1 text-xs text-text-faint">
                                {repo !== null && <span className="shrink-0">{repo}</span>}
                                {repo !== null && (worktree.missing === true || names !== '') && <span className="shrink-0">·</span>}
                                {worktree.missing ? (
                                    <span className="truncate">{t('worktree.menu.folderMissing')}</span>
                                ) : (
                                    names !== '' && (
                                        <>
                                            <Icon icon={MessageSquare} size={12} className="shrink-0" />
                                            <span className="truncate">{names}</span>
                                        </>
                                    )
                                )}
                            </span>
                        )}
                    </span>
                    <WorkCounts worktree={worktree} />
                    {worktree.path === current && <Menu.Check kind="radio" checked />}
                </Menu.Item>
                {actions !== undefined && (
                    <Menu.SubmenuRoot>
                        <Menu.RowSubmenuTrigger icon={MoreHorizontal} label={t('worktree.menu.actions')} disabled={busy} />
                        <Menu.Popup>
                            {!worktree.missing && (
                                <>
                                    <Menu.Item onClick={() => actions.onView(worktree)}>
                                        <Icon icon={Eye} size={14} /> {t('worktree.menu.view')}
                                    </Menu.Item>
                                    <Menu.Item onClick={() => actions.onMerge(worktree)}>
                                        <Icon icon={GitMerge} size={14} /> {t('worktree.menu.merge')}
                                    </Menu.Item>
                                </>
                            )}
                            {reveal !== null && onCanvas && (
                                <Menu.Item onClick={() => actions.onReveal(reveal)}>
                                    <Icon icon={LocateFixed} size={14} /> {t('file.menu.showOnCanvas')}
                                </Menu.Item>
                            )}
                            <Menu.Item onClick={() => actions.onInspect(worktree, agentWorking)}>
                                <Icon icon={ScanSearch} size={14} /> {t('worktree.menu.inspect')}
                            </Menu.Item>
                            <Menu.Separator />
                            <Menu.Item className="text-status-error" onClick={() => actions.onRemove(worktree)}>
                                <Icon icon={Trash} size={14} /> {t('worktree.menu.remove')}
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.SubmenuRoot>
                )}
            </Menu.Row>
        );
    });
}

interface WorktreeBarProps {
    /* The repository the worktree was made from while the project holds several, else the word for a worktree. */
    label: string;
    /* The nodes working in it, by their titles. */
    names: string;
    tooltip: string;
    /* True while the selection put the panel here, which the row marks. */
    following?: boolean;
    /* What sits at the end of the row. */
    children?: ReactNode;
}

/* The row under a panel's header that says the panel is inside a worktree, and who works in it. */
export function WorktreeBar({ label, names, tooltip, following = false, children }: WorktreeBarProps) {
    return (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3 text-sm">
            <Tooltip label={tooltip}>
                <span className="flex min-w-0 items-center gap-2">
                    <Icon icon={GitFork} size={14} className="shrink-0 text-text-muted" />
                    <span className="shrink-0 text-text">{label}</span>
                    {names !== '' && (
                        <span className="flex min-w-0 items-center gap-1 text-text-muted">
                            <Icon icon={MessageSquare} size={12} className="shrink-0" />
                            <span className="truncate">{names}</span>
                        </span>
                    )}
                    {following && <Icon icon={LocateFixed} size={12} className="shrink-0 text-text-faint" />}
                </span>
            </Tooltip>
            <span className="grow" />
            {children}
        </div>
    );
}

/* How far the worktree is ahead and behind and how many files it changed, or that it is clean; nothing until it is counted. */
function WorkCounts({ worktree }: { worktree: Worktree }) {
    const { t } = useTranslation('panels');
    const work = worktree.work;
    if (work === undefined) {
        return null;
    }
    if (!hasWork(work) && (work.behind ?? 0) === 0) {
        return <span className="shrink-0 self-start text-xs text-text-faint">{t('worktree.menu.clean')}</span>;
    }
    const files = work.changed + work.untracked;
    const label = workBadgesLabel(worktree, work);
    return (
        <Tooltip label={label}>
            <span role="img" aria-label={label} className="flex shrink-0 items-center gap-2 self-start text-xs text-text-muted tabular-nums">
                {work.operation !== undefined && <Icon icon={CircleAlert} size={12} className="text-status-needs-you" />}
                {work.ahead > 0 && (
                    <span className="flex items-center gap-0.5">
                        <Icon icon={ArrowUp} size={12} />
                        {formatNumber(work.ahead)}
                    </span>
                )}
                {(work.behind ?? 0) > 0 && (
                    <span className="flex items-center gap-0.5 text-status-needs-you">
                        <Icon icon={ArrowDown} size={12} />
                        {formatNumber(work.behind ?? 0)}
                    </span>
                )}
                {files > 0 && <span>{formatNumber(files)}</span>}
            </span>
        </Tooltip>
    );
}
