import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Menu } from '@base-ui-components/react/menu';
import { ChevronRight, Copy, Frame, Globe, LayoutGrid, MessageSquare, Minus, Pencil, PenTool, Plus, Settings, StickyNote, Terminal, Trash } from 'lucide-react';
import clsx from 'clsx';
import { isCanvasView, isSessionView, type AgentKind, type NodeKind, type ProjectViewKind } from '@ruimte/contracts';
import { useShallow } from 'zustand/react/shallow';
import { useDrafts } from '@/chat/drafts';
import { askDeleteView, duplicateViewOf, putOnCanvas, revealNode, showOnCanvas, showView } from '@/project/views';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useDocument } from '@/state/document';
import { nodeStatus, useSessions, type StatusOf } from '@/state/sessions';
import { useUi } from '@/state/ui';
import {
    buildSidebar,
    isSessionKind,
    rowAfterArrow,
    rowOrder,
    type SidebarNode,
    type SidebarNodeRow,
    type SidebarView,
    type SidebarViewRow
} from '@/shell/sidebar-rows';
import { AgentIcon } from '@/agents/AgentIcon';
import { Favicon } from '@/browser/Favicon';
import { resetTitle } from '@/nodes/node-host';
import { StatusDot } from '@/canvas/NodeFrame';
import { NodeMenuPopup } from '@/canvas/NodeMenu';
import { Brand } from '@/ui/Brand';
import { SECTION_LABEL } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Tooltip } from '@/ui/Tooltip';
import { SidebarToggle } from '@/shell/SidebarToggle';
import { NewViewItems } from '@/shell/ViewMenu';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { useTrafficLightInset } from '@/desktop/useFullscreen';
import { Icon } from '@/ui/Icon';

/* How wide the list is when it is open. The inner column keeps this width while the wrapper
   animates to zero, so nothing reflows on the way out. */
export const SIDEBAR_WIDTH_PX = 248;

/* The padding the strip starts with where there are no traffic lights to clear. */
export const STRIP_PADDING_PX = 12;

/* Every kind a row can be: the views of the project and the nodes on a canvas, in one table, since
   the three kinds both lists share wear the same glyph either way. */
const ROW_ICON: Record<NodeKind | ProjectViewKind, typeof Terminal> = {
    canvas: Frame,
    terminal: Terminal,
    chat: MessageSquare,
    browser: Globe,
    group: LayoutGrid,
    note: StickyNote,
    drawing: PenTool,
    separator: Minus
};

const ROW = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors';
/* Where a dragged row would land. It sits in the gap, so the rows around it do not move while
   the pointer travels. */
const INSERT_LINE = 'pointer-events-none -my-px h-0.5 shrink-0 rounded-full bg-accent';
/* Every row opens with the same 16px square, so a view and a node under it line up one indent apart. */
const ICON_SLOT = 'grid size-4 shrink-0 place-items-center';
const ROW_SELECTED = 'bg-surface-active text-text';
const ROW_PLAIN = 'text-text-muted hover:bg-surface-hover hover:text-text';

/* The gap in the list the pointer is asking for: above the row whose top half it is in. */
const insertionIndex = (list: HTMLElement, clientY: number): number => {
    const rows = [...list.querySelectorAll<HTMLElement>('[data-view-index]')];
    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
            return Number(row.dataset.viewIndex);
        }
    }
    return rows.length;
};

interface RowProps {
    /* The one row Tab reaches: the list is a single stop and the arrows move inside it. */
    tabbable: boolean;
    onFocus(): void;
    onArrow(delta: -1 | 1): void;
}

/*
 * What a row wears at its left edge: a page its own favicon, an agent the mark of its CLI, and
 * anything else the glyph of its kind. The 16px slot is the same either way, so nothing shifts.
 */
