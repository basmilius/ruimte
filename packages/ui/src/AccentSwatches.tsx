import clsx from 'clsx';
import { Menu } from '@base-ui-components/react/menu';
import { Check, Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ACCENT_SWATCH } from './classes.ts';
import { Icon } from './Icon.tsx';
import { MenuCheck } from './MenuCheck.tsx';
import { MenuPopup } from './MenuPopup.tsx';
import { Tooltip } from './Tooltip.tsx';

const RING = 'ring-2 ring-accent ring-offset-2 ring-offset-surface';

export interface AccentSwatchesProps<Id extends string> {
    value: string | undefined;
    onChange(id: Id): void;
    label: string;
    /* Every color on offer, in the order of the list behind the featured ones. */
    accents: readonly { id: Id; color: string }[];
    /* The few drawn in the open, in the order they stand. */
    featured: readonly Id[];
    labelOf(id: Id): string;
}

/*
 * An accent, a few colors at a time. A palette is more than a settings row can carry, so the list
 * behind them holds all of them, the featured ones included; the trigger wears the chosen color
 * itself whenever that color is not one of the few. A value that is no accent at all picks nothing.
 */
export function AccentSwatches<Id extends string>({ value, onChange, label, accents, featured, labelOf }: AccentSwatchesProps<Id>) {
    const { t } = useTranslation('ui');
    const isFeatured = (id: string): boolean => featured.some((entry) => entry === id);
    const colorOf = (id: string): string | undefined => accents.find((entry) => entry.id === id)?.color;
    const shown = accents.filter((entry) => isFeatured(entry.id)).sort((a, b) => featured.indexOf(a.id) - featured.indexOf(b.id));
    const hidden = value !== undefined && !isFeatured(value) && colorOf(value) !== undefined ? value : null;
    return (
        <div className="flex items-center gap-2" role="radiogroup" aria-label={label}>
            {shown.map((entry) => (
                <Tooltip key={entry.id} label={labelOf(entry.id)}>
                    <button
                        type="button"
                        role="radio"
                        aria-checked={value === entry.id}
                        aria-label={labelOf(entry.id)}
                        className={clsx(ACCENT_SWATCH, value === entry.id && RING)}
                        style={{ background: entry.color }}
                        onClick={() => onChange(entry.id)}
                    >
                        {value === entry.id && <Icon icon={Check} size={12} />}
                    </button>
                </Tooltip>
            ))}
            <Menu.Root>
                <Tooltip label={t('accent.more')}>
                    <Menu.Trigger
                        aria-label={t('accent.more')}
                        className={clsx(ACCENT_SWATCH, hidden ? RING : 'border border-border-strong text-text-muted')}
                        style={hidden ? { background: colorOf(hidden) } : undefined}
                    >
                        <Icon icon={hidden ? Check : Ellipsis} size={12} />
                    </Menu.Trigger>
                </Tooltip>
                <MenuPopup align="end" className="max-h-96 overflow-y-auto">
                    <Menu.RadioGroup value={value ?? null} onValueChange={(id: Id) => onChange(id)}>
                        {accents.map((entry) => (
                            <Menu.RadioItem key={entry.id} value={entry.id} className="menu-item">
                                <MenuCheck kind="radio" />
                                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: entry.color }} aria-hidden />
                                <span className="grow">{labelOf(entry.id)}</span>
                            </Menu.RadioItem>
                        ))}
                    </Menu.RadioGroup>
                </MenuPopup>
            </Menu.Root>
        </div>
    );
}
