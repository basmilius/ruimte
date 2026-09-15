import type { ReactNode } from 'react';
import clsx from 'clsx';

interface SettingsRowProps {
    label: ReactNode;
    description?: ReactNode;
    /* The control, aligned right; it carries its own accessible name. */
    control?: ReactNode;
    /* Content under the label line that needs the whole width, like a list of swatches. */
    children?: ReactNode;
    /* Where the row only shows state, its whole line reads a shade softer. */
    muted?: boolean;
}

/*
 * One setting: what it is on the left, the control on the right. Where the two do not fit side by
 * side (a tablet, a narrow window) the control wraps under the label instead of widening the dialog.
 */
export function SettingsRow({ label, description, control, children, muted = false }: SettingsRowProps) {
    return (
        <div className={clsx('flex min-w-0 flex-col gap-3 px-4', description || children ? 'py-3' : 'py-2')}>
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 grow basis-60">
                    <div className={clsx('text-sm break-words', muted ? 'text-text-muted' : 'text-text')}>{label}</div>
                    {description && <div className="mt-0.5 text-xs leading-snug break-words text-text-muted">{description}</div>}
                </div>
                {control && <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">{control}</div>}
            </div>
            {children}
        </div>
    );
}
