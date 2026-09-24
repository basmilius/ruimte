import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
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
    Pencil,
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
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { isCanvasView, isSessionView, type AgentKind, type CanvasNodeKind, viewIconOf } from '@ruimte/contracts';
import { useShallow } from 'zustand/react/shallow';
import { moveViewAction, renameNodeAction, renameViewAction } from '@/actions/client-actions';
import { useDrafts } from '@/chat/drafts';
import { isUnseen, useAttention } from '@/state/attention';
import { useProcessWarnings } from '@/state/processes';
import { carriesFiles, carriesPaths, dropEffectFor, droppedPaths } from '@/canvas/drop';
import { finderPaths } from '@/canvas/finder-drop';
import { askDeleteView, askViewSettings, newFileViewsAfter, revealNode, showView } from '@/project/views';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useDocument } from '@/state/document';
import { nodeStatus, useSessions, type StatusOf } from '@/state/sessions';
import { ViewMenuItems } from '@/shell/ViewMenuItems';
import { useUi } from '@/state/ui';
import { useEndpointId } from '@/state/keys';
import { snoozeOf, useSnoozes } from '@/state/snooze';
import { SnoozeButton, SnoozedMark, SnoozeMenuItems } from '@/shell/Snooze';
import {
    buildSidebar,
    isSessionKind,
    rowAfterArrow,
    rowOrder,
    waitsOnYou,
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
import { FlagMark } from '@/project/FlagMark';
import { ViewGlyph } from '@/project/ViewGlyph';
import { Brand } from '@/ui/Brand';
import { INSET_ROW, MENU_HINT, SECTION_LABEL } from '@/ui/classes';
import { Tooltip } from '@/ui/Tooltip';
import { SidebarToggle } from '@/shell/SidebarToggle';
import { StationMenu } from '@/shell/menu/StationMenu';
import { IS_STATION } from '@/station';
import { NewViewItems } from '@/shell/ViewMenu';
import { setDragging as setDraggedView, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { UsageLimitsCard } from '@/shell/usage/UsageLimitsCard';
import { ConnectionDot } from '@/shell/ConnectionDot';
import { FolderMenuItems } from '@/shell/FolderMenuItems';
import { STRIP_PADDING_PX, useTrafficLightInset } from '@/desktop/useFullscreen';
import { Icon } from '@/ui/Icon';
import { MenuPopup } from '@/ui/MenuPopup';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useSettings } from '@/state/settings';
import { useProject } from '@/state/project';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { useServers } from '@/state/server';
import { useSidebarGroups } from './sidebar-groups';
import { useSidebarProjects } from './sidebar-projects';
import { openSidebarTarget } from './sidebar-navigation';
import { buildCombinedSidebar, type SidebarRow, type SidebarGroup } from './sidebar-rows';
import { useUnsavedStoredPath } from '@/shell/panels/use-unsaved';

/* How wide the list is when it is open. The inner column keeps this width while the wrapper
   animates to zero, so nothing reflows on the way out. */
export const SIDEBAR_WIDTH_PX = 248;

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

const ROW = `${INSET_ROW} w-full gap-2 text-left text-sm`;
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

/* The whole text of a row that truncates it, on hover; a row with nothing more to say has no tooltip. */
function MaybeTooltip({ label, children }: { label: string | null | undefined; children: ReactElement<Record<string, unknown>> }) {
    if (!label) {
        return children;
    }
    return (
        <Tooltip label={label} side="right">
            {children}
        </Tooltip>
    );
}

function RenameField({ value, onDone }: { value: string; onDone(next: string | null): void }) {
    return (
        <input
            autoFocus
            defaultValue={value}
            maxLength={MAX_TITLE_LENGTH}
            className="field field-sm min-w-0 grow text-sm"
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

/* What a "Needs you" row keeps at its right edge, and gives up to the snooze while the pointer is on it. */
const SNOOZE_MARKS = 'flex shrink-0 items-center gap-2 group-hover/snooze:invisible group-has-[[data-popup-open]]/snooze:invisible';

/* A "Needs you" row with the snooze in its corner, out of the Tab order since the list is one stop; the context menu has the same choices. */
function SnoozableRow({ endpointId, nodeId, children }: { endpointId: string; nodeId: string; children: ReactNode }) {
    return (
        <div className="group/snooze relative">
            {children}
            <span className="absolute inset-y-0 right-1 flex items-center opacity-0 group-hover/snooze:opacity-100 has-[[data-popup-open]]:opacity-100">
                <SnoozeButton endpointId={endpointId} nodeId={nodeId} tabIndex={-1} />
            </span>
        </div>
    );
}

function NodeRow({ row, tabbable, onFocus, onArrow, snoozable }: RowProps & { row: SidebarNodeRow; snoozable: boolean }) {
    const { t } = useTranslation('shell');
    const { node } = row;
    const currentEndpointId = useEndpointId();
    const endpointId = row.target?.endpointId ?? currentEndpointId;
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
                            renameNodeAction(row.viewId, node.id, next);
                        } else {
                            resetTitle(node.id, row.viewId);
                        }
                        setRenaming(false);
                    }}
                />
            </div>
        );
    }
    const menu = (
        <ContextMenu.Root>
            <MaybeTooltip label={row.location}>
                <ContextMenu.Trigger
                    render={<button />}
                    data-sidebar-row={row.rowId}
                    aria-current={selected ? 'true' : undefined}
                    tabIndex={tabbable ? 0 : -1}
                    className={clsx(ROW, row.viewName === null && 'pl-6', row.location && 'h-auto min-h-10', selected ? ROW_SELECTED : ROW_PLAIN)}
                    onFocus={onFocus}
                    onClick={() => (row.target ? void openSidebarTarget(row.target) : revealNode(node.id))}
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
                    <span className="min-w-0 truncate">
                        <span className="block truncate">{node.kind === 'browser' ? title : node.title}</span>
                        {row.location && <span className="block truncate text-xs text-text-faint">{row.location}</span>}
                    </span>
                    {!row.location && row.viewName && <span className="min-w-0 shrink truncate text-xs text-text-faint">{row.viewName}</span>}
                    <span className="grow" />
                    <span className={SNOOZE_MARKS}>
                        {node.draft && (
                            <Tooltip label={t('sidebar.unsentDraft')}>
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" />
                            </Tooltip>
                        )}
                        {node.task && <TaskMark task={node.task} />}
                        {node.finished && <UnseenMark />}
                        {node.alert && <ProcessWarningMark />}
                        {node.snoozedUntil && <SnoozedMark until={node.snoozedUntil} />}
                        {node.status && <StatusDot status={node.status} plain />}
                    </span>
                </ContextMenu.Trigger>
            </MaybeTooltip>
            <NodeMenuPopup
                id={node.id}
                onRename={() => setRenaming(true)}
                snooze={
                    node.status === 'needs-you' || node.snoozedUntil ? (
                        <SnoozeMenuItems endpointId={endpointId} nodeId={node.id} needsYou={node.status === 'needs-you'} />
                    ) : undefined
                }
            />
        </ContextMenu.Root>
    );
    return snoozable ? (
        <SnoozableRow endpointId={endpointId} nodeId={node.id}>
            {menu}
        </SnoozableRow>
    ) : (
        menu
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
 *
 * With a heading right under it the line keeps its distance from the group above and gives up the
 * room below, so the two read as one thing: a rule that closes a group and the heading that opens
 * the next. That is the line at the bottom of a shorter row rather than in the middle of a tall one.
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
                className={clsx('focus-ring flex w-full cursor-default', row.headingBelow ? 'h-4 items-end' : 'h-6 items-center')}
                onFocus={onFocus}
                onDragStart={(event) => onDrag(view.id, event.dataTransfer)}
                onDragEnd={() => onDrag(null)}
                onKeyDown={(e) => arrowStep(e, onArrow)}
            >
                {/* Edge to edge: the negative margin takes back the padding of the list around it,
                    the way the line in a menu takes back the padding of its popup. */}
                <span className="-mx-2 h-px grow bg-border-soft" />
            </ContextMenu.Trigger>
            <DeleteRowMenu onDelete={onDelete} />
        </ContextMenu.Root>
    );
}

