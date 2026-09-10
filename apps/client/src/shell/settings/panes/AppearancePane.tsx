import clsx from 'clsx';
import { Check } from 'lucide-react';
import { NODE_ACCENTS } from '@/canvas/accents';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented, Stepper, Toggle } from '@/shell/settings/controls';
import { FONT_SIZE_RANGE, INTERFACE_FONT_SIZE_RANGE, MONO_FONTS, useSettings } from '@/state/settings';
import { useTheme, type Theme } from '@/state/theme';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

const THEMES: Array<{ id: Theme; label: string }> = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' }
];

function AccentSwatches() {
    const accent = useSettings((s) => s.accent);
    const update = useSettings((s) => s.update);
    const ring = 'ring-2 ring-accent ring-offset-2 ring-offset-surface';
    return (
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Accent">
            <Tooltip label="Theme default">
                <button
                    role="radio"
                    aria-checked={accent === null}
                    aria-label="Theme default"
                    className={clsx('grid h-6 w-6 place-items-center rounded-full border border-border-strong text-text-muted', accent === null && ring)}
                    onClick={() => update({ accent: null })}
                >
                    {accent === null && <Icon icon={Check} size={12} />}
                </button>
            </Tooltip>
            {NODE_ACCENTS.map((entry) => (
                <Tooltip key={entry.id} label={entry.label}>
                    <button
                        role="radio"
                        aria-checked={accent === entry.id}
                        aria-label={entry.label}
                        className={clsx('grid h-6 w-6 place-items-center rounded-full text-accent-text', accent === entry.id && ring)}
                        style={{ background: entry.color }}
                        onClick={() => update({ accent: entry.id })}
                    >
                        {accent === entry.id && <Icon icon={Check} size={12} />}
                    </button>
                </Tooltip>
            ))}
        </div>
    );
}

export function AppearancePane() {
    const theme = useTheme((t) => t.theme);
    const setTheme = useTheme((t) => t.setTheme);
    const font = useSettings((s) => s.font);
    const fontSize = useSettings((s) => s.fontSize);
    const interfaceFontSize = useSettings((s) => s.interfaceFontSize);
    const dockAutoHide = useSettings((s) => s.dockAutoHide);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title="Theme">
                <SettingsRow
                    label="Theme"
                    description="System follows the OS and switches with it."
                    control={<Segmented value={theme} options={THEMES} onChange={setTheme} label="Theme" />}
                />
                <SettingsRow
                    label="Accent"
                    description="Selection rings, focus and the terminal cursor. The default is the theme's own."
                    control={<AccentSwatches />}
                />
            </SettingsSection>
            <SettingsSection title="Interface">
                <SettingsRow
                    label="Interface font size"
                    description="Text, rows and spacing everywhere but the terminal and code."
                    control={
                        <Stepper
                            value={interfaceFontSize}
                            min={INTERFACE_FONT_SIZE_RANGE.min}
                            max={INTERFACE_FONT_SIZE_RANGE.max}
                            step={INTERFACE_FONT_SIZE_RANGE.step}
                            unit=" px"
                            label="Interface font size"
                            onChange={(value) => update({ interfaceFontSize: value })}
                        />
                    }
                />
                <SettingsRow
                    label="Hide the dock"
                    description="The bar under a canvas or a drawing waits below the edge and comes back when the pointer nears the bottom."
                    control={<Toggle checked={dockAutoHide} onChange={(checked) => update({ dockAutoHide: checked })} label="Hide the dock" />}
                />
            </SettingsSection>
            <SettingsSection title="Terminal" description="Every terminal node picks these up the moment they change.">
                <SettingsRow
                    label="Font"
                    description="A font that is not installed falls back to the system one."
                    control={
                        <Select
                            value={font}
                            label="Terminal font"
                            align="end"
                            items={MONO_FONTS.map((entry) => ({ value: entry.id, label: entry.label }))}
                            onValueChange={(value) => update({ font: value })}
                        />
                    }
                />
                <SettingsRow
                    label="Font size"
                    description="Open terminals refit their rows and columns."
                    control={
                        <Stepper
                            value={fontSize}
                            min={FONT_SIZE_RANGE.min}
                            max={FONT_SIZE_RANGE.max}
                            step={FONT_SIZE_RANGE.step}
                            unit=" px"
                            label="Font size"
                            onChange={(value) => update({ fontSize: value })}
                        />
                    }
                />
            </SettingsSection>
        </>
    );
}