function RowIcon({ id, kind, provider, className }: { id: string; kind: NodeKind | ProjectViewKind; provider: AgentKind | null; className?: string }) {
    if (kind === 'browser') {
        return <Favicon id={id} />;
    }
    if (provider && (kind === 'chat' || kind === 'terminal')) {
        return <AgentIcon kind={provider} size={14} className={className} />;
    }
    return <Icon icon={ROW_ICON[kind]} size={14} className={className} />;
}

/* Answers with the name that was typed, or null when the field is left empty, which unnames it. */
function RenameField({ value, onDone }: { value: string; onDone(next: string | null): void }) {
    return (
        <input
            autoFocus
            defaultValue={value}
            className="min-w-0 grow rounded bg-surface-sunken px-1.5 py-0.5 text-sm text-text outline-none ring-1 ring-accent"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => onDone(e.currentTarget.value.trim() || null)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                    e.currentTarget.value = value;
                    e.currentTarget.blur();
                }
            }}
        />
    );
}

function NodeRow({ row, tabbable, onFocus, onArrow }: RowProps & { row: SidebarNodeRow }) {
    const { node } = row;
    const picked = useCanvas((s) => s.selection.includes(node.id));
    // The selection belongs to the canvas store, so the row pairs on the view that store holds, not
    // on the active one, which flips a tick before the canvas follows.
    const onScreen = useCanvas((s) => s.viewId === row.viewId);
    // Only the canvas that is up has a selection, so a row of another view is never the current one.
    const selected = picked && onScreen;
    const [renaming, setRenaming] = useState(false);
    if (renaming) {
        return (
            <div className={`${ROW} pl-6`}>
                <span className={ICON_SLOT}>
                    <RowIcon id={node.id} kind={node.kind} provider={node.provider} className="text-text-muted" />
                </span>
                <RenameField
                    value={node.title}
                    onDone={(next) => {
                        if (next) {
                            useCanvas.getState().renameNode(node.id, next);
                        } else {
                            resetTitle(node.id);
                        }
                        setRenaming(false);
                    }}
                />
            </div>
        );
    }
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<button />}
                data-sidebar-row={row.rowId}
                aria-current={selected ? 'true' : undefined}
                tabIndex={tabbable ? 0 : -1}
                className={clsx(ROW, row.viewName === null && 'pl-6', selected ? ROW_SELECTED : ROW_PLAIN)}
                onFocus={onFocus}
                onClick={() => revealNode(node.id)}
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
                <span className={ICON_SLOT}>
                    <RowIcon id={node.id} kind={node.kind} provider={node.provider} />
                </span>
                <span className="min-w-0 truncate">{node.title}</span>
                {/* A row that stands outside its own view says where the node is, so the jump is no surprise. */}
                {row.viewName && <span className="min-w-0 shrink truncate text-xs text-text-faint">{row.viewName}</span>}
                <span className="grow" />
                {node.draft && (
                    <Tooltip label="Unsent draft">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" />
                    </Tooltip>
                )}
                {node.status && <StatusDot status={node.status} plain />}
            </ContextMenu.Trigger>
            <NodeMenuPopup id={node.id} onRename={() => setRenaming(true)} />
        </ContextMenu.Root>
    );
}

interface ViewRowProps extends RowProps {
    row: SidebarViewRow;
    onToggle(): void;
    onDelete(): void;
    onDrag(id: string | null): void;
}

/*
 * A separator is a line, not a place: it has no body, never opens and says nothing. It drags and
 * reorders like any other row, because it earns its keep by where it sits between them.
 */
function SeparatorRow({ row, tabbable, onFocus, onArrow, onDelete, onDrag }: Omit<ViewRowProps, 'onToggle'>) {
    const { view } = row;
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                draggable
                role="separator"
                aria-label="Separator"
                data-sidebar-row={row.rowId}
                data-view-index={row.index}
                tabIndex={tabbable ? 0 : -1}
                className="flex h-6 w-full cursor-default items-center gap-2 px-2 outline-none focus-visible:ring-1 focus-visible:ring-accent"
                onFocus={onFocus}
                onDragStart={() => onDrag(view.id)}
                onDragEnd={() => onDrag(null)}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        onArrow(e.key === 'ArrowDown' ? 1 : -1);
                    }
                }}
            >
                <span className="h-px grow bg-border" />
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-[var(--z-popup)]">
                    <ContextMenu.Popup className="menu-popup">
                        <ContextMenu.Item className="menu-item text-status-error" onClick={onDelete}>
                            <Icon icon={Trash} size={14} /> Delete
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}

