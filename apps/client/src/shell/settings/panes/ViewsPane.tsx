import { Globe, MapIcon, PenTool } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { canSwipeBetweenPages } from '@/desktop/bridge';
import { SettingsRow } from '@adecore/ui/settings';
import { Switch, Keys, shortcut } from '@adecore/ui';
import { NodeSizeSections } from '@/shell/settings/NodeSizeSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useSettings } from '@/state/settings';

const MOD_HELD = shortcut('Mod');

/* What new nodes start at, then a section per kind of view. Zoom, locks and layouts act on the canvas that is open, so they stay in the dock and the palette instead of here. */
export function ViewsPane() {
    const { t } = useTranslation('settings');
    const canvasMinimap = useSettings((s) => s.canvasMinimap);
    const drawingSnap = useSettings((s) => s.drawingSnap);
    const browserSwipe = useSettings((s) => s.browserSwipe);
    const update = useSettings((s) => s.update);

    return (
        <>
            <NodeSizeSections />
            <SettingsSection title={t('views.canvas.title')} icon={MapIcon}>
                <SettingsRow
                    searchId="views.canvas.minimap"
                    label={t('views.canvas.minimap.label')}
                    description={t('views.canvas.minimap.description')}
                    control={
                        <Switch
                            checked={canvasMinimap}
                            onCheckedChange={(checked) => update({ canvasMinimap: checked })}
                            label={t('views.canvas.minimap.label')}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('views.drawing.title')} icon={PenTool}>
                <SettingsRow
                    searchId="views.drawing.snap"
                    label={t('views.drawing.snap.label')}
                    description={t('views.drawing.snap.description')}
                    control={
                        <>
                            <Keys shortcut={MOD_HELD} then={t('gesture.drag')} />
                            <Switch
                                checked={drawingSnap}
                                onCheckedChange={(checked) => update({ drawingSnap: checked })}
                                label={t('views.drawing.snap.label')}
                            />
                        </>
                    }
                />
            </SettingsSection>
            {canSwipeBetweenPages() && (
                <SettingsSection title={t('views.browser.title')} icon={Globe}>
                    <SettingsRow
                        searchId="views.browser.swipe"
                        label={t('views.browser.swipe.label')}
                        description={t('views.browser.swipe.description')}
                        control={
                            <Switch
                                checked={browserSwipe}
                                onCheckedChange={(checked) => update({ browserSwipe: checked })}
                                label={t('views.browser.swipe.label')}
                            />
                        }
                    />
                </SettingsSection>
            )}
        </>
    );
}
