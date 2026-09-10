import { memo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import {
    ArrowExpandDiagonal01Icon,
    ChevronDownIcon,
    ChevronRightIcon,
    GitBranchIcon,
    GlobeIcon,
    KeyboardIcon,
    LayoutGridIcon,
    Link02Icon,
    MessageSquareIcon,
    StickyNote03Icon,
    TerminalIcon,
    XIcon
} from '@hugeicons/core-free-icons';
import { AgentIcon } from '@/agents/AgentIcon';
import { isNodeFocused, useCanvas, type AgentStatus, type NodeKind } from '@/state/canvas';
import { useNodeStatus } from '@/state/chats';
import { useHasContextLinks } from '@/context/sync';
import { NODE_ACCENTS } from '@/canvas/accents';
import { NodeMenuPopup } from '@/canvas/NodeMenu';
import { Tooltip } from '@/ui/Tooltip';
import { useHeldWhileVisible, useNodeInViewport } from '@/canvas/culling';
import { TerminalNode, TerminalPlate } from '@/canvas/nodes/TerminalNode';
import { ChatNode } from '@/canvas/nodes/ChatNode';
import { BrowserNode } from '@/canvas/nodes/BrowserNode';
import { NoteNode } from '@/canvas/nodes/NoteNode';
import { noteColorClass } from '@/canvas/note-colors';
import { Icon } from '@/ui/Icon';

const ICONS: Record<NodeKind, ReactNode> = {
    terminal: <Icon icon={TerminalIcon} size={14} />,
    chat: <Icon icon={MessageSquareIcon} size={14} />,
    browser: <Icon icon={GlobeIcon} size={14} />,
    group: <Icon icon={LayoutGridIcon} size={14} />,
    note: <Icon icon={StickyNote03Icon} size={14} />
};

const STATUS_LABEL: Record<AgentStatus, string> = {
    running: 'Running',
    'needs-you': 'Needs you',
    idle: 'Idle',
    error: 'Error'
};

const STATUS_CLASS: Record<AgentStatus, string> = {
    running: 'bg-status-running',
    'needs-you': 'bg-status-needs-you',
    idle: 'bg-status-idle',
    error: 'bg-status-error'
};

const RESIZE_EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

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

export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
    return (
        <Tooltip label={STATUS_LABEL[status]}>
            <span className={clsx('inline-block h-2 w-2 rounded-full', STATUS_CLASS[status], status === 'running' && 'animate-pulse', className)} />
        </Tooltip>
    );
}

