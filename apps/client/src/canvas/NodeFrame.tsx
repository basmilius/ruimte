import { memo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Globe, LayoutGrid, Maximize2, MessageSquare, Terminal, X } from 'lucide-react';
import { isNodeFocused, useCanvas, type AgentStatus, type NodeKind } from '@/state/canvas';
import { useNodeStatus } from '@/state/chats';
import { NODE_ACCENTS } from '@/canvas/accents';
import { NodeMenuPopup } from '@/canvas/NodeMenu';
import { Tooltip } from '@/ui/Tooltip';
import { useHeldWhileVisible, useNodeInViewport } from '@/canvas/culling';
import { TerminalNode, TerminalPlate } from '@/canvas/nodes/TerminalNode';
import { ChatNode } from '@/canvas/nodes/ChatNode';
import { BrowserNode } from '@/canvas/nodes/BrowserNode';

const ICONS: Record<NodeKind, ReactNode> = {
    terminal: <Terminal size={14} strokeWidth={1.75} />,
    chat: <MessageSquare size={14} strokeWidth={1.75} />,
    browser: <Globe size={14} strokeWidth={1.75} />,
    group: <LayoutGrid size={14} strokeWidth={1.75} />
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

    if (!node) {
        return null;
    }

    const accent = NODE_ACCENTS.find((a) => a.id === node.accent)?.color;
    const isGroup = node.kind === 'group';
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
                    'absolute flex flex-col overflow-hidden rounded-xl border focus-visible:outline-none',
                    isGroup ? 'node-group' : 'bg-surface shadow-node',
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
                        isGroup ? 'bg-transparent' : 'border-b border-border bg-surface-raised'
                    )}
                >
                    {accent && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />}
                    <span className="shrink-0 text-text-muted">{ICONS[node.kind]}</span>
                    <span className="flex min-w-0 grow items-center" onDoubleClick={() => setRenaming(true)}>
                        <Title id={id} title={node.title} editing={renaming} onDone={() => setRenaming(false)} />
                    </span>
                    {status && !renaming && (
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-text-muted">
                            <StatusDot status={status} />
                            {STATUS_LABEL[status]}
                        </span>
                    )}
                    <div className="btn-group shrink-0">
                        <Tooltip label="Zoom to node">
                            <button className="icon-btn h-7 w-7" onClick={() => useCanvas.getState().goToNode(id)}>
                                <Maximize2 size={13} strokeWidth={1.75} />
                            </button>
                        </Tooltip>
                        <Tooltip label="Close">
                            <button className="icon-btn h-7 w-7" onClick={remove}>
                                <X size={14} strokeWidth={1.75} />
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
                        {!focused && <div className="absolute inset-0" aria-hidden="true" />}
                    </div>
                )}
                {resizable &&
                    selected &&
                    !focused &&
                    RESIZE_EDGES.map((edge) => <div key={edge} data-resize={edge} className={clsx('absolute z-10', EDGE_STYLE[edge])} />)}
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
