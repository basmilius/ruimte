import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Menu } from '@base-ui-components/react/menu';
import {
    ChartNoAxesColumn,
    ChevronRight,
    CircleQuestionMark,
    FileText,
    Globe,
    LayoutGrid,
    MessageSquare,
    PenTool,
    Plus,
    Settings,
    StickyNote,
    Smartphone,
    Terminal,
    Trash,
    TriangleAlert,
    Users,
    Workflow
} from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { isCanvasView, isSessionView, type AgentKind, type CanvasNodeKind, viewIconOf } from '@ruimte/contracts';
import { useShallow } from 'zustand/react/shallow';
import { renameViewAction } from '@/actions/client-actions';
import { useDrafts } from '@/chat/drafts';
import { isUnseen, useAttention } from '@/state/attention';
import { useProcessWarnings } from '@/state/processes';
import { carriesFiles, carriesPaths, dropEffectFor, droppedPaths } from '@/canvas/drop';
import { finderPaths } from '@/canvas/finder-drop';
import { askDeleteView, newFileView, revealNode, showView } from '@/project/views';
import { focusedCanvas, useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useDocument } from '@/state/document';
import { nodeStatus, useSessions, type StatusOf } from '@/state/sessions';
import { ViewMenuItems } from '@/shell/ViewMenuItems';
import { useUi } from '@/state/ui';
import { useEndpointId } from '@/state/keys';
import {
    buildSidebar,
    isSessionKind,
    rowAfterArrow,
    rowOrder,
    type SidebarNode,
    type SidebarNodeRow,
    type SidebarProject,
    type SidebarViewRow
} from '@/shell/sidebar-rows';
import { useSidebarSource } from '@/shell/sidebar-source';
import { AgentIcon } from '@/agents/AgentIcon';
import { UnseenMark } from '@/attention/UnseenMark';
import { TaskMark } from '@/tasks/TaskMark';
import { childTask, useTasks } from '@/state/tasks';
import { Favicon } from '@/browser/Favicon';
import { useBrowserDisplayTitle } from '@/browser/title';
import { resetTitle } from '@/nodes/node-host';
import { StatusDot } from '@/canvas/NodeFrame';
import { NodeMenuPopup } from '@/canvas/NodeMenu';
import { ViewGlyph } from '@/project/ViewGlyph';
import { Brand } from '@/ui/Brand';
import { SECTION_LABEL } from '@/ui/classes';
import { Tooltip } from '@/ui/Tooltip';
import { SidebarToggle } from '@/shell/SidebarToggle';
import { NewViewItems, NewViewTiles } from '@/shell/ViewMenu';
import { setDragging as setDraggedView, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { UsageLimitsCard } from '@/shell/usage/UsageLimitsCard';
import { ConnectionDot } from '@/shell/ConnectionDot';
import { useTrafficLightInset } from '@/desktop/useFullscreen';
import { Icon } from '@/ui/Icon';
import { MenuPopup } from '@/ui/MenuPopup';
import { APP_SHORTCUTS } from '@/shell/shortcuts';

/* How wide the list is when it is open. The inner column keeps this width while the wrapper
   animates to zero, so nothing reflows on the way out. */
export const SIDEBAR_WIDTH_PX = 248;

/* The padding the strip starts with where there are no traffic lights to clear. */
export const STRIP_PADDING_PX = 12;

/* Every kind a node on a canvas can be. A view row draws itself through `ViewGlyph`, which starts
   from the icon a person picked and falls back to the same marks. */
const ROW_ICON: Record<CanvasNodeKind, typeof Terminal> = {
    terminal: Terminal,
    chat: MessageSquare,
    browser: Globe,
    device: Smartphone,
    group: LayoutGrid,
    note: StickyNote,
    drawing: PenTool,
    diagram: Workflow,
    file: FileText,
    unknown: CircleQuestionMark
};

const ROW = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm';
/* Where a dragged row would land. It sits in the gap, so the rows around it do not move while
   the pointer travels. */
const INSERT_LINE = 'pointer-events-none -my-px h-0.5 shrink-0 rounded-full bg-accent';
/* Every row opens with the same 16px square, so a view and a node under it line up one indent apart. */
const ICON_SLOT = 'grid size-4 shrink-0 place-items-center';
const ROW_SELECTED = 'bg-surface-active text-text';
/* Standing in a cell beside the focused one: the name at full strength, the background left empty,
   so it reads as open without claiming to be the row the keyboard is on. */
const ROW_BESIDE = 'text-text hover:bg-surface-hover';
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
function RowIcon({ id, kind, provider, className }: { id: string; kind: CanvasNodeKind; provider: AgentKind | null; className?: string }) {
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

/* A folded canvas still says one of its nodes has a warning, the way it says one needs you. */
function ProcessWarningMark() {
    const { t } = useTranslation('shell');
    return (
        <Tooltip label={t('sidebar.processWarning')}>
            <span className="inline-flex shrink-0 text-status-needs-you">
                <Icon icon={TriangleAlert} size={12} />
            </span>
        </Tooltip>
    );
}

function NodeRow({ row, tabbable, onFocus, onArrow }: RowProps & { row: SidebarNodeRow }) {
    const { t } = useTranslation('shell');
    const { node } = row;
    const title = useBrowserDisplayTitle(node.id, node.title, node.titleSource);
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
                            focusedCanvas().getState().renameNode(node.id, next);
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
                    arrowStep(e, onArrow);
                    if (e.key === 'F2') {
                        e.preventDefault();
                        setRenaming(true);
                    }
                }}
            >
                <span className={ICON_SLOT}>
                    <RowIcon id={node.id} kind={node.kind} provider={node.provider} />
                </span>
                <span className="min-w-0 truncate">{node.kind === 'browser' ? title : node.title}</span>
                {/* A row that stands outside its own view says where the node is, so the jump is no surprise. */}
                {row.viewName && <span className="min-w-0 shrink truncate text-xs text-text-faint">{row.viewName}</span>}
                <span className="grow" />
                {node.draft && (
                    <Tooltip label={t('sidebar.unsentDraft')}>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" />
                    </Tooltip>
                )}
                {node.task && <TaskMark task={node.task} />}
                {node.finished && <UnseenMark />}
                {node.alert && <ProcessWarningMark />}
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
    /* A drag of a view, with the transfer to write the payload on; null when it ends. */
    onDrag(id: string | null, transfer?: DataTransfer): void;
}

