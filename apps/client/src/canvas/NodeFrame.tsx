import { memo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Check, ChevronRight, Copy, Globe, Maximize2, MessageSquare, Palette, Pencil, Terminal, Trash2, X } from 'lucide-react';
import { isNodeFocused, useCanvas, type AgentStatus, type NodeKind } from '@/state/canvas';
import { useChats, useNodeStatus } from '@/state/chats';
import { useSessions } from '@/state/sessions';
import { NODE_ACCENTS } from '@/canvas/accents';
import { Tooltip } from '@/ui/Tooltip';
import { useHeldWhileVisible, useNodeInViewport } from '@/canvas/culling';
import { TerminalNode, TerminalPlate } from '@/canvas/nodes/TerminalNode';
import { ChatNode } from '@/canvas/nodes/ChatNode';
import { BrowserNode } from '@/canvas/nodes/BrowserNode';

const ICONS: Record<NodeKind, ReactNode> = {
    terminal: <Terminal size={14} strokeWidth={1.75} />,
    chat: <MessageSquare size={14} strokeWidth={1.75} />,
    browser: <Globe size={14} strokeWidth={1.75} />
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
    const agent = useSessions((s) => s.byNodeId[id]?.agent);
    const chatSession = useChats((s) => s.byNodeId[id]?.info.agentSessionId);
    const chatCwd = useChats((s) => s.byNodeId[id]?.info.cwd);
    const chatProvider = useChats((s) => s.byNodeId[id]?.info.provider);

    if (!node) {
        return null;
    }

    const accent = NODE_ACCENTS.find((a) => a.id === node.accent)?.color;
    const remove = (): void => {
        const s = useCanvas.getState();
        s.select([id]);
        s.deleteSelected();
    };
    // The same CLI session can continue in the other kind of node, next to this one.
    const beside = { x: node.x + node.w + 40 + 260, y: node.y + node.h / 2 };
    const openInChat = (): void => {
        if (agent) {
            useCanvas.getState().addNode('chat', beside, { title: node.title, cwd: node.cwd, resume: agent.agentSessionId, provider: agent.kind });
        }
    };
    const openInTerminal = (): void => {
        if (chatSession) {
            const command = chatProvider === 'codex' ? `codex resume ${chatSession}` : `claude --resume ${chatSession}`;
            useCanvas.getState().addNode('terminal', beside, { title: node.title, cwd: chatCwd, command });
        }
    };

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                data-node-id={id}
                className={clsx(
                    'absolute flex flex-col overflow-hidden rounded-xl border bg-surface shadow-node',
                    focused ? 'node-focused border-transparent' : selected ? 'node-selected border-transparent' : 'border-border'
                )}
                style={{
                    left: node.x,
                    top: node.y,
                    width: node.w,
                    height: node.h
                }}
            >
                <header className="flex h-[37px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised pl-2.5 pr-1 text-text-muted">
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
                <div data-node-body className={clsx('relative min-h-0 grow', !focused && 'cursor-default')}>
                    {node.kind === 'terminal' && (live ? <TerminalNode id={id} focused={focused} /> : <TerminalPlate id={id} />)}
                    {node.kind === 'chat' && <ChatNode id={id} focused={focused} />}
                    {node.kind === 'browser' && <BrowserNode id={id} focused={focused} />}
                    {!focused && <div className="absolute inset-0" aria-hidden="true" />}
                </div>
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

            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-50">
                    <ContextMenu.Popup className="menu-popup">
                        <ContextMenu.Item className="menu-item" onClick={() => setRenaming(true)}>
                            <Pencil size={14} /> Rename <kbd>dbl-click</kbd>
                        </ContextMenu.Item>
                        <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().duplicateNode(id)}>
                            <Copy size={14} /> Duplicate
                        </ContextMenu.Item>
                        <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().goToNode(id)}>
                            <Maximize2 size={14} /> Zoom to node
                        </ContextMenu.Item>
                        {node.kind === 'terminal' && agent && (
                            <ContextMenu.Item className="menu-item" onClick={openInChat}>
                                <MessageSquare size={14} /> Open in chat
                            </ContextMenu.Item>
                        )}
                        {node.kind === 'chat' && chatSession && (
                            <ContextMenu.Item className="menu-item" onClick={openInTerminal}>
                                <Terminal size={14} /> Open in terminal
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.SubmenuRoot>
                            <ContextMenu.SubmenuTrigger className="menu-item">
                                <Palette size={14} /> Color
                                <ChevronRight size={14} className="ml-auto text-text-faint" />
                            </ContextMenu.SubmenuTrigger>
                            <ContextMenu.Portal>
                                <ContextMenu.Positioner className="z-50" sideOffset={4} alignOffset={-4}>
                                    <ContextMenu.Popup className="menu-popup min-w-40">
                                        <ContextMenu.Item className="menu-item" onClick={() => useCanvas.getState().setNodeAccent(id, null)}>
                                            <span className="h-3 w-3 rounded-full border border-border-strong" /> None
                                            {!node.accent && <Check size={13} className="ml-auto" />}
                                        </ContextMenu.Item>
                                        <ContextMenu.Separator className="menu-separator" />
                                        {NODE_ACCENTS.map((a) => (
                                            <ContextMenu.Item key={a.id} className="menu-item" onClick={() => useCanvas.getState().setNodeAccent(id, a.id)}>
                                                <span
                                                    className="h-3 w-3 rounded-full"
                                                    style={{
                                                        background: a.color
                                                    }}
                                                />{' '}
                                                {a.label}
                                                {node.accent === a.id && <Check size={13} className="ml-auto" />}
                                            </ContextMenu.Item>
                                        ))}
                                    </ContextMenu.Popup>
                                </ContextMenu.Positioner>
                            </ContextMenu.Portal>
                        </ContextMenu.SubmenuRoot>
                        <ContextMenu.Separator className="menu-separator" />
                        <ContextMenu.Item className="menu-item text-status-error" onClick={remove}>
                            <Trash2 size={14} /> Delete <kbd>⌫</kbd>
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
});
