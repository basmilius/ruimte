import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChartNoAxesColumn, Plus, Settings } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { usePanelGap } from '@/shell/panel-layout';
import { isSessionView, isUnlistedView, sessionKindOfView, type AgentKind } from '@ruimte/contracts';
import { useShallow } from 'zustand/react/shallow';
import { moveViewAction } from '@/actions/client-actions';
import { useDrafts } from '@adecore/agents-react/chat';
import { nodeWork } from '@/state/agent-work';
import { isUnseen, useAttention } from '@/state/attention';
import { useProcessWarnings } from '@/state/processes';
import { carriesFiles, carriesPaths, dropEffectFor, droppedPaths } from '@/canvas/drop';
import { finderPaths } from '@/canvas/finder-drop';
import { askDeleteView, newFileViewsAfter, promoteLooseDatabase, promoteLooseFile, revealNode } from '@/project/views';
import { addArtifactToSidebar, carriesArtifact, droppedArtifact } from '@/output/artifact-drag';
import { useChats } from '@adecore/agents-react/state';
import { useDocument } from '@/state/document';
import { isDatabaseTab, isPromotableTab, useFiles } from '@/state/files';
import { nodeProvider, nodeStatus, useSessions, type StatusOf } from '@/state/sessions';
import { useUi } from '@/state/ui';
import { useEndpointId, endpointOfNodeIn } from '@/state/keys';
import { useEndpoints } from '@/state/endpoints';
import { snoozeOf, useSnoozes } from '@/state/snooze';
import { useWaitingSince, waitDetailsOf } from '@/state/waiting';
import {
    buildCombinedSidebar,
    buildSidebar,
    buildSidebarEverywhere,
    gapIndex,
    isSessionKind,
    rowAfterArrow,
    rowOrder,
    type SidebarGroup,
    type SidebarNode,
    type SidebarProject,
    type SidebarRow,
    type SidebarSection
} from '@/shell/sidebar-rows';
import { useSidebarSource } from '@/shell/sidebar-source';
import { viewGlyphOf } from '@/shell/cell-view';
import { childTask, useTasks } from '@/state/tasks';
import { StatusDot } from '@/canvas/NodeFrame';
import { Brand } from '@/ui/Brand';
import { Icon, IconButton, Menu, SectionLabel } from '@adecore/ui';
import { hasLogoMenu } from '@/desktop/bridge';
import { SidebarToggle } from '@/shell/SidebarToggle';
import { StationMenu } from '@/shell/menu/StationMenu';
import { IS_STATION } from '@/station';
import { draggedViewId, dragging as draggedView, draggingWholeCell, PROJECT_DRAG_TYPE, setDragging as setDraggedView, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { UsageLimitsCard } from '@adecore/agents-react/usage';
import { ConnectionDot } from '@/shell/ConnectionDot';
import { useTrafficLightInset } from '@/desktop/useFullscreen';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useSettings } from '@/state/settings';
import { isScratchProject, useProject } from '@/state/project';
import { newChat } from '@/project/new-chat';
import { NewViewItems } from '@/shell/NewViewMenu';
import { useSidebarGroups } from './sidebar-groups';
import { openSidebarTarget } from './sidebar-navigation';
import { NeedsYouCard } from './NeedsYouCard';
import {
    BackgroundRow,
    NewViewRow,
    NodeRow,
    ProjectHeading,
    ProjectSeparatorRow,
    SeparatorRow,
    SubheaderRow,
    UnknownViewRow,
    ViewRow
} from '@/shell/SidebarListRows';
import { useProjectMenu } from '@/shell/project-menu-model';
import { foldedProjects, movableKeys, separatorKey, useSidebarProjects, type SeparatorPlaces, type SidebarSeparator } from '@/shell/sidebar-projects';
import { SIDEBAR_WIDTH_PX, SidebarGlow } from '@/shell/SidebarGlow';

const NO_SEPARATORS: SeparatorPlaces = { before: {}, trailing: [] };

const FOOTER_BUTTON =
    'flex h-8 grow items-center gap-2 rounded-md px-2 text-sm text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent';

/* Where a dragged row would land. It sits in the gap, so the rows around it do not move while
   the pointer travels. */
const INSERT_LINE = 'pointer-events-none -my-px h-0.5 shrink-0 rounded-full bg-accent';

