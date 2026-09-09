import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { Check, X } from 'lucide-react';
import { NODE_ACCENTS } from '@/canvas/accents';
import { MONO_FONTS, useSettings } from '@/state/settings';
import { useTheme, type Theme } from '@/state/theme';
import { useUi } from '@/state/ui';
import { Tooltip } from '@/ui/Tooltip';

const THEMES: Array<{ id: Theme; label: string }> = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' }
];

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ id: T; label: string }>; onChange(id: T): void }) {
    return (
        <div className="flex h-8 items-center rounded-lg bg-surface-sunken p-0.5 text-[12px] font-medium" role="radiogroup">
            {options.map((option) => (
                <button
                    key={option.id}
                    role="radio"
                    aria-checked={value === option.id}
                    className={clsx(
                        'h-7 rounded-md px-3 transition-colors',
                        value === option.id ? 'bg-surface-raised text-text shadow-sm' : 'text-text-muted hover:text-text'
                    )}
                    onClick={() => onChange(option.id)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

/* Theme, font and accent. Everything else is a default on purpose. */
export function SettingsDialog() {
    const open = useUi((s) => s.settingsOpen);
    const setOpen = useUi((s) => s.setSettingsOpen);
    const theme = useTheme((t) => t.theme);
    const setTheme = useTheme((t) => t.setTheme);
    const accent = useSettings((s) => s.accent);
    const font = useSettings((s) => s.font);
    const update = useSettings((s) => s.update);

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup top-[24vh] w-[420px] p-5">
                    <div className="flex items-center">
                        <Dialog.Title className="text-[15px] font-semibold text-text">Settings</Dialog.Title>
                        <span className="grow" />
                        <Dialog.Close className="icon-btn h-7 w-7" aria-label="Close">
                            <X size={14} />
                        </Dialog.Close>
                    </div>
                    <div className="mt-4 flex flex-col gap-4">
                        <label className="flex items-center justify-between gap-4 text-[13px] text-text">
                            Theme
                            <Segmented value={theme} options={THEMES} onChange={setTheme} />
                        </label>
                        <label className="flex items-center justify-between gap-4 text-[13px] text-text">
                            Terminal font
                            <select
                                className="h-8 rounded-lg border border-border bg-surface-raised px-2 text-[12px] text-text outline-none focus-visible:ring-1 focus-visible:ring-accent"
                                value={font}
                                onChange={(e) => update({ font: e.target.value as typeof font })}
                            >
                                {MONO_FONTS.map((entry) => (
                                    <option key={entry.id} value={entry.id}>
                                        {entry.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="flex items-center justify-between gap-4 text-[13px] text-text">
                            Accent
                            <div className="flex items-center gap-1.5" role="radiogroup">
                                <Tooltip label="Theme default">
                                    <button
                                        role="radio"
                                        aria-checked={accent === null}
                                        className={clsx(
                                            'grid h-6 w-6 place-items-center rounded-full border border-border-strong',
                                            accent === null && 'ring-2 ring-accent ring-offset-2 ring-offset-surface-raised'
                                        )}
                                        onClick={() => update({ accent: null })}
                                    >
                                        {accent === null && <Check size={12} />}
                                    </button>
                                </Tooltip>
                                {NODE_ACCENTS.map((entry) => (
                                    <Tooltip key={entry.id} label={entry.label}>
                                        <button
                                            role="radio"
                                            aria-checked={accent === entry.id}
                                            className={clsx(
                                                'grid h-6 w-6 place-items-center rounded-full text-accent-text',
                                                accent === entry.id && 'ring-2 ring-accent ring-offset-2 ring-offset-surface-raised'
                                            )}
                                            style={{ background: entry.color }}
                                            onClick={() => update({ accent: entry.id })}
                                        >
                                            {accent === entry.id && <Check size={12} strokeWidth={3} />}
                                        </button>
                                    </Tooltip>
                                ))}
                            </div>
                        </div>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
