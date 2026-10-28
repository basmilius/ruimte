import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { notePaperOf, type CanvasNodeKind } from '@ruimte/contracts';
import { memo, useState, type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, CircleDot, CirclePower, CircleX, Crosshair, Eye, GitBranch, Hand, Link2, Shrink, X, type LucideIcon } from 'lucide-react';
import { focusNodeAction, renameNodeAction } from '@/actions/client-actions';
import { openInSystemBrowser } from '@/desktop/bridge';
import { taskStatusWord, useSubagentTrail } from '@adecore/agents-react/chat';
import { UnseenMark } from '@/attention/UnseenMark';
import { WorkingMark } from '@/attention/WorkingMark';
import { TaskMark } from '@/tasks/TaskMark';
import { useChildTask } from '@/state/tasks';
import { useUnseen } from '@/state/attention';
import { useHiddenNeedsYou } from '@/canvas/use-group-waits';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { KindIcon } from '@/canvas/KindIcon';
import { NODE_KIND_ICONS } from '@/canvas/node-icons';
import { useWorkspace } from '@/transport/connections';
import { markPeerLapsed, usePeerLapse } from '@/project/peer-lapse';
import { linkToPeer } from '@/project/peer-linker';
import { useUntakenTask, useWaitingMachines } from '@/canvas/remote-wait';
import { useEndpointIdOfMachine } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { NodeMachineScope } from '@/transport/node-machine';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { RemoteNodeOffline } from '@/canvas/RemoteNodeOffline';
import { useRemoteNodeState } from '@/canvas/remote-node-state';
import { useMachineEntry } from '@/shell/use-machine-entry';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { nameOf } from '@/shell/settings/machine-list';
import { GROUP_HEADER_PX, isNodeActive, maximizedNodeOf, useCanvas, useCanvasStore, type AgentStatus } from '@/state/canvas';
import type { AgentWork } from '@/state/agent-work';
import { useNodeStatus, useNodeWork } from '@/state/chats';
import { ProcessAlertMark } from '@/processes/ProcessAlertMark';
import { useNodeAlerts } from '@/processes/use-node-alerts';
import { useHasContextLinks } from '@/context/sources';
import { accentColor, accentHeaderStyle, accentShades, notePaperClass } from '@/canvas/accents';
import { DeviceOperatedStrip } from '@/devices/DeviceOperatedStrip';
import { ComputerIndicator } from '@/computer/ComputerIndicator';
import { NodeMenuPopup } from '@/canvas/NodeMenu';
import { FlagMarkOf } from '@/project/FlagMark';
import { SnoozeMenuItems } from '@/shell/Snooze';
import { useEndpointId, useEndpointOfNode } from '@/state/keys';
import { useUi } from '@/state/ui';
import { useCellHasFocus } from '@/state/document';
import { useProject } from '@/state/project';
import { useGroupWorktrees, useWorktreeOf } from '@/state/worktrees';
import {
    ButtonGroup,
    ErrorBoundary,
    Pill,
    messageOf,
    Tooltip,
    FileIcon,
    Icon,
    IconButton,
    Input,
    ContextMenu,
    LazyBoundary,
    lazyNamed,
    tintStyle
} from '@adecore/ui';
import { useHeldWhileVisible, useNodeInViewport, useReadableZoom } from '@/canvas/culling';
import { TerminalBody, TerminalPlate } from '@/nodes/TerminalBody';
import { SessionPorts } from '@/terminal/SessionPorts';
import { ChatBody } from '@/nodes/ChatBody';
import { ForkPill } from '@/chat/ForkPill';
import { AccountPill, GoalPill, LimitPill, SubagentTitleCrumb } from '@adecore/agents-react/chat/ui';
import { PlanPill } from '@/plan/PlanPill';
import { useChatPrWatch } from '@/state/pr-watches';
import { BrowserBody } from '@/nodes/BrowserBody';
import { DeviceBody, DevicePlate, DeviceToolbar } from '@/devices/DeviceBody';
import { NoteNode } from '@/canvas/nodes/NoteNode';
import { DiagramNode, DiagramPlate } from '@/canvas/nodes/DiagramNode';
import { DrawingNode } from '@/canvas/nodes/DrawingNode';
import { FileNode, FilePlate } from '@/canvas/nodes/FileNode';
import { UnknownNodePlate } from '@/canvas/nodes/UnknownNode';
import { Favicon } from '@/browser/Favicon';
import { useBrowserDisplayTitle } from '@/browser/title';
import { fixedSlot, FileToolbarSlotProvider } from '@/shell/panels/file-toolbar-slot';
import { useUnsavedStoredPath } from '@/shell/panels/use-unsaved';
import { resetTitle } from '@/nodes/node-host';
import { AgentIcon } from '@adecore/agents-react/providers';

