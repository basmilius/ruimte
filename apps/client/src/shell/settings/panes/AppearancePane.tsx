import clsx from 'clsx';
import { Menu } from '@base-ui-components/react/menu';
import { Check, Ellipsis } from 'lucide-react';
import { accentColor, FEATURED_ACCENTS, isFeatured, NODE_ACCENTS, type AccentId } from '@/canvas/accents';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented, Stepper, Toggle } from '@/shell/settings/controls';
import { FONT_SIZE_RANGE, INTERFACE_FONT_SIZE_RANGE, MONO_FONTS, useSettings, type SidebarScope } from '@/state/settings';
import { useTheme, type Theme } from '@/state/theme';
import { ACCENT_SWATCH, ACCENT_SWATCH_PICKED } from '@/ui/classes';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

const SIDEBAR_SCOPES: Array<{ id: SidebarScope; label: string }> = [
    { id: 'project', label: 'This project' },
    { id: 'window', label: 'This window' }
];

const THEMES: Array<{ id: Theme; label: string }> = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' }
];

/*
 * The accent, five colors at a time. Every Tailwind hue is on offer, which is more than a settings
 * row can carry, so the wheel past the five sits in a menu behind them; the trigger wears the
 * chosen color itself whenever that color is one of the ones it hides.
 */
function AccentSwatches() {
    const accent = useSettings((s) => s.accent);
    const update = useSettings((s) => s.update);
    const ring = 'ring-2 ring-accent ring-offset-2 ring-offset-surface';
    const featured = NODE_ACCENTS.filter((entry) => isFeatured(entry.id)).sort((a, b) => FEATURED_ACCENTS.indexOf(a.id) - FEATURED_ACCENTS.indexOf(b.id));
    const rest = NODE_ACCENTS.filter((entry) => !isFeatured(entry.id));
    const hidden = isFeatured(accent) ? null : accent;
    const pick = (id: AccentId): void => update({ accent: id });
    return (
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Accent">
            {featured.map((entry) => (
                <Tooltip key={entry.id} label={entry.label}>
                    <button
                        role="radio"
                        aria-checked={accent === entry.id}
                        aria-label={entry.label}
                        className={clsx(ACCENT_SWATCH, accent === entry.id && ring)}
                        style={{ background: entry.color }}
                        onClick={() => pick(entry.id)}
                    >
                        {accent === entry.id && <Icon icon={Check} size={12} />}
                    </button>
                </Tooltip>
            ))}
            <Menu.Root>
                <Tooltip label="More colors">
                    <Menu.Trigger
                        aria-label="More colors"
                        className={clsx(ACCENT_SWATCH, hidden ? ring : 'border border-border-strong text-text-muted')}
                        style={hidden ? { background: accentColor(hidden) } : undefined}
                    >
                        <Icon icon={hidden ? Check : Ellipsis} size={12} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-[var(--z-popup)]" side="bottom" align="end" sideOffset={6}>
                        <Menu.Popup className="menu-popup grid min-w-0 grid-cols-6 gap-1 p-2">
                            {rest.map((entry) => (
                                <Tooltip key={entry.id} label={entry.label}>
                                    <Menu.Item
                                        aria-label={entry.label}
                                        className={clsx(ACCENT_SWATCH, accent === entry.id && ACCENT_SWATCH_PICKED)}
                                        style={{ background: entry.color }}
                                        onClick={() => pick(entry.id)}
                                    >
                                        {accent === entry.id && <Icon icon={Check} size={12} />}
                                    </Menu.Item>
                                </Tooltip>
                            ))}
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
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
    const sidebarScope = useSettings((s) => s.sidebarScope);
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
                    description="Selection rings, focus and the terminal cursor. Blue is the one Ruimte carries."
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
                    label="Sidebar"
                    description="This window lists every project open in it, each under its own name. This project lists the one you are working in."
                    control={
                        <Segmented
                            value={sidebarScope}
                            options={SIDEBAR_SCOPES}
                            onChange={(id) => update({ sidebarScope: id })}
                            label="What the sidebar lists"
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
