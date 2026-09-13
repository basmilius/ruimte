import { Maximize, Scan, Trash } from 'lucide-react';
import { activeZoomPreset, ZOOM_PRESETS } from '@/canvas/math';
import { LOCK_ROWS } from '@/canvas/locks';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Keys, Segmented, Toggle } from '@/shell/settings/controls';
import { Button } from '@/ui/Button';
import { focusedCanvas, useCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

const PRESET_OPTIONS = ZOOM_PRESETS.map((pct) => ({ id: String(pct), label: `${pct}%` }));

/* Nothing here is a stored preference: the rows act on the canvas that is open right now. */
export function CanvasPane() {
    const zoom = useCanvas((s) => s.camera.zoom);
    const hasSelection = useCanvas((s) => s.selection.length > 0);
    const locks = useCanvas((s) => s.locks);
    const layouts = useCanvas((s) => s.layouts);
    const preset = activeZoomPreset(zoom);

    return (
        <>
            <SettingsSection title="Zoom" description="The dock's zoom menu, laid out in full.">
                <SettingsRow
                    label="Zoom level"
                    description={preset === null ? `Now at ${Math.round(zoom * 100)}%, between presets.` : undefined}
                    control={
                        <Segmented
                            value={preset === null ? '' : String(preset)}
                            options={PRESET_OPTIONS}
                            label="Zoom level"
                            onChange={(value) =>
                                focusedCanvas()
                                    .getState()
                                    .zoomTo(Number(value) / 100)
                            }
                        />
                    }
                />
                <SettingsRow
                    label="Zoom to fit"
                    description="Every node and text in view."
                    control={
                        <>
                            <Keys keys="⇧ 1" />
                            <Button variant="secondary" onClick={() => focusedCanvas().getState().fitAll()}>
                                <Icon icon={Maximize} size={12} /> Fit
                            </Button>
                        </>
                    }
                />
                <SettingsRow
                    label="Zoom to selection"
                    description={hasSelection ? 'Frame the selected nodes.' : 'Select nodes on the canvas first.'}
                    control={
                        <>
                            <Keys keys="⇧ 2" />
                            <Button variant="secondary" disabled={!hasSelection} onClick={() => focusedCanvas().getState().zoomToSelection()}>
                                <Icon icon={Scan} size={12} /> Frame
                            </Button>
                        </>
                    }
                />
            </SettingsSection>
            <SettingsSection title="Locks" description="Buttons and shortcuts still work while something is locked.">
                {LOCK_ROWS.map((row) => (
                    <SettingsRow
                        key={row.key}
                        label={row.label}
                        description={row.hint}
                        control={
                            <Toggle
                                checked={locks[row.key]}
                                label={`Lock ${row.label.toLowerCase()}`}
                                onChange={() => focusedCanvas().getState().toggleLock(row.key)}
                            />
                        }
                    />
                ))}
            </SettingsSection>
            <SettingsSection
                title="Layouts"
                description="Named arrangements of this project's nodes."
                action={
                    <Button variant="secondary" onClick={() => useUi.getState().setLayoutDialogOpen(true)}>
                        Save current
                    </Button>
                }
            >
                {layouts.length === 0 && (
                    <SettingsRow muted label="No layouts saved yet" description="Arrange the canvas, then save it under a name to come back to it." />
                )}
                {layouts.map((layout) => (
                    <SettingsRow
                        key={layout.name}
                        label={layout.name}
                        description={`${Object.keys(layout.nodes).length} nodes`}
                        control={
                            <>
                                <Button variant="secondary" onClick={() => focusedCanvas().getState().applyLayout(layout.name)}>
                                    Apply
                                </Button>
                                <Tooltip label="Delete layout">
                                    <button
                                        className="icon-btn h-8 w-8"
                                        aria-label={`Delete layout ${layout.name}`}
                                        onClick={() => focusedCanvas().getState().deleteLayout(layout.name)}
                                    >
                                        <Icon icon={Trash} size={16} />
                                    </button>
                                </Tooltip>
                            </>
                        }
                    />
                ))}
            </SettingsSection>
        </>
    );
}