/*
 * A heading over the rows under it, and nothing else: it never opens and holds no node, so all it
 * offers is its own text. That text starts where the marks of the view rows start, so the list
 * reads as one column of names under one column of headings; the row is as tall as a view row, so
 * a drag lands between the same gaps everywhere. A new heading opens in the field straight away.
 */
function SubheaderRow({ row, tabbable, onFocus, onArrow, onDelete, onDrag }: Omit<ViewRowProps, 'onToggle'>) {
    const { t } = useTranslation(['shell', 'common']);
    const { view } = row;
    const renaming = useUi((state) => state.renamingViewId) === view.id;
    const rename = (on: boolean): void => useUi.getState().setRenamingViewId(on ? view.id : null);
    if (renaming) {
        return (
            <div className="flex h-8 w-full items-center px-2">
                <RenameField
                    value={view.name}
                    onDone={(next) => {
                        // An empty field is not a heading, so the one it had stands.
                        if (next) {
                            renameViewAction(view.id, next);
                        }
                        rename(false);
                    }}
                />
            </div>
        );
    }
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                draggable
                role="heading"
                aria-level={3}
                data-sidebar-row={row.rowId}
                data-view-index={row.index}
                tabIndex={tabbable ? 0 : -1}
                className={clsx(SECTION_LABEL, 'focus-ring flex h-8 w-full cursor-default items-center px-2')}
                onFocus={onFocus}
                onDoubleClick={() => rename(true)}
                onDragStart={(event) => onDrag(view.id, event.dataTransfer)}
                onDragEnd={() => onDrag(null)}
                onKeyDown={(e) => {
                    arrowStep(e, onArrow);
                    if (e.key === 'F2') {
                        e.preventDefault();
                        rename(true);
                    }
                }}
            >
                <span className="min-w-0 truncate">{view.name}</span>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-(--z-popup)">
                    <ContextMenu.Popup className="menu-popup">
                        <ContextMenu.Item className="menu-item" onClick={() => rename(true)}>
                            <Icon icon={Pencil} size={14} /> {t('common:action.rename')} <span className={MENU_HINT}>{t('sidebar.doubleClick')}</span>
                        </ContextMenu.Item>
                        <ContextMenu.Item className="menu-item text-status-error" onClick={onDelete}>
                            <Icon icon={Trash} size={14} /> {t('common:action.delete')}
                        </ContextMenu.Item>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
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
                className={clsx(ROW, 'focus-ring cursor-default font-medium text-text-faint')}
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
    const endpointId = useEndpointId();
    const title = useBrowserDisplayTitle(view.id, view.name, view.titleSource);
    const unsaved = useUnsavedStoredPath(view.kind === 'file' ? view.path : null, row.target);
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
                onClick={() => (row.target ? void openSidebarTarget(row.target) : showView(view.id))}
                onDoubleClick={() => setRenaming(true)}
                onDragStart={(event) => onDrag(view.id, event.dataTransfer)}
                onDragEnd={() => onDrag(null)}
                onKeyDown={(e) => {
                    arrowStep(e, onArrow);
                    if (e.key === 'F2') {
                        // A double click still renames the row in place; the key goes to the dialog,
                        // where the name and the mark sit together.
                        e.preventDefault();
                        askViewSettings(view.id);
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
                {/* Color alone would say nothing to a screen reader, and a view standing in another
                    cell is not the same as one that is closed. */}
                {row.beside && <span className="sr-only">{t('sidebar.openInAnotherCell')}</span>}
                <span className="grow" />
                <FlagMark color={view.flag} />
                {row.draft && (
                    <Tooltip label={t('sidebar.unsentDraft')}>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" />
                    </Tooltip>
                )}
                {unsaved && (
                    <Tooltip label={t('sidebar.unsavedFile')}>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" />
                    </Tooltip>
                )}
                {(view.self ? view.self.alert : view.nodes.some((node) => node.alert)) && <ProcessWarningMark />}
                {view.self?.snoozedUntil && <SnoozedMark until={view.self.snoozedUntil} />}
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
                        {view.self && <SnoozeMenuItems endpointId={endpointId} nodeId={view.self.id} needsYou={view.self.status === 'needs-you'} />}
                        <ViewMenuItems viewId={view.id} kind={view.kind} onSidebar />
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}

function ProjectHeading({ group, tabbable, onFocus, onArrow }: RowProps & { group: SidebarGroup }) {
    const { t } = useTranslation('shell');
    const machineIcon = useServers((state) => state.byEndpoint[group.endpointId]?.icon ?? null);
    const collapse = (value: boolean) => useSidebarProjects.getState().collapse(group.key, value);
    const count = group.project.views.flatMap((view) => [...view.nodes, ...(view.self ? [view.self] : [])]).filter(waitsOnYou).length;
    return (
        <ContextMenu.Root>
            <MaybeTooltip label={`${group.summary.name} · ${group.machineLabel}`}>
                <ContextMenu.Trigger
                    render={<button type="button" />}
                    data-sidebar-row={`project:${group.key}`}
                    tabIndex={tabbable ? 0 : -1}
                    aria-expanded={!group.collapsed}
                    aria-label={`${group.summary.name} · ${group.machineLabel}${group.active ? ` · ${t('sidebar.activeProject')}` : ''}`}
                    onFocus={onFocus}
                    onClick={() => collapse(!group.collapsed)}
                    onKeyDown={(event) => {
                        arrowStep(event, onArrow);
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                            event.preventDefault();
                            collapse(event.key === 'ArrowLeft');
                        }
                    }}
                    className={clsx(ROW, 'group font-medium text-text hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent')}
                >
                    <span className={clsx(ICON_SLOT, group.active && 'text-accent')}>
                        <ProjectGlyph
                            projectId={group.summary.projectId}
                            endpointId={group.endpointId}
                            icon={group.summary.icon}
                            size={14}
                            color={group.active ? 'var(--accent)' : group.summary.color}
                            className="col-start-1 row-start-1 group-hover:hidden group-focus-visible:hidden"
                        />
                        <Icon
                            icon={ChevronRight}
                            size={14}
                            className={clsx('col-start-1 row-start-1 hidden group-hover:block group-focus-visible:block', !group.collapsed && 'rotate-90')}
                        />
                    </span>
                    <span className="min-w-0 grow truncate">{group.summary.name}</span>
                    <Tooltip label={group.machineLabel}>
                        <span className="grid h-8 w-6 shrink-0 place-items-center text-text-faint" aria-label={group.machineLabel}>
                            <MachineGlyph icon={machineIcon} size={14} />
                        </span>
                    </Tooltip>
                    {group.state === 'ready' && count > 0 && (
                        <span className="tabular-nums text-status-needs-you" aria-label={t('sidebar.waitingCount', { count })}>
                            {count}
                        </span>
                    )}
                </ContextMenu.Trigger>
            </MaybeTooltip>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-(--z-popup)">
                    <ContextMenu.Popup className="menu-popup">
                        <FolderMenuItems endpointId={group.endpointId} folder={group.summary.folder} connected={group.state !== 'offline'} />
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}

function BackgroundRow({ row, group, tabbable, onFocus, onArrow, snoozable }: RowProps & { row: SidebarRow; group: SidebarGroup; snoozable: boolean }) {
    const { t } = useTranslation('shell');
    const view = row.type === 'view' ? row.view : null;
    const item = row.type === 'node' ? row.node : null;
    const inert = view?.kind === 'separator' || view?.kind === 'subheader' || view?.kind === 'unknown' || !group.summary.available;
    const toggle = () => {
        if (row.type === 'view') {
            useSidebarProjects.getState().expandView(group.key, row.view.id, !row.expanded);
        }
    };
    const label = view?.name ?? item?.title ?? '';
    const status = row.type === 'view' ? row.status : row.node.status;
    const button = (
        <MaybeTooltip label={row.type === 'node' ? row.location : label}>
            <button
                type="button"
                data-sidebar-row={row.rowId}
                tabIndex={tabbable ? 0 : -1}
                aria-disabled={inert || undefined}
                aria-expanded={row.type === 'view' && row.expandable ? row.expanded : undefined}
                onFocus={onFocus}
                onClick={() => {
                    if (!inert && row.target) {
                        void openSidebarTarget(row.target);
                    }
                }}
                onKeyDown={(event) => {
                    arrowStep(event, onArrow);
                    if (row.type === 'view' && row.expandable && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                        event.preventDefault();
                        if (row.expanded !== (event.key === 'ArrowRight')) {
                            toggle();
                        }
                    }
                }}
                className={clsx(
                    ROW,
                    'focus-visible:outline-2 focus-visible:outline-accent',
                    inert ? 'cursor-default text-text-faint' : ROW_PLAIN,
                    row.type === 'node' && row.viewName === null && 'pl-6',
                    row.type === 'node' && row.location && 'h-auto min-h-10'
                )}
            >
                {view?.kind === 'separator' ? (
                    <span className="h-px w-full bg-border" />
                ) : (
                    <>
                        <span
                            className={ICON_SLOT}
                            onClick={(event) => {
                                if (row.type === 'view' && row.expandable) {
                                    event.stopPropagation();
                                    toggle();
                                }
                            }}
                        >
                            {row.type === 'view' && row.expandable ? (
                                <Icon icon={ChevronRight} size={14} className={clsx(row.expanded && 'rotate-90')} />
                            ) : view ? (
                                view.kind === 'browser' && !view.icon ? (
                                    <Icon icon={Globe} size={14} />
                                ) : (
                                    <ViewGlyph id={view.id} kind={view.kind} icon={view.icon} provider={view.provider} path={view.path} />
                                )
                            ) : item?.kind === 'browser' ? (
                                <Icon icon={Globe} size={14} />
                            ) : item ? (
                                <RowIcon id={item.id} kind={item.kind} provider={item.provider} />
                            ) : null}
                        </span>
                        <span className="min-w-0 grow">
                            <span className="block truncate">{label || t('sidebar.noViews')}</span>
                            {row.type === 'node' && row.location && <span className="block truncate text-xs text-text-faint">{row.location}</span>}
                        </span>
                        <span className={SNOOZE_MARKS}>
                            {status && group.state === 'ready' && <StatusDot status={status} plain />}
                            {view?.shared && <Icon icon={Users} size={12} className="shrink-0 text-text-faint" />}
                        </span>
                    </>
                )}
            </button>
        </MaybeTooltip>
    );
    return snoozable && item ? (
        <SnoozableRow endpointId={group.endpointId} nodeId={item.id}>
            {button}
        </SnoozableRow>
    ) : (
        button
    );
}

export function Sidebar() {
    const { t } = useTranslation('shell');
    const source = useSidebarSource();
    const combined = useSettings((s) => s.sidebarScope === 'all-open');
    const currentProject = useProject((s) => s.current);
    const shared = useDocument(useShallow((state) => state.shared));
    const flags = useDocument((state) => state.flags);
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const drafts = useDrafts((s) => s.ids);
    const warnings = useProcessWarnings((s) => s.byEndpoint);
    const unseen = useAttention((s) => s.unseen);
    const tasks = useTasks((s) => s.byEndpoint);
    const snoozes = useSnoozes((s) => s.byKey);
    const open = useUi((s) => s.sidebarOpen);
    const expanded = useUi(useShallow((s) => s.sidebarExpanded));
    const instant = useInstantWidth();
    const inset = useTrafficLightInset();
    const listRef = useRef<HTMLDivElement>(null);
    const listHadFocus = useRef(false);
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
                const canvas = source.canvases[view.id];
                const live = isCanvasView(view) ? (canvas ?? view.nodes) : [];
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
                    task: childTask(tasks[endpointId], node.id),
                    snoozedUntil: snoozeOf(snoozes, endpointId, node.id)
                });
                const provider = view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : undefined;
                return {
                    id: view.id,
                    name: view.name ?? '',
                    titleSource: 'titleSource' in view ? view.titleSource : undefined,
                    kind: view.kind,
                    shared: shared.includes(view.id),
                    flag: flags[view.id],
                    icon: viewIconOf(view),
                    provider: provider ?? null,
                    path: view.kind === 'file' ? view.path : null,
                    nodes: live.filter((node) => isSessionKind(node.kind)).map(asRow),
                    // Only a session view is a node of its own; a divider and a drawing have no status.
                    self: isSessionView(view) ? asRow({ id: view.id, kind: view.kind, title: view.name, titleSource: view.titleSource, provider }) : null
                };
            })
        }),
        [source, shared, flags, endpointId, sessions, chats, drafts, warnings, unseen, tasks, snoozes]
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
    const { groups, incomplete } = useSidebarGroups(combined, project, expandedIds);
    const sections = combined ? buildCombinedSidebar(groups) : buildSidebar({ project, expandedIds });
    const rows = rowOrder(sections);
    const roving = rovingId !== null && rows.includes(rovingId) ? rovingId : (rows[0] ?? null);
    const empty = !combined && project.views.length === 0;
    useEffect(() => {
        if (rovingId !== null && !rows.includes(rovingId) && roving !== null && listHadFocus.current && document.activeElement === document.body) {
            listRef.current?.querySelector<HTMLElement>(`[data-sidebar-row="${CSS.escape(roving)}"]`)?.focus();
        }
    }, [rows, rovingId, roving]);

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
            const others = useDocument.getState().views.filter((view) => view.id !== id);
            void moveViewAction(id, to === 0 ? null : others[to - 1]!.id);
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
        const { views } = useDocument.getState();
        const after = index === 0 ? null : (views[Math.min(index, views.length) - 1]?.id ?? null);
        void newFileViewsAfter(paths, after);
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
                    {IS_STATION ? <StationMenu variant="wordmark" /> : <Brand className="pointer-events-none" />}
                    <SidebarToggle />
                </div>

                <div
                    ref={listRef}
                    className="mt-2 min-h-0 grow overflow-auto px-2"
                    onFocusCapture={() => {
                        listHadFocus.current = true;
                    }}
                    onBlurCapture={(event) => {
                        listHadFocus.current = event.currentTarget.contains(event.relatedTarget as Node | null);
                    }}
                >
                    {combined && incomplete.length > 0 && (
                        <div className="mb-3 px-2 text-xs text-text-muted" role="status">
                            <p>{t('sidebar.incomplete')}</p>
                            {incomplete.map(({ label, state }) => (
                                <p key={label}>
                                    {label}: {t(`sidebar.source.${state}`)}
                                </p>
                            ))}
                        </div>
                    )}
                    {empty ? (
                        <p className="px-2 py-4 text-center text-xs text-text-muted">{t('sidebar.noViews')}</p>
                    ) : (
                        sections.map((section, sectionIndex) => {
                            // Only the list of views takes a drop, and only the one the row came out of; the
                            // nodes under a canvas are not places a view can go.
                            const reorderable =
                                section.kind === 'views' &&
                                dragging?.sectionId === section.id &&
                                (!section.group || (section.group.active && !section.group.collapsed));
                            /* A file out of the files panel or off a preview tab lands here as a view
                               of its own; the waiting list is not a place in any project's file. */
                            const takesDrop = section.kind === 'views' && (!section.group || (section.group.active && !section.group.collapsed));
                            return (
                                <div
                                    key={section.id}
                                    className={clsx('flex flex-col gap-px', section.group ? 'mb-px' : 'mb-3')}
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
                                            : (e) => {
                                                  e.preventDefault();
                                                  e.dataTransfer.dropEffect = 'none';
                                              }
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
                                            : (e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                              }
                                    }
                                >
                                    {section.group && sections[sectionIndex - 1]?.group && (
                                        <div role="separator" className="my-1 h-px shrink-0 bg-border-soft" />
                                    )}
                                    {section.group && (
                                        <ProjectHeading
                                            group={section.group}
                                            tabbable={roving === `project:${section.id}`}
                                            onFocus={() => setRovingId(`project:${section.id}`)}
                                            onArrow={moveFocus}
                                        />
                                    )}
                                    {section.group && !section.group.collapsed && (section.group.state !== 'ready' || section.rows.length === 0) && (
                                        <p className="px-2 py-1 text-xs text-text-faint">
                                            {section.group.state === 'ready' ? t('sidebar.noViews') : t(`sidebar.source.${section.group.state}`)}
                                        </p>
                                    )}
                                    {section.label !== null && (
                                        <div className={`${SECTION_LABEL} flex items-center gap-1.5 px-2 py-1`}>
                                            {section.kind === 'needs-you' && <StatusDot status="needs-you" plain />}
                                            {section.label}
                                            <span className="ml-auto tabular-nums">{section.rows.length}</span>
                                        </div>
                                    )}
                                    {section.rows.map((row) => {
                                        const owner = row.target
                                            ? groups.find(
                                                  (group) => group.endpointId === row.target!.endpointId && group.summary.projectId === row.target!.projectId
                                              )
                                            : undefined;
                                        if (owner && !owner.active) {
                                            return (
                                                <BackgroundRow
                                                    key={row.rowId}
                                                    row={row}
                                                    group={owner}
                                                    snoozable={section.kind === 'needs-you'}
                                                    tabbable={row.rowId === roving}
                                                    onFocus={() => setRovingId(row.rowId)}
                                                    onArrow={moveFocus}
                                                />
                                            );
                                        }
                                        if (row.type === 'node') {
                                            return (
                                                <NodeRow
                                                    key={row.rowId}
                                                    row={row}
                                                    snoozable={section.kind === 'needs-you'}
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
                                                ) : row.view.kind === 'subheader' ? (
                                                    <SubheaderRow {...shared} />
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
                        <MaybeTooltip label={combined ? t('sidebar.newViewIn', { project: currentProject?.name }) : null}>
                            <Menu.Trigger className="flex h-8 grow items-center gap-2 rounded-md px-2 text-sm text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50 disabled:hover:bg-transparent data-[popup-open]:bg-surface-active">
                                <Icon icon={Plus} size={14} /> {t('viewMenu.newView')}
                            </Menu.Trigger>
                        </MaybeTooltip>
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
