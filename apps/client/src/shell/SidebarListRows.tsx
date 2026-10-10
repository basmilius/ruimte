import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import {
    AppWindow,
    ChevronRight,
    CircleQuestionMark,
    FileText,
    Globe,
    LayoutGrid,
    MessageSquare,
    PanelTop,
    Pencil,
    PenTool,
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
import type { AgentKind, AgentStatus, CanvasNodeKind } from '@ruimte/contracts';
import { renameNodeAction, renameViewAction } from '@/actions/client-actions';
import type { AgentWork } from '@/state/agent-work';
import { askViewSettings, revealNode, showView } from '@/project/views';
import { useCanvas } from '@/state/canvas';
import { ViewMenuItems } from '@/shell/ViewMenuItems';
import { useUi } from '@/state/ui';
import { useEndpointId } from '@/state/keys';
import { SnoozeButton, SnoozedMark, SnoozeMenuItems } from '@/shell/Snooze';
import { heaviestWork, waitsOnYou, type SidebarGroup, type SidebarNodeRow, type SidebarRow, type SidebarViewRow } from '@/shell/sidebar-rows';
import { AgentIcon } from '@adecore/agents-react/agents/AgentIcon';
import { UnseenMark } from '@/attention/UnseenMark';
import { WorkingMark } from '@/attention/WorkingMark';
import { TaskMark } from '@/tasks/TaskMark';
import { Favicon } from '@/browser/Favicon';
import { useBrowserDisplayTitle } from '@/browser/title';
import { resetTitle } from '@/nodes/node-host';
import { StatusDot } from '@/canvas/NodeFrame';
import { NodeMenuPopup } from '@/canvas/NodeMenu';
import { FlagMark } from '@/project/FlagMark';
import { ViewGlyph } from '@/project/ViewGlyph';
import { Tooltip, Icon, Input, ListRow, ContextMenu, SectionLabel } from '@adecore/ui';
import { wantsNewTab } from '@/shell/tab-drop';
import { isApplePlatform } from '@/desktop/bridge';
import { FolderMenuItems } from '@/shell/FolderMenuItems';
import { canOpenWindows, moveToNewWindow, openInNewWindow } from '@/project/windows';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { useServers } from '@/state/server';
import { useSidebarProjects } from '@/shell/sidebar-projects';
import { openSidebarTarget } from '@/shell/sidebar-navigation';
import { useUnsavedStoredPath } from '@/shell/panels/use-unsaved';

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

const ROW = 'w-full gap-2 text-left text-sm';

/* Every row opens with the same 16px square, so a view and a node under it line up one indent apart. */
const ICON_SLOT = 'grid size-4 shrink-0 place-items-center';
const ROW_SELECTED = 'bg-surface-active text-text';
/* Standing in a cell beside the focused one: the name at full strength, the background left empty,
   so it reads as open without claiming to be the row the keyboard is on. */
const ROW_BESIDE = 'text-text hover:bg-surface-hover';
const ROW_PLAIN = 'text-text-muted hover:bg-surface-hover hover:text-text';

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
export function MaybeTooltip({ label, children }: { label: string | null | undefined; children: ReactElement<Record<string, unknown>> }) {
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
        <Input
            autoFocus
            defaultValue={value}
            maxLength={MAX_TITLE_LENGTH}
            size="sm"
            className="min-w-0 grow text-sm"
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

/* A row at rest carries no dot. A green one on every idle chat read as news that never went away,
   while a turn that ended unseen has its own mark. */
function RowStatus({ status, work }: { status: AgentStatus | null | undefined; work: AgentWork | null | undefined }) {
    // Another project's rows cannot tell a working agent from a shell at its prompt, so they keep the dot.
    if ((status === 'running' || status === 'idle') && work !== undefined) {
        return work === null ? null : <WorkingMark plain delegating={work === 'delegating'} />;
    }
    return status && status !== 'idle' ? <StatusDot status={status} plain /> : null;
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

export function NodeRow({ row, tabbable, onFocus, onArrow, snoozable }: RowProps & { row: SidebarNodeRow; snoozable: boolean }) {
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
            <ListRow variant="inset" className={`${ROW} pl-6`}>
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
            </ListRow>
        );
    }
    const menu = (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<ListRow variant="inset" render={<button />} />}
                data-sidebar-row={row.rowId}
                aria-current={selected ? 'true' : undefined}
                tabIndex={tabbable ? 0 : -1}
                className={clsx(ROW, row.viewName === null && 'pl-6', selected ? ROW_SELECTED : ROW_PLAIN)}
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
                <span className="min-w-0 truncate">{node.kind === 'browser' ? title : node.title}</span>
                {row.viewName && <span className="min-w-0 shrink truncate text-xs text-text-faint">{row.viewName}</span>}
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
                    <RowStatus status={node.status} work={node.work} />
                </span>
            </ContextMenu.Trigger>
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
function arrowStep(event: ReactKeyboardEvent<HTMLElement>, onArrow: (delta: 1 | -1) => void): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        onArrow(event.key === 'ArrowDown' ? 1 : -1);
    }
}

