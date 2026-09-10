import { useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Globe, LayoutGrid, MessageSquare, Plus, Search, Settings, StickyNote, Terminal } from 'lucide-react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useCanvas, type AgentStatus, type CanvasNode } from '@/state/canvas';
import { useChats, useNodeStatus } from '@/state/chats';
import { nodeStatus, useSessions } from '@/state/sessions';
import { useUi } from '@/state/ui';
import { addNodeAtCenter } from '@/shell/commands';
import { StatusDot } from '@/canvas/NodeFrame';
import { NodeMenuPopup } from '@/canvas/NodeMenu';
import { Brand } from '@/ui/Brand';
import { Tooltip } from '@/ui/Tooltip';
import { SidebarToggle } from '@/shell/SidebarToggle';
import { useTrafficLightInset } from '@/desktop/useFullscreen';
import { Icon } from '@/ui/Icon';

/* How wide the list is when it is open. The inner column keeps this width while the wrapper
   animates to zero, so nothing reflows on the way out. */
export const SIDEBAR_WIDTH_PX = 248;

/* The padding the strip starts with where there are no traffic lights to clear. */
export const STRIP_PADDING_PX = 12;

const KIND_ICON = {
    terminal: Terminal,
    chat: MessageSquare,
    browser: Globe,
    group: LayoutGrid,
    note: StickyNote
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
    const kindIcon = KIND_ICON[node.kind];
    if (renaming) {
        return (
            <div className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm">
                <Icon icon={kindIcon} size={14} className="shrink-0 text-text-muted" />
                <input
                    autoFocus
                    defaultValue={node.title}
                    className="min-w-0 grow rounded bg-surface-sunken px-1.5 py-0.5 text-sm text-text outline-none ring-1 ring-accent"
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
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    selected ? 'bg-accent-soft text-text' : 'text-text-muted hover:bg-surface-sunken hover:text-text'
                )}
                onClick={() => useCanvas.getState().goToNode(node.id)}
                onDoubleClick={() => setRenaming(true)}
            >
                <Icon icon={kindIcon} size={14} className="shrink-0" />
                <span className="truncate">{node.title}</span>
                <span className="grow" />
                {status && <StatusDot status={status} />}
            </ContextMenu.Trigger>
            <NodeMenuPopup id={node.id} onRename={() => setRenaming(true)} />
        </ContextMenu.Root>
    );
}

export function Sidebar() {
    // Groups are frames and notes are paper, not sessions; the list is about what runs.
    const nodes = useCanvas(useShallow((s) => s.order.map((id) => s.nodes[id]).filter((node) => node.kind !== 'group' && node.kind !== 'note')));
    const sessions = useSessions((s) => s.byNodeId);
    const chats = useChats((s) => s.byNodeId);
    const open = useUi((s) => s.sidebarOpen);
    const inset = useTrafficLightInset();

    return (
        <aside
            id="app-sidebar"
            inert={!open}
            className="h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
            style={{ width: open ? SIDEBAR_WIDTH_PX : 0 }}
        >
            <div className="flex h-full flex-col border-r border-border bg-surface" style={{ width: SIDEBAR_WIDTH_PX }}>
                <div className="app-drag relative flex h-12 items-center gap-2 pr-3" style={{ paddingLeft: inset ?? STRIP_PADDING_PX }}>
                    <SidebarToggle />
                    {/* The brand centers in what the traffic lights leave of the strip, so the toggle
                        and the search button beside it cannot pull it off center. */}
                    <span className="pointer-events-none absolute inset-y-0 right-0 grid place-items-center" style={{ left: inset ?? STRIP_PADDING_PX }}>
                        <Brand />
                    </span>
                    <span className="grow" />
                    <Tooltip label="Search" kbd="⌘K">
                        <button className="icon-btn h-7 w-7" onClick={() => useUi.getState().setPaletteOpen(true)}>
                            <Icon icon={Search} size={16} />
                        </button>
                    </Tooltip>
                </div>

                <div className="mt-2 min-h-0 grow overflow-auto px-2">
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
                                <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium uppercase tracking-[.04em] text-text-faint">
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
                        className="flex h-8 grow items-center gap-2 rounded-md px-2 text-sm text-text-muted hover:bg-surface-sunken hover:text-text"
                        onClick={() => addNodeAtCenter('terminal')}
                    >
                        <Icon icon={Plus} size={14} /> New session
                    </button>
                    <Tooltip label="Settings" kbd="⌘,">
                        <button className="icon-btn" onClick={() => useUi.getState().setSettings({ open: true })}>
                            <Icon icon={Settings} size={16} />
                        </button>
                    </Tooltip>
                </div>
            </div>
        </aside>
    );
}
