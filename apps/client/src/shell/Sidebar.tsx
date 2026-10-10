import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChartNoAxesColumn, Plus, Settings } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { usePanelGap } from '@/shell/panel-layout';
import { isCanvasView, isSessionView, isUnlistedChatView, type AgentKind, viewIconOf } from '@ruimte/contracts';
import { useShallow } from 'zustand/react/shallow';
import { moveViewAction } from '@/actions/client-actions';
import { useDrafts } from '@adecore/agents-react/chat/drafts';
import { nodeWork } from '@/state/agent-work';
import { isUnseen, useAttention } from '@/state/attention';
import { useProcessWarnings } from '@/state/processes';
import { carriesFiles, carriesPaths, dropEffectFor, droppedPaths } from '@/canvas/drop';
import { finderPaths } from '@/canvas/finder-drop';
import { askDeleteView, newFileViewsAfter, promoteLooseDatabase, promoteLooseFile, revealNode } from '@/project/views';
import { useChats } from '@adecore/agents-react/state/chats';
import { useDocument } from '@/state/document';
import { isDatabaseTab, isPromotableTab, useFiles } from '@/state/files';
import { nodeStatus, useSessions, type StatusOf } from '@/state/sessions';
import { useUi } from '@/state/ui';
import { useEndpointId } from '@/state/keys';
import { snoozeOf, useSnoozes } from '@/state/snooze';
import { buildSidebar, gapIndex, isSessionKind, rowAfterArrow, rowOrder, type SidebarNode, type SidebarProject } from '@/shell/sidebar-rows';
import { useSidebarSource } from '@/shell/sidebar-source';
import { childTask, useTasks } from '@/state/tasks';
import { StatusDot } from '@/canvas/NodeFrame';
import { Brand } from '@/ui/Brand';
import { Icon, IconButton, Menu, SectionLabel } from '@adecore/ui';
import { SidebarToggle } from '@/shell/SidebarToggle';
import { StationMenu } from '@/shell/menu/StationMenu';
import { IS_STATION } from '@/station';
import { NewViewItems } from '@/shell/ViewMenu';
import { draggedViewId, dragging as draggedView, draggingWholeCell, setDragging as setDraggedView, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { UsageLimitsCard } from '@adecore/agents-react/usage/UsageLimitsCard';
import { ConnectionDot } from '@/shell/ConnectionDot';
import { STRIP_PADDING_PX, useTrafficLightInset } from '@/desktop/useFullscreen';
import { APP_SHORTCUTS } from '@/shell/shortcuts';
import { useSettings } from '@/state/settings';
import { isScratchProject, useProject } from '@/state/project';
import { newChat } from '@/project/new-chat';
import { useSidebarGroups } from './sidebar-groups';
import { openSidebarTarget } from './sidebar-navigation';
import { buildCombinedSidebar, buildSidebarEverywhere, type SidebarGroup, type SidebarRow } from './sidebar-rows';
import { NeedsYouCard } from './NeedsYouCard';
import { BackgroundRow, MaybeTooltip, NodeRow, ProjectHeading, SeparatorRow, SubheaderRow, UnknownViewRow, ViewRow } from '@/shell/SidebarListRows';

/* How wide the list is when it is open. The inner column keeps this width while the wrapper
   animates to zero, so nothing reflows on the way out. */
export const SIDEBAR_WIDTH_PX = 248;

const NEW_VIEW_BUTTON =
    'flex h-8 grow items-center gap-2 rounded-md px-2 text-sm text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50 disabled:hover:bg-transparent data-[popup-open]:bg-surface-active';

/* Where a dragged row would land. It sits in the gap, so the rows around it do not move while
   the pointer travels. */
const INSERT_LINE = 'pointer-events-none -my-px h-0.5 shrink-0 rounded-full bg-accent';

function insertionIndex(list: HTMLElement, clientY: number, viewCount: number): number {
    const rows = [...list.querySelectorAll<HTMLElement>('[data-view-index]')].map((row) => {
        const rect = row.getBoundingClientRect();
        return { index: Number(row.dataset.viewIndex), middle: rect.top + rect.height / 2 };
    });
    return gapIndex(rows, clientY, viewCount);
}

/* The diameters and strengths of the rings at the top of the sidebar. */
const GLOW_ORBITS = [
    { size: 130, alpha: 0.05 },
    { size: 230, alpha: 0.035 },
    { size: 340, alpha: 0.025 }
] as const;

/* A part centered on the middle of the sidebar's top edge, `size` pixels across. */
function atTop(size: number): CSSProperties {
    return { width: size, height: size, margin: `-${size / 2}px 0 0 -${size / 2}px` };
}

/* The eclipse's orbits rising over the top edge, the way the welcome and About draw it. */
function SidebarGlow() {
    return (
        <div aria-hidden className="sidebar-glow">
            <span className="sidebar-glow-light" style={atTop(240)} />
            {GLOW_ORBITS.map((orbit) => (
                <span key={orbit.size} className="sidebar-glow-orbit" style={{ ...atTop(orbit.size), '--sidebar-glow-alpha': orbit.alpha } as CSSProperties} />
            ))}
        </div>
    );
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
                    work: nodeWork(node, sessions, chats, endpointId),
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
                    self: isSessionView(view) ? asRow({ id: view.id, kind: view.kind, title: view.name, titleSource: view.titleSource, provider }) : null,
                    hidden: isUnlistedChatView(view)
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
    const { groups, incomplete } = useSidebarGroups(combined || everywhere, project, expandedIds);
    const sections = combined
        ? buildCombinedSidebar(groups)
        : everywhere
          ? buildSidebarEverywhere({ project, expandedIds }, groups)
          : buildSidebar({ project, expandedIds });
    const rows = rowOrder(sections);
    const roving = rovingId !== null && rows.includes(rovingId) ? rovingId : (rows[0] ?? null);
    const empty = !combined && project.views.every((view) => view.hidden);
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
        const { views } = useDocument.getState();
        const after = index === 0 ? null : (views[Math.min(index, views.length) - 1]?.id ?? null);
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
        const common = { row, snoozable: true, tabbable: row.rowId === roving, onFocus: () => setRovingId(row.rowId), onArrow: moveFocus };
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
                            return (
                                <div
                                    key={section.id}
                                    className={clsx('flex flex-col gap-px', section.group ? 'mb-px' : 'mb-3')}
                                    onDragOver={
                                        takesDrop
                                            ? (e) => {
                                                  // Only a file or a table promotes: a diff, a commit or a designer has no row to become, and a whole host is no tab.
                                                  const loose = useFiles.getState().tabs.find((entry) => entry.key === draggedView());
                                                  const temporary = isPromotableTab(loose) && !draggingWholeCell();
                                                  if (
                                                      !reorderable &&
                                                      !temporary &&
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
                                        <SectionLabel render={<div />} className="flex items-center gap-1.5 px-2 py-1">
                                            {section.kind === 'needs-you' && <StatusDot status="needs-you" plain />}
                                            {section.label}
                                            <span className="ml-auto tabular-nums">{section.rows.length}</span>
                                        </SectionLabel>
                                    )}
                                    {section.waiting
                                        ? section.waiting.map((part) => (
                                              <Fragment key={part.key}>
                                                  {part.label !== null && <div className="truncate px-2 pt-2 pb-0.5 text-xs text-text-muted">{part.label}</div>}
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
                                                          snoozable={false}
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
                    {/* The views of the Chats project are its chats, so its plus makes one; a canvas or a terminal
                        there still comes from the File menu and the palette. */}
                    {isScratchProject(currentProject) ? (
                        <button type="button" className={NEW_VIEW_BUTTON} onClick={newChat}>
                            <Icon icon={Plus} size={14} /> {t('chats.newChat')}
                        </button>
                    ) : (
                        <Menu.Root>
                            <MaybeTooltip label={combined ? t('sidebar.newViewIn', { project: currentProject?.name }) : null}>
                                <Menu.Trigger className={NEW_VIEW_BUTTON}>
                                    <Icon icon={Plus} size={14} /> {t('viewMenu.newView')}
                                </Menu.Trigger>
                            </MaybeTooltip>
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
        </aside>
    );
}
