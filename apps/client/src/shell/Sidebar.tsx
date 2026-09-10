import { useRef, useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Globe, LayoutGrid, MessageSquare, Plus, Settings, StickyNote, Terminal } from 'lucide-react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useHasDraft } from '@/chat/drafts';
import { useCanvas, type CanvasNode } from '@/state/canvas';
import { useChats, useNodeStatus } from '@/state/chats';
import { nodeStatus, useSessions } from '@/state/sessions';
import { useUi } from '@/state/ui';
import { addNodeAtCenter } from '@/shell/commands';
import { groupRows, rowAfterArrow, rowOrder } from '@/shell/sidebar-rows';
import { StatusDot } from '@/canvas/NodeFrame';
import { NodeMenuPopup } from '@/canvas/NodeMenu';
import { Brand } from '@/ui/Brand';
import { SECTION_LABEL } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Tooltip } from '@/ui/Tooltip';
import { SidebarToggle } from '@/shell/SidebarToggle';
import { useInstantWidth } from '@/shell/useInstantWidth';
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

interface SessionRowProps {
    node: CanvasNode;
    /* The one row Tab reaches: the list is a single stop and the arrows move inside it. */
    tabbable: boolean;
    onFocus(): void;
    onArrow(delta: -1 | 1): void;
}

function SessionRow({ node, tabbable, onFocus, onArrow }: SessionRowProps) {
    const selected = useCanvas((s) => s.selection.includes(node.id));
    const status = useNodeStatus(node);
    const draft = useHasDraft(node.id) && node.kind === 'chat';
    const [renaming, setRenaming] = useState(false);
    const kindIcon = KIND_ICON[node.kind];
    if (renaming) {
        return (
            <div className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm">
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
                data-sidebar-row={node.id}
                aria-current={selected ? 'true' : undefined}
                tabIndex={tabbable ? 0 : -1}
                className={clsx(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
                    selected ? 'bg-accent-soft text-text' : 'text-text-muted hover:bg-surface-sunken hover:text-text'
                )}
                onFocus={onFocus}
                onClick={() => useCanvas.getState().goToNode(node.id)}
                onDoubleClick={() => setRenaming(true)}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        onArrow(e.key === 'ArrowDown' ? 1 : -1);
                    }
                    if (e.key === 'F2') {
                        e.preventDefault();
                        setRenaming(true);
                    }
                }}
            >
                <Icon icon={kindIcon} size={14} className="shrink-0" />
                <span className="truncate">{node.title}</span>
                <span className="grow" />
                {draft && (
                    <Tooltip label="Unsent draft">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" />
                    </Tooltip>
                )}
                {status && <StatusDot status={status} plain />}
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
    const instant = useInstantWidth();
    const inset = useTrafficLightInset();
    const listRef = useRef<HTMLDivElement>(null);
    /* Which row the arrows move from, and the only row Tab reaches. */
    const [rovingId, setRovingId] = useState<string | null>(null);

    const groups = groupRows(nodes, (node) => nodeStatus(node, sessions, chats) ?? null);
    const order = rowOrder(groups);
    const roving = rovingId !== null && order.includes(rovingId) ? rovingId : (order[0] ?? null);

    const moveFocus = (delta: -1 | 1): void => {
        const next = rowAfterArrow(order, roving, delta);
        if (next === null) {
            return;
        }
        setRovingId(next);
        listRef.current?.querySelector<HTMLElement>(`[data-sidebar-row="${CSS.escape(next)}"]`)?.focus();
    };

    return (
        <aside
            id="app-sidebar"
            inert={!open}
            data-instant={instant ? '' : undefined}
            className="panel-shell h-full shrink-0 overflow-hidden"
            style={{ width: open ? SIDEBAR_WIDTH_PX : 0 }}
        >
            <div className="flex h-full flex-col border-r border-border bg-surface" style={{ width: SIDEBAR_WIDTH_PX }}>
                <div className="app-drag relative flex h-12 items-center pr-3" style={{ paddingLeft: inset ?? STRIP_PADDING_PX }}>
                    <SidebarToggle />
                    {/* The brand centers in what the traffic lights leave of the strip, so the toggle
                        beside it cannot pull it off center. */}
                    <span className="pointer-events-none absolute inset-y-0 right-0 grid place-items-center" style={{ left: inset ?? STRIP_PADDING_PX }}>
                        <Brand />
                    </span>
                </div>

                <div ref={listRef} className="mt-2 min-h-0 grow overflow-auto px-2">
                    {groups.length === 0 ? (
                        <EmptyState>Nothing runs yet. Add a terminal, a chat or an agent from the plus below.</EmptyState>
                    ) : (
                        groups.map((group) => (
                            <div key={group.status} className="mb-3">
                                <div className={`${SECTION_LABEL} flex items-center gap-1.5 px-2 py-1`}>
                                    {group.status !== 'none' && <StatusDot status={group.status} plain />}
                                    {group.label}
                                    <span className="ml-auto tabular-nums">{group.rows.length}</span>
                                </div>
                                {group.rows.map((node) => (
                                    <SessionRow
                                        key={node.id}
                                        node={node}
                                        tabbable={node.id === roving}
                                        onFocus={() => setRovingId(node.id)}
                                        onArrow={moveFocus}
                                    />
                                ))}
                            </div>
                        ))
                    )}
                </div>

                <div className="flex items-center gap-1 border-t border-border p-2">
                    <button
                        className="flex h-8 grow items-center gap-2 rounded-md px-2 text-sm text-text-muted hover:bg-surface-sunken hover:text-text"
                        onClick={() => addNodeAtCenter('terminal')}
                    >
                        <Icon icon={Plus} size={14} /> New terminal
                    </button>
                    <Tooltip label="Settings" kbd="⌘," name>
                        <button className="icon-btn" onClick={() => useUi.getState().setSettings({ open: true })}>
                            <Icon icon={Settings} size={16} />
                        </button>
                    </Tooltip>
                </div>
            </div>
        </aside>
    );
}
