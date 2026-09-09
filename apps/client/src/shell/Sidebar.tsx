import { useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Globe, LayoutGrid, MessageSquare, Plus, Search, Settings, Terminal } from 'lucide-react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useCanvas, type AgentStatus, type CanvasNode } from '@/state/canvas';
import { useChats, useNodeStatus } from '@/state/chats';
import { nodeStatus, useSessions } from '@/state/sessions';
import { useUi } from '@/state/ui';
import { addNodeAtCenter } from '@/shell/commands';
import { StatusDot } from '@/canvas/NodeFrame';
import { NodeMenuPopup } from '@/canvas/NodeMenu';
import { Tooltip } from '@/ui/Tooltip';
import { ConnectionDot } from '@/shell/ConnectionDot';
import { ProjectMenu } from '@/shell/ProjectMenu';
import { TRAFFIC_LIGHTS_INSET_PX, hasTrafficLights } from '@/desktop/bridge';
import { useDesktopFullscreen } from '@/desktop/useFullscreen';

const KIND_ICON = {
    terminal: Terminal,
    chat: MessageSquare,
    browser: Globe,
    group: LayoutGrid
} as const;

const GROUPS: { status: AgentStatus | 'none'; label: string }[] = [
    { status: 'needs-you', label: 'Needs you' },
    { status: 'running', label: 'Running' },
    { status: 'idle', label: 'Idle' },
    { status: 'none', label: 'Other' }
];

function SessionRow({ node }: { node: CanvasNode }) {
    const selected = useCanvas((s) => s.selection.includes(node.id));
    const status = useNodeStatus(node);
    const [renaming, setRenaming] = useState(false);
    const Icon = KIND_ICON[node.kind];
    if (renaming) {
        return (
            <div className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-[13px]">
                <Icon size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" />
                <input
                    autoFocus
                    defaultValue={node.title}
                    className="min-w-0 grow rounded bg-surface-sunken px-1.5 py-0.5 text-[13px] text-text outline-none ring-1 ring-accent"
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => {
                        const next = e.currentTarget.value.trim();
                        if (next) {
                            useCanvas.getState().renameNode(node.id, next);
                        }
                        setRenaming(false);
                    }}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                            e.currentTarget.blur();
                        }
                        if (e.key === 'Escape') {
                            e.currentTarget.value = node.title;
                            e.currentTarget.blur();
                        }
                    }}
                />
            </div>
        );
    }
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<button />}
                className={clsx(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                    selected ? 'bg-accent-soft text-text' : 'text-text-muted hover:bg-surface-sunken hover:text-text'
                )}
                onClick={() => useCanvas.getState().goToNode(node.id)}
                onDoubleClick={() => setRenaming(true)}
            >
                <Icon size={14} strokeWidth={1.75} className="shrink-0" />
                <span className="truncate">{node.title}</span>
                <span className="grow" />
                {status && <StatusDot status={status} />}
            </ContextMenu.Trigger>
            <NodeMenuPopup id={node.id} onRename={() => setRenaming(true)} />
        </ContextMenu.Root>
    );
}

export function Sidebar() {
    // Groups are frames, not sessions; the list is about what runs.
    const nodes = useCanvas(useShallow((s) => s.order.map((id) => s.nodes[id]).filter((node) => node.kind !== 'group')));
    const sessions = useSessions((s) => s.byNodeId);
    const chats = useChats((s) => s.byNodeId);
    const fullscreen = useDesktopFullscreen();

    return (
        <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-surface">
            <div
                className="app-drag flex h-12 items-center gap-2 px-3"
                style={hasTrafficLights() && !fullscreen ? { paddingLeft: TRAFFIC_LIGHTS_INSET_PX } : undefined}
            >
                <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-[12px] font-semibold text-accent-text">R</span>
                <span className="text-[14px] font-semibold tracking-tight text-text">Ruimte</span>
                <span className="grow" />
                <Tooltip label="Search" kbd="⌘K">
                    <button className="icon-btn h-7 w-7" onClick={() => useUi.getState().setPaletteOpen(true)}>
                        <Search size={15} />
                    </button>
                </Tooltip>
            </div>

            <div className="px-2">
                <ProjectMenu />
            </div>

            <div className="mt-4 min-h-0 grow overflow-auto px-2">
                {GROUPS.map((group) => {
                    const rows = nodes.filter((n) => {
                        const status = nodeStatus(n, sessions, chats);
                        return group.status === 'none' ? !status : status === group.status;
                    });
                    if (rows.length === 0) {
                        return null;
                    }
                    return (
                        <div key={group.status} className="mb-3">
                            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium uppercase tracking-[.04em] text-text-faint">
                                {group.status !== 'none' && <StatusDot status={group.status} />}
                                {group.label}
                                <span className="ml-auto tabular-nums">{rows.length}</span>
                            </div>
                            {rows.map((n) => (
                                <SessionRow key={n.id} node={n} />
                            ))}
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center gap-1 border-t border-border p-2">
                <button
                    className="flex h-8 grow items-center gap-2 rounded-md px-2 text-[13px] text-text-muted hover:bg-surface-sunken hover:text-text"
                    onClick={() => addNodeAtCenter('terminal')}
                >
                    <Plus size={15} /> New session
                </button>
                <ConnectionDot />
                <Tooltip label="Settings" kbd="⌘,">
                    <button className="icon-btn" onClick={() => useUi.getState().setSettings({ open: true })}>
                        <Settings size={15} />
                    </button>
                </Tooltip>
            </div>
        </aside>
    );
}
