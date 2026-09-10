import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Switch } from '@base-ui-components/react/switch';
import { Minus, Plus } from 'lucide-react';
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
        <div className="flex h-8 items-center rounded-lg bg-surface-sunken p-0.5 text-xs font-medium" role="radiogroup" aria-label={label}>
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
            <span className="min-w-12 text-right text-xs tabular-nums text-text" aria-live="polite">
                {value}
                {unit}
            </span>
            <div className="btn-group rounded-lg bg-surface-sunken p-0.5">
                <Tooltip label="Smaller">
                    <button className="icon-btn h-7 w-7" aria-label={`${label}: smaller`} disabled={value <= min} onClick={() => nudge(-1)}>
                        <Icon icon={Minus} size={16} />
                    </button>
                </Tooltip>
                <Tooltip label="Larger">
                    <button className="icon-btn h-7 w-7" aria-label={`${label}: larger`} disabled={value >= max} onClick={() => nudge(1)}>
                        <Icon icon={Plus} size={16} />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}

export function Kbd({ children }: { children: ReactNode }) {
    return <kbd className="rounded-md border border-border bg-surface-sunken px-1.5 py-0.5 font-sans text-xs text-text-muted">{children}</kbd>;
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

/* A bar where a value will be, while the daemon has not answered yet. */
export function Skeleton({ className }: { className?: string }) {
    return <span className={clsx('block h-4 animate-pulse rounded bg-surface-sunken', className)} aria-hidden />;
}

export function Badge({ tone, children }: { tone: 'idle' | 'muted' | 'accent'; children: ReactNode }) {
    return (
        <span
            className={clsx(
                'rounded-md px-1.5 py-0.5 text-xs font-medium',
                tone === 'idle' && 'bg-status-idle/15 text-status-idle',
                tone === 'accent' && 'bg-accent-soft text-accent',
                tone === 'muted' && 'bg-surface-sunken text-text-muted'
            )}
        >
            {children}
        </span>
    );
}