/* Without traffic lights the 18px logo centers on the 16px row icons below it (8px list padding plus
   8px row padding), which also lines the wordmark up with the row labels. */
const BRAND_PADDING_PX = 15;

function insertionIndex(list: HTMLElement, clientY: number, viewCount: number): number {
    const rows = [...list.querySelectorAll<HTMLElement>('[data-view-index]')].map((row) => {
        const rect = row.getBoundingClientRect();
        return { index: Number(row.dataset.viewIndex), middle: rect.top + rect.height / 2 };
    });
    return gapIndex(rows, clientY, viewCount);
}

/* The plus under each open project of "All open projects"; with one project the footer has it. */
function newViewIn(section: SidebarSection): boolean {
    return section.kind === 'views' && section.group !== undefined && !section.group.collapsed && section.group.state === 'ready';
}

/* Every row the arrows walk, the separators and the plus rows among them. */
function sidebarRowOrder(sections: readonly SidebarSection[], separators: SeparatorPlaces, hidden: ReadonlySet<string>, empty: boolean): string[] {
    if (empty) {
        return [];
    }
    return [
        ...sections.flatMap((section) => [
            ...(section.group ? (separators.before[section.group.key] ?? []).map((separator) => separatorKey(separator.id)) : []),
            ...(section.group && hidden.has(section.group.key) ? [] : [...rowOrder([section]), ...(newViewIn(section) ? [`new-view:${section.id}`] : [])])
        ]),
        ...separators.trailing.map((separator) => separatorKey(separator.id))
    ];
}

