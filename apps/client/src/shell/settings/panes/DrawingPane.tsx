import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Keys, Toggle } from '@/shell/settings/controls';
import { useSettings } from '@/state/settings';

/* What a drawing view does while you draw; the tools themselves sit in its own dock. */
export function DrawingPane() {
    const drawingSnap = useSettings((s) => s.drawingSnap);
    const update = useSettings((s) => s.update);

    return (
        <SettingsSection title="Drawing" description="A sketch is freehand by default; the grid is there when you want it.">
            <SettingsRow
                label="Snap to the grid"
                description="Corners, moves and resizes land on the 8 unit grid. Freehand never snaps."
                control={
                    <>
                        <Keys keys="⌘ drag" />
                        <Toggle checked={drawingSnap} onChange={(checked) => update({ drawingSnap: checked })} label="Snap to the grid" />
                    </>
                }
            />
        </SettingsSection>
    );
}