function Title({ id, title, editing, onDone }: { id: string; title: string; editing: boolean; onDone: () => void }) {
    if (!editing) {
        return <span className="truncate text-[13px] font-medium text-text">{title}</span>;
    }
    return (
        <input
            autoFocus
            defaultValue={title}
            className="min-w-0 grow rounded-md bg-surface-sunken px-1.5 py-0.5 text-[13px] font-medium text-text outline-none ring-1 ring-accent"
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
                const next = e.currentTarget.value.trim();
                if (next) {
                    useCanvas.getState().renameNode(id, next);
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

export const NodeFrame = memo(function NodeFrame({ id }: { id: string }) {
    const node = useCanvas((s) => s.nodes[id]);
    const selected = useCanvas((s) => s.selection.includes(id));
    const focused = useCanvas((s) => isNodeFocused(s.mode, id));
    const resizable = useCanvas((s) => !s.locks.resize);
    const resizing = useCanvas((s) => s.resizing === id);
    const inViewport = useNodeInViewport(id);
    const live = useHeldWhileVisible(inViewport);
    const [renaming, setRenaming] = useState(false);
    const status = useNodeStatus(node);
    const hasContext = useHasContextLinks(id);
    const hidden = useCanvas((s) => s.hidden.has(id));

    if (!node || hidden) {
        return null;
    }

    const accent = NODE_ACCENTS.find((a) => a.id === node.accent)?.color;
    const isGroup = node.kind === 'group';
    const isNote = node.kind === 'note';
    const collapsed = isGroup && node.collapsed === true;
    const remove = (): void => {
        const s = useCanvas.getState();
        s.select([id]);
        s.deleteSelected();
    };
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                data-node-id={id}
                className={clsx(
                    // isolate: xterm's layers carry z-indexes; without a stacking context they would paint over a node added later.
                    'absolute isolate flex flex-col overflow-hidden rounded-xl border focus-visible:outline-none',
                    isGroup ? 'node-group' : isNote ? clsx('node-note shadow-node', noteColorClass(node.color)) : 'bg-surface shadow-node',
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
                        useCanvas.getState().enterNode(id);
                    }
                }}
            >
                <header
                    className={clsx(
                        'flex h-[37px] shrink-0 items-center gap-2 pl-2.5 pr-1 text-text-muted',
                        isGroup ? 'bg-transparent' : isNote ? 'border-b bg-transparent' : 'border-b border-border bg-surface-raised'
                    )}
                >
                    {isGroup && (
                        <Tooltip label={collapsed ? 'Expand' : 'Collapse'}>
                            <button className="icon-btn -ml-1 h-6 w-6" onClick={() => useCanvas.getState().toggleGroupCollapse(id)}>
                                {collapsed ? <Icon icon={ChevronRightIcon} size={14} /> : <Icon icon={ChevronDownIcon} size={14} />}
                            </button>
                        </Tooltip>
                    )}
                    {accent && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />}
                    <span className="shrink-0 text-text-muted">{node.provider ? <AgentIcon kind={node.provider} /> : ICONS[node.kind]}</span>
                    <span className="flex min-w-0 grow items-center" onDoubleClick={() => setRenaming(true)}>
                        <Title id={id} title={node.title} editing={renaming} onDone={() => setRenaming(false)} />
                    </span>
                    {collapsed && (
                        <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] tabular-nums text-text-muted">
                            {node.memberIds?.length ?? 0} inside
                        </span>
                    )}
                    {isGroup && node.worktree && (
                        <Tooltip label={node.worktree.path}>
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 font-mono text-[11px] text-text-muted">
                                <Icon icon={GitBranchIcon} size={11} /> {node.worktree.branch}
                            </span>
                        </Tooltip>
                    )}
                    {node.kind === 'terminal' && hasContext && !renaming && (
                        <Tooltip label="Linked context. The agent in this terminal reads it with ruimte-context (list, read <id>).">
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-text-muted">
                                <Icon icon={Link02Icon} size={11} /> context
                            </span>
                        </Tooltip>
                    )}
                    {node.kind === 'terminal' && node.escapeToApp && !renaming && (
                        <Tooltip label="Escape goes to the program in this terminal; click to turn off. Leave the node with" kbd="⌘Esc / ⌃Esc">
                            <button
                                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-text-muted hover:text-text"
                                onClick={() => useCanvas.getState().updateNode(id, { escapeToApp: false })}
                            >
                                <Icon icon={KeyboardIcon} size={11} /> Esc
                            </button>
                        </Tooltip>
                    )}
                    {status && !renaming && (
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-text-muted">
                            <StatusDot status={status} />
                            {STATUS_LABEL[status]}
                        </span>
                    )}
                    <div className="btn-group shrink-0">
                        <Tooltip label="Zoom to node">
                            <button className="icon-btn h-7 w-7" onClick={() => useCanvas.getState().goToNode(id)}>
                                <Icon icon={ArrowExpandDiagonal01Icon} size={13} />
                            </button>
                        </Tooltip>
                        <Tooltip label="Close">
                            <button className="icon-btn h-7 w-7" onClick={remove}>
                                <Icon icon={XIcon} size={14} />
                            </button>
                        </Tooltip>
                    </div>
                </header>
                {isGroup ? (
                    // No body attribute: a press anywhere on the frame drags it, together with what it holds.
                    <div className="grow" />
                ) : (
                    <div data-node-body className={clsx('relative min-h-0 grow', !focused && 'cursor-default')}>
                        {node.kind === 'terminal' && (live ? <TerminalNode id={id} focused={focused} /> : <TerminalPlate id={id} />)}
                        {node.kind === 'chat' && <ChatNode id={id} focused={focused} />}
                        {node.kind === 'browser' && <BrowserNode id={id} focused={focused} />}
                        {node.kind === 'note' && <NoteNode id={id} focused={focused} />}
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
                            className="node-port absolute -right-2 top-1/2 z-20 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-accent bg-surface"
                        />
                    </Tooltip>
                )}
                {resizing && (
                    <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-accent px-2 py-0.5 font-mono text-[11px] tabular-nums text-accent-text shadow-float">
                        {node.w} × {node.h}
                    </div>
                )}
            </ContextMenu.Trigger>

            <NodeMenuPopup id={id} onRename={() => setRenaming(true)} />
        </ContextMenu.Root>
    );
});