function ViewRow({ row, tabbable, onFocus, onArrow, onToggle, onDelete, onDrag }: ViewRowProps) {
    const { view } = row;
    const [renaming, setRenaming] = useState(false);
    if (renaming) {
        return (
            <div className={ROW}>
                <span className={ICON_SLOT}>
                    <RowIcon id={view.id} kind={view.kind} provider={view.provider} className="text-text-muted" />
                </span>
                <RenameField
                    value={view.name}
                    onDone={(next) => {
                        if (next) {
                            useDocument.getState().renameView(view.id, next);
                        } else {
                            resetTitle(view.id);
                        }
                        setRenaming(false);
                    }}
                />
            </div>
        );
    }
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<button />}
                draggable
                data-sidebar-row={row.rowId}
                data-view-index={row.index}
                aria-current={row.active ? 'true' : undefined}
                aria-expanded={row.expandable ? row.expanded : undefined}
                tabIndex={tabbable ? 0 : -1}
                className={clsx(ROW, 'group font-medium', row.active ? ROW_SELECTED : ROW_PLAIN)}
                onFocus={onFocus}
                onClick={() => showView(view.id)}
                onDoubleClick={() => setRenaming(true)}
                onDragStart={() => onDrag(view.id)}
                onDragEnd={() => onDrag(null)}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        onArrow(e.key === 'ArrowDown' ? 1 : -1);
                    }
                    if (e.key === 'F2') {
                        e.preventDefault();
                        setRenaming(true);
                    }
                    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && row.expandable && row.expanded !== (e.key === 'ArrowRight')) {
                        e.preventDefault();
                        onToggle();
                    }
                }}
            >
                {/* One slot at the row's left edge: the kind of the view, and the chevron in its place
                    the moment folding is on offer. */}
                <span
                    role="presentation"
                    className={clsx(ICON_SLOT, row.expandable && 'rounded-sm hover:bg-surface-hover')}
                    onClick={(e) => {
                        if (row.expandable) {
                            e.stopPropagation();
                            onToggle();
                        }
                    }}
                >
                    <RowIcon
                        id={view.id}
                        kind={view.kind}
                        provider={view.provider}
                        className={clsx(
                            'col-start-1 row-start-1',
                            row.expandable && (row.expanded ? 'hidden' : 'group-hover:hidden group-focus-visible:hidden')
                        )}
                    />
                    {row.expandable && (
                        <Icon
                            icon={ChevronRight}
                            size={14}
                            className={clsx(
                                'col-start-1 row-start-1 transition-transform duration-150',
                                row.expanded ? 'rotate-90' : 'hidden group-hover:block group-focus-visible:block'
                            )}
                        />
                    )}
                </span>
                <span className="min-w-0 truncate">{view.name}</span>
                <span className="grow" />
                {row.count > 0 && <span className="shrink-0 text-xs tabular-nums text-text-faint">{row.count}</span>}
                {row.draft && (
                    <Tooltip label="Unsent draft">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" />
                    </Tooltip>
                )}
                {row.status && <StatusDot status={row.status} plain />}
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-[var(--z-popup)]">
                    <ContextMenu.Popup className="menu-popup">
                        <ContextMenu.Item className="menu-item" onClick={() => setRenaming(true)}>
                            <Icon icon={Pencil} size={14} /> Rename <kbd>F2</kbd>
                        </ContextMenu.Item>
                        {(view.kind === 'canvas' || view.kind === 'drawing') && (
                            <ContextMenu.Item className="menu-item" onClick={() => duplicateViewOf(view.id)}>
                                <Icon icon={Copy} size={14} /> Duplicate
                            </ContextMenu.Item>
                        )}
                        {view.kind !== 'canvas' && view.kind !== 'drawing' && (
                            <ContextMenu.Item className="menu-item" onClick={() => putOnCanvas(view.id)}>
                                <Icon icon={Frame} size={14} /> Put on canvas
                            </ContextMenu.Item>
                        )}
                        {view.kind === 'drawing' && (
                            <ContextMenu.Item className="menu-item" onClick={() => showOnCanvas(view.id)}>
                                <Icon icon={Frame} size={14} /> Show on canvas
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Item className="menu-item text-status-error" onClick={onDelete}>
                            <Icon icon={Trash} size={14} /> Delete
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}

export function Sidebar() {
    const views = useDocument((s) => s.views);
    const activeViewId = useDocument((s) => s.activeViewId);
    const canvasViewId = useCanvas((s) => s.viewId);
    const order = useCanvas(useShallow((s) => s.order));
    const nodes = useCanvas((s) => s.nodes);
    const sessions = useSessions((s) => s.byNodeId);
    const chats = useChats((s) => s.byNodeId);
    const drafts = useDrafts((s) => s.ids);
    const open = useUi((s) => s.sidebarOpen);
    const expanded = useUi(useShallow((s) => s.sidebarExpanded));
    const instant = useInstantWidth();
    const inset = useTrafficLightInset();
    const listRef = useRef<HTMLDivElement>(null);
    /* Which row the arrows move from, and the only row Tab reaches. */
    const [rovingId, setRovingId] = useState<string | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    /* The gap the row would drop into, drawn as a line between two rows. */
    const [insertAt, setInsertAt] = useState<number | null>(null);

    const sidebarViews = useMemo<SidebarView[]>(
        () =>
            views.map((view) => {
                // The canvas store owns the view it holds, so its nodes are the fresher ones. It pairs on
                // the store's own view, not on the active one, which flips a tick before the canvas follows.
                const live = isCanvasView(view) ? (view.id === canvasViewId ? order.map((id) => nodes[id]!) : view.nodes) : [];
                const asRow = (node: StatusOf & { title: string; provider?: AgentKind }): SidebarNode => ({
                    id: node.id,
                    title: node.title,
                    kind: node.kind,
                    provider: node.provider ?? null,
                    status: nodeStatus(node, sessions, chats) ?? null,
                    draft: node.kind === 'chat' && drafts.includes(node.id)
                });
                const provider = view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : undefined;
                return {
                    id: view.id,
                    name: view.name ?? '',
                    kind: view.kind,
                    provider: provider ?? null,
                    nodes: live.filter((node) => isSessionKind(node.kind)).map(asRow),
                    // Only a session view is a node of its own; a separator and a drawing have no status.
                    self: isSessionView(view) ? asRow({ id: view.id, kind: view.kind, title: view.name, provider }) : null
                };
            }),
        [views, canvasViewId, order, nodes, sessions, chats, drafts]
    );

    const expandedIds = useMemo(() => new Set(expanded ?? (activeViewId === null ? [] : [activeViewId])), [expanded, activeViewId]);

    /* The list seeds itself with the canvas that is up, once per project. From there the set is the
       person's own and lands in the project's local file, so no switch ever folds a canvas shut. */
    useEffect(() => {
        if (expanded === null && activeViewId !== null) {
            useUi.getState().setSidebarExpanded([activeViewId]);
        }
    }, [expanded, activeViewId]);
    const sections = buildSidebar({ views: sidebarViews, activeViewId, expandedIds });
    const rows = rowOrder(sections);
    const roving = rovingId !== null && rows.includes(rovingId) ? rovingId : (rows[0] ?? null);

    const onDrag = (id: string | null): void => {
        setDragging(id);
        if (id === null) {
            setInsertAt(null);
        }
    };

    /* A drop writes the order into the file. The gap was read off the list as it stands, so taking
       the row out of it first moves every gap below it up by one. */
    const dropAt = (index: number): void => {
        const id = dragging;
        onDrag(null);
        const from = id === null ? -1 : useDocument.getState().views.findIndex((view) => view.id === id);
        if (id === null || from === -1) {
            return;
        }
        const to = index > from ? index - 1 : index;
        if (to !== from) {
            useDocument.getState().moveView(id, to);
        }
    };

    const moveFocus = (delta: -1 | 1): void => {
        const next = rowAfterArrow(rows, roving, delta);
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
                    {sidebarViews.length === 0 ? (
                        <EmptyState>No project is open yet.</EmptyState>
                    ) : (
                        sections.map((section) => {
                            // Only the list of views takes a drop; the nodes under a canvas are not places
                            // a view can go.
                            const reorderable = section.id === 'views' && dragging !== null;
                            return (
                                <div
                                    key={section.id}
                                    className="mb-3 flex flex-col gap-px"
                                    onDragOver={
                                        reorderable
                                            ? (e) => {
                                                  e.preventDefault();
                                                  setInsertAt(insertionIndex(e.currentTarget, e.clientY));
                                              }
                                            : undefined
                                    }
                                    onDrop={
                                        reorderable
                                            ? (e) => {
                                                  e.preventDefault();
                                                  dropAt(insertionIndex(e.currentTarget, e.clientY));
                                              }
                                            : undefined
                                    }
                                >
                                    <div className={`${SECTION_LABEL} flex items-center gap-1.5 px-2 py-1`}>
                                        {section.id === 'needs-you' && <StatusDot status="needs-you" plain />}
                                        {section.label}
                                        <span className="ml-auto tabular-nums">{section.rows.length}</span>
                                    </div>
                                    {section.rows.map((row) => {
                                        if (row.type === 'node') {
                                            return (
                                                <NodeRow
                                                    key={row.rowId}
                                                    row={row}
                                                    tabbable={row.rowId === roving}
                                                    onFocus={() => setRovingId(row.rowId)}
                                                    onArrow={moveFocus}
                                                />
                                            );
                                        }
                                        const shared = {
                                            row,
                                            tabbable: row.rowId === roving,
                                            onFocus: () => setRovingId(row.rowId),
                                            onArrow: moveFocus,
                                            onDelete: () => askDeleteView(row.view.id),
                                            onDrag
                                        };
                                        return (
                                            <Fragment key={row.rowId}>
                                                {section.id === 'views' && insertAt === row.index && <div className={INSERT_LINE} />}
                                                {row.view.kind === 'separator' ? (
                                                    <SeparatorRow {...shared} />
                                                ) : (
                                                    <ViewRow
                                                        {...shared}
                                                        onToggle={() => {
                                                            const next = new Set(expandedIds);
                                                            if (row.expanded) {
                                                                next.delete(row.view.id);
                                                            } else {
                                                                next.add(row.view.id);
                                                            }
                                                            useUi.getState().setSidebarExpanded([...next]);
                                                        }}
                                                    />
                                                )}
                                            </Fragment>
                                        );
                                    })}
                                    {section.id === 'views' && insertAt === sidebarViews.length && <div className={INSERT_LINE} />}
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="flex items-center gap-1 border-t border-border p-2">
                    <Menu.Root>
                        <Menu.Trigger className="flex h-8 grow items-center gap-2 rounded-md px-2 text-sm text-text-muted hover:bg-surface-hover hover:text-text data-[popup-open]:bg-surface-active">
                            <Icon icon={Plus} size={14} /> New view
                        </Menu.Trigger>
                        <Menu.Portal>
                            <Menu.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={6} align="start">
                                <Menu.Popup className="menu-popup min-w-52">
                                    <NewViewItems />
                                </Menu.Popup>
                            </Menu.Positioner>
                        </Menu.Portal>
                    </Menu.Root>
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
