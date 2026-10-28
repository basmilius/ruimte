import { Globe, MapIcon, PenTool } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { canSwipeBetweenPages } from '@/desktop/bridge';
import { SettingsRow } from '@adecore/ui/settings';
import { Segmented, Switch, Keys, shortcut } from '@adecore/ui';
import { RENDER_DISTANCES, type RenderDistance } from '@/canvas/render-distance';
import { NodeSizeSections } from '@/shell/settings/NodeSizeSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { useSettings } from '@/state/settings';

const MOD_HELD = shortcut('Mod');

/* What new nodes start at, then a section per kind of view. Zoom, locks and layouts act on the canvas that is open, so they stay in the dock and the palette instead of here. */
export function ViewsPane() {
    const { t } = useTranslation('settings');
    const drawingSnap = useSettings((s) => s.drawingSnap);
    const renderDistance = useSettings((s) => s.canvasRenderDistance);
    const update = useSettings((s) => s.update);

    return (
        <>
            <NodeSizeSections />
            <SettingsSection title={t('views.canvas.title')} icon={MapIcon}>
                <SettingSwitchRow id="views.canvas.minimap" setting="canvasMinimap" />
                <SettingsRow
                    searchId="views.canvas.renderDistance"
                    label={t('views.canvas.renderDistance.label')}
                    description={t('views.canvas.renderDistance.description')}
                    control={
                        <Segmented<RenderDistance>
                            value={renderDistance}
                            options={RENDER_DISTANCES.map((id) => ({ id, label: t(`views.canvas.renderDistance.options.${id}`) }))}
                            label={t('views.canvas.renderDistance.label')}
                            onValueChange={(value) => update({ canvasRenderDistance: value })}
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
                    <SettingSwitchRow id="views.browser.swipe" setting="browserSwipe" />
                </SettingsSection>
            )}
        </>
    );
}
