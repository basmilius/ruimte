import { SubagentTitleCrumb } from '@adecore/agents-react/chat/ui';
import { Icon, Menu, PaneBar, Tooltip } from '@adecore/ui';
import { Ungroup } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { closeCellAction } from '@/action-port/person-actions';
import { useBrowserDisplayTitle } from '@/browser/title';
import { ViewAccessories } from '@/extensions/ContributedSlots';
import { nodeInfoOf } from '@/extensions/slots';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { FileMenuItems } from '@/files/FileMenuItems';
import { LooseGlyph } from '@/files/LooseGlyph';
import { cellAt, type CellAt } from '@/layout/split';
import { ViewGlyph } from '@/project/ViewGlyph';
import { MaximizedIndicator } from '@/shell/MaximizedIndicator';
import { TabStrip } from '@/shell/TabStrip';
import { useCellBarSlot } from '@/shell/top-row-slot';
import { useHasViewToolbar, useViewToolbarLeads } from '@/shell/view-toolbar';
import { ViewToolbar } from '@/shell/ViewToolbar';
import { useDocument } from '@/state/document';
import { isDatabaseTab } from '@/state/files';
import { isLooseView, viewGlyphOf, type CellView } from '@/surface/cell-view';
import { FileToolbarSlotProvider } from '@/surface/panels/file-toolbar-slot';
import { setDragging, VIEW_DRAG_TYPE } from '@/surface/view-drag';
import { SplitItems, ViewMenuItems } from '@/view-menu/ViewMenuItems';

/* What a cell is: its tabs when it hosts them, or the glyph and the name of the view. */
function CellTitle({ at, view, tabs, title }: { at: CellAt; view: CellView; tabs: readonly string[] | undefined; title: string | undefined }) {
    if (tabs !== undefined) {
        return <TabStrip at={at} ids={tabs} active={view.id} />;
    }

    if (isLooseView(view)) {
        return (
            <>
                <LooseGlyph tab={view.tab} />
                <span className="min-w-0 truncate text-sm font-medium">{title}</span>
            </>
        );
    }

    // The address field beside it already says where the page is, so the title would only take its room.
    if (view.kind === 'browser') {
        return (
            <Tooltip label={title}>
                <span className="inline-flex shrink-0">
                    <ViewGlyph {...viewGlyphOf(view)} />
                </span>
            </Tooltip>
        );
    }

    return (
        <>
            <ViewGlyph {...viewGlyphOf(view)} />
            <SubagentTitleCrumb chatId={view.id} className="text-text-muted hover:text-text">
                <span className="min-w-0 truncate text-sm font-medium">{title}</span>
            </SubagentTitleCrumb>
        </>
    );
}

/*
 * The bar of a cell: what the cell holds, the view's own controls, its menu and its close button. The bar
 * is ADE CORE's `PaneBar`; the cell supplies the words, the controls and what a drag carries. The bar of
 * the only cell joins the project in the top row.
 */
export function CellToolbar({
    at,
    view,
    focused,
    hidden = false,
    children
}: {
    at: CellAt;
    view: CellView;
    focused: boolean;
    /* A tab in the back of its host, whose bar stays with its hidden body rather than in the top row. */
    hidden?: boolean;
    children: ReactElement;
}) {
    const { t } = useTranslation('shell');
    /* The file's controls are portaled up into this bar, so every cell holds a host of its own:
       one shared host would put the controls of one file over the bar of another. */
    const [host, setHost] = useState<HTMLElement | null>(null);
    /* Folding moves the slot, and a popover's slot leaves only once it has animated out, after the
       new one came; only the slot that is the host may clear it, or the controls draw a bar of their own. */
    const mountHost = (element: HTMLElement | null): (() => void) | undefined => {
        if (element === null) {
            return undefined;
        }

        setHost(element);

        return () => setHost((current) => (current === element ? null : current));
    };
    const bodyFocused = useDocument((s) => s.bodyFocused);
    const maximized = useDocument((s) => s.maximized === view.id);
    const closable = useDocument((s) => s.layout !== null);
    /* The tabs of the cell when it is a host. A host keeps its bar whatever the view in front is. */
    const tabs = useDocument((s) => (s.layout === null ? undefined : cellAt(s.layout, at)?.tabs));
    const hosted = tabs !== undefined;
    const hasViewToolbar = useHasViewToolbar(view);
    const compactToolbar = view.kind === 'file' || view.kind === 'terminal' || (isLooseView(view) && !isDatabaseTab(view.tab));
    const leads = useViewToolbarLeads(view);
    /* A lone cell with nothing to do takes no bar. The wrapper stays, so the body keeps its place
       in the tree and a session inside it survives the bar coming and going. */
    const bare = !hosted && !closable && !hasViewToolbar;
    const slot = useCellBarSlot();
    const title = useBrowserDisplayTitle(view.id, view.name ?? '', 'titleSource' in view ? view.titleSource : undefined);
    const visibleTitle = view.kind === 'browser' ? title : view.name;

    return (
        <FileToolbarSlotProvider value={{ host, mount: mountHost }}>
            {!bare && (
                <PaneBar
                    data-cell-bar=""
                    aria-label={t('cellToolbar.drag', { name: visibleTitle ?? t('cellToolbar.view') })}
                    title={<CellTitle at={at} view={view} tabs={tabs} title={visibleTitle} />}
                    tabs={hosted}
                    actions={
                        hasViewToolbar && (
                            /* `display: contents` so the wrapper changes no layout. It is here for the right-click alone: the
                               view's own controls hold a browser's address field and menus of their own, and the bar's menu is
                               about the cell, so a press inside them never reaches it. */
                            <span className="contents" onContextMenu={(event) => event.stopPropagation()}>
                                <ViewToolbar view={view} focused={focused && bodyFocused} />
                            </span>
                        )
                    }
                    compactActions={compactToolbar}
                    separated={leads}
                    accessory={
                        // A terminal's text takes every pixel of its body, so what a built-in adds stands in the bar.
                        view.kind === 'terminal' && (
                            <ViewAccessories
                                on="terminal"
                                id={view.id}
                                title={visibleTitle}
                                onPress={() => {
                                    useDocument.getState().focusCellAt(at);
                                    useDocument.getState().setBodyFocused(true);
                                }}
                            />
                        )
                    }
                    trailing={
                        <>
                            <SlotRow place="viewToolbar" context={{}} />
                            {view.kind === 'terminal' && <SlotRow place="terminalToolbar" context={{ node: nodeInfoOf(view.id) }} />}
                            {maximized && <MaximizedIndicator at={at} />}
                        </>
                    }
                    focused={focused}
                    onClose={closable ? () => closeCellAction(view.id) : undefined}
                    closeLabel={t('cellToolbar.closeCell')}
                    moreActionsLabel={t('cellToolbar.moreActions')}
                    // A tab in the back keeps its bar on its hidden body, so the top row holds the one in front.
                    container={hidden ? null : slot}
                    onDragStart={(event) => {
                        event.dataTransfer.setData(VIEW_DRAG_TYPE, view.id);
                        event.dataTransfer.effectAllowed = 'move';
                        setDragging(view.id, hosted);
                    }}
                    menu={
                        <>
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
                        </>
                    }
                />
            )}
            {children}
        </FileToolbarSlotProvider>
    );
}