// Draws what the artifact view draws, which a canvas without one never loads.
const ArtifactNodeBody = lazyNamed(() => import('@/output/ArtifactNode'), 'ArtifactNodeBody');
const RoutineNodeBody = lazyNamed(() => import('@/routines/RoutineNode'), 'RoutineNodeBody');

const STATUS_CLASS: Record<AgentStatus, string> = {
    running: 'bg-status-running',
    'needs-you': 'bg-status-needs-you',
    idle: 'bg-status-idle',
    error: 'bg-status-error',
    // A CLI that is gone is not a failure; it is a session waiting to be picked up again.
    exited: 'bg-text-faint'
};

/* A node at rest carries no mark. Work is `WorkingMark`, and only while an agent works, since an attached shell reads running too. */
const STATUS_MARK: Partial<Record<AgentStatus, { icon: LucideIcon; className: string }>> = {
    'needs-you': { icon: Hand, className: 'text-status-needs-you' },
    error: { icon: CircleX, className: 'text-status-error' },
    exited: { icon: CirclePower, className: 'text-text-faint' }
};

/* A group is a frame under its nodes: a faint tint of its accent, never a surface of its own. */
const GROUP_FRAME =
    'border-dashed bg-[color-mix(in_srgb,var(--group-accent,var(--text-faint))_7%,transparent)] hover:bg-[color-mix(in_srgb,var(--group-accent,var(--text-faint))_10%,transparent)]';

/* `plain` drops the tooltip, for a control that already has one of its own; a screen reader still hears the status. */
export function StatusDot({ status, className, plain = false }: { status: AgentStatus; className?: string; plain?: boolean }) {
    const { t } = useTranslation('canvas');
    const label = t(`status.${status}`);
    const dot = (
        <span
            role="img"
            aria-label={label}
            className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', STATUS_CLASS[status], status === 'running' && 'animate-pulse', className)}
        />
    );
    if (plain) {
        return dot;
    }
    return <Tooltip label={label}>{dot}</Tooltip>;
}

function StatusMark({ status, work }: { status: AgentStatus; work: AgentWork | null }) {
    const { t } = useTranslation('canvas');
    if (status === 'running' || status === 'idle') {
        return work === null ? null : <WorkingMark delegating={work === 'delegating'} />;
    }
    const mark = STATUS_MARK[status];
    if (mark === undefined) {
        return null;
    }
    return (
        <Tooltip label={t(`status.${status}`)}>
            <span role="img" aria-label={t(`status.${status}`)} className={clsx('inline-flex shrink-0', mark.className)}>
                <Icon icon={mark.icon} size={12} />
            </span>
        </Tooltip>
    );
}

function WorktreePill({ worktree }: { worktree: { path: string; branch: string } }) {
    return (
        <Tooltip label={worktree.path}>
            <Pill mono icon={<Icon icon={GitBranch} size={12} />}>
                {worktree.branch}
            </Pill>
        </Tooltip>
    );
}

/* Under this wide a header keeps the glyph of the machine and leaves its name to the tooltip. */
const MACHINE_PILL_MIN_WIDTH = 380;

/*
 * Which machine a node runs on, for a node that is not on the workspace's own. A canvas of one
 * machine draws none.
 */
function MachinePill({ machineId, endpointId, narrow }: { machineId: string; endpointId: string; narrow: boolean }) {
    const { t } = useTranslation('canvas');
    const entry = useMachineEntry(endpointId);
    const icon = useMachineIcon(entry);
    const name = nameOf(entry);
    const workspace = useWorkspace();
    // The link between the machines is kept under the id the machine mints, which is not the key of its row on this computer.
    const lapsed = usePeerLapse((state) => state.lapsed[machineId] === true);
    const linkAgain = (): void => {
        if (workspace === null) {
            return;
        }
        void linkToPeer(machineId, workspace.connection.transport)
            .then(() => markPeerLapsed(machineId, false))
            .catch((e: unknown) =>
                useToasts.getState().show({ kind: 'error', title: t('remote.linkAgainFailed', { machine: name }), description: messageOf(e) })
            );
    };
    const label = lapsed ? t('remote.pillLapsed', { machine: name }) : t('remote.pill', { machine: name });
    return (
        <Tooltip label={label}>
            <Pill
                icon={<MachineGlyph icon={icon} size={12} />}
                className="max-w-40"
                aria-label={label}
                {...(lapsed ? { tone: 'error' as const, onClick: linkAgain } : {})}
            >
                {narrow ? null : name}
            </Pill>
        </Tooltip>
    );
}

