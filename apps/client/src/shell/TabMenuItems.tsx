import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, PanelRight } from 'lucide-react';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { canSplit, cellAt, locateView } from '@/shell/split';
import { useDocument } from '@/state/document';
import { Icon, Kbd, Menu } from '@adecore/ui';

/* What a tab can do with its place in the strip. Nothing at all for a view that is no tab of a host. */
export function TabMenuItems({ viewId }: { viewId: string }) {
    const { t } = useTranslation('shell');
    const tabs = useDocument((s) => {
        const at = s.layout === null ? null : locateView(s.layout, viewId);
        return s.layout === null || at === null ? undefined : cellAt(s.layout, at)?.tabs;
    });
    const splittable = useDocument((s) => {
        const at = s.layout === null ? null : locateView(s.layout, viewId);
        return s.layout !== null && at !== null && canSplit(s.layout, at, 'right', viewId);
    });
    if (tabs === undefined) {
        return null;
    }
    const index = tabs.indexOf(viewId);
    return (
        <>
            <Menu.Item disabled={index < 1} onClick={() => useDocument.getState().moveTab(viewId, -1)}>
                <Icon icon={ArrowLeft} size={14} /> {t('viewMenu.moveTabLeft')} <Kbd shortcut={CANVAS_SHORTCUTS.moveTabLeft} />
            </Menu.Item>
            <Menu.Item disabled={index === tabs.length - 1} onClick={() => useDocument.getState().moveTab(viewId, 1)}>
                <Icon icon={ArrowRight} size={14} /> {t('viewMenu.moveTabRight')} <Kbd shortcut={CANVAS_SHORTCUTS.moveTabRight} />
            </Menu.Item>
            <Menu.Item disabled={tabs.length < 2 || !splittable} onClick={() => useDocument.getState().splitTabOff(viewId)}>
                <Icon icon={PanelRight} size={14} /> {t('viewMenu.moveTabToNewCell')}
            </Menu.Item>
            <Menu.Separator />
        </>
    );
}
