import { useTranslation } from 'react-i18next';
import { canSwipeBetweenPages } from '@/desktop/bridge';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { Keys } from '@/ui/Kbd';
import { useSettings } from '@/state/settings';
import { shortcut } from '@/ui/shortcut';

const MOD_HELD = shortcut('Mod');

/* A section per kind of view. Zoom, locks and layouts act on the canvas that is open, so they stay in the dock and the palette instead of here. */
export function ViewsPane() {
    const { t } = useTranslation('settings');
    const drawingSnap = useSettings((s) => s.drawingSnap);
    const browserSwipe = useSettings((s) => s.browserSwipe);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title={t('views.drawing.title')}>
                <SettingsRow
                    label={t('views.drawing.snap.label')}
                    description={t('views.drawing.snap.description')}
                    control={
                        <>
                            <Keys shortcut={MOD_HELD} then={t('gesture.drag')} />
                            <Toggle checked={drawingSnap} onChange={(checked) => update({ drawingSnap: checked })} label={t('views.drawing.snap.label')} />
                        </>
                    }
                />
            </SettingsSection>
            {canSwipeBetweenPages() && (
                <SettingsSection title={t('views.browser.title')}>
                    <SettingsRow
                        label={t('views.browser.swipe.label')}
                        description={t('views.browser.swipe.description')}
                        control={
                            <Toggle checked={browserSwipe} onChange={(checked) => update({ browserSwipe: checked })} label={t('views.browser.swipe.label')} />
                        }
                    />
                </SettingsSection>
            )}
        </>
    );
}
