import type { CanvasNodeKind } from '@ruimte/contracts';
import { memo, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import {
    ChevronDown,
    ChevronRight,
    CircleQuestionMark,
    FileText,
    GitBranch,
    Globe,
    LayoutGrid,
    Link2,
    Maximize2,
    MessageSquare,
    PenTool,
    Workflow,
    StickyNote,
    Terminal,
    X
} from 'lucide-react';
import { AgentIcon } from '@/agents/AgentIcon';
import { UnseenMark } from '@/attention/UnseenMark';
import { TaskMark } from '@/tasks/TaskMark';
import { useChildTask } from '@/state/tasks';
import { useUnseen } from '@/state/attention';
import { deleteSelectionAsking } from '@/canvas/delete-selection';
import { useOptionalConnection } from '@/transport/context';
import { isNodeFocused, useCanvas, useCanvasStore, type AgentStatus } from '@/state/canvas';
import { useNodeStatus } from '@/state/chats';
import { ProcessAlertMark, useNodeAlerts } from '@/processes/ProcessAlertMark';
import { useHasContextLinks } from '@/context/sources';
import { accentColor } from '@/canvas/accents';
import { ApprovalStrip } from '@/canvas/ApprovalStrip';
import { NodeMenuPopup } from '@/canvas/NodeMenu';
import { useCellHasFocus } from '@/state/document';
import { useProject } from '@/state/project';
import { BTN_GROUP } from '@/ui/classes';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';
import { useHeldWhileVisible, useNodeInViewport, useReadableZoom } from '@/canvas/culling';
import { TerminalBody, TerminalPlate } from '@/nodes/TerminalBody';
import { ChatBody } from '@/nodes/ChatBody';
import { BrowserBody } from '@/nodes/BrowserBody';
import { NoteNode } from '@/canvas/nodes/NoteNode';
import { DiagramNode, DiagramPlate } from '@/canvas/nodes/DiagramNode';
import { DrawingNode } from '@/canvas/nodes/DrawingNode';
import { FileNode, FilePlate } from '@/canvas/nodes/FileNode';
import { UnknownNodePlate } from '@/canvas/nodes/UnknownNode';
import { noteColorClass } from '@/canvas/note-colors';
import { Favicon } from '@/browser/Favicon';
import { FileIcon } from '@/ui/FileIcon';
import { fixedSlot, FileToolbarSlotProvider } from '@/shell/panels/file-toolbar-slot';
import { resetTitle } from '@/nodes/node-host';
import { Icon } from '@/ui/Icon';

const ICONS: Record<CanvasNodeKind, ReactNode> = {
    terminal: <Icon icon={Terminal} size={14} />,
    chat: <Icon icon={MessageSquare} size={14} />,
    browser: <Icon icon={Globe} size={14} />,
    group: <Icon icon={LayoutGrid} size={14} />,
    note: <Icon icon={StickyNote} size={14} />,
    drawing: <Icon icon={PenTool} size={14} />,
    diagram: <Icon icon={Workflow} size={14} />,
    // The floor under a file node that has no path yet; with one it wears the mark of its own name.
    file: <Icon icon={FileText} size={14} />,
    unknown: <Icon icon={CircleQuestionMark} size={14} />
};

const STATUS_LABEL: Record<AgentStatus, string> = {
    running: 'Running',
    'needs-you': 'Needs you',
    idle: 'Idle',
    error: 'Error',
    exited: 'Session ended'
};

const STATUS_CLASS: Record<AgentStatus, string> = {
    running: 'bg-status-running',
    'needs-you': 'bg-status-needs-you',
    idle: 'bg-status-idle',
    error: 'bg-status-error',
    // A CLI that is gone is not a failure; it is a session waiting to be picked up again.
    exited: 'bg-text-faint'
};

const RESIZE_EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

/* A group is a frame under its nodes: a faint tint of its accent, never a surface of its own. */
const GROUP_FRAME =
    'border-dashed bg-[color-mix(in_srgb,var(--group-accent,var(--text-faint))_7%,transparent)] hover:bg-[color-mix(in_srgb,var(--group-accent,var(--text-faint))_10%,transparent)]';

const EDGE_STYLE: Record<(typeof RESIZE_EDGES)[number], string> = {
    n: 'top-0 left-3 right-3 h-2 -translate-y-1/2 cursor-ns-resize',
    s: 'bottom-0 left-3 right-3 h-2 translate-y-1/2 cursor-ns-resize',
    e: 'right-0 top-3 bottom-3 w-2 translate-x-1/2 cursor-ew-resize',
    w: 'left-0 top-3 bottom-3 w-2 -translate-x-1/2 cursor-ew-resize',
    ne: 'top-0 right-0 h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2 cursor-nesw-resize',
    nw: 'top-0 left-0 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 cursor-nwse-resize',
    se: 'bottom-0 right-0 h-3.5 w-3.5 translate-y-1/2 translate-x-1/2 cursor-nwse-resize',
    sw: 'bottom-0 left-0 h-3.5 w-3.5 translate-y-1/2 -translate-x-1/2 cursor-nesw-resize'
};

/* `plain` drops the tooltip: inside a control that already has a name of its own, a second tooltip
   under the pointer only fights the first one. */
export function StatusDot({ status, className, plain = false }: { status: AgentStatus; className?: string; plain?: boolean }) {
    const dot = (
        <span className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', STATUS_CLASS[status], status === 'running' && 'animate-pulse', className)} />
    );
    if (plain) {
        return dot;
    }
    return <Tooltip label={STATUS_LABEL[status]}>{dot}</Tooltip>;
}

function Title({ id, title, editing, onDone }: { id: string; title: string; editing: boolean; onDone: () => void }) {
    const canvasStore = useCanvasStore();
    if (!editing) {
        return <span className="truncate text-sm font-medium text-text">{title}</span>;
    }
    return (
        <input
            autoFocus
            defaultValue={title}
            className="min-w-0 grow rounded-md bg-surface-sunken px-1.5 py-0.5 text-sm font-medium text-text outline-none ring-1 ring-accent"
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
                const next = e.currentTarget.value.trim();
                // An empty field is not a name: it hands the node back to whatever named it before.
                if (next) {
                    canvasStore.getState().renameNode(id, next);
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
 * The rev is read here and not in the frame, so a save re-renders one boundary per node and not
 * every frame; the children it hands through are the same elements and React skips them.
 */
function NodeBodyBoundary({ kind, children }: { kind: CanvasNodeKind; children: ReactNode }) {
    const rev = useProject((s) => s.rev);
    return (
        <ErrorBoundary label="This node failed to render" resetKeys={[rev, kind]} compact>
            {children}
        </ErrorBoundary>
    );
}

export const NodeFrame = memo(function NodeFrame({ id }: { id: string }) {
    const canvasStore = useCanvasStore();
    const transport = useOptionalConnection()?.transport ?? null;
    const node = useCanvas((s) => s.nodes[id]);
    const selected = useCanvas((s) => s.selection.includes(id));
    const focused = useCanvas((s) => isNodeFocused(s.mode, id));
    /* Every cell's canvas keeps a focused node of its own; only the one in the focused cell may take
       the keyboard, or a node remounting beside it pulls the grid's focus over. */
    const cellHasFocus = useCellHasFocus();
    const takesKeyboard = focused && cellHasFocus;
    const resizable = useCanvas((s) => !s.locks.resize);
    const resizing = useCanvas((s) => s.resizing === id);
    const inViewport = useNodeInViewport(id);
    const live = useHeldWhileVisible(inViewport);
    const readable = useReadableZoom();
    const [renaming, setRenaming] = useState(false);
    /* Where a file node's controls go: its own header, so the body draws no second bar under it.
       Every other node hands its body an empty slot, which keeps the canvas out of the window's. */
    const [fileControls, setFileControls] = useState<HTMLElement | null>(null);
    const toolbarSlot = useMemo(() => fixedSlot(fileControls), [fileControls]);
    const status = useNodeStatus(node);
    const unseen = useUnseen(id);
    const processAlerts = useNodeAlerts(id);
    const task = useChildTask(id);
    const hasContext = useHasContextLinks(id);
    const hidden = useCanvas((s) => s.hidden.has(id));

    if (!node || hidden) {
        return null;
    }

    const accent = accentColor(node.accent);
    const isGroup = node.kind === 'group';
    const isNote = node.kind === 'note';
    // A newer Ruimte's node: it moves, resizes and goes away like any other, and nothing else about it is this version's to change.
    const isUnknown = node.kind === 'unknown';
    const collapsed = isGroup && node.collapsed === true;
    const remove = (): void => {
        canvasStore.getState().select([id]);
        void deleteSelectionAsking(canvasStore, transport);
    };
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                data-node-id={id}
                className={clsx(
                    // isolate: xterm's layers carry z-indexes; without a stacking context they would paint over a node added later.
                    'absolute isolate flex flex-col overflow-hidden rounded-xl border focus-visible:outline-none',
                    isGroup ? GROUP_FRAME : isNote ? clsx('shadow-node', noteColorClass(node.color)) : 'bg-surface shadow-node',
                    focused
                        ? 'node-focused border-transparent'
                        : selected
                          ? 'node-selected border-transparent'
                          : isGroup
                            ? 'border-border-strong'
                            : 'border-border'
                )}
                style={{
                    left: node.x,
                    top: node.y,
                    width: node.w,
                    height: node.h,
                    ...(isGroup && accent ? { '--group-accent': accent } : {})
                }}
                tabIndex={0}
                // The node's own menu answers the right-click; the canvas must not open its menu as well.
                onContextMenu={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    // Tab reaches the frame; Enter steps into it, so a node is usable without a pointer.
                    if (e.key === 'Enter' && e.target === e.currentTarget && !isGroup) {
                        e.preventDefault();
                        canvasStore.getState().enterNode(id);
                    }
                }}
            >
                <header
                    className={clsx(
                        'flex h-[39px] shrink-0 items-center gap-2 pr-1 text-text-muted',
                        // The collapse button carries 6px of optical padding inside its 28px square, so
                        // 4px of header padding puts its glyph in the same column as a node's kind icon.
                        isGroup ? 'pl-1' : 'pl-2.5',
                        isGroup
                            ? 'bg-transparent'
                            : isNote
                              ? // A note is its color all over, so the divider is a shade of the text and fits every note color.
                                'border-b border-[color-mix(in_srgb,var(--text)_12%,transparent)] bg-transparent'
                              : 'border-b border-border bg-surface-raised'
                    )}
                >
                    {isGroup && (
                        <Tooltip label={collapsed ? 'Expand' : 'Collapse'} name>
                            <button className="icon-btn h-7 w-7" onClick={() => canvasStore.getState().toggleGroupCollapse(id)}>
                                {collapsed ? <Icon icon={ChevronRight} size={16} /> : <Icon icon={ChevronDown} size={16} />}
                            </button>
                        </Tooltip>
                    )}
                    {accent && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />}
                    <span className="flex shrink-0 items-center text-text-muted">
                        {node.provider ? (
                            <AgentIcon kind={node.provider} />
                        ) : node.kind === 'browser' ? (
                            <Favicon id={id} />
                        ) : node.kind === 'file' && node.path ? (
                            <FileIcon path={node.path} size={14} />
                        ) : (
                            ICONS[node.kind]
                        )}
                    </span>
                    <span className="flex min-w-0 grow items-center" onDoubleClick={() => setRenaming(!isUnknown)}>
                        <Title id={id} title={node.title} editing={renaming} onDone={() => setRenaming(false)} />
                    </span>
                    {collapsed && <Pill className="tabular-nums">{node.memberIds?.length ?? 0} inside</Pill>}
                    {isGroup && node.worktree && (
                        <Tooltip label={node.worktree.path}>
                            <Pill mono icon={<Icon icon={GitBranch} size={12} />}>
                                {node.worktree.branch}
                            </Pill>
                        </Tooltip>
                    )}
                    {node.kind === 'terminal' && hasContext && !renaming && (
                        <Tooltip label="Linked context. The agent reads it with ruimte-context.">
                            <Pill icon={<Icon icon={Link2} size={12} />}>context</Pill>
                        </Tooltip>
                    )}
                    {status && !renaming && (
                        <Pill className="gap-1.5" icon={<StatusDot status={status} plain />}>
                            {STATUS_LABEL[status]}
                        </Pill>
                    )}
                    {/* Up close this is already gone, since looking clears it. It is for the canvas
                        zoomed out over everything and for the window standing beside another app. */}
                    {task && !renaming && <TaskMark task={task} />}
                    {unseen && !renaming && <UnseenMark />}
                    {!renaming && <ProcessAlertMark alerts={processAlerts} />}
                    {node.kind === 'file' && <span ref={setFileControls} className={`${BTN_GROUP} shrink-0`} />}
                    <div className={`${BTN_GROUP} shrink-0`}>
                        <Tooltip label="Zoom to node" name>
                            <button className="icon-btn h-7 w-7" onClick={() => canvasStore.getState().goToNode(id)}>
                                <Icon icon={Maximize2} size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip label="Close node" name>
                            <button className="icon-btn h-7 w-7" onClick={remove}>
                                <Icon icon={X} size={16} />
                            </button>
                        </Tooltip>
                    </div>
                </header>
                {node.kind === 'terminal' && !collapsed && <ApprovalStrip id={id} />}
                {isGroup ? (
                    // No body attribute: a press anywhere on the frame drags it, together with what it holds.
                    <div className="grow" />
                ) : (
                    <div
                        data-node-body
                        className={clsx(
                            'relative min-h-0 grow',
                            // A thread reads at the node's own 14px, over the 22px a chat gives its prose.
                            node.kind === 'chat' && '[--text-sm--line-height:22px]',
                            !focused && 'cursor-default'
                        )}
                    >
                        {/* Around the body only, so the header, the menu, a drag and a resize keep working. */}
                        <NodeBodyBoundary kind={node.kind}>
                            {node.kind === 'terminal' && (live ? <TerminalBody id={id} focused={takesKeyboard} /> : <TerminalPlate id={id} />)}
                            {node.kind === 'chat' && <ChatBody id={id} focused={takesKeyboard} />}
                            {node.kind === 'browser' && <BrowserBody id={id} focused={focused} />}
                            {node.kind === 'note' && <NoteNode id={id} focused={focused} />}
                            {node.kind === 'drawing' && <DrawingNode id={id} />}
                            {node.kind === 'diagram' && (live && readable ? <DiagramNode id={id} /> : <DiagramPlate id={id} />)}
                            {isUnknown && <UnknownNodePlate id={id} />}
                            {node.kind === 'file' &&
                                (live && readable ? (
                                    <FileToolbarSlotProvider value={toolbarSlot}>
                                        <FileNode id={id} />
                                    </FileToolbarSlotProvider>
                                ) : (
                                    <FilePlate id={id} />
                                ))}
                        </NodeBodyBoundary>
                        {!focused && <div className="absolute inset-0" aria-hidden="true" />}
                    </div>
                )}
                {resizable &&
                    selected &&
                    !focused &&
                    !collapsed &&
                    RESIZE_EDGES.map((edge) => <div key={edge} data-resize={edge} className={clsx('absolute z-10', EDGE_STYLE[edge])} />)}
                {(selected || focused) && (
                    <Tooltip label="Drag to connect to another node" side="right">
                        <div
                            data-port={id}
                            className="absolute -right-2 top-1/2 z-20 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-accent bg-surface shadow-[0_0_0_2px_var(--surface)] hover:bg-accent"
                        />
                    </Tooltip>
                )}
                {resizing && (
                    <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-accent px-2 py-0.5 font-mono text-xs tabular-nums text-accent-text shadow-float">
                        {node.w} × {node.h}
                    </div>
                )}
            </ContextMenu.Trigger>

            <NodeMenuPopup id={id} onRename={() => setRenaming(true)} />
        </ContextMenu.Root>
    );
});
