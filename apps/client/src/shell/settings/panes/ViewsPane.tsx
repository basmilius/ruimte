import { canSwipeBetweenPages } from '@/desktop/bridge';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Keys, Toggle } from '@/shell/settings/controls';
import { useSettings } from '@/state/settings';
import { shortcut } from '@/ui/shortcut';

const MOD_HELD = shortcut('Mod');

/* A section per kind of view. Only preferences: zoom, locks and layouts act on the canvas that is open, so they stay in the dock and the palette. */
export function ViewsPane() {
    const drawingSnap = useSettings((s) => s.drawingSnap);
    const browserSwipe = useSettings((s) => s.browserSwipe);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title="Drawing">
                <SettingsRow
                    label="Snap to the grid"
                    description="Shapes land on the 8 unit grid when you draw, move or resize them. Freehand strokes never snap."
                    control={
                        <>
                            <Keys shortcut={MOD_HELD} then="drag" />
                            <Toggle checked={drawingSnap} onChange={(checked) => update({ drawingSnap: checked })} label="Snap to the grid" />
                        </>
                    }
                />
            </SettingsSection>
            {canSwipeBetweenPages() && (
                <SettingsSection title="Browser">
                    <SettingsRow
                        label="Swipe between pages"
                        description="Two fingers left or right on the trackpad go back or forward in a browser node or view. A page that scrolls sideways itself keeps the gesture."
                        control={<Toggle checked={browserSwipe} onChange={(checked) => update({ browserSwipe: checked })} label="Swipe between pages" />}
                    />
                </SettingsSection>
            )}
        </>
    );
}