/* All a row with nothing to open offers: a separator, and a view this version cannot draw. */
function DeleteRowMenu({ onDelete }: { onDelete(): void }) {
    const { t } = useTranslation('common');
    return (
        <ContextMenu.Popup>
            <ContextMenu.Item className="text-status-error" onClick={onDelete}>
                <Icon icon={Trash} size={14} /> {t('action.delete')}
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}

/*
 * A separator is a line, not a place: it never opens, but drags and reorders like any other row. With
 * a heading right under it the line sits at the bottom of a shorter row, so rule and heading read as one.
 */
export function SeparatorRow({ row, tabbable, onFocus, onArrow, onDelete, onDrag }: Omit<ViewRowProps, 'onToggle'>) {
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
 * A heading over the rows under it, which never opens. Its text starts where the marks of the view
 * rows start, and it is as tall as a view row, so a drag lands between the same gaps everywhere.
 */
export function SubheaderRow({ row, tabbable, onFocus, onArrow, onDelete, onDrag }: Omit<ViewRowProps, 'onToggle'>) {
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
                render={<SectionLabel render={<div />} />}
                draggable
                role="heading"
                aria-level={3}
                data-sidebar-row={row.rowId}
                data-view-index={row.index}
                tabIndex={tabbable ? 0 : -1}
                className="focus-ring flex h-8 w-full cursor-default items-center px-2"
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
            <ContextMenu.Popup>
                <ContextMenu.Item onClick={() => rename(true)}>
                    <Icon icon={Pencil} size={14} /> {t('common:action.rename')} <ContextMenu.Hint>{t('sidebar.doubleClick')}</ContextMenu.Hint>
                </ContextMenu.Item>
                <ContextMenu.Item className="text-status-error" onClick={onDelete}>
                    <Icon icon={Trash} size={14} /> {t('common:action.delete')}
                </ContextMenu.Item>
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

/*
 * A view a newer Ruimte made. It is listed so nobody wonders where it went and kept in the file as it
 * is, but this version has nothing to draw it with: it neither opens nor drags into a cell, and a
 * person may still delete it.
 */
export function UnknownViewRow({ row, tabbable, onFocus, onArrow, onDelete }: Omit<ViewRowProps, 'onToggle' | 'onDrag'>) {
    const { t } = useTranslation(['shell', 'common']);
    const { view } = row;
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<ListRow variant="inset" />}
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

export function ViewRow({ row, tabbable, onFocus, onArrow, onToggle, onDrag }: ViewRowProps) {
    const { t } = useTranslation(['shell', 'common']);
    const { view } = row;
    const endpointId = useEndpointId();
    const title = useBrowserDisplayTitle(view.id, view.name, view.titleSource);
    const unsaved = useUnsavedStoredPath(view.kind === 'file' ? view.path : null, row.target);
    const [renaming, setRenaming] = useState(false);
    if (renaming) {
        return (
            <ListRow variant="inset" className={ROW}>
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
            </ListRow>
        );
    }
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<ListRow variant="inset" render={<button />} />}
                draggable
                data-sidebar-row={row.rowId}
                data-view-index={row.index}
                aria-current={row.active ? 'true' : undefined}
                aria-expanded={row.expandable ? row.expanded : undefined}
                tabIndex={tabbable ? 0 : -1}
                className={clsx(ROW, 'group font-medium', row.active ? ROW_SELECTED : row.beside ? ROW_BESIDE : ROW_PLAIN)}
                onFocus={onFocus}
                onClick={(event) => (row.target ? void openSidebarTarget(row.target) : showView(view.id, { newTab: wantsNewTab(event, isApplePlatform()) }))}
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
                {/* The view's mark, swapped for the chevron under the pointer, so a folded row and an
                    open one read the same at rest. The padding grows the target to 24 pixels and the
                    negative margin gives the space back. */}
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
                {view.self?.finished && <UnseenMark />}
                {view.self?.snoozedUntil && <SnoozedMark until={view.self.snoozedUntil} />}
                <RowStatus status={row.status} work={view.self ? view.self.work : heaviestWork(view.nodes)} />
                {/* Last, after the dots that are the news. Only a shared row is marked, since a view is
                    private until someone says otherwise; never in the accent. */}
                {view.shared && (
                    <Tooltip label={t('sidebar.shared')}>
                        <Icon icon={Users} size={12} className="shrink-0 text-text-faint" />
                    </Tooltip>
                )}
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                {!row.target && (
                    <>
                        <ContextMenu.Item onClick={() => showView(view.id, { newTab: true })}>
                            <Icon icon={PanelTop} size={14} /> {t('viewMenu.openInNewTab')}
                        </ContextMenu.Item>
                        <ContextMenu.Separator />
                    </>
                )}
                {view.self && <SnoozeMenuItems endpointId={endpointId} nodeId={view.self.id} needsYou={view.self.status === 'needs-you'} />}
                <ViewMenuItems viewId={view.id} kind={view.kind} onSidebar />
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

export function ProjectHeading({ group, tabbable, onFocus, onArrow }: RowProps & { group: SidebarGroup }) {
    const { t } = useTranslation('shell');
    const machineIcon = useServers((state) => state.byEndpoint[group.endpointId]?.icon ?? null);
    const collapse = (value: boolean) => useSidebarProjects.getState().collapse(group.key, value);
    const count = group.project.views.flatMap((view) => [...view.nodes, ...(view.self ? [view.self] : [])]).filter(waitsOnYou).length;
    return (
        <ContextMenu.Root>
            <MaybeTooltip label={`${group.summary.name} · ${group.machineLabel}`}>
                <ContextMenu.Trigger
                    render={<ListRow variant="inset" render={<button type="button" />} />}
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
                            scratch={group.summary.scratch === true}
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
            <ContextMenu.Popup>
                {canOpenWindows() && (
                    <>
                        <ContextMenu.Item
                            disabled={!group.active && !group.summary.available}
                            onClick={() => (group.active ? void moveToNewWindow() : openInNewWindow(group.endpointId, group.summary.projectId))}
                        >
                            <Icon icon={AppWindow} size={14} /> {t(group.active ? 'projectMenu.moveToNewWindow' : 'projectMenu.openInNewWindow')}
                        </ContextMenu.Item>
                        <ContextMenu.Separator />
                    </>
                )}
                {group.summary.scratch !== true && (
                    <FolderMenuItems endpointId={group.endpointId} folder={group.summary.folder} connected={group.state !== 'offline'} />
                )}
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

export function BackgroundRow({ row, group, tabbable, onFocus, onArrow, snoozable }: RowProps & { row: SidebarRow; group: SidebarGroup; snoozable: boolean }) {
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
        <MaybeTooltip label={row.type === 'node' ? null : label}>
            <ListRow
                variant="inset"
                render={<button type="button" />}
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
                    row.type === 'node' && row.viewName === null && 'pl-6'
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
                        <span className="min-w-0 truncate">{label || t('sidebar.noViews')}</span>
                        {row.type === 'node' && row.viewName && <span className="min-w-0 shrink truncate text-xs text-text-faint">{row.viewName}</span>}
                        <span className="grow" />
                        <span className={SNOOZE_MARKS}>
                            {group.state === 'ready' && <RowStatus status={status} work={undefined} />}
                            {view?.shared && <Icon icon={Users} size={12} className="shrink-0 text-text-faint" />}
                        </span>
                    </>
                )}
            </ListRow>
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
