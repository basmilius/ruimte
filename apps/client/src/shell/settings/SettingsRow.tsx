import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';

/* How long a row a search result jumped to stays lit. */
const TARGET_MS = 1600;

interface SettingsRowProps {
    label: ReactNode;
    description?: ReactNode;
    /* The control, aligned right; it carries its own accessible name. */
    control?: ReactNode;
    /* Content under the label line that needs the whole width, like a list of swatches. */
    children?: ReactNode;
    /* Where the row only shows state, its whole line reads a shade softer. */
    muted?: boolean;
    /* Before the label, held to its first line (`TopIcon`) or a tile of its own. */
    leading?: ReactNode;
    /* A row that only makes sense under the one above it steps in. */
    indent?: boolean;
    /* The entry in `search.ts` that leads here. */
    searchId?: string;
}

/* An icon beside text that may wrap: the box is one line of `text-sm` high, so the icon sits on the first line. */
export function TopIcon({ icon, size = 16, className }: { icon: LucideIcon; size?: number; className?: string }) {
    return (
        <span className="flex h-5.5 shrink-0 items-center">
            <Icon icon={icon} size={size} className={className} />
        </span>
    );
}

/*
 * One setting: what it is on the left, the control on the right. Where the two do not fit side by
 * side (a tablet, a narrow window) the control wraps under the label instead of widening the dialog.
 */
export function SettingsRow({ label, description, control, children, muted = false, leading, indent = false, searchId }: SettingsRowProps) {
    const ref = useRef<HTMLDivElement>(null);
    const targeted = useUi((s) => searchId !== undefined && s.settings.target === searchId);

    useEffect(() => {
        if (!targeted) {
            return;
        }
        ref.current?.scrollIntoView({ block: 'center' });
        const timer = window.setTimeout(() => useUi.getState().setSettings({ target: null }), TARGET_MS);
        return () => window.clearTimeout(timer);
    }, [targeted]);

    return (
        <div
            ref={ref}
            data-settings-row={searchId}
            className={clsx(
                'flex min-w-0 flex-col gap-3 pr-4.5 transition-colors duration-500 first:rounded-t-xl last:rounded-b-xl',
                indent ? 'pl-14.5' : 'pl-4.5',
                description || children || leading ? 'py-3.5' : 'py-3',
                targeted && 'bg-accent-soft duration-0'
            )}
        >
            <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex min-w-0 grow basis-60 items-start gap-3">
                    {leading}
                    <div className="min-w-0 grow">
                        <div className={clsx('text-sm break-words', muted ? 'text-text-muted' : 'text-text')}>{label}</div>
                        {description && <div className="mt-0.5 text-xs break-words text-text-muted">{description}</div>}
                    </div>
                </div>
                {control && <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">{control}</div>}
            </div>
            {children}
        </div>
    );
}