/* A parent whose task was given to a machine that does not answer yet: the task starts there by itself once it does. */
function RemoteWaitPill({ machine, count }: { machine: string; count: number }) {
    const { t } = useTranslation('canvas');
    const entry = useMachineEntry(useEndpointIdOfMachine(machine));
    const icon = useMachineIcon(entry);
    const name = nameOf(entry);
    const label = t('remote.waitTooltip', { machine: name, count });
    return (
        <Tooltip label={label}>
            <Pill icon={<MachineGlyph icon={icon} size={12} />} className="max-w-48" aria-label={label}>
                {t('remote.waiting', { machine: name })}
            </Pill>
        </Tooltip>
    );
}

function IssuePill({ issue }: { issue: { repo: string; number: number; url: string } }) {
    const { t } = useTranslation('canvas');
    const open = (): void => {
        if (!/^https:\/\//.test(issue.url)) {
            return;
        }
        openInSystemBrowser(issue.url);
    };
    return (
        <Tooltip label={t('node.issuePill', { issue: `${issue.repo}#${issue.number}` })}>
            <Pill mono icon={<Icon icon={CircleDot} size={12} />} className="max-w-48" onClick={open}>
                #{issue.number}
            </Pill>
        </Tooltip>
    );
}

const PR_CHECK_TONES = { failure: 'error', success: 'idle', pending: 'muted', none: 'muted' } as const;

function PrWatchPill({ chatId }: { chatId: string }) {
    const { t } = useTranslation('canvas');
    const watch = useChatPrWatch(chatId);
    if (watch === null) {
        return null;
    }
    return (
        <Tooltip label={t('node.prWatchPill', { pr: `${watch.repo}#${watch.number}`, state: t(`node.prWatchState.${watch.checkState}`) })}>
            <Pill
                mono
                tone={PR_CHECK_TONES[watch.checkState]}
                icon={<Icon icon={Eye} size={12} />}
                onClick={() => useUi.getState().setPullRequestDialog({ cwd: watch.cwd })}
            >
                PR #{watch.number}
            </Pill>
        </Tooltip>
    );
}

function Title({ id, title, editing, muted, onDone }: { id: string; title: string; editing: boolean; muted: boolean; onDone: () => void }) {
    const canvasStore = useCanvasStore();
    if (!editing) {
        // A crumb on the way back from a sub-agent gives the emphasis to the step on screen.
        return <span className={clsx('truncate text-xs font-medium', muted ? 'text-text-muted hover:text-text' : 'text-text')}>{title}</span>;
    }
    return (
        <Input
            autoFocus
            defaultValue={title}
            maxLength={MAX_TITLE_LENGTH}
            size="sm"
            className="min-w-0 grow font-medium"
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
                const next = e.currentTarget.value.trim();
                // An empty field is not a name: it hands the node back to whatever named it before.
                if (next) {
                    renameNodeAction(canvasStore.getState().viewId, id, next);
                } else {
                    resetTitle(id);
                }
                onDone();
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                    e.currentTarget.value = title;
                    e.currentTarget.blur();
                }
            }}
        />
    );
}

/*
 * Where a maximized node stands: over the whole canvas at actual size. It stays inside the camera's
 * transform and undoes it, since moving it out would remount its session or its page.
 */
function useMaximizedPlace(id: string): CSSProperties | null {
    const camera = useCanvas((s) => (maximizedNodeOf(s) === id ? s.camera : null));
    const viewport = useCanvas((s) => (maximizedNodeOf(s) === id ? s.viewport : null));
    if (camera === null || viewport === null) {
        return null;
    }
    return {
        left: -camera.x / camera.zoom,
        top: -camera.y / camera.zoom,
        width: viewport.w,
        height: viewport.h,
        transform: `scale(${1 / camera.zoom})`
    };
}

