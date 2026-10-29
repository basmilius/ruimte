import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canSwipeBetweenPages } from '@/desktop/bridge';
import { SettingsRow, useSettingsTarget } from '@adecore/ui/settings';
import { Segmented, Switch, Keys, shortcut } from '@adecore/ui';
import { RENDER_DISTANCES, type RenderDistance } from '@/canvas/render-distance';
import { NodeSizeSection } from '@/shell/settings/NodeSizeSection';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { useSettings } from '@/state/settings';

type ViewTab = 'canvas' | 'drawing' | 'browser';

const MOD_HELD = shortcut('Mod');

/* The tab that holds the row a search result names, by the prefix of its id. New node sizes live on a canvas. */
function tabOfTarget(target: string | null): ViewTab | null {
    if (target === null) {
        return null;
    }

    if (target.startsWith('views.drawing.')) {
        return 'drawing';
    }

    if (target.startsWith('views.browser.')) {
        return 'browser';
    }

    return target.startsWith('views.') ? 'canvas' : null;
}

function CanvasTab() {
    const { t } = useTranslation('settings');
    const renderDistance = useSettings((s) => s.canvasRenderDistance);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection>
                <SettingSwitchRow id="views.canvas.minimap" setting="canvasMinimap" />
            </SettingsSection>
            {/* Read by every window on this computer, so it carries the computer's tag apart from the map above. */}
            <SettingsSection scope="computer">
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
            <NodeSizeSection />
        </>
    );
}

function DrawingTab() {
    const { t } = useTranslation('settings');
    const drawingSnap = useSettings((s) => s.drawingSnap);
    const update = useSettings((s) => s.update);

    return (
        <SettingsSection>
            <SettingsRow
                searchId="views.drawing.snap"
                label={t('views.drawing.snap.label')}
                description={t('views.drawing.snap.description')}
                control={
                    <>
                        <Keys shortcut={MOD_HELD} then={t('gesture.drag')} />
                        <Switch checked={drawingSnap} onCheckedChange={(checked) => update({ drawingSnap: checked })} label={t('views.drawing.snap.label')} />
                    </>
                }
            />
        </SettingsSection>
    );
}

/*
 * A tab per kind of view: a canvas, a drawing, a browser page. Zoom, locks and layouts act on the
 * canvas that is open, so they stay in the dock and the palette instead of here.
 */
export function ViewsPane() {
    const { t } = useTranslation('settings');
    const { target } = useSettingsTarget();
    // A browser page has one setting, and only where the trackpad can swipe; elsewhere its tab would be empty.
    const tabs: readonly ViewTab[] = canSwipeBetweenPages() ? ['canvas', 'drawing', 'browser'] : ['canvas', 'drawing'];
    const [tab, setTab] = useState<ViewTab>(() => tabOfTarget(target) ?? 'canvas');
    const [seenTarget, setSeenTarget] = useState(target);

    // A search result opens its own tab; adjusted while rendering so the row exists in the frame it is lit.
    if (target !== seenTarget) {
        setSeenTarget(target);
        const next = tabOfTarget(target);

        if (next !== null) {
            setTab(next);
        }
    }

    return (
        <>
            <Segmented<ViewTab>
                value={tab}
                options={tabs.map((id) => ({ id, label: t(`views.${id}.title`) }))}
                label={t('views.tabs')}
                onValueChange={setTab}
            />
            {tab === 'canvas' && <CanvasTab />}
            {tab === 'drawing' && <DrawingTab />}
            {tab === 'browser' && (
                <SettingsSection>
                    <SettingSwitchRow id="views.browser.swipe" setting="browserSwipe" />
                </SettingsSection>
            )}
        </>
    );
}
