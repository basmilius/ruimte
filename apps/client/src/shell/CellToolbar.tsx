{!hosted && leads && !inSubagents && <Separator />}import { useEffect, useRef, useState, type ReactElement } from 'react';
{!hosted && leads && !inSubagents && <Separator />}import clsx from 'clsx';
{!hosted && leads && !inSubagents && <Separator />}import { useTranslation } from 'react-i18next';
{!hosted && leads && !inSubagents && <Separator />}import { Expand, MoreHorizontal, Ungroup } from 'lucide-react';
{!hosted && leads && !inSubagents && <Separator />}import { viewIconOf } from '@ruimte/contracts';
{!hosted && leads && !inSubagents && <Separator />}import { closeCellAction } from '@/actions/client-actions';
{!hosted && leads && !inSubagents && <Separator />}import { ViewGlyph } from '@/project/ViewGlyph';
{!hosted && leads && !inSubagents && <Separator />}import { isLooseView, type CellView } from '@/shell/cell-view';
{!hosted && leads && !inSubagents && <Separator />}import { FileToolbarSlotProvider } from '@/shell/panels/file-toolbar-slot';
{!hosted && leads && !inSubagents && <Separator />}import { FileMenuItems } from '@/shell/panels/FileMenuItems';
{!hosted && leads && !inSubagents && <Separator />}import { LooseGlyph } from '@/shell/panels/LooseGlyph';
{!hosted && leads && !inSubagents && <Separator />}import { TabStrip } from '@/shell/TabStrip';
{!hosted && leads && !inSubagents && <Separator />}import { SubagentTitleCrumb } from '@adecore/agents-react/chat/ui/SubagentControls';
{!hosted && leads && !inSubagents && <Separator />}import { SplitItems, ViewMenuItems } from '@/shell/ViewMenuItems';
{!hosted && leads && !inSubagents && <Separator />}import { ViewToolbar } from '@/shell/ViewToolbar';
{!hosted && leads && !inSubagents && <Separator />}import { useHasViewToolbar, useShowsSubagents, useViewToolbarLeads } from '@/shell/view-toolbar';
{!hosted && leads && !inSubagents && <Separator />}import { setDragging, VIEW_DRAG_TYPE } from '@/shell/view-drag';
{!hosted && leads && !inSubagents && <Separator />}import { useDocument } from '@/state/document';
{!hosted && leads && !inSubagents && <Separator />}import { cellAt, cellCount, type CellAt } from '@/shell/split';
{!hosted && leads && !inSubagents && <Separator />}import { CloseButton, Icon, IconButton, Menu, Separator, ContextMenu, Popover, Tooltip } from '@adecore/ui';
{!hosted && leads && !inSubagents && <Separator />}import { useBrowserDisplayTitle } from '@/browser/title';
{!hosted && leads && !inSubagents && <Separator />}
{!hosted && leads && !inSubagents && <Separator />}/* What the bar holds that is not the bar: a press on one of these is not the start of a drag. */
{!hosted && leads && !inSubagents && <Separator />}const CONTROLS = 'input, textarea, select, button, a, [contenteditable=""], [contenteditable="true"], [role="button"]';
{!hosted && leads && !inSubagents && <Separator />}
{!hosted && leads && !inSubagents && <Separator />}/* Without this margin, a bar right at the fold point would fold and unfold on every pixel of a splitter drag. */
{!hosted && leads && !inSubagents && <Separator />}const UNFOLD_MARGIN = 24;
{!hosted && leads && !inSubagents && <Separator />}
{!hosted && leads && !inSubagents && <Separator />}/*
{!hosted && leads && !inSubagents && <Separator />} * Whether the view's actions are folded into the overflow menu: only once the title has shrunk to
{!hosted && leads && !inSubagents && <Separator />} * its glyph and the actions still do not fit. The width where that happened is remembered, since a
{!hosted && leads && !inSubagents && <Separator />} * folded bar fits by definition and can no longer tell by overflowing when there is room again.
{!hosted && leads && !inSubagents && <Separator />} */
{!hosted && leads && !inSubagents && <Separator />}function useFolded(bar: React.RefObject<HTMLElement | null>, actions: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
{!hosted && leads && !inSubagents && <Separator />}    const [foldedAt, setFoldedAt] = useState<number | null>(null);
{!hosted && leads && !inSubagents && <Separator />}
{!hosted && leads && !inSubagents && <Separator />}    useEffect(() => {
{!hosted && leads && !inSubagents && <Separator />}        const element = bar.current;
{!hosted && leads && !inSubagents && <Separator />}        if (!enabled || element === null || typeof ResizeObserver === 'undefined') {
{!hosted && leads && !inSubagents && <Separator />}            return;
{!hosted && leads && !inSubagents && <Separator />}        }
{!hosted && leads && !inSubagents && <Separator />}        const measure = (): void => {
{!hosted && leads && !inSubagents && <Separator />}            const width = element.clientWidth;
{!hosted && leads && !inSubagents && <Separator />}            setFoldedAt((current) => {
{!hosted && leads && !inSubagents && <Separator />}                if (current !== null) {
{!hosted && leads && !inSubagents && <Separator />}                    return width > current + UNFOLD_MARGIN ? null : current;
{!hosted && leads && !inSubagents && <Separator />}                }
{!hosted && leads && !inSubagents && <Separator />}                return element.scrollWidth > width + 1 ? width : null;
{!hosted && leads && !inSubagents && <Separator />}            });
{!hosted && leads && !inSubagents && <Separator />}        };
{!hosted && leads && !inSubagents && <Separator />}        const observer = new ResizeObserver(measure);
{!hosted && leads && !inSubagents && <Separator />}        observer.observe(element);
{!hosted && leads && !inSubagents && <Separator />}        // The actions change size on their own as well: an agent starting in a terminal adds its mode.
{!hosted && leads && !inSubagents && <Separator />}        if (actions.current) {
{!hosted && leads && !inSubagents && <Separator />}            observer.observe(actions.current);
{!hosted && leads && !inSubagents && <Separator />}        }
{!hosted && leads && !inSubagents && <Separator />}        measure();
{!hosted && leads && !inSubagents && <Separator />}        return () => observer.disconnect();
{!hosted && leads && !inSubagents && <Separator />}        // Again on every fold: the actions are a new element each time they come back, and the
{!hosted && leads && !inSubagents && <Separator />}        // observer has to be on that one.
{!hosted && leads && !inSubagents && <Separator />}    }, [bar, actions, enabled, foldedAt]);
{!hosted && leads && !inSubagents && <Separator />}
{!hosted && leads && !inSubagents && <Separator />}    // A view that brings no actions has nothing to fold, whatever the bar measured before it changed.
{!hosted && leads && !inSubagents && <Separator />}    return enabled && foldedAt !== null;
{!hosted && leads && !inSubagents && <Separator />}}
{!hosted && leads && !inSubagents && <Separator />}
{!hosted && leads && !inSubagents && <Separator />}/*
{!hosted && leads && !inSubagents && <Separator />} * The bar over one cell of the grid. With the views side by side the window's toolbar goes back to
{!hosted && leads && !inSubagents && <Separator />} * being the application's, and every cell says for itself which view it holds and what that view can
{!hosted && leads && !inSubagents && <Separator />} * do. The bar is the handle as well: drag it anywhere to move the view to another cell, which is
{!hosted && leads && !inSubagents && <Separator />} * where a tab bar would be in an app that had tabs, and this app does not.
{!hosted && leads && !inSubagents && <Separator />} */
{!hosted && leads && !inSubagents && <Separator />}export function CellToolbar({
{!hosted && leads && !inSubagents && <Separator />}    at,
{!hosted && leads && !inSubagents && <Separator />}    view,
{!hosted && leads && !inSubagents && <Separator />}    focused,
{!hosted && leads && !inSubagents && <Separator />}    tabDrop,
{!hosted && leads && !inSubagents && <Separator />}    children
{!hosted && leads && !inSubagents && <Separator />}}: {
{!hosted && leads && !inSubagents && <Separator />}    at: CellAt;
{!hosted && leads && !inSubagents && <Separator />}    view: CellView;
{!hosted && leads && !inSubagents && <Separator />}    focused: boolean;
{!hosted && leads && !inSubagents && <Separator />}    /* A view is being dragged over the bar to become one of its tabs; `gap` is where in the strip, counted in tabs from the left. */
{!hosted && leads && !inSubagents && <Separator />}    tabDrop: { gap: number } | null;
{!hosted && leads && !inSubagents && <Separator />}    children: ReactElement;
{!hosted && leads && !inSubagents && <Separator />}}) {
{!hosted && leads && !inSubagents && <Separator />}    const { t } = useTranslation('shell');
{!hosted && leads && !inSubagents && <Separator />}    /* The file's controls are portaled up into this bar, so every cell holds a host of its own:
{!hosted && leads && !inSubagents && <Separator />}       one shared host would put the controls of one file over the bar of another. */
{!hosted && leads && !inSubagents && <Separator />}    const [host, setHost] = useState<HTMLElement | null>(null);
{!hosted && leads && !inSubagents && <Separator />}    /* Whether the pointer came down on the bar itself. A drag starts on the nearest draggable
{!hosted && leads && !inSubagents && <Separator />}       ancestor, so `draggable` on a child does not hold it back: the attribute itself has to go
{!hosted && leads && !inSubagents && <Separator />}       while the pointer is in something that controls the view, or selecting text in a browser's
{!hosted && leads && !inSubagents && <Separator />}       address field would drag the cell away instead. */
{!hosted && leads && !inSubagents && <Separator />}    const [grabbable, setGrabbable] = useState(true);
{!hosted && leads && !inSubagents && <Separator />}    const [menuOpen, setMenuOpen] = useState(false);
{!hosted && leads && !inSubagents && <Separator />}    const bar = useRef<HTMLDivElement>(null);
{!hosted && leads && !inSubagents && <Separator />}    const actions = useRef<HTMLSpanElement>(null);
{!hosted && leads && !inSubagents && <Separator />}    const bodyFocused = useDocument((s) => s.bodyFocused);
{!hosted && leads && !inSubagents && <Separator />}    const maximized = useDocument((s) => s.maximized === view.id);
{!hosted && leads && !inSubagents && <Separator />}    /* The last cell stays (`split.close`), so its bar has nothing to offer there. */
{!hosted && leads && !inSubagents && <Separator />}    const closable = useDocument((s) => s.layout !== null && cellCount(s.layout) > 1);
{!hosted && leads && !inSubagents && <Separator />}    /* The tabs of the cell when it is a host. A host keeps its bar whatever the view in front is. */
{!hosted && leads && !inSubagents && <Separator />}    const tabs = useDocument((s) => (s.layout === null ? undefined : cellAt(s.layout, at)?.tabs));
{!hosted && leads && !inSubagents && <Separator />}    const hosted = tabs !== undefined;
{!hosted && leads && !inSubagents && <Separator />}    const loose = isLooseView(view);
{!hosted && leads && !inSubagents && <Separator />}    const hasViewToolbar = useHasViewToolbar(view);
{!hosted && leads && !inSubagents && <Separator />}    /* The controls of a loose view in a host never fold: the strip beside them is the list of what is open,
{!hosted && leads && !inSubagents && <Separator />}       and a strip inside a popover is a list you have to open a menu to see. It gives way by scrolling
{!hosted && leads && !inSubagents && <Separator />}       sideways instead. */
{!hosted && leads && !inSubagents && <Separator />}    const stripBeside = hosted && loose;
{!hosted && leads && !inSubagents && <Separator />}    const folded = useFolded(bar, actions, hasViewToolbar && !stripBeside);
{!hosted && leads && !inSubagents && <Separator />}    const leads = useViewToolbarLeads(view);
{!hosted && leads && !inSubagents && <Separator />}    /* A lone cell with nothing to do takes no bar. The wrapper stays, so the body keeps its place
{!hosted && leads && !inSubagents && <Separator />}       in the tree and a session inside it survives the bar coming and going. */
{!hosted && leads && !inSubagents && <Separator />}    const bare = !hosted && !closable && !hasViewToolbar;
{!hosted && leads && !inSubagents && <Separator />}    const inSubagents = useShowsSubagents(view);
{!hosted && leads && !inSubagents && <Separator />}    const title = useBrowserDisplayTitle(view.id, view.name ?? '', 'titleSource' in view ? view.titleSource : undefined);
{!hosted && leads && !inSubagents && <Separator />}    const visibleTitle = view.kind === 'browser' ? title : view.name;
{!hosted && leads && !inSubagents && <Separator />}
{!hosted && leads && !inSubagents && <Separator />}    /* `display: contents` so the wrapper changes no layout. It is here for the right-click alone: the
{!hosted && leads && !inSubagents && <Separator />}       view's own controls hold a browser's address field and menus of their own, and the bar's menu
{!hosted && leads && !inSubagents && <Separator />}       is about the cell, so a press inside them never reaches it. */
{!hosted && leads && !inSubagents && <Separator />}    const controls = (
{!hosted && leads && !inSubagents && <Separator />}        <span className="contents" onContextMenu={(event) => event.stopPropagation()}>
{!hosted && leads && !inSubagents && <Separator />}            <ViewToolbar view={view} focused={focused && bodyFocused} />
{!hosted && leads && !inSubagents && <Separator />}        </span>
{!hosted && leads && !inSubagents && <Separator />}    );
{!hosted && leads && !inSubagents && <Separator />}    return (
{!hosted && leads && !inSubagents && <Separator />}        <FileToolbarSlotProvider value={{ host, mount: setHost }}>
{!hosted && leads && !inSubagents && <Separator />}            {!bare && (
{!hosted && leads && !inSubagents && <Separator />}                <ContextMenu.Root>
{!hosted && leads && !inSubagents && <Separator />}                    {/* The size of the toolbar under a panel's header (`FILE_TOOLBAR`): a cell is a body
{!hosted && leads && !inSubagents && <Separator />}                    with a bar over it, the way the files and the git panel are. Written out rather
{!hosted && leads && !inSubagents && <Separator />}                    than reused, because that bar has one background and this one has two. */}
{!hosted && leads && !inSubagents && <Separator />}                    <ContextMenu.Trigger
{!hosted && leads && !inSubagents && <Separator />}                        render={<header />}
{!hosted && leads && !inSubagents && <Separator />}                        ref={bar}
{!hosted && leads && !inSubagents && <Separator />}                        data-cell-bar=""
{!hosted && leads && !inSubagents && <Separator />}                        draggable={grabbable}
{!hosted && leads && !inSubagents && <Separator />}                        aria-label={t('cellToolbar.drag', {
{!hosted && leads && !inSubagents && <Separator />}                            name: visibleTitle ?? t('cellToolbar.view')
{!hosted && leads && !inSubagents && <Separator />}                        })}
{!hosted && leads && !inSubagents && <Separator />}                        className={clsx(
{!hosted && leads && !inSubagents && <Separator />}                            'flex h-10 shrink-0 cursor-grab items-center gap-2 overflow-hidden border-b border-border pr-1.5 pl-2 text-xs active:cursor-grabbing',
{!hosted && leads && !inSubagents && <Separator />}                            tabDrop !== null && !hosted
{!hosted && leads && !inSubagents && <Separator />}                                ? 'bg-accent/15 text-text outline-2 -outline-offset-2 outline-accent'
{!hosted && leads && !inSubagents && <Separator />}                                : focused
{!hosted && leads && !inSubagents && <Separator />}                                  ? 'bg-surface text-text'
{!hosted && leads && !inSubagents && <Separator />}                                  : 'bg-surface-idle text-text-muted'
{!hosted && leads && !inSubagents && <Separator />}                        )}
{!hosted && leads && !inSubagents && <Separator />}                        onPointerDown={(event) => setGrabbable(!(event.target as HTMLElement | null)?.closest(CONTROLS))}
{!hosted && leads && !inSubagents && <Separator />}                        onPointerUp={() => setGrabbable(true)}
{!hosted && leads && !inSubagents && <Separator />}                        onDragStart={(event) => {
{!hosted && leads && !inSubagents && <Separator />}                            event.dataTransfer.setData(VIEW_DRAG_TYPE, view.id);
{!hosted && leads && !inSubagents && <Separator />}                            event.dataTransfer.effectAllowed = 'move';
{!hosted && leads && !inSubagents && <Separator />}                            setDragging(view.id, hosted);
{!hosted && leads && !inSubagents && <Separator />}                        }}
{!hosted && leads && !inSubagents && <Separator />}                        onDragEnd={() => setDragging(null)}
{!hosted && leads && !inSubagents && <Separator />}                    >
{!hosted && leads && !inSubagents && <Separator />}                        {/* The title is what gives way: it truncates down to its glyph before anything else
{!hosted && leads && !inSubagents && <Separator />}                    in the bar has to move. A host has its tabs in its place. */}
{!hosted && leads && !inSubagents && <Separator />}                        <span
{!hosted && leads && !inSubagents && <Separator />}                            className={clsx(
{!hosted && leads && !inSubagents && <Separator />}                                'flex items-center gap-2 pl-1',
{!hosted && leads && !inSubagents && <Separator />}                                hosted ? 'min-w-24 self-stretch' : 'min-w-5',
{!hosted && leads && !inSubagents && <Separator />}                                folded || !hasViewToolbar || (hosted && loose) ? 'grow' : hosted ? 'max-w-[60%] shrink' : 'shrink'
{!hosted && leads && !inSubagents && <Separator />}                            )}
{!hosted && leads && !inSubagents && <Separator />}                        >
{!hosted && leads && !inSubagents && <Separator />}                            {maximized && (
{!hosted && leads && !inSubagents && <Separator />}                                <Tooltip label={t('cellToolbar.maximized')}>
{!hosted && leads && !inSubagents && <Separator />}                                    <span role="img" aria-label={t('cellToolbar.maximized')} className="inline-flex shrink-0 text-text-muted">
{!hosted && leads && !inSubagents && <Separator />}                                        <Icon icon={Expand} size={14} />
{!hosted && leads && !inSubagents && <Separator />}                                    </span>
{!hosted && leads && !inSubagents && <Separator />}                                </Tooltip>
{!hosted && leads && !inSubagents && <Separator />}                            )}
{!hosted && leads && !inSubagents && <Separator />}                            {tabs !== undefined ? (
{!hosted && leads && !inSubagents && <Separator />}                                <TabStrip at={at} ids={tabs} active={view.id} insertAt={tabDrop?.gap ?? null} />
{!hosted && leads && !inSubagents && <Separator />}                            ) : isLooseView(view) ? (
{!hosted && leads && !inSubagents && <Separator />}                                <>
{!hosted && leads && !inSubagents && <Separator />}                                    <LooseGlyph tab={view.tab} />
{!hosted && leads && !inSubagents && <Separator />}                                    <span className="min-w-0 truncate font-medium">{visibleTitle}</span>
{!hosted && leads && !inSubagents && <Separator />}                                </>
{!hosted && leads && !inSubagents && <Separator />}                            ) : view.kind === 'browser' ? (
{!hosted && leads && !inSubagents && <Separator />}                                /* The address field beside it already says where the page is, so the
{!hosted && leads && !inSubagents && <Separator />}                                   title would only take its room. */
{!hosted && leads && !inSubagents && <Separator />}                                <Tooltip label={visibleTitle}>
{!hosted && leads && !inSubagents && <Separator />}                                    <span className="inline-flex shrink-0">
{!hosted && leads && !inSubagents && <Separator />}                                        <ViewGlyph id={view.id} kind={view.kind} icon={viewIconOf(view)} provider={null} path={null} />
{!hosted && leads && !inSubagents && <Separator />}                                    </span>
{!hosted && leads && !inSubagents && <Separator />}                                </Tooltip>
{!hosted && leads && !inSubagents && <Separator />}                            ) : (
{!hosted && leads && !inSubagents && <Separator />}                                <>
{!hosted && leads && !inSubagents && <Separator />}                                    <ViewGlyph
{!hosted && leads && !inSubagents && <Separator />}                                        id={view.id}
{!hosted && leads && !inSubagents && <Separator />}                                        kind={view.kind}
{!hosted && leads && !inSubagents && <Separator />}                                        icon={viewIconOf(view)}
{!hosted && leads && !inSubagents && <Separator />}                                        provider={view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null}
{!hosted && leads && !inSubagents && <Separator />}                                        path={view.kind === 'file' ? view.path : null}
{!hosted && leads && !inSubagents && <Separator />}                                    />
{!hosted && leads && !inSubagents && <Separator />}                                    <SubagentTitleCrumb chatId={view.id} className="text-text-muted hover:text-text">
{!hosted && leads && !inSubagents && <Separator />}                                        <span className="min-w-0 truncate font-medium">{visibleTitle}</span>
{!hosted && leads && !inSubagents && <Separator />}                                    </SubagentTitleCrumb>
{!hosted && leads && !inSubagents && <Separator />}                                </>
{!hosted && leads && !inSubagents && <Separator />}                            )}
{!hosted && leads && !inSubagents && <Separator />}                        </span>
{!hosted && leads && !inSubagents && <Separator />}                        {hasViewToolbar && !folded && (
{!hosted && leads && !inSubagents && <Separator />}                            <>
{!hosted && leads && !inSubagents && <Separator />}                                {(hosted || (leads && !inSubagents)) && <Separator />}
{!hosted && leads && !inSubagents && <Separator />}                                {/* At least as wide as the controls at their smallest, so a bar too narrow
{!hosted && leads && !inSubagents && <Separator />}                            for them overflows, and that is how it knows to fold. Beside a strip they never
{!hosted && leads && !inSubagents && <Separator />}                            fold, so the strip may shrink and scroll. */}
{!hosted && leads && !inSubagents && <Separator />}                                <span ref={actions} className={clsx('flex grow items-center', stripBeside ? 'min-w-0 self-stretch' : 'min-w-min')}>
{!hosted && leads && !inSubagents && <Separator />}                                    {controls}
{!hosted && leads && !inSubagents && <Separator />}                                </span>
{!hosted && leads && !inSubagents && <Separator />}                            </>
{!hosted && leads && !inSubagents && <Separator />}                        )}
{!hosted && leads && !inSubagents && <Separator />}                        {hasViewToolbar && folded && (
{!hosted && leads && !inSubagents && <Separator />}                            <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
{!hosted && leads && !inSubagents && <Separator />}                                <IconButton
{!hosted && leads && !inSubagents && <Separator />}                                    icon={MoreHorizontal}
{!hosted && leads && !inSubagents && <Separator />}                                    size="sm"
{!hosted && leads && !inSubagents && <Separator />}                                    label={t('cellToolbar.moreActions')}
{!hosted && leads && !inSubagents && <Separator />}                                    className="cursor-default"
{!hosted && leads && !inSubagents && <Separator />}                                    render={<Popover.Trigger />}
{!hosted && leads && !inSubagents && <Separator />}                                />
{!hosted && leads && !inSubagents && <Separator />}                                {/* A popover and not a menu: a browser's address field is among these,
{!hosted && leads && !inSubagents && <Separator />}                            and a menu would take its keys for moving between items. */}
{!hosted && leads && !inSubagents && <Separator />}                                <Popover.Popup sideOffset={6} align="end" className="flex min-w-72 items-center gap-2 p-2 text-xs">
{!hosted && leads && !inSubagents && <Separator />}                                    {controls}
{!hosted && leads && !inSubagents && <Separator />}                                </Popover.Popup>
{!hosted && leads && !inSubagents && <Separator />}                            </Popover.Root>
{!hosted && leads && !inSubagents && <Separator />}                        )}
{!hosted && leads && !inSubagents && <Separator />}                        {/* Folded and closed, the controls still have to be mounted somewhere: a file's
{!hosted && leads && !inSubagents && <Separator />}                    renderer portals into their host, and with no host it would draw a bar of its
{!hosted && leads && !inSubagents && <Separator />}                    own inside the cell. */}
{!hosted && leads && !inSubagents && <Separator />}                        {hasViewToolbar && folded && !menuOpen && (
{!hosted && leads && !inSubagents && <Separator />}                            <span hidden className="hidden">
{!hosted && leads && !inSubagents && <Separator />}                                {controls}
{!hosted && leads && !inSubagents && <Separator />}                            </span>
{!hosted && leads && !inSubagents && <Separator />}                        )}
{!hosted && leads && !inSubagents && <Separator />}                        {closable && (
{!hosted && leads && !inSubagents && <Separator />}                            <CloseButton label={t('cellToolbar.closeCell')} size="sm" className="cursor-default" onClick={() => closeCellAction(view.id)} />
{!hosted && leads && !inSubagents && <Separator />}                        )}
{!hosted && leads && !inSubagents && <Separator />}                    </ContextMenu.Trigger>
{!hosted && leads && !inSubagents && <Separator />}                    <ContextMenu.Popup>
{!hosted && leads && !inSubagents && <Separator />}                        {tabs?.length === 1 && (
{!hosted && leads && !inSubagents && <Separator />}                            <>
{!hosted && leads && !inSubagents && <Separator />}                                <Menu.Item onClick={() => useDocument.getState().ungroupCell(at)}>
{!hosted && leads && !inSubagents && <Separator />}                                    <Icon icon={Ungroup} size={14} /> {t('viewMenu.ungroup')}
{!hosted && leads && !inSubagents && <Separator />}                                </Menu.Item>
{!hosted && leads && !inSubagents && <Separator />}                                <Menu.Separator />
{!hosted && leads && !inSubagents && <Separator />}                            </>
{!hosted && leads && !inSubagents && <Separator />}                        )}
{!hosted && leads && !inSubagents && <Separator />}                        <SplitItems at={at} separated />
{!hosted && leads && !inSubagents && <Separator />}                        {/* A loose view is no view of the project: nothing to rename, share or delete. */}
{!hosted && leads && !inSubagents && <Separator />}                        {isLooseView(view) ? <FileMenuItems tabKey={view.id} /> : <ViewMenuItems viewId={view.id} kind={view.kind} />}
{!hosted && leads && !inSubagents && <Separator />}                    </ContextMenu.Popup>
{!hosted && leads && !inSubagents && <Separator />}                </ContextMenu.Root>
{!hosted && leads && !inSubagents && <Separator />}            )}
{!hosted && leads && !inSubagents && <Separator />}            {children}
{!hosted && leads && !inSubagents && <Separator />}        </FileToolbarSlotProvider>
{!hosted && leads && !inSubagents && <Separator />}    );
{!hosted && leads && !inSubagents && <Separator />}}
