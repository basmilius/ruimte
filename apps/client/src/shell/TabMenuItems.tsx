import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, ArrowRightToLine, Columns3, ListX, PanelRight, Pin, PinOff, SquareX, X } from 'lucide-react';
import { closeTabAction, closeTabsAction } from '@/actions/client-actions';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { SplitItems } from '@/shell/ViewMenuItems';
import { canSplit, cellAt, locateView } from '@/shell/split';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';
import { setTabPinned, tabsToClose } from '@/state/tab-close';
import { useCurrentProjectKey, useViewPins } from '@/state/view-pins';
import { Icon, Kbd, Menu } from '@adecore/ui';

/* Whether a tab of a host is pinned, for a loose tab in the pool and for a view of the project in this client's pins. */
function usePinnedOf(): (id: string) => boolean {
    const loose = useFiles((s) => s.tabs);
    const pins = useViewPins((s) => s.pins);
    const key = useCurrentProjectKey();
    return (id) => {
        const tab = loose.find((entry) => entry.key === id);
        return tab === undefined ? key !== null && (pins[key]?.includes(id) ?? false) : tab.pinned;
    };
}

/*
 * What every tab of a host offers above what it holds: its pin, the ways to close tabs, its place in the
 * strip and the cell it stands in. A file and a chat say the same here. Nothing for a view that is no tab of a host.
 */
export function TabMenuItems({ viewId }: { viewId: string }) {
    const { t } = useTranslation(['shell', 'panels']);
    const layout = useDocument((s) => s.layout);
    const pinnedOf = usePinnedOf();
    const at = layout === null ? null : locateView(layout, viewId);
    const tabs = layout === null || at === null ? undefined : cellAt(layout, at)?.tabs;
    if (layout === null || at === null || tabs === undefined) {
        return null;
    }
    const splittable = canSplit(layout, at, 'right', viewId);
    const index = tabs.indexOf(viewId);
    const pinned = pinnedOf(viewId);
    return (
        <>
            <Menu.Item onClick={() => setTabPinned(viewId, !pinned)}>
                <Icon icon={pinned ? PinOff : Pin} size={14} /> {pinned ? t('panels:file.tab.unpin') : t('panels:file.tab.pin')}
            </Menu.Item>
            <Menu.Item onClick={() => closeTabAction(viewId)}>
                <Icon icon={X} size={14} /> {t('panels:file.tab.close')} <Kbd shortcut={CANVAS_SHORTCUTS.closeCell} />
            </Menu.Item>
            <Menu.Item disabled={tabsToClose(tabs, viewId, 'others', pinnedOf).length === 0} onClick={() => closeTabsAction(viewId, 'others')}>
                <Icon icon={ListX} size={14} /> {t('panels:file.tab.closeOthers')}
            </Menu.Item>
            <Menu.Item disabled={tabsToClose(tabs, viewId, 'right', pinnedOf).length === 0} onClick={() => closeTabsAction(viewId, 'right')}>
                <Icon icon={ArrowRightToLine} size={14} /> {t('panels:file.tab.closeToRight')}
            </Menu.Item>
            <Menu.Item disabled={tabsToClose(tabs, viewId, 'all', pinnedOf).length === 0} onClick={() => closeTabsAction(viewId, 'all')}>
                <Icon icon={SquareX} size={14} /> {t('panels:file.tab.closeAll')}
            </Menu.Item>
            <Menu.Separator />
            <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger>
                    <Icon icon={ArrowRight} size={14} /> {t('viewMenu.moveTab')}
                </Menu.SubmenuTrigger>
                <Menu.Popup>
                    <Menu.Item disabled={index < 1} onClick={() => useDocument.getState().moveTab(viewId, -1)}>
                        <Icon icon={ArrowLeft} size={14} /> {t('viewMenu.moveTabLeft')} <Kbd shortcut={CANVAS_SHORTCUTS.moveTabLeft} />
                    </Menu.Item>
                    <Menu.Item disabled={index === tabs.length - 1} onClick={() => useDocument.getState().moveTab(viewId, 1)}>
                        <Icon icon={ArrowRight} size={14} /> {t('viewMenu.moveTabRight')} <Kbd shortcut={CANVAS_SHORTCUTS.moveTabRight} />
                    </Menu.Item>
                    <Menu.Item disabled={tabs.length < 2 || !splittable} onClick={() => useDocument.getState().splitTabOff(viewId)}>
                        <Icon icon={PanelRight} size={14} /> {t('viewMenu.moveTabToNewCell')}
                    </Menu.Item>
                </Menu.Popup>
            </Menu.SubmenuRoot>
            <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger>
                    <Icon icon={Columns3} size={14} /> {t('viewMenu.cell')}
                </Menu.SubmenuTrigger>
                <Menu.Popup>
                    <SplitItems at={at} />
                </Menu.Popup>
            </Menu.SubmenuRoot>
            <Menu.Separator />
        </>
    );
}
