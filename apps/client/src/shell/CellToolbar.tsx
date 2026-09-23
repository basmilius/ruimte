import { useEffect, useRef, useState, type ReactElement } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Popover } from '@base-ui-components/react/popover';
import { Files, MoreHorizontal, X } from 'lucide-react';
import { viewIconOf } from '@ruimte/contracts';
import { ViewGlyph } from '@/project/ViewGlyph';
import { isFilesView, type CellView } from '@/shell/files-view';
import { FileToolbarSlotProvider } from '@/shell/panels/file-toolbar-slot';
import { SubagentTitleCrumb } from '@/chat/ui/SubagentControls';
import { SplitItems, ViewMenuItems } from '@/shell/ViewMenuItems';
import { useHasViewToolbar, useShowsSubagents, useViewToolbarLeads, ViewToolbar } from '@/shell/ViewToolbar';
import { setDragging, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { useDocument } from '@/state/document';
import { type CellAt } from '@/shell/split';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';
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
const useFolded = (bar: React.RefObject<HTMLElement | null>, actions: React.RefObject<HTMLElement | null>, enabled: boolean): boolean => {
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
};

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
    const files = isFilesView(view);
    const hasViewToolbar = useHasViewToolbar(view);
    /* The files never fold: their controls are the tab strip, and a strip inside a popover is a list
       of files you have to open a menu to see. It gives way by scrolling sideways instead. */
    const folded = useFolded(bar, actions, hasViewToolbar && !files);
    const leads = useViewToolbarLeads(view);
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
            <ContextMenu.Root>
                {/* The size of the toolbar under a panel's header (`FILE_TOOLBAR`): a cell is a body
                    with a bar over it, the way the files and the git panel are. Written out rather
                    than reused, because that bar has one background and this one has two. */}
                <ContextMenu.Trigger
                    render={<header />}
                    ref={bar}
                    draggable={grabbable}
                    aria-label={t('cellToolbar.drag', { name: visibleTitle ?? t('cellToolbar.view') })}
                    className={clsx(
                        'flex h-10 shrink-0 cursor-grab items-center gap-2 overflow-hidden border-b border-border pr-1.5 pl-2 text-xs active:cursor-grabbing',
                        focused ? 'bg-surface text-text' : 'bg-surface-idle text-text-muted'
                    )}
                    onPointerDown={(event) => setGrabbable(!(event.target as HTMLElement | null)?.closest(CONTROLS))}
                    onPointerUp={() => setGrabbable(true)}
                    onDragStart={(event) => {
                        event.dataTransfer.setData(VIEW_DRAG_TYPE, view.id);
                        event.dataTransfer.effectAllowed = 'move';
                        setDragging(view.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                >
                    {/* The title is what gives way: it truncates down to its glyph before anything else
                    in the bar has to move. */}
                    <span className={clsx('flex min-w-5 items-center gap-2 pl-1', folded || !hasViewToolbar ? 'grow' : 'shrink')}>
                        {/* The tabs beside it say which files are open, so the glyph stands alone:
                            a name here would take the room the strip needs. */}
                        {files ? (
                            <Icon icon={Files} size={14} className="shrink-0" />
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
                            {leads && !inSubagents && <Separator />}
                            {/* At least as wide as the controls at their smallest, so a bar too narrow
                            for them overflows, and that is how it knows to fold. The files never fold,
                            so their strip may shrink and scroll. The bar centers what it holds, so a
                            tab strip that runs its full height has to say so. */}
                            <span ref={actions} className={clsx('flex grow items-center', files ? 'min-w-0 self-stretch' : 'min-w-min')}>
                                {controls}
                            </span>
                        </>
                    )}
                    {hasViewToolbar && folded && (
                        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
                            <Tooltip label={t('cellToolbar.moreActions')}>
                                <Popover.Trigger className="icon-btn h-7 w-7 cursor-default" aria-label={t('cellToolbar.moreActions')}>
                                    <Icon icon={MoreHorizontal} size={14} />
                                </Popover.Trigger>
                            </Tooltip>
                            <Popover.Portal>
                                <Popover.Positioner side="bottom" sideOffset={6} align="end" className="z-(--z-popup)">
                                    {/* A popover and not a menu: a browser's address field is among these,
                                    and a menu would take its keys for moving between items. */}
                                    <Popover.Popup className="menu-popup flex min-w-72 items-center gap-2 p-2 text-xs">{controls}</Popover.Popup>
                                </Popover.Positioner>
                            </Popover.Portal>
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
                    <Tooltip label={t('cellToolbar.closeCell')}>
                        <button type="button" className="icon-btn h-7 w-7 cursor-default" onClick={() => useDocument.getState().closeCellAt(at)}>
                            <Icon icon={X} size={14} />
                        </button>
                    </Tooltip>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                    <ContextMenu.Positioner className="z-(--z-popup)">
                        <ContextMenu.Popup className="menu-popup">
                            <SplitItems at={at} separated />
                            {/* The files are no view of the project: nothing to rename, share or delete. */}
                            {!files && <ViewMenuItems viewId={view.id} kind={view.kind} />}
                        </ContextMenu.Popup>
                    </ContextMenu.Positioner>
                </ContextMenu.Portal>
            </ContextMenu.Root>
            {children}
        </FileToolbarSlotProvider>
    );
}
