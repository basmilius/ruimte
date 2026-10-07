import { useEffect, useRef, useState, type ReactElement } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Expand, MoreHorizontal, Ungroup } from 'lucide-react';
import { viewIconOf } from '@ruimte/contracts';
import { closeCellAction } from '@/actions/client-actions';
import { ViewGlyph } from '@/project/ViewGlyph';
import { isLooseView, type CellView } from '@/shell/cell-view';
import { FileToolbarSlotProvider } from '@/shell/panels/file-toolbar-slot';
import { FileMenuItems } from '@/shell/panels/FileMenuItems';
import { LooseGlyph } from '@/shell/panels/LooseGlyph';
import { TabStrip } from '@/shell/TabStrip';
import { SubagentTitleCrumb } from '@adecore/agents-react/chat/ui/SubagentControls';
import { SplitItems, ViewMenuItems } from '@/shell/ViewMenuItems';
import { ViewToolbar } from '@/shell/ViewToolbar';
import { useHasViewToolbar, useShowsSubagents, useViewToolbarLeads } from '@/shell/view-toolbar';
import { setDragging, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { useDocument } from '@/state/document';
import { cellAt, cellCount, type CellAt } from '@/shell/split';
import { CloseButton, Icon, IconButton, Menu, Separator, ContextMenu, Popover, Tooltip } from '@adecore/ui';
import { useBrowserDisplayTitle } from '@/browser/title';

/* What the bar holds that is not the bar: a press on one of these is not the start of a drag. */
const CONTROLS = 'input, textarea, select, button, a, [contenteditable=""], [contenteditable="true"], [role="button"]';

/* Without this margin, a bar right at the fold point would fold and unfold on every pixel of a splitter drag. */
const UNFOLD_MARGIN = 24;

/*
 * Whether the view's actions are folded into the overflow menu: only once the title has shrunk to
 * its glyph and the actions still do not fit. The width where that happened is remembered, since a
 * folded bar fits by definition and can no longer tell by overflowing when there is room again.
 */
function useFolded(bar: React.RefObject<HTMLElement | null>, actions: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
    const [foldedAt, setFoldedAt] = useState<number | null>(null);

    useEffect(() => {
        const element = bar.current;
        if (!enabled || element === null || typeof ResizeObserver === 'undefined') {
            return;
        }
        const measure = (): void => {
            const width = element.clientWidth;
            setFoldedAt((current) => {
                if (current !== null) {
                    return width > current + UNFOLD_MARGIN ? null : current;
                }
                return element.scrollWidth > width + 1 ? width : null;
            });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        // The actions change size on their own as well: an agent starting in a terminal adds its mode.
        if (actions.current) {
            observer.observe(actions.current);
        }
        measure();
        return () => observer.disconnect();
        // Again on every fold: the actions are a new element each time they come back, and the
        // observer has to be on that one.
    }, [bar, actions, enabled, foldedAt]);

    // A view that brings no actions has nothing to fold, whatever the bar measured before it changed.
    return enabled && foldedAt !== null;
}

/*
 * The bar over one cell of the grid. With the views side by side the window's toolbar goes back to
 * being the application's, and every cell says for itself which view it holds and what that view can
 * do. The bar is the handle as well: drag it anywhere to move the view to another cell, which is
 * where a tab bar would be in an app that had tabs, and this app does not.
 */
export function CellToolbar({ at, view, focused, children }: { at: CellAt; view: CellView; focused: boolean; children: ReactElement }) {
    const { t } = useTranslation('shell');
    /* The file's controls are portaled up into this bar, so every cell holds a host of its own:
       one shared host would put the controls of one file over the bar of another. */
    const [host, setHost] = useState<HTMLElement | null>(null);
    /* Whether the pointer came down on the bar itself. A drag starts on the nearest draggable
       ancestor, so `draggable` on a child does not hold it back: the attribute itself has to go
       while the pointer is in something that controls the view, or selecting text in a browser's
       address field would drag the cell away instead. */
    const [grabbable, setGrabbable] = useState(true);
    const [menuOpen, setMenuOpen] = useState(false);
    const bar = useRef<HTMLDivElement>(null);
    const actions = useRef<HTMLSpanElement>(null);
    const bodyFocused = useDocument((s) => s.bodyFocused);
    const maximized = useDocument((s) => s.maximized === view.id);
    /* The last cell stays (`split.close`), so its bar has nothing to offer there. */
    const closable = useDocument((s) => s.layout !== null && cellCount(s.layout) > 1);
    /* The tabs of the cell when it is a host. A host keeps its bar whatever the view in front is. */
    const tabs = useDocument((s) => (s.layout === null ? undefined : cellAt(s.layout, at)?.tabs));
    const hosted = tabs !== undefined;
    const loose = isLooseView(view);
    const hasViewToolbar = useHasViewToolbar(view);
    /* The controls of a loose view in a host never fold: the strip beside them is the list of what is open,
       and a strip inside a popover is a list you have to open a menu to see. It gives way by scrolling
       sideways instead. */
    const stripBeside = hosted && loose;
    const folded = useFolded(bar, actions, hasViewToolbar && !stripBeside);
    const leads = useViewToolbarLeads(view);
    /* A lone cell with nothing to do takes no bar. The wrapper stays, so the body keeps its place
       in the tree and a session inside it survives the bar coming and going. */
    const bare = !hosted && !closable && !hasViewToolbar;
    const inSubagents = useShowsSubagents(view);
    const title = useBrowserDisplayTitle(view.id, view.name ?? '', 'titleSource' in view ? view.titleSource : undefined);
    const visibleTitle = view.kind === 'browser' ? title : view.name;

    /* `display: contents` so the wrapper changes no layout. It is here for the right-click alone: the
       view's own controls hold a browser's address field and menus of their own, and the bar's menu
       is about the cell, so a press inside them never reaches it. */
    const controls = (
        <span className="contents" onContextMenu={(event) => event.stopPropagation()}>
            <ViewToolbar view={view} focused={focused && bodyFocused} />
        </span>
    );
    return (
        <FileToolbarSlotProvider value={{ host, mount: setHost }}>
            {!bare && (
                <ContextMenu.Root>
                    {/* The size of the toolbar under a panel's header (`FILE_TOOLBAR`): a cell is a body
                    with a bar over it, the way the files and the git panel are. Written out rather
                    than reused, because that bar has one background and this one has two. */}
                    <ContextMenu.Trigger
                        render={<header />}
                        ref={bar}
                        data-cell-bar=""
                        draggable={grabbable}
                        aria-label={t('cellToolbar.drag', {
                            name: visibleTitle ?? t('cellToolbar.view')
                        })}
                        className={clsx(
                            'flex h-10 shrink-0 cursor-grab items-center gap-2 overflow-hidden border-b border-border pr-1.5 text-xs active:cursor-grabbing',
                            !hosted && 'pl-2',
                            focused ? 'bg-surface text-text' : 'bg-surface-idle text-text-muted'
                        )}
                        onPointerDown={(event) => setGrabbable(!(event.target as HTMLElement | null)?.closest(CONTROLS))}
                        onPointerUp={() => setGrabbable(true)}
                        onDragStart={(event) => {
                            event.dataTransfer.setData(VIEW_DRAG_TYPE, view.id);
                            event.dataTransfer.effectAllowed = 'move';
                            setDragging(view.id, hosted);
                        }}
                        onDragEnd={() => setDragging(null)}
                    >
                        {/* The title is what gives way: it truncates down to its glyph before anything else
                    in the bar has to move. A host has its tabs in its place. */}
                        <span
                            data-cell-title=""
                            className={clsx(
                                'flex items-center gap-2',
                                hosted ? 'min-w-24 self-stretch' : 'min-w-5 pl-1',
                                folded || !hasViewToolbar || (hosted && loose) ? 'grow' : 'shrink'
                            )}
                        >
                            {maximized && (
                                <Tooltip label={t('cellToolbar.maximized')}>
                                    <span
                                        role="img"
                                        aria-label={t('cellToolbar.maximized')}
                                        className={clsx('inline-flex shrink-0 text-text-muted', hosted && 'pl-3')}
                                    >
                                        <Icon icon={Expand} size={14} />
                                    </span>
                                </Tooltip>
                            )}
                            {tabs !== undefined ? (
                                <TabStrip at={at} ids={tabs} active={view.id} />
                            ) : isLooseView(view) ? (
                                <>
                                    <LooseGlyph tab={view.tab} />
                                    <span className="min-w-0 truncate font-medium">{visibleTitle}</span>
                                </>
                            ) : view.kind === 'browser' ? (
                                /* The address field beside it already says where the page is, so the
                                   title would only take its room. */
                                <Tooltip label={visibleTitle}>
                                    <span className="inline-flex shrink-0">
                                        <ViewGlyph id={view.id} kind={view.kind} icon={viewIconOf(view)} provider={null} path={null} />
                                    </span>
                                </Tooltip>
                            ) : (
                                <>
                                    <ViewGlyph
                                        id={view.id}
                                        kind={view.kind}
                                        icon={viewIconOf(view)}
                                        provider={view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null}
                                        path={view.kind === 'file' ? view.path : null}
                                    />
                                    <SubagentTitleCrumb chatId={view.id} className="text-text-muted hover:text-text">
                                        <span className="min-w-0 truncate font-medium">{visibleTitle}</span>
                                    </SubagentTitleCrumb>
                                </>
                            )}
                        </span>
                        {hasViewToolbar && !folded && (
                            <>
                                {/* A strip ends where the controls begin, and a view without controls would leave a line on its own. */}
                                {!hosted && leads && !inSubagents && <Separator />}
                                {/* At least as wide as the controls at their smallest, so a bar too narrow
                            for them overflows, and that is how it knows to fold. Beside a strip they never
                            fold, so the strip may shrink and scroll. */}
                                <span ref={actions} className={clsx('flex grow items-center', stripBeside ? 'min-w-0 self-stretch' : 'min-w-min')}>
                                    {controls}
                                </span>
                            </>
                        )}
                        {hasViewToolbar && folded && (
                            <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
                                <IconButton
                                    icon={MoreHorizontal}
                                    size="sm"
                                    label={t('cellToolbar.moreActions')}
                                    className="cursor-default"
                                    render={<Popover.Trigger />}
                                />
                                {/* A popover and not a menu: a browser's address field is among these,
                            and a menu would take its keys for moving between items. */}
                                <Popover.Popup sideOffset={6} align="end" className="flex min-w-72 items-center gap-2 p-2 text-xs">
                                    {controls}
                                </Popover.Popup>
                            </Popover.Root>
                        )}
                        {/* Folded and closed, the controls still have to be mounted somewhere: a file's
                    renderer portals into their host, and with no host it would draw a bar of its
                    own inside the cell. */}
                        {hasViewToolbar && folded && !menuOpen && (
                            <span hidden className="hidden">
                                {controls}
                            </span>
                        )}
                        {closable && (
                            <CloseButton label={t('cellToolbar.closeCell')} size="sm" className="cursor-default" onClick={() => closeCellAction(view.id)} />
                        )}
                    </ContextMenu.Trigger>
                    <ContextMenu.Popup>
                        {tabs?.length === 1 && (
                            <>
                                <Menu.Item onClick={() => useDocument.getState().ungroupCell(at)}>
                                    <Icon icon={Ungroup} size={14} /> {t('viewMenu.ungroup')}
                                </Menu.Item>
                                <Menu.Separator />
                            </>
                        )}
                        <SplitItems at={at} separated />
                        {/* A loose view is no view of the project: nothing to rename, share or delete. */}
                        {isLooseView(view) ? <FileMenuItems tabKey={view.id} /> : <ViewMenuItems viewId={view.id} kind={view.kind} />}
                    </ContextMenu.Popup>
                </ContextMenu.Root>
            )}
            {children}
        </FileToolbarSlotProvider>
    );
}