/* Up and down walk the list, from whichever row has the keyboard. */
const arrowStep = (event: ReactKeyboardEvent<HTMLElement>, onArrow: (delta: 1 | -1) => void): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        onArrow(event.key === 'ArrowDown' ? 1 : -1);
    }
};

/* All a row with nothing to open offers: a separator, and a view this version cannot draw. */
function DeleteRowMenu({ onDelete }: { onDelete(): void }) {
    const { t } = useTranslation('common');
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-(--z-popup)">
                <ContextMenu.Popup className="menu-popup">
                    <ContextMenu.Item className="menu-item text-status-error" onClick={onDelete}>
                        <Icon icon={Trash} size={14} /> {t('action.delete')}
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}

/*
 * A separator is a line, not a place: it has no body, never opens and says nothing. It drags and
 * reorders like any other row, because it earns its keep by where it sits between them.
 */
function SeparatorRow({ row, tabbable, onFocus, onArrow, onDelete, onDrag }: Omit<ViewRowProps, 'onToggle'>) {
    const { t } = useTranslation(['shell', 'common']);
    const { view } = row;
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                draggable
                role="separator"
                aria-label={t('viewKinds.separator')}
                data-sidebar-row={row.rowId}
                data-view-index={row.index}
                tabIndex={tabbable ? 0 : -1}
                className="flex h-6 w-full cursor-default items-center gap-2 px-2 outline-none focus-visible:ring-1 focus-visible:ring-accent"
                onFocus={onFocus}
                onDragStart={(event) => onDrag(view.id, event.dataTransfer)}
                onDragEnd={() => onDrag(null)}
                onKeyDown={(e) => arrowStep(e, onArrow)}
            >
                <span className="h-px grow bg-border" />
            </ContextMenu.Trigger>
            <DeleteRowMenu onDelete={onDelete} />
        </ContextMenu.Root>
    );
}

/*
 * A view a newer Ruimte made. It is listed so nobody wonders where it went and kept in the file as it
 * is, but this version has nothing to draw it with: it neither opens nor drags into a cell, and a
 * person may still delete it.
 */
function UnknownViewRow({ row, tabbable, onFocus, onArrow, onDelete }: Omit<ViewRowProps, 'onToggle' | 'onDrag'>) {
    const { t } = useTranslation(['shell', 'common']);
    const { view } = row;
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                aria-disabled="true"
                data-sidebar-row={row.rowId}
                data-view-index={row.index}
                tabIndex={tabbable ? 0 : -1}
                className={clsx(ROW, 'cursor-default font-medium text-text-faint outline-none focus-visible:ring-1 focus-visible:ring-accent')}
                onFocus={onFocus}
                onKeyDown={(e) => arrowStep(e, onArrow)}
            >
                <Tooltip label={t('sidebar.needsNewerRuimte')}>
                    <span className="flex min-w-0 grow items-center gap-2">
                        <span className={ICON_SLOT}>
                            <ViewGlyph id={view.id} kind={view.kind} />
                        </span>
                        <span className="min-w-0 truncate">{view.name}</span>
                    </span>
                </Tooltip>
            </ContextMenu.Trigger>
            <DeleteRowMenu onDelete={onDelete} />
        </ContextMenu.Root>
    );
}

