import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Keys, Toggle } from '@/shell/settings/controls';
import { useSettings } from '@/state/settings';
import { shortcut } from '@/ui/shortcut';

const MOD_HELD = shortcut('Mod');

/* Only preferences: zoom, locks and layouts act on the canvas that is open, so they stay in the dock and the palette. */
export function CanvasPane() {
    const drawingSnap = useSettings((s) => s.drawingSnap);
    const update = useSettings((s) => s.update);

    return (
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
    );
}