export function Sidebar() {
    const gap = usePanelGap();
    const { t } = useTranslation('shell');
    const source = useSidebarSource();
    const combined = useSettings((s) => s.sidebarScope === 'all-open');
    const everywhere = useSettings((s) => s.needsYouAllProjects);
    const currentProject = useProject((s) => s.current);
    const shared = useDocument(useShallow((state) => state.shared));
    const flags = useDocument((state) => state.flags);
    const endpointId = useEndpointId();
    const endpoints = useEndpoints((s) => s.endpoints);
    const projectMenu = useProjectMenu();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const drafts = useDrafts((s) => s.ids);
    const warnings = useProcessWarnings((s) => s.byEndpoint);
    const unseen = useAttention((s) => s.unseen);
    const tasks = useTasks((s) => s.byEndpoint);
    const snoozes = useSnoozes((s) => s.byKey);
    const waitingSince = useWaitingSince((state) => state.byKey);
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
    /* The project heading being dragged, and the project it would land before or after. */
    const [projectDrag, setProjectDrag] = useState<string | null>(null);
    const [projectInsert, setProjectInsert] = useState<{ key: string; after: boolean } | null>(null);

    const project: SidebarProject = {
        activeViewId: source.activeViewId,
        openViewIds: source.openViewIds,
        views: source.views.map((view) => {
            const live = source.nodesOf(view);
            const asRow = (node: StatusOf & { title: string; titleSource?: SidebarNode['titleSource']; provider?: AgentKind }): SidebarNode => {
                // A node that runs on another machine is that machine's to report on.
                const machine = endpointOfNodeIn(endpoints, node, endpointId);
                return {
                    id: node.id,
                    title: node.title,
                    titleSource: node.titleSource,
                    kind: node.kind,
                    provider: nodeProvider(node, chats, endpointId) ?? null,
                    status: nodeStatus(node, sessions, chats, endpointId) ?? null,
                    wait: waitDetailsOf(node, sessions, chats, waitingSince, endpointId),
                    work: nodeWork(node, sessions, chats, endpointId),
                    draft: (node.kind === 'chat' || node.kind === 'design') && drafts.includes(node.id),
                    alert: (warnings[machine] ?? []).some((alert) => alert.nodeId === node.id),
                    finished: isUnseen(unseen, machine, node.id),
                    task: childTask(tasks[machine], node.id),
                    snoozedUntil: snoozeOf(snoozes, machine, node.id)
                };
            };
            const { icon, provider, path } = viewGlyphOf(view);
            return {
                id: view.id,
                name: view.name ?? '',
                titleSource: 'titleSource' in view ? view.titleSource : undefined,
                kind: view.kind,
                shared: shared.includes(view.id),
                flag: flags[view.id],
                icon,
                provider,
                path,
                nodes: live.filter((node) => isSessionKind(node.kind)).map(asRow),
                // Only a session view is a node of its own; a divider and a drawing have no status.
                self: isSessionView(view)
                    ? asRow({ id: view.id, kind: sessionKindOfView(view), title: view.name, titleSource: view.titleSource, provider: provider ?? undefined })
                    : null,
                hidden: isUnlistedView(view)
            };
        })
    };

    const activeViewId = project.activeViewId;
    const expandedIds = new Set(expanded ?? (activeViewId === null ? [] : [activeViewId]));

    /* The list seeds itself with the canvas that is up, once per project. From there the set is the
       person's own and lands in the project's local file, so no switch ever folds a canvas shut. */
    useEffect(() => {
        if (expanded === null && activeViewId !== null) {
            useUi.getState().setSidebarExpanded([activeViewId]);
        }
    }, [expanded, activeViewId]);
    const { groups, incomplete, separators: placed } = useSidebarGroups(combined || everywhere, project, expandedIds);
    const separators = combined ? placed : NO_SEPARATORS;
    /* The projects and separators a person can move, in the order they show; the Chats project leads and stays. */
    const movable = movableKeys(
        groups.filter((group) => group.summary.scratch !== true).map((group) => group.key),
        separators
    );
    const hidden = foldedProjects(movable, [...Object.values(separators.before).flat(), ...separators.trailing]);
    const sections = combined
        ? buildCombinedSidebar(groups)
        : everywhere
          ? buildSidebarEverywhere({ project, expandedIds }, groups)
          : buildSidebar({ project, expandedIds });
    const empty = !combined && project.views.every((view) => view.hidden);
    const rows = sidebarRowOrder(sections, separators, hidden, empty);
    const roving = rovingId !== null && rows.includes(rovingId) ? rovingId : (rows[0] ?? null);
    useEffect(() => {
        if (rovingId !== null && !rows.includes(rovingId) && roving !== null && listHadFocus.current && document.activeElement === document.body) {
            listRef.current?.querySelector<HTMLElement>(`[data-sidebar-row=${CSS.escape(roving)}]`)?.focus();
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
        if (transfer) {
            transfer.setData(VIEW_DRAG_TYPE, drag.viewId);
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
        const { views } = useDocument.getState();
        const after = index === 0 ? null : (views[Math.min(index, views.length) - 1]?.id ?? null);
        const artifact = droppedArtifact(transfer);
        if (artifact !== null) {
            void addArtifactToSidebar(artifact, after);
            return;
        }
        const loose = draggedViewId(transfer);
        // A loose file or table takes its place in the grid with it; anything else a person drags here is a file by its path.
        const tab = useFiles.getState().tabs.find((entry) => entry.key === loose);
        if (loose !== null && tab !== undefined && isPromotableTab(tab)) {
            void (isDatabaseTab(tab) ? promoteLooseDatabase(loose, after) : promoteLooseFile(loose, after));
            return;
        }
        // A drag out of the file manager is named by the shell of the machine the project runs on.
        const paths = carriesPaths(transfer.types) ? droppedPaths(transfer) : finderPaths(transfer, endpointId);
        if (paths.length === 0) {
            return;
        }
        void newFileViewsAfter(paths, after);
    };

    const onProjectDrag = (key: string | null, transfer?: DataTransfer): void => {
        setProjectDrag(key);
        setProjectInsert(null);
        if (key !== null && transfer) {
            transfer.setData(PROJECT_DRAG_TYPE, key);
            transfer.effectAllowed = 'move';
        }
    };

    /* Over the upper half of a project it lands before it, over the lower half after it. */
    const projectOver = (event: React.DragEvent<HTMLDivElement>, key: string): void => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const box = event.currentTarget.getBoundingClientRect();
        const after = event.clientY > box.top + box.height / 2;
        setProjectInsert((was) => (was?.key === key && was.after === after ? was : { key, after }));
    };

    const projectDrop = (key: string): void => {
        const dragged = projectDrag;
        const after = projectInsert?.key === key ? projectInsert.after : false;
        onProjectDrag(null);
        if (dragged === null || dragged === key) {
            return;
        }
        const others = movable.filter((one) => one !== dragged);
        useSidebarProjects.getState().move(movable, dragged, others.indexOf(key) + (after ? 1 : 0));
    };

    /* Move up and Move down in a project's menu, the way a drag moves it, for whoever works without a mouse. */
    const moveItems = (key: string): ReactNode => {
        const index = movable.indexOf(key);
        return (
            <>
                <Menu.Item disabled={index < 1} onClick={() => useSidebarProjects.getState().move(movable, key, index - 1)}>
                    <Icon icon={ArrowUp} size={14} /> {t('sidebar.moveUp')}
                </Menu.Item>
                <Menu.Item disabled={index === -1 || index === movable.length - 1} onClick={() => useSidebarProjects.getState().move(movable, key, index + 1)}>
                    <Icon icon={ArrowDown} size={14} /> {t('sidebar.moveDown')}
                </Menu.Item>
            </>
        );
    };

    const separatorRow = (separator: SidebarSeparator): ReactNode => {
        const key = separatorKey(separator.id);
        return (
            <div
                key={key}
                className="flex flex-col"
                onDragOver={(e) => {
                    if (e.dataTransfer.types.includes(PROJECT_DRAG_TYPE) && projectDrag !== null) {
                        projectOver(e, key);
                    }
                }}
                onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setProjectInsert((was) => (was?.key === key ? null : was));
                    }
                }}
                onDrop={(e) => {
                    if (e.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) {
                        e.preventDefault();
                        projectDrop(key);
                    }
                }}
            >
                {projectInsert?.key === key && !projectInsert.after && <div className={INSERT_LINE} />}
                <ProjectSeparatorRow
                    separator={separator}
                    moveItems={moveItems(key)}
                    onDrag={(transfer) => onProjectDrag(transfer === null ? null : key, transfer ?? undefined)}
                    tabbable={roving === key}
                />
                {projectInsert?.key === key && projectInsert.after && <div className={INSERT_LINE} />}
            </div>
        );
    };

    /* The group of another project a row stands for, which then draws as a background row. */
    const ownerOf = (row: SidebarRow): SidebarGroup | undefined => {
        const target = row.target;
        return target ? groups.find((group) => group.endpointId === target.endpointId && group.summary.projectId === target.projectId) : undefined;
    };

    const waitingRow = (row: SidebarRow): ReactNode => {
        if (row.type !== 'node') {
            return null;
        }
        const target = row.target;
        const owner = ownerOf(row);
        const common = { row, snoozable: true, tabbable: row.rowId === roving };
        return (
            <NeedsYouCard
                key={row.rowId}
                endpointId={target?.endpointId ?? endpointId}
                node={row.node}
                onOpen={() => (target ? void openSidebarTarget(target) : revealNode(row.node.id))}
            >
                {owner && !owner.active ? <BackgroundRow {...common} group={owner} /> : <NodeRow {...common} />}
            </NeedsYouCard>
        );
    };

    // The list owns navigation so status updates do not replace every row's handlers.
    const moveFocus = (delta: -1 | 1): void => {
        const next = rowAfterArrow(rows, roving, delta);
        if (next === null) {
            return;
        }
        setRovingId(next);
        listRef.current?.querySelector<HTMLElement>(`[data-sidebar-row=${CSS.escape(next)}]`)?.focus();
    };

    return (
        <aside
            id="app-sidebar"
            inert={!open}
            data-instant={instant ? '' : undefined}
            className="sliding-column h-full shrink-0 overflow-hidden"
            style={{ width: open ? SIDEBAR_WIDTH_PX + gap : 0 }}
        >
            <div
                className={clsx('relative isolate flex h-full flex-col bg-surface', gap === 0 && 'border-r border-border')}
                style={{ width: SIDEBAR_WIDTH_PX }}
            >
                <SidebarGlow />
                <div
                    className="app-drag relative flex h-12 shrink-0 items-center justify-between pr-2"
                    style={{ paddingLeft: inset === undefined ? BRAND_PADDING_PX : inset + 8 }}
                >
                    {IS_STATION || hasLogoMenu() ? <StationMenu variant="wordmark" /> : <Brand className="pointer-events-none" />}
                    <SidebarToggle />
                </div>

                <div
                    ref={listRef}
                    className="mt-2 min-h-0 grow overflow-auto px-2"
                    onFocusCapture={(event) => {
                        listHadFocus.current = true;
                        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-sidebar-row]');
                        if (row && event.currentTarget.contains(row)) {
                            setRovingId(row.dataset.sidebarRow!);
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.defaultPrevented || !(event.target as HTMLElement).closest('[data-sidebar-row]')) {
                            return;
                        }
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            moveFocus(event.key === 'ArrowDown' ? 1 : -1);
                        }
                    }}
                    onBlurCapture={(event) => {
                        listHadFocus.current = event.currentTarget.contains(event.relatedTarget as Node | null);
                    }}
                >
                    {(combined || everywhere) && incomplete.length > 0 && (
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
                        <p className="px-2 py-4 text-center text-xs text-text-muted">
                            {t(isScratchProject(currentProject) ? 'sidebar.noChats' : 'sidebar.noViews')}
                        </p>
                    ) : (
                        sections.map((section, sectionIndex) => {
                            /* A file out of the files panel or off a preview tab lands here as a view
                               of its own; the waiting list is not a place in any project's file. */
                            const takesDrop = section.kind === 'views' && (!section.group || (section.group.active && !section.group.collapsed));
                            // A reorder lands only in the list the row came out of.
                            const reorderable = takesDrop && dragging?.sectionId === section.id;
                            const group = section.group;
                            const movableGroup = group !== undefined && group.summary.scratch !== true ? group : null;
                            const viewDragOver: (e: React.DragEvent<HTMLDivElement>) => void = takesDrop
                                ? (e) => {
                                      // Only a file or a table promotes: a diff, a commit or a designer has no row to become, and a whole host is no tab.
                                      const loose = useFiles.getState().tabs.find((entry) => entry.key === draggedView());
                                      const temporary = isPromotableTab(loose) && !draggingWholeCell();
                                      if (
                                          !reorderable &&
                                          !temporary &&
                                          !carriesArtifact(e.dataTransfer) &&
                                          !carriesPaths(e.dataTransfer.types) &&
                                          !carriesFiles(e.dataTransfer.types)
                                      ) {
                                          return;
                                      }
                                      e.preventDefault();
                                      if (!reorderable) {
                                          e.dataTransfer.dropEffect = dropEffectFor(e.dataTransfer.effectAllowed);
                                      }
                                      setInsertAt(insertionIndex(e.currentTarget, e.clientY, section.viewCount));
                                  }
                                : (e) => {
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = 'none';
                                  };
                            const viewDragLeave: ((e: React.DragEvent<HTMLDivElement>) => void) | undefined = takesDrop
                                ? (e) => {
                                      // A drag from outside the list has no drag end here to clear the gap.
                                      if (!reorderable && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                          setInsertAt(null);
                                      }
                                  }
                                : undefined;
                            const viewDrop: (e: React.DragEvent<HTMLDivElement>) => void = takesDrop
                                ? (e) => {
                                      const index = insertionIndex(e.currentTarget, e.clientY, section.viewCount);
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
                                  };
                            const separatorsBefore = section.group ? (separators.before[section.group.key] ?? []) : [];
                            return (
                                <Fragment key={section.id}>
                                    {separatorsBefore.map(separatorRow)}
                                    {!(section.group && hidden.has(section.group.key)) && (
                                        <div
                                            className={clsx('flex flex-col gap-px', section.group ? 'mb-px' : 'mb-3')}
                                            onDragOver={(e) => {
                                                if (e.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) {
                                                    if (movableGroup !== null && projectDrag !== null) {
                                                        projectOver(e, movableGroup.key);
                                                    }
                                                    return;
                                                }
                                                viewDragOver(e);
                                            }}
                                            onDragLeave={(e) => {
                                                if (movableGroup !== null && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                                    setProjectInsert((was) => (was?.key === movableGroup.key ? null : was));
                                                }
                                                viewDragLeave?.(e);
                                            }}
                                            onDrop={(e) => {
                                                if (e.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) {
                                                    e.preventDefault();
                                                    if (movableGroup !== null) {
                                                        projectDrop(movableGroup.key);
                                                    }
                                                    return;
                                                }
                                                viewDrop(e);
                                            }}
                                        >
                                            {section.group && separatorsBefore.length === 0 && sections[sectionIndex - 1]?.group && (
                                                <div role="separator" className="my-1 h-px shrink-0 bg-border-soft" />
                                            )}
                                            {movableGroup !== null && projectInsert?.key === movableGroup.key && !projectInsert.after && (
                                                <div className={INSERT_LINE} />
                                            )}
                                            {section.group && (
                                                <ProjectHeading
                                                    group={section.group}
                                                    menu={(row) => projectMenu.actionsOf(row, movableGroup === null ? undefined : moveItems(movableGroup.key))}
                                                    onDrag={
                                                        movableGroup === null
                                                            ? undefined
                                                            : (transfer) => onProjectDrag(transfer === null ? null : movableGroup.key, transfer ?? undefined)
                                                    }
                                                    tabbable={roving === `project:${section.id}`}
                                                />
                                            )}
                                            {section.group && !section.group.collapsed && (section.group.state !== 'ready' || section.rows.length === 0) && (
                                                <p className="px-2 py-1 text-xs text-text-faint">
                                                    {section.group.state === 'ready' ? t('sidebar.noViews') : t(`sidebar.source.${section.group.state}`)}
                                                </p>
                                            )}
                                            {section.label !== null && (
                                                <SectionLabel render={<div />} className="flex items-center gap-1.5 px-2 py-1">
                                                    {section.kind === 'needs-you' && <StatusDot status="needs-you" plain />}
                                                    {section.label}
                                                    <span className="ml-auto tabular-nums">{section.rows.length}</span>
                                                </SectionLabel>
                                            )}
                                            {section.waiting
                                                ? section.waiting.map((part) => (
                                                      <Fragment key={part.key}>
                                                          {part.label !== null && (
                                                              <div className="truncate px-2 pt-2 pb-0.5 text-xs text-text-muted">{part.label}</div>
                                                          )}
                                                          {part.rows.map(waitingRow)}
                                                      </Fragment>
                                                  ))
                                                : section.rows.map((row) => {
                                                      const owner = ownerOf(row);
                                                      if (owner && !owner.active) {
                                                          return (
                                                              <BackgroundRow
                                                                  key={row.rowId}
                                                                  row={row}
                                                                  group={owner}
                                                                  snoozable={false}
                                                                  tabbable={row.rowId === roving}
                                                              />
                                                          );
                                                      }
                                                      if (row.type === 'node') {
                                                          return <NodeRow key={row.rowId} row={row} snoozable={false} tabbable={row.rowId === roving} />;
                                                      }
                                                      const shared = {
                                                          row,
                                                          tabbable: row.rowId === roving,
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
                                            {section.group && newViewIn(section) && (
                                                <>
                                                    {section.rows.length > 0 && <div role="separator" className="my-1 h-px shrink-0 bg-border-soft" />}
                                                    <NewViewRow
                                                        group={section.group}
                                                        rowId={`new-view:${section.id}`}
                                                        tabbable={roving === `new-view:${section.id}`}
                                                    />
                                                </>
                                            )}
                                            {movableGroup !== null && projectInsert?.key === movableGroup.key && projectInsert.after && (
                                                <div className={INSERT_LINE} />
                                            )}
                                        </div>
                                    )}
                                </Fragment>
                            );
                        })
                    )}
                    {!empty && separators.trailing.map(separatorRow)}
                </div>

                <div className="flex shrink-0 items-center justify-end gap-1 border-t border-border p-2">
                    {combined ? (
                        <button type="button" className={FOOTER_BUTTON} onClick={() => useSidebarProjects.getState().addSeparator(movable, movable.length)}>
                            <Icon icon={Plus} size={14} /> {t('sidebar.separator')}
                        </button>
                    ) : isScratchProject(currentProject) ? (
                        <button type="button" className={FOOTER_BUTTON} onClick={newChat}>
                            <Icon icon={Plus} size={14} /> {t('chats.newChat')}
                        </button>
                    ) : (
                        <Menu.Root>
                            <Menu.Trigger className={clsx(FOOTER_BUTTON, 'data-[popup-open]:bg-surface-active')}>
                                <Icon icon={Plus} size={14} /> {t('sidebar.newView')}
                            </Menu.Trigger>
                            <Menu.Popup side="top" className="min-w-52">
                                <NewViewItems />
                            </Menu.Popup>
                        </Menu.Root>
                    )}
                    <ConnectionDot />
                    <UsageLimitsCard>
                        <IconButton icon={ChartNoAxesColumn} label={t('sidebar.usage')} tooltip={false} onClick={() => useUi.getState().setUsageOpen(true)} />
                    </UsageLimitsCard>
                    <IconButton
                        icon={Settings}
                        label={t('settingsDialog.title')}
                        kbd={APP_SHORTCUTS.settings}
                        onClick={() => useUi.getState().setSettings({ open: true })}
                    />
                </div>
            </div>
            {projectMenu.dialogs}
        </aside>
    );
}