/*
 * The rev is read here and not in the frame, so a save re-renders one boundary per node and not
 * every frame; the children it hands through are the same elements and React skips them.
 */
function NodeBodyBoundary({ kind, children }: { kind: CanvasNodeKind; children: ReactNode }) {
    const { t } = useTranslation('canvas');
    const rev = useProject((s) => s.rev);
    return (
        <ErrorBoundary label={t('node.failed')} resetKeys={[rev, kind]} compact>
            {children}
        </ErrorBoundary>
    );
}

/*
 * A node that runs on another machine is drawn from that machine: everything in its frame reads
 * the transport, the rows and the prompts of the machine it names.
 */
export const NodeFrame = memo(function NodeFrame({ id, z }: { id: string; z: number }) {
    const machine = useCanvas((s) => s.nodes[id]?.machine);
    return (
        <NodeMachineScope machine={machine}>
            <NodeFrameContent id={id} z={z} />
        </NodeMachineScope>
    );
});

function NodeFrameContent({ id, z }: { id: string; z: number }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    // The delete question asks about the project's worktrees, which are the workspace's whichever machine the node runs on.
    const transport = useWorkspace()?.connection.transport ?? null;
    const node = useCanvas((s) => s.nodes[id]);
    const selected = useCanvas((s) => s.selection.includes(id));
    /* The line being drawn would land here: the node that is about to be connected says so, never the
       one the line is being pulled from. */
    const linkTarget = useCanvas((s) => s.linkDraft?.over === id);
    /* The keyboard is in this node's content. It is not what the ring shows: a node is selected to be
       moved, resized or removed, and it has the focus to be typed in. */
    const active = useCanvas((s) => isNodeActive(s.bodyFocusId, id));
    /* Every cell's canvas keeps an active node of its own; only the one in the focused cell may take
       the keyboard, or a node remounting beside it pulls the grid's focus over. */
    const cellHasFocus = useCellHasFocus();
    // A card beside the node holds the keys while its owner counts as active, so the node's own content does not take them back.
    const onOwnCard = useCanvas((s) => s.navigationId !== null && s.derivedCards[s.navigationId]?.owner === id);
    const takesKeyboard = active && cellHasFocus && !onOwnCard;
    const resizing = useCanvas((s) => s.resizing === id);
    const maximizedPlace = useMaximizedPlace(id);
    const maximized = maximizedPlace !== null;
    const inViewport = useNodeInViewport(id);
    const live = useHeldWhileVisible(inViewport || maximized);
    const readable = useReadableZoom() || maximized;
    const [renaming, setRenaming] = useState(false);
    const subagentTrail = useSubagentTrail(id).trail;
    /* Where a file node's controls go: its own header, so the body draws no second bar under it.
       Every other node hands its body an empty slot, which keeps the canvas out of the window's. */
    const [fileControls, setFileControls] = useState<HTMLElement | null>(null);
    const toolbarSlot = fixedSlot(fileControls);
    const status = useNodeStatus(node);
    const work = useNodeWork(node);
    const endpointId = useEndpointId();
    const workspaceId = useWorkspace()?.connection.endpointId;
    const nodeEndpointId = useEndpointOfNode(node, '');
    // A node of another machine draws a card for that machine in place of its body while the machine is away.
    const remote = useRemoteNodeState(node?.machine, workspaceId);
    const unseen = useUnseen(id);
    const processAlerts = useNodeAlerts(id);
    const task = useChildTask(id);
    const waitingFor = useWaitingMachines(id);
    const unstarted = useUntakenTask(id, node?.machine);
    const hasContext = useHasContextLinks(id);
    const nodeWorktree = useWorktreeOf(node?.kind === 'terminal' || node?.kind === 'chat' ? node.cwd : undefined);
    const groupWorktrees = useGroupWorktrees(node?.kind === 'group' && !node.worktree ? id : null);
    const hidden = useCanvas((s) => s.hidden.has(id));
    const hiddenNeedsYou = useHiddenNeedsYou(node?.kind === 'group' && node.collapsed === true ? id : null);
    const browserTitle = useBrowserDisplayTitle(id, node?.title ?? '', node?.titleSource);
    const unsavedFile = useUnsavedStoredPath(node?.kind === 'file' ? (node.path ?? null) : null);

    if (!node || hidden) {
        return null;
    }

    const accent = accentColor(node.accent);
    const inSubagents = node.kind === 'chat' && subagentTrail.length > 0;
    const isGroup = node.kind === 'group';
    const isNote = node.kind === 'note';
    const frameAccent = !isGroup && !isNote ? accent : undefined;
    // A note is colored the way a colored node's header is, all over; only the neutral paper keeps a sheet of its own.
    const noteAccent = isNote ? accentColor(notePaperOf(node) ?? 'yellow') : undefined;
    const borderAccent = isNote ? noteAccent : frameAccent;
    // A newer Ruimte's node: it moves, resizes and goes away like any other, and nothing else about it is this version's to change.
    const isUnknown = node.kind === 'unknown';
    const collapsed = isGroup && node.collapsed === true;
    // Any other node folded to its header: its body stays mounted at the height it had, under the header and out of reach.
    const folded = !isGroup && node.collapsed === true;
    const visibleTitle = node.kind === 'browser' && !renaming ? browserTitle : node.title;
    const remove = (): void => {
        canvasStore.getState().select([id]);
        void deleteSelectionAsking(canvasStore, transport);
    };
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                data-node-id={id}
                data-paper={isNote ? (notePaperOf(node) ?? 'yellow') : undefined}
                className={clsx(
                    // isolate: xterm's layers carry z-indexes; without a stacking context they would paint over a node added later.
                    'absolute isolate flex flex-col overflow-hidden focus-visible:outline-none',
                    maximized ? 'origin-top-left' : 'rounded-xl border',
                    isGroup
                        ? GROUP_FRAME
                        : isNote
                          ? clsx(!maximized && 'shadow-node', noteAccent ? 'bg-clip-padding' : notePaperClass(notePaperOf(node)))
                          : clsx('bg-surface', !maximized && 'shadow-node'),
                    (selected || linkTarget) && !maximized && 'node-selected',
                    /* Never transparent: a surface clips to its padding box, so that would show a line of
                       bare canvas. A group's border is its color, which tells one group from another. */
                    isGroup && accent ? 'border-(--group-accent)' : isGroup ? 'border-border-strong' : 'border-border'
                )}
                style={{
                    left: node.x,
                    top: node.y,
                    width: node.w,
                    height: node.h,
                    ...maximizedPlace,
                    zIndex: z,
                    ...(borderAccent ? { borderColor: accentShades(borderAccent).frameBorder } : {}),
                    ...(noteAccent ? { backgroundColor: `color-mix(in srgb, ${noteAccent} 20%, var(--surface-raised))` } : {}),
                    ...(isGroup && accent ? { '--group-accent': accent } : {})
                }}
                tabIndex={0}
                // The node's own menu answers the right-click; the canvas must not open its menu as well.
                onContextMenu={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    // Tab reaches the frame; Enter makes it the selection, so a node is usable without a pointer.
                    if (e.key === 'Enter' && e.target === e.currentTarget && !isGroup) {
                        e.preventDefault();
                        canvasStore.getState().activateNode(id);
                    }
                }}
            >
                <header
                    className={clsx(
                        'group/header flex h-[39px] shrink-0 items-center gap-2 pr-1 text-text-muted',
                        // The collapse button carries 6px of optical padding, so 4px puts its glyph in the column of a node's kind icon.
                        isGroup ? 'pl-1' : 'pl-2.5',
                        isGroup
                            ? 'bg-transparent'
                            : isNote
                              ? // A note is its color all over, so the divider is a shade of the text and fits every note color.
                                'border-b border-[color-mix(in_srgb,var(--text)_12%,transparent)] bg-transparent'
                              : 'border-b border-border bg-surface-raised'
                    )}
                    style={
                        frameAccent
                            ? accentHeaderStyle(frameAccent)
                            : noteAccent
                              ? // A note is its color all over, so a hover is a shade of it over the paper rather than over a surface.
                                { borderColor: accentShades(noteAccent).headerBorder, ...tintStyle(noteAccent, 'transparent') }
                              : undefined
                    }
                >
                    {isGroup && (
                        <IconButton
                            icon={collapsed ? ChevronRight : ChevronDown}
                            size="sm"
                            label={collapsed ? t('group.expand') : t('group.collapse')}
                            onClick={() => canvasStore.getState().toggleCollapse(id)}
                        />
                    )}
                    <KindIcon
                        toggle={
                            isGroup
                                ? null
                                : {
                                      folded,
                                      label: folded ? t('node.expand') : t('node.collapse'),
                                      onToggle: () => canvasStore.getState().toggleCollapse(id)
                                  }
                        }
                    >
                        {node.provider ? (
                            <AgentIcon kind={node.provider} />
                        ) : node.kind === 'browser' ? (
                            <Favicon id={id} />
                        ) : node.kind === 'file' && node.path ? (
                            <FileIcon path={node.path} size={14} />
                        ) : (
                            <Icon icon={NODE_KIND_ICONS[node.kind]} size={14} />
                        )}
                    </KindIcon>
                    <span className="flex min-w-0 grow items-center" onDoubleClick={() => setRenaming(!isUnknown)}>
                        {node.kind === 'chat' && !renaming ? (
                            <SubagentTitleCrumb chatId={id}>
                                <Title id={id} title={visibleTitle} editing={false} muted={inSubagents} onDone={() => setRenaming(false)} />
                            </SubagentTitleCrumb>
                        ) : (
                            <Title id={id} title={visibleTitle} editing={renaming} muted={false} onDone={() => setRenaming(false)} />
                        )}
                    </span>
                    {!renaming && <FlagMarkOf id={id} />}
                    {collapsed && <Pill className="tabular-nums">{t('group.inside', { count: node.memberIds?.length ?? 0 })}</Pill>}
                    {hiddenNeedsYou && <StatusDot status="needs-you" />}
                    {node.kind === 'chat' && !renaming && (
                        <>
                            <AccountPill chatId={id} />
                            <ForkPill chatId={id} />
                            <PlanPill chatId={id} />
                            <LimitPill chatId={id} />
                            <GoalPill chatId={id} />
                            <PrWatchPill chatId={id} />
                        </>
                    )}
                    {node.kind === 'terminal' && !renaming && <SessionPorts id={id} />}
                    {(node.kind === 'chat' || node.kind === 'terminal') && !renaming && <ComputerIndicator nodeId={id} />}
                    {node.machine !== undefined && nodeEndpointId !== workspaceId && !renaming && (
                        <MachinePill machineId={node.machine} endpointId={nodeEndpointId} narrow={node.w < MACHINE_PILL_MIN_WIDTH} />
                    )}
                    {!renaming && waitingFor.map(({ machine, count }) => <RemoteWaitPill key={machine} machine={machine} count={count} />)}
                    {nodeWorktree && !renaming && <WorktreePill worktree={nodeWorktree} />}
                    {node.issue && !renaming && <IssuePill issue={node.issue} />}
                    {isGroup && !node.worktree && groupWorktrees.length > 0 && (
                        <Tooltip label={groupWorktrees.map((worktree) => worktree.branch).join(', ')}>
                            <Pill className="tabular-nums" icon={<Icon icon={GitBranch} size={12} />}>
                                {t('group.worktrees', { count: groupWorktrees.length })}
                            </Pill>
                        </Tooltip>
                    )}
                    {isGroup && node.worktree && <WorktreePill worktree={node.worktree} />}
                    {node.kind === 'terminal' && hasContext && !renaming && (
                        <Tooltip label={t('node.context.tooltip')}>
                            <Pill icon={<Icon icon={Link2} size={12} />}>{t('node.context.pill')}</Pill>
                        </Tooltip>
                    )}
                    {status && !renaming && <StatusMark status={status} work={work} />}
                    {task && !renaming && (work === null || taskStatusWord(task) !== 'running') && <TaskMark task={task} />}
                    {/* Looking clears it, so this is for a canvas zoomed out and a window beside another app. */}
                    {unseen && !renaming && <UnseenMark />}
                    {!renaming && <ProcessAlertMark alerts={processAlerts} />}
                    {unsavedFile && (
                        <Tooltip label={t('file.unsaved')}>
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" />
                        </Tooltip>
                    )}
                    {(node.kind === 'file' || node.kind === 'artifact') && <ButtonGroup ref={setFileControls} render={<span />} className="shrink-0" />}
                    {node.kind === 'routine' && <span ref={setFileControls} className="flex shrink-0 items-center gap-1.5" />}
                    {node.kind === 'device' && <DeviceToolbar id={id} narrow={node.w < MACHINE_PILL_MIN_WIDTH} />}
                    <ButtonGroup className="shrink-0">
                        {maximized ? (
                            <IconButton icon={Shrink} size="sm" label={t('node.restore')} onClick={() => canvasStore.getState().toggleMaximizedNode(id)} />
                        ) : (
                            <IconButton
                                icon={Crosshair}
                                size="sm"
                                label={t('node.zoomTo')}
                                onClick={() => focusNodeAction(canvasStore.getState().viewId, id)}
                            />
                        )}
                        <IconButton icon={X} size="sm" label={t('node.close')} onClick={remove} />
                    </ButtonGroup>
                </header>
                {node.kind === 'device' && !collapsed && <DeviceOperatedStrip id={id} />}
                {isGroup ? (
                    // No body attribute: a press anywhere on the frame drags it, together with what it holds.
                    <div className="grow" />
                ) : (
                    <div
                        data-node-body
                        className={clsx(
                            'relative min-h-0',
                            folded ? 'shrink-0' : 'grow',
                            // A thread reads at the node's own 14px, over the 22px a chat gives its prose.
                            node.kind === 'chat' && '[--text-sm--line-height:22px]'
                        )}
                        /* Folded, the body keeps the height it had under the header, where the frame cuts it off:
                           a terminal keeps its rows and its session, a chat its thread and its place in it. */
                        style={folded ? { height: Math.max(0, (node.expandedHeight ?? node.h) - GROUP_HEADER_PX - 2) } : undefined}
                        inert={folded ? true : undefined}
                    >
                        {/* Around the body only, so the header, the menu, a drag and a resize keep working. */}
                        <NodeBodyBoundary kind={node.kind}>
                            {(remote !== 'ready' || unstarted !== null) && node.machine !== undefined ? (
                                <RemoteNodeOffline
                                    machine={nodeEndpointId}
                                    state={remote === 'ready' ? 'unstarted' : remote}
                                    task={unstarted?.title}
                                    onLinkAgain={() =>
                                        useUi.getState().setRemoteNodeDialog({
                                            machineId: node.machine!,
                                            kind: node.kind === 'terminal' || node.kind === 'device' ? node.kind : 'chat',
                                            viewId: null,
                                            at: null,
                                            relink: true
                                        })
                                    }
                                />
                            ) : (
                                <>
                                    {node.kind === 'terminal' && (live ? <TerminalBody id={id} focused={takesKeyboard} /> : <TerminalPlate id={id} />)}
                                    {node.kind === 'chat' && <ChatBody id={id} focused={takesKeyboard} onCanvas />}
                                    {node.kind === 'browser' && <BrowserBody id={id} focused={active} />}
                                    {node.kind === 'device' && (live && readable ? <DeviceBody id={id} /> : <DevicePlate id={id} />)}
                                    {node.kind === 'note' && <NoteNode id={id} focused={active} />}
                                    {node.kind === 'drawing' && <DrawingNode id={id} />}
                                    {node.kind === 'diagram' && (live && readable ? <DiagramNode id={id} /> : <DiagramPlate id={id} />)}
                                    {isUnknown && <UnknownNodePlate id={id} />}
                                    {node.kind === 'artifact' && (
                                        <FileToolbarSlotProvider value={toolbarSlot}>
                                            <LazyBoundary>
                                                <ArtifactNodeBody id={id} />
                                            </LazyBoundary>
                                        </FileToolbarSlotProvider>
                                    )}
                                    {node.kind === 'routine' && (
                                        <FileToolbarSlotProvider value={toolbarSlot}>
                                            <LazyBoundary>
                                                <RoutineNodeBody id={id} />
                                            </LazyBoundary>
                                        </FileToolbarSlotProvider>
                                    )}
                                    {node.kind === 'file' &&
                                        (live && readable ? (
                                            <FileToolbarSlotProvider value={toolbarSlot}>
                                                <FileNode id={id} focused={takesKeyboard} />
                                            </FileToolbarSlotProvider>
                                        ) : (
                                            <FilePlate id={id} />
                                        ))}
                                </>
                            )}
                        </NodeBodyBoundary>
                    </div>
                )}
                {resizing && (
                    <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-accent px-2 py-0.5 font-mono text-xs tabular-nums text-accent-text shadow-float">
                        {Math.round(node.w)} × {Math.round(node.h)}
                    </div>
                )}
            </ContextMenu.Trigger>

            <NodeMenuPopup
                id={id}
                onRename={() => setRenaming(true)}
                snooze={<SnoozeMenuItems endpointId={endpointId} nodeId={id} needsYou={status === 'needs-you'} />}
            />
        </ContextMenu.Root>
    );
}
