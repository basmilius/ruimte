import clsx from 'clsx';
import { Menu } from '@base-ui-components/react/menu';
import { Check, Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accentColor, accentLabel, FEATURED_ACCENTS, isFeatured, NODE_ACCENTS, type AccentId } from '@/canvas/accents';
import { ACCENT_SWATCH } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { MenuCheck } from '@/ui/MenuCheck';
import { MenuPopup } from '@/ui/MenuPopup';
import { Tooltip } from '@/ui/Tooltip';

const RING = 'ring-2 ring-accent ring-offset-2 ring-offset-surface';

/*
 * An accent, five colors at a time. Every Tailwind hue is on offer, which is more than a settings
 * row can carry, so the list behind them holds all of them in the order of the wheel, the five
 * included; the trigger wears the chosen color itself whenever that color is not one of the five.
 * A value that is no accent at all picks nothing.
 */
export function AccentSwatches({ value, onChange, label }: { value: string | undefined; onChange(id: AccentId): void; label: string }) {
    const { t } = useTranslation('settings');
    const featured = NODE_ACCENTS.filter((entry) => isFeatured(entry.id)).sort((a, b) => FEATURED_ACCENTS.indexOf(a.id) - FEATURED_ACCENTS.indexOf(b.id));
    const hidden = value !== undefined && !isFeatured(value) && accentColor(value) !== undefined ? value : null;
    return (
        <div className="flex items-center gap-2" role="radiogroup" aria-label={label}>
            {featured.map((entry) => (
                <Tooltip key={entry.id} label={accentLabel(entry.id)}>
                    <button
                        type="button"
                        role="radio"
                        aria-checked={value === entry.id}
                        aria-label={accentLabel(entry.id)}
                        className={clsx(ACCENT_SWATCH, value === entry.id && RING)}
                        style={{ background: entry.color }}
                        onClick={() => onChange(entry.id)}
                    >
                        {value === entry.id && <Icon icon={Check} size={12} />}
                    </button>
                </Tooltip>
            ))}
            <Menu.Root>
                <Tooltip label={t('appearance.accent.more')}>
                    <Menu.Trigger
                        aria-label={t('appearance.accent.more')}
                        className={clsx(ACCENT_SWATCH, hidden ? RING : 'border border-border-strong text-text-muted')}
                        style={hidden ? { background: accentColor(hidden) } : undefined}
                    >
                        <Icon icon={hidden ? Check : Ellipsis} size={12} />
                    </Menu.Trigger>
                </Tooltip>
                <MenuPopup align="end" className="max-h-96 overflow-y-auto">
                    <Menu.RadioGroup value={value ?? null} onValueChange={(id: AccentId) => onChange(id)}>
                        {NODE_ACCENTS.map((entry) => (
                            <Menu.RadioItem key={entry.id} value={entry.id} className="menu-item">
                                <MenuCheck kind="radio" />
                                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: entry.color }} aria-hidden />
                                <span className="grow">{accentLabel(entry.id)}</span>
                            </Menu.RadioItem>
                        ))}
                    </Menu.RadioGroup>
                </MenuPopup>
            </Menu.Root>
        </div>
    );
}
