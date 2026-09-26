import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../Icon.tsx';

export interface SettingsSectionProps {
    title?: string;
    description?: ReactNode;
    /* Drawn before the title, muted, for a pane whose sections are kinds of thing. */
    icon?: LucideIcon;
    /* A tag on the header line, after the action, such as where the settings apply. */
    tag?: ReactNode;
    /* A small control on the header line, aligned right. */
    action?: ReactNode;
    /* A note under the card, in the faint color. */
    footer?: ReactNode;
    children: ReactNode;
}

/* A titled group of rows in one card; rows divide themselves with a hairline. Without a title it is the card alone. */
export function SettingsSection({ title, description, icon, tag, action, footer, children }: SettingsSectionProps) {
    const hasHeader = title !== undefined || description !== undefined || tag !== undefined || action !== undefined;
    return (
        <section className="flex min-w-0 flex-col gap-2.5" aria-label={title}>
            {hasHeader && (
                <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
                    <div className="min-w-0 grow basis-48">
                        {title !== undefined && (
                            <h3 className="flex items-center gap-2 text-sm font-medium text-text">
                                {icon && <Icon icon={icon} size={14} className="shrink-0 text-text-faint" />}
                                {title}
                            </h3>
                        )}
                        {description !== undefined && <p className="mt-0.5 text-xs break-words text-text-muted">{description}</p>}
                    </div>
                    {action}
                    {tag}
                </div>
            )}
            <div className="min-w-0 divide-y divide-border rounded-xl border border-border bg-surface bg-clip-padding">{children}</div>
            {footer && <p className="text-xs text-text-faint">{footer}</p>}
        </section>
    );
}