function ViewRow({ row, tabbable, onFocus, onArrow, onToggle, onDrag }: ViewRowProps) {
    const { t } = useTranslation(['shell', 'common']);
    const { view } = row;
    const title = useBrowserDisplayTitle(view.id, view.name, view.titleSource);
    const [renaming, setRenaming] = useState(false);
    if (renaming) {
        return (
            <div className={ROW}>
                <span className={ICON_SLOT}>
                    <ViewGlyph id={view.id} kind={view.kind} icon={view.icon} provider={view.provider} path={view.path} className="text-text-muted" />
                </span>
                <RenameField
                    value={view.name}
                    onDone={(next) => {
                        if (next) {
                            renameViewAction(view.id, next);
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
                className={clsx(ROW, 'group font-medium', row.active ? ROW_SELECTED : row.beside ? ROW_BESIDE : ROW_PLAIN)}
                onFocus={onFocus}
                onClick={() => showView(view.id)}
                onDoubleClick={() => setRenaming(true)}
                onDragStart={(event) => onDrag(view.id, event.dataTransfer)}
                onDragEnd={() => onDrag(null)}
                onKeyDown={(e) => {
                    arrowStep(e, onArrow);
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
                {/* One slot at the row's left edge: the mark of the view, and the chevron in its place
                    under the pointer, so a folded row and an open one read the same at rest. The
                    padding grows that target to 24 pixels and the negative margin gives the space
                    back, so the chevron is easy to hit without moving the name beside it. */}
                <span
                    role="presentation"
                    className={clsx(ICON_SLOT, row.expandable && '-m-1 box-content rounded-md p-1 hover:bg-surface-hover')}
                    onClick={(e) => {
                        if (row.expandable) {
                            e.stopPropagation();
                            onToggle();
                        }
                    }}
                >
                    <ViewGlyph
                        id={view.id}
                        kind={view.kind}
                        icon={view.icon}
                        provider={view.provider}
                        path={view.path}
                        className={clsx('col-start-1 row-start-1', row.expandable && 'group-hover:hidden group-focus-visible:hidden')}
                    />
                    {row.expandable && (
                        <Icon
                            icon={ChevronRight}
                            size={14}
                            className={clsx('col-start-1 row-start-1 hidden group-hover:block group-focus-visible:block', row.expanded && 'rotate-90')}
                        />
                    )}
                </span>
                <span className="min-w-0 truncate">{view.kind === 'browser' ? title : view.name}</span>
                {/* Colour alone would say nothing to a screen reader, and a view standing in another
                    cell is not the same as one that is closed. */}
                {row.beside && <span className="sr-only">{t('sidebar.openInAnotherCell')}</span>}
                <span className="grow" />
                {row.draft && (
                    <Tooltip label={t('sidebar.unsentDraft')}>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" />
                    </Tooltip>
                )}
                {(view.self ? view.self.alert : view.nodes.some((node) => node.alert)) && <ProcessWarningMark />}
                {row.status && <StatusDot status={row.status} plain />}
                {/* Last of the row, after every dot: where a view lives says something about the
                    project and not about what is happening in it, and the dots are the news. Only a
                    shared row is marked, since private is what a view is until someone says
                    otherwise. Never in the accent, like every other mark here. */}
                {view.shared && (
                    <Tooltip label={t('sidebar.shared')}>
                        <Icon icon={Users} size={12} className="shrink-0 text-text-faint" />
                    </Tooltip>
                )}
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-(--z-popup)">
                    <ContextMenu.Popup className="menu-popup">
                        <ViewMenuItems viewId={view.id} kind={view.kind} onRename={() => setRenaming(true)} />
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}

export function Sidebar() {
    const { t } = useTranslation('shell');
    const source = useSidebarSource();
    const shared = useDocument(useShallow((state) => state.shared));
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.byKey);
    const drafts = useDrafts((s) => s.ids);
    const warnings = useProcessWarnings((s) => s.byEndpoint);
    const unseen = useAttention((s) => s.unseen);
    const tasks = useTasks((s) => s.byEndpoint);
    const open = useUi((s) => s.sidebarOpen);
    const expanded = useUi(useShallow((s) => s.sidebarExpanded));
    const instant = useInstantWidth();
    const inset = useTrafficLightInset();
    const listRef = useRef<HTMLDivElement>(null);
    /* Which row the arrows move from, and the only row Tab reaches. */
    const [rovingId, setRovingId] = useState<string | null>(null);
    /* The row being dragged and the list it came out of, so no other list draws a gap for it. */
    const [dragging, setDragging] = useState<{ sectionId: string; viewId: string } | null>(null);
    /* The gap the row would drop into, drawn as a line between two rows. */
    const [insertAt, setInsertAt] = useState<number | null>(null);

    const project = useMemo<SidebarProject>(
        () => ({
            activeViewId: source.activeViewId,
            openViewIds: source.openViewIds,
            views: source.views.map((view) => {
                // The canvas store owns the view it holds, so its nodes are the fresher ones. It pairs on
                // the store's own view, not on the active one, which flips a tick before the canvas follows.
                const live = isCanvasView(view) ? (view.id === source.canvasViewId ? source.order.map((id) => source.nodes[id]!) : view.nodes) : [];
                const asRow = (node: StatusOf & { title: string; titleSource?: SidebarNode['titleSource']; provider?: AgentKind }): SidebarNode => ({
                    id: node.id,
                    title: node.title,
                    titleSource: node.titleSource,
                    kind: node.kind,
                    provider: node.provider ?? null,
                    status: nodeStatus(node, sessions, chats, endpointId) ?? null,
                    draft: node.kind === 'chat' && drafts.includes(node.id),
                    alert: (warnings[endpointId] ?? []).some((alert) => alert.nodeId === node.id),
                    finished: isUnseen(unseen, endpointId, node.id),
                    task: childTask(tasks[endpointId], node.id)
                });
                const provider = view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : undefined;
                return {
                    id: view.id,
                    name: view.name ?? '',
                    titleSource: 'titleSource' in view ? view.titleSource : undefined,
                    kind: view.kind,
                    shared: shared.includes(view.id),
                    icon: viewIconOf(view),
                    provider: provider ?? null,
                    path: view.kind === 'file' ? view.path : null,
                    nodes: live.filter((node) => isSessionKind(node.kind)).map(asRow),
                    // Only a session view is a node of its own; a separator and a drawing have no status.
                    self: isSessionView(view) ? asRow({ id: view.id, kind: view.kind, title: view.name, titleSource: view.titleSource, provider }) : null
                };
            })
        }),
        [source, shared, endpointId, sessions, chats, drafts, warnings, unseen, tasks]
    );

    const activeViewId = project.activeViewId;
    const expandedIds = useMemo(() => new Set(expanded ?? (activeViewId === null ? [] : [activeViewId])), [expanded, activeViewId]);

    /* The list seeds itself with the canvas that is up, once per project. From there the set is the
       person's own and lands in the project's local file, so no switch ever folds a canvas shut. */
    useEffect(() => {
        if (expanded === null && activeViewId !== null) {
            useUi.getState().setSidebarExpanded([activeViewId]);
        }
    }, [expanded, activeViewId]);
    const sections = buildSidebar({ project, expandedIds });
    const rows = rowOrder(sections);
    const roving = rovingId !== null && rows.includes(rovingId) ? rovingId : (rows[0] ?? null);
    const empty = project.views.length === 0;

    /*
     * One gesture, two targets: a gap between two rows reorders the list, a cell of the grid opens
     * the view there. The row does not know which it will be, so it always writes the payload and
     * both listeners read the same type.
     */
    const onDrag = (drag: { sectionId: string; viewId: string } | null, transfer?: DataTransfer): void => {
        setDragging(drag);
        setDraggedView(drag?.viewId ?? null);
        if (drag === null) {
            setInsertAt(null);
            return;
        }
        transfer?.setData(VIEW_DRAG_TYPE, drag.viewId);
        if (transfer) {
            transfer.effectAllowed = 'move';
        }
    };

    /* The gap was read off the list as it stands, so taking the row out of it first moves every gap below it up by one. */
    const dropAt = (index: number): void => {
        const id = dragging?.viewId ?? null;
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

    /* A file dragged onto the list becomes a view of its own, in the gap it was let go of. */
    const dropFilesAt = (index: number, transfer: DataTransfer): void => {
        setInsertAt(null);
        // A drag out of the file manager is named by the shell of the machine the project runs on.
        const paths = carriesPaths(transfer.types) ? droppedPaths(transfer) : finderPaths(transfer, endpointId);
        if (paths.length === 0) {
            return;
        }
        for (const [at, path] of paths.entries()) {
            const id = newFileView(path);
            if (id !== null) {
                useDocument.getState().moveView(id, index + at);
            }
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
                <div
                    className="app-drag relative flex h-12 shrink-0 items-center justify-between pr-2"
                    style={{ paddingLeft: inset === undefined ? STRIP_PADDING_PX : inset + 8 }}
                >
                    <Brand className="pointer-events-none" />
                    <SidebarToggle />
                </div>

                <div ref={listRef} className="mt-2 min-h-0 grow overflow-auto px-2">
                    {empty ? (
                        <div className="flex flex-col gap-2 px-1 pt-2">
                            <p className="px-1 text-xs text-text-muted">{t('sidebar.noViews')}</p>
                            <NewViewTiles />
                        </div>
                    ) : (
                        sections.map((section) => {
                            // Only the list of views takes a drop, and only the one the row came out of; the
                            // nodes under a canvas are not places a view can go.
                            const reorderable = section.kind === 'views' && dragging?.sectionId === section.id;
                            /* A file out of the files panel or off a preview tab lands here as a view
                               of its own; the waiting list is not a place in any project's file. */
                            const takesDrop = reorderable || section.kind === 'views';
                            return (
                                <div
                                    key={section.id}
                                    className="mb-3 flex flex-col gap-px"
                                    onDragOver={
                                        takesDrop
                                            ? (e) => {
                                                  if (!reorderable && !carriesPaths(e.dataTransfer.types) && !carriesFiles(e.dataTransfer.types)) {
                                                      return;
                                                  }
                                                  e.preventDefault();
                                                  if (!reorderable) {
                                                      e.dataTransfer.dropEffect = dropEffectFor(e.dataTransfer.effectAllowed);
                                                  }
                                                  setInsertAt(insertionIndex(e.currentTarget, e.clientY));
                                              }
                                            : undefined
                                    }
                                    onDragLeave={
                                        takesDrop
                                            ? (e) => {
                                                  // A drag from outside the list has no drag end here to clear the gap.
                                                  if (!reorderable && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                                      setInsertAt(null);
                                                  }
                                              }
                                            : undefined
                                    }
                                    onDrop={
                                        takesDrop
                                            ? (e) => {
                                                  const index = insertionIndex(e.currentTarget, e.clientY);
                                                  e.preventDefault();
                                                  if (reorderable) {
                                                      dropAt(index);
                                                      return;
                                                  }
                                                  dropFilesAt(index, e.dataTransfer);
                                              }
                                            : undefined
                                    }
                                >
                                    {section.label !== null && (
                                        <div className={`${SECTION_LABEL} flex items-center gap-1.5 px-2 py-1`}>
                                            {section.kind === 'needs-you' && <StatusDot status="needs-you" plain />}
                                            {section.label}
                                            <span className="ml-auto tabular-nums">{section.rows.length}</span>
                                        </div>
                                    )}
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
                                            onDrag: (viewId: string | null, transfer?: DataTransfer) =>
                                                onDrag(viewId === null ? null : { sectionId: section.id, viewId }, transfer)
                                        };
                                        return (
                                            <Fragment key={row.rowId}>
                                                {takesDrop && insertAt === row.index && <div className={INSERT_LINE} />}
                                                {row.view.kind === 'separator' ? (
                                                    <SeparatorRow {...shared} />
                                                ) : row.view.kind === 'unknown' ? (
                                                    <UnknownViewRow {...shared} />
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
                                    {takesDrop && insertAt === section.viewCount && <div className={INSERT_LINE} />}
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-1 border-t border-border p-2">
                    <Menu.Root>
                        <Menu.Trigger className="flex h-8 grow items-center gap-2 rounded-md px-2 text-sm text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50 disabled:hover:bg-transparent data-[popup-open]:bg-surface-active">
                            <Icon icon={Plus} size={14} /> {t('viewMenu.newView')}
                        </Menu.Trigger>
                        <MenuPopup side="top" className="min-w-52">
                            <NewViewItems />
                        </MenuPopup>
                    </Menu.Root>
                    <ConnectionDot />
                    <UsageLimitsCard>
                        <button className="icon-btn" aria-label={t('sidebar.usage')} onClick={() => useUi.getState().setUsageOpen(true)}>
                            <Icon icon={ChartNoAxesColumn} size={16} />
                        </button>
                    </UsageLimitsCard>
                    <Tooltip label={t('settingsDialog.title')} kbd={APP_SHORTCUTS.settings} name>
                        <button className="icon-btn" onClick={() => useUi.getState().setSettings({ open: true })}>
                            <Icon icon={Settings} size={16} />
                        </button>
                    </Tooltip>
                </div>
            </div>
        </aside>
    );
}
