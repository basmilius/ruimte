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

/* One setting: what it is on the left, the control on the right. */
export function SettingsRow({ label, description, control, children, muted = false }: SettingsRowProps) {
    return (
        <div className={clsx('flex flex-col gap-3 px-4', description || children ? 'py-3' : 'py-2')}>
            <div className="flex items-center gap-4">
                <div className="min-w-0 grow">
                    <div className={clsx('text-sm', muted ? 'text-text-muted' : 'text-text')}>{label}</div>
                    {description && <div className="mt-0.5 text-xs leading-snug text-text-muted">{description}</div>}
                </div>
                {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
            </div>
            {children}
        </div>
    );
}
