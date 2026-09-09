import { Maximize, Scan, Trash2 } from 'lucide-react';
import { activeZoomPreset, ZOOM_PRESETS } from '@/canvas/math';
import { LOCK_ROWS } from '@/canvas/locks';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Keys, Segmented, Toggle, buttonClass } from '@/shell/settings/controls';
import { useCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { Tooltip } from '@/ui/Tooltip';

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
                            onChange={(value) => useCanvas.getState().zoomTo(Number(value) / 100)}
                        />
                    }
                />
                <SettingsRow
                    label="Zoom to fit"
                    description="Every node and text in view."
                    control={
                        <>
                            <Keys keys="⇧ 1" />
                            <button className={buttonClass} onClick={() => useCanvas.getState().fitAll()}>
                                <Maximize size={13} /> Fit
                            </button>
                        </>
                    }
                />
                <SettingsRow
                    label="Zoom to selection"
                    description={hasSelection ? 'Frame the selected nodes.' : 'Select nodes on the canvas first.'}
                    control={
                        <>
                            <Keys keys="⇧ 2" />
                            <button className={buttonClass} disabled={!hasSelection} onClick={() => useCanvas.getState().zoomToSelection()}>
                                <Scan size={13} /> Frame
                            </button>
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
                                onChange={() => useCanvas.getState().toggleLock(row.key)}
                            />
                        }
                    />
                ))}
            </SettingsSection>
            <SettingsSection
                title="Layouts"
                description="Named arrangements of this project's nodes."
                action={
                    <button className={buttonClass} onClick={() => useUi.getState().setLayoutDialogOpen(true)}>
                        Save current
                    </button>
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
                                <button className={buttonClass} onClick={() => useCanvas.getState().applyLayout(layout.name)}>
                                    Apply
                                </button>
                                <Tooltip label="Delete layout">
                                    <button
                                        className="icon-btn h-8 w-8"
                                        aria-label={`Delete layout ${layout.name}`}
                                        onClick={() => useCanvas.getState().deleteLayout(layout.name)}
                                    >
                                        <Trash2 size={13} />
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
