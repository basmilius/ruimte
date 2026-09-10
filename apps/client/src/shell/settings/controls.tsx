import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Switch } from '@base-ui-components/react/switch';
import { faMinus, faPlus } from '@fortawesome/duotone-regular-svg-icons';
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
    label
}: {
    value: T;
    options: readonly Option<T>[];
    onChange(id: T): void;
    label: string;
}) {
    return (
        <div className="flex h-8 items-center rounded-lg bg-surface-sunken p-0.5 text-[12px] font-medium" role="radiogroup" aria-label={label}>
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

export const selectClass =
    'h-8 max-w-56 rounded-lg border border-border bg-surface-raised px-2 text-[12px] text-text outline-none focus-visible:ring-1 focus-visible:ring-accent';

export function SelectControl({ value, onChange, label, children }: { value: string; onChange(value: string): void; label: string; children: ReactNode }) {
    return (
        <select className={selectClass} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
            {children}
        </select>
    );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(checked: boolean): void; label: string }) {
    return (
        <Switch.Root
            checked={checked}
            onCheckedChange={onChange}
            aria-label={label}
            className="relative h-5 w-9 shrink-0 rounded-full bg-border-strong p-0.5 transition-colors data-checked:bg-accent"
        >
            <Switch.Thumb className="block h-4 w-4 rounded-full bg-surface-raised shadow-sm transition-transform data-checked:translate-x-4" />
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

/* A number with minus and plus; the buttons form one group so they read as a single control. */
export function Stepper({ value, min, max, step, unit, label, onChange }: StepperProps) {
    const nudge = (direction: -1 | 1): void => {
        const next = Math.round((value + direction * step) * 100) / 100;
        onChange(Math.min(max, Math.max(min, next)));
    };
    return (
        <div className="flex items-center gap-2" role="group" aria-label={label}>
            <span className="min-w-12 text-right text-[12px] tabular-nums text-text" aria-live="polite">
                {value}
                {unit}
            </span>
            <div className="btn-group rounded-lg bg-surface-sunken p-0.5">
                <Tooltip label="Smaller">
                    <button className="icon-btn h-7 w-7" aria-label={`${label}: smaller`} disabled={value <= min} onClick={() => nudge(-1)}>
                        <Icon icon={faMinus} size={13} />
                    </button>
                </Tooltip>
                <Tooltip label="Larger">
                    <button className="icon-btn h-7 w-7" aria-label={`${label}: larger`} disabled={value >= max} onClick={() => nudge(1)}>
                        <Icon icon={faPlus} size={13} />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}

export function Kbd({ children }: { children: ReactNode }) {
    return <kbd className="rounded-md border border-border bg-surface-sunken px-1.5 py-0.5 font-sans text-[11px] text-text-muted">{children}</kbd>;
}

/* A few keys in a row, `⌘` and `K` for one chord, separated by a thin gap. */
export function Keys({ keys }: { keys: string }) {
    return (
        <span className="flex items-center gap-1">
            {keys.split(' ').map((part, index) => (
                <Kbd key={`${part}-${index}`}>{part}</Kbd>
            ))}
        </span>
    );
}

export function Badge({ tone, children }: { tone: 'idle' | 'muted' | 'accent'; children: ReactNode }) {
    return (
        <span
            className={clsx(
                'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                tone === 'idle' && 'bg-status-idle/15 text-status-idle',
                tone === 'accent' && 'bg-accent-soft text-accent',
                tone === 'muted' && 'bg-surface-sunken text-text-muted'
            )}
        >
            {children}
        </span>
    );
}

export const buttonClass =
    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3 text-[12px] font-medium text-text hover:bg-surface-sunken disabled:opacity-50 disabled:hover:bg-surface-raised';
