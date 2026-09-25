import clsx from 'clsx';
import { Switch } from '@base-ui-components/react/switch';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';
import { BTN_GROUP } from '@/ui/classes';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

/* The shared controls of the settings panes; each one is small enough to read at a glance. */

interface Option<T extends string> {
    id: T;
    label: string;
}

export function Segmented<T extends string>({
    value,
    options,
    onChange,
    label,
    disabled
}: {
    value: T;
    options: readonly Option<T>[];
    onChange(id: T): void;
    label: string;
    disabled?: boolean;
}) {
    return (
        <div className="flex h-8 items-center rounded-lg bg-surface-sunken p-0.5 text-xs font-medium" role="radiogroup" aria-label={label}>
            {options.map((option) => (
                <button
                    key={option.id}
                    role="radio"
                    aria-checked={value === option.id}
                    disabled={disabled}
                    className={clsx(
                        'h-7 rounded-md px-3 transition-colors disabled:opacity-50',
                        value === option.id ? 'bg-surface-raised text-text shadow-node' : 'text-text-muted hover:text-text'
                    )}
                    onClick={() => onChange(option.id)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange(checked: boolean): void; label: string; disabled?: boolean }) {
    return (
        <Switch.Root
            checked={checked}
            onCheckedChange={onChange}
            aria-label={label}
            disabled={disabled}
            className="relative h-5 w-9 shrink-0 rounded-full bg-border-strong p-0.5 transition-colors data-checked:bg-accent data-disabled:opacity-50"
        >
            <Switch.Thumb className="block h-4 w-4 rounded-full bg-surface-raised shadow-node transition-transform data-checked:translate-x-4" />
        </Switch.Root>
    );
}

interface StepperProps {
    value: number;
    min: number;
    max: number;
    step: number;
    unit?: string;
    label: string;
    onChange(value: number): void;
}

/* A number between minus and plus, in one sunken group so the three read as a single control. */
export function Stepper({ value, min, max, step, unit, label, onChange }: StepperProps) {
    const { t } = useTranslation('settings');
    const nudge = (direction: -1 | 1): void => {
        const next = Math.round((value + direction * step) * 100) / 100;
        onChange(Math.min(max, Math.max(min, next)));
    };
    return (
        <div className={`${BTN_GROUP} shrink-0 rounded-lg bg-surface-sunken p-0.5`} role="group" aria-label={label}>
            <Tooltip label={t('controls.stepper.smaller')}>
                <button
                    className="icon-btn icon-btn-sm"
                    aria-label={t('controls.stepper.smallerFor', { label })}
                    disabled={value <= min}
                    onClick={() => nudge(-1)}
                >
                    <Icon icon={Minus} size={14} />
                </button>
            </Tooltip>
            <span className="min-w-10 px-1 text-center text-xs text-text tabular-nums" aria-live="polite">
                {value}
                {unit}
            </span>
            <Tooltip label={t('controls.stepper.larger')}>
                <button
                    className="icon-btn icon-btn-sm"
                    aria-label={t('controls.stepper.largerFor', { label })}
                    disabled={value >= max}
                    onClick={() => nudge(1)}
                >
                    <Icon icon={Plus} size={14} />
                </button>
            </Tooltip>
        </div>
    );
}

/* A bar where a value will be, while the daemon has not answered yet. */
export function Skeleton({ className }: { className?: string }) {
    return <span className={clsx('block h-4 animate-pulse rounded bg-surface-sunken', className)} aria-hidden />;
}
